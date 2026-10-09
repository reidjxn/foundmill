/**
 * Streamed structured output, shared by the live and the mock client (audit P1, docs/ARCHITECTURE.md §6).
 *
 * `runStructuredStream()` owns everything above one model stream: scanning the JSON as it arrives
 * (`JsonElementScanner`), validating each completed element against the element schema and delivering it, restarting
 * or resuming a stream that broke, repairing only the elements that failed validation, one full repair when the
 * document itself is wrong, and the final validation against the full schema. The client supplies `streamCall` (one
 * model stream, with its own connection-phase retries, rate limiting and usage metering) and `complete` (used for
 * element repairs).
 *
 * Invariant callers rely on: every element delivered to `onElement` is in the final `json` at its index (a regenerated
 * document never replaces a delivered element: delivered elements are "pinned"), and every element of the final array
 * is delivered exactly once.
 */
import { z } from "zod";
import { ModelAbortedError, ModelOutputError, ModelUnavailableError } from "./errors";
import { parseJsonLoose } from "./json";
import { type MeterResult, ZERO_USAGE, addUsage, estimateTokens, sumMeters } from "./pricing";
import type { ModelId, ModelKey } from "./routing";
import { JsonElementScanner, arrayAtPath, elementPathKeys, getAtPath } from "./stream-json";
import type {
  ChatMessage,
  CompleteRequest,
  CompleteResultWithJson,
  Effort,
  ModelClient,
  ModelLogger,
  ModelMode,
  StopReason,
  StreamPhase,
  StreamProgress,
  StreamStructuredRequest,
  StreamStructuredResult,
  Speed,
  TokenUsage,
} from "./types";

/** Default minimum interval between two `onPartial` calls while text streams. */
export const DEFAULT_PARTIAL_THROTTLE_MS = 200;
/** Restarts or resumes allowed after a stream breaks mid-way (on top of the per-call connection retries). */
export const MAX_STREAM_INTERRUPTIONS = 2;

/** One model stream. `onText` is awaited for every delta (it may deliver elements, which may be slow). */
export interface StreamCallArgs {
  messages: readonly ChatMessage[];
  /** Call number within the request (0 = first stream); forwarded to usage events. */
  call: number;
  onText(delta: string): Promise<void>;
}

export interface StreamCallResult {
  text: string;
  stopReason: StopReason;
  usage: TokenUsage;
  cost: MeterResult;
  requestId?: string;
  stopDetails?: unknown;
  speed?: Speed;
}

/**
 * A stream that broke after it connected (dropped connection, mid-stream `overloaded_error`). Carries what arrived so
 * the orchestrator can resume. Errors that must not be retried (abort, 4xx, a throwing `onElement`) are thrown as is.
 */
export class StreamInterruptedError extends Error {
  constructor(
    message: string,
    readonly partialText: string,
    readonly usage: TokenUsage | undefined,
    readonly cost: MeterResult | undefined,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StreamInterruptedError";
  }
}

export interface StructuredStreamDeps {
  mode: ModelMode;
  modelId: ModelId;
  modelKey: ModelKey;
  warning?: string;
  effort?: Effort;
  speed?: Speed;
  streamCall(args: StreamCallArgs): Promise<StreamCallResult>;
  complete<X>(req: CompleteRequest<X> & { schema: z.ZodType<X> }): Promise<CompleteResultWithJson<X>>;
  logger?: ModelLogger;
  now?: () => number;
  maxInterruptions?: number;
  /** maxTokens the request runs with (sizes element repairs). */
  maxTokens: number;
}

interface FailedElement {
  raw?: string;
  issues: string[];
}

export async function runStructuredStream<T, E>(req: StreamStructuredRequest<T, E>, deps: StructuredStreamDeps): Promise<StreamStructuredResult<T, E>> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const path = req.elementPath;
  const pathKeys = elementPathKeys(path);
  const throttleMs = req.partialThrottleMs ?? DEFAULT_PARTIAL_THROTTLE_MS;
  const maxInterruptions = deps.maxInterruptions ?? MAX_STREAM_INTERRUPTIONS;

  /** Raw JSON of every delivered element, by index: the value the final document keeps. */
  const pins = new Map<number, unknown>();
  /** Parsed (element-schema) value of every delivered element. */
  const delivered = new Map<number, E>();
  const fromLaterCall = new Set<number>();
  let failed = new Map<number, FailedElement>();

  let usage: TokenUsage = ZERO_USAGE;
  const meters: MeterResult[] = [];
  let calls = 0;
  let requestId: string | undefined;
  let speed: Speed | undefined = deps.speed;
  let firstTextMs: number | undefined;
  let firstElementMs: number | undefined;
  let repaired = false;

  let phase: StreamPhase = "waiting";
  let scanner: JsonElementScanner | undefined;
  let currentCall = 0;
  let lastPartialAt = Number.NEGATIVE_INFINITY;

  const report = (force: boolean) => {
    if (!req.onPartial) return;
    const t = now();
    if (!force && t - lastPartialAt < throttleMs) return;
    lastPartialAt = t;
    const s = scanner;
    const progress: StreamProgress = {
      route: req.route,
      phase,
      call: currentCall,
      chars: s?.text.length ?? 0,
      elementsEmitted: delivered.size,
      elementsFailed: failed.size,
      writingIndex: s?.writingIndex ?? null,
      elapsedMs: t - started,
      snapshot: () => s?.snapshot(),
    };
    try {
      req.onPartial(progress);
    } catch (error) {
      deps.logger?.warn({ route: req.route, err: error instanceof Error ? error.message : String(error) }, "onPartial threw; ignored");
    }
  };
  const setPhase = (p: StreamPhase) => {
    phase = p;
    report(true);
  };

  const deliver = async (index: number, raw: unknown, value: E, later: boolean) => {
    pins.set(index, raw);
    delivered.set(index, value);
    failed.delete(index);
    if (later) fromLaterCall.add(index);
    firstElementMs ??= now() - started;
    report(true);
    if (req.onElement) await req.onElement({ index, value, path, repaired: later, elapsedMs: now() - started });
  };

  /** A scanned element: deliver it, record it as failed, or ignore it (already pinned). */
  const consider = async (index: number, raw: string, later: boolean) => {
    if (pins.has(index)) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      failed.set(index, { raw, issues: [`element is not valid JSON: ${(error as Error).message}`] });
      report(true);
      return;
    }
    const parsed = req.elementSchema.safeParse(value);
    if (!parsed.success) {
      failed.set(index, { raw, issues: formatIssues(parsed.error.issues) });
      report(true);
      return;
    }
    await deliver(index, value, parsed.data, later);
  };

  const account = (u: TokenUsage | undefined, cost: MeterResult | undefined, id?: string) => {
    if (u) usage = addUsage(usage, u);
    if (cost) meters.push(cost);
    if (id) requestId = id;
  };

  /** One stream over `messages`, scanned and delivered as it arrives. `later`: a resumed or repair stream. */
  const streamOnce = async (messages: readonly ChatMessage[], later: boolean): Promise<StreamCallResult> => {
    const call = calls++;
    currentCall = call;
    failed = new Map();
    const s = new JsonElementScanner({ path });
    scanner = s;
    report(true);
    const result = await deps.streamCall({
      messages,
      call,
      onText: async (delta) => {
        if (firstTextMs === undefined) firstTextMs = now() - started;
        // The first JSON character ends the thinking wait: report that change at once, not at the next throttle tick.
        const firstText = phase === "waiting" || phase === "retrying";
        if (firstText) phase = "streaming";
        const found = s.feed(delta);
        if (firstText && found.length === 0) report(true);
        for (const el of found) await consider(el.index, el.raw, later);
        report(false);
      },
    });
    account(result.usage, result.cost, result.requestId);
    if (result.speed) speed = result.speed;
    return result;
  };

  /** A stream with restarts (nothing delivered yet) or resumes (pinned elements kept) after interruptions. */
  let interruptions = 0;
  const generate = async (messages: readonly ChatMessage[], repairing: boolean): Promise<{ result: StreamCallResult; messages: readonly ChatMessage[]; later: boolean }> => {
    let current = messages;
    let later = repairing;
    for (;;) {
      try {
        return { result: await streamOnce(current, later), messages: current, later };
      } catch (error) {
        if (!(error instanceof StreamInterruptedError)) throw error;
        account(error.usage, error.cost);
        if (req.signal?.aborted) throw new ModelAbortedError();
        if (interruptions >= maxInterruptions) {
          throw new ModelUnavailableError(`The stream for route "${req.route}" broke ${interruptions + 1} times: ${error.message}`, { delivered: delivered.size, cause: error.cause instanceof Error ? error.cause.message : undefined });
        }
        interruptions++;
        deps.logger?.warn({ route: req.route, delivered: delivered.size, interruptions, err: error.message }, "model stream interrupted; retrying");
        if (pins.size > 0) {
          // Resume: the model rewrites the document; the elements already delivered stay pinned at their index.
          current = [...current, { role: "assistant", content: error.partialText.trim() || "(no output)" }, { role: "user", content: resumePrompt(path, [...pins.keys()]) }];
          later = true;
        }
        setPhase("retrying");
      }
    }
  };

  /** Parse the final text, write the pinned elements back, and check every element and the whole document. */
  const evaluate = async (text: string, later: boolean): Promise<{ ok: true; data: T; doc: unknown } | { ok: false; issues: string[]; rootIssues: string[] }> => {
    const parsed = parseJsonLoose(text);
    if (!parsed.ok) {
      const issue = `output is not JSON: ${parsed.error}`;
      return { ok: false, issues: [issue], rootIssues: [issue] };
    }
    const doc = parsed.value;
    const arr = arrayAtPath(doc, path, pins.size > 0);
    if (arr) {
      for (const [index, raw] of pins) arr[index] = structuredClone(raw);
      // Elements the scanner did not report (text outside the scanned value) are checked and delivered here.
      for (let i = 0; i < arr.length; i++) {
        if (pins.has(i) || failed.has(i)) continue;
        const el = req.elementSchema.safeParse(arr[i]);
        if (el.success) await deliver(i, arr[i], el.data, later);
        else failed.set(i, { raw: safeStringify(arr[i]), issues: formatIssues(el.error.issues) });
      }
    }
    const full = req.schema.safeParse(doc);
    const rootIssues: string[] = [];
    const fullIssueIndices = new Set<number>();
    const issues: string[] = [];
    if (!full.success) {
      for (const issue of full.error.issues) {
        const index = elementIndexOf(issue.path, pathKeys);
        const line = formatIssue(issue);
        issues.push(line);
        if (index === undefined) rootIssues.push(line);
        else {
          fullIssueIndices.add(index);
          if (!failed.has(index)) failed.set(index, { raw: safeStringify(arr?.[index]), issues: [line] });
        }
      }
    }
    if (full.success && failed.size === 0) return { ok: true, data: full.data, doc };
    // Elements that fail only the element schema still need a repair: name them in the issues too.
    for (const [i, f] of failed) if (!fullIssueIndices.has(i)) issues.push(...f.issues.map((x) => `${path}.${i} (element): ${x}`));
    return { ok: false, issues, rootIssues };
  };

  const repairElements = async (messages: readonly ChatMessage[], text: string): Promise<void> => {
    const targets = [...failed.entries()].filter(([i]) => !pins.has(i));
    setPhase("repairing");
    const results = await Promise.all(
      targets.map(async ([index, f]) => {
        const rawTokens = estimateTokens(f.raw ?? "");
        try {
          const res = await deps.complete({
            route: req.route,
            system: req.system,
            cacheSystem: req.cacheSystem,
            modelOverride: req.modelOverride,
            scope: req.scope,
            attribution: req.attribution,
            effort: req.effort,
            signal: req.signal,
            schema: req.elementSchema,
            maxTokens: Math.min(deps.maxTokens, Math.max(1024, rawTokens * 2 + 1024)),
            reserveTokens: rawTokens + 512,
            messages: [...messages, { role: "assistant", content: text.trim() || "(empty response)" }, { role: "user", content: elementRepairPrompt(path, index, f.issues) }],
          });
          calls++;
          account(res.usage, res.cost, res.requestId);
          const raw = parseJsonLoose(res.text);
          return { index, value: res.json, raw: raw.ok ? raw.value : res.json };
        } catch (error) {
          if (error instanceof ModelAbortedError) throw error;
          deps.logger?.warn({ route: req.route, index, err: error instanceof Error ? error.message : String(error) }, "element repair failed");
          return undefined;
        }
      }),
    );
    for (const r of results.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))) {
      if (!r) continue;
      await deliver(r.index, r.raw, r.value, true);
    }
    repaired = repaired || results.some(Boolean);
  };

  let messages: readonly ChatMessage[] = [...req.messages];
  let fullRepairs = 0;
  let elementRepairs = 0;
  for (;;) {
    const { result, messages: used, later } = await generate(messages, fullRepairs > 0);
    messages = used;
    if (result.stopReason === "refusal") {
      throw new ModelOutputError(`Model refused the request for route "${req.route}"`, { stopDetails: result.stopDetails, requestId: result.requestId, delivered: delivered.size }, "refusal");
    }
    let verdict = await evaluate(result.text, later);
    if (verdict.ok) return finish(verdict.data, result, verdict.doc);
    if (result.stopReason === "max_tokens") {
      throw new ModelOutputError(`Output truncated at max_tokens=${deps.maxTokens} before valid JSON was produced for route "${req.route}"`, { issues: verdict.issues, requestId: result.requestId, delivered: delivered.size, elements: [...delivered.entries()].sort(([a], [b]) => a - b).map(([index, value]) => ({ index, value })) }, "max_tokens");
    }
    if (verdict.rootIssues.length === 0 && failed.size > 0 && elementRepairs === 0 && isObjectSchema(req.elementSchema)) {
      elementRepairs++;
      await repairElements(messages, result.text);
      verdict = await evaluate(result.text, true);
      if (verdict.ok) return finish(verdict.data, result, verdict.doc);
    }
    if (fullRepairs >= 1) {
      throw new ModelOutputError(`Model output did not match the schema for route "${req.route}" after one repair retry`, { issues: verdict.issues, text: result.text.slice(0, 2000), requestId: result.requestId, delivered: delivered.size });
    }
    fullRepairs++;
    repaired = true;
    deps.logger?.info({ route: req.route, issues: verdict.issues.slice(0, 10), requestId: result.requestId, delivered: delivered.size }, "streamed output failed validation; asking the model to repair its JSON");
    messages = [...messages, { role: "assistant", content: result.text.trim() ? result.text : "(empty response)" }, { role: "user", content: repairPrompt(verdict.issues, path, [...pins.keys()]) }];
    setPhase("repairing");
  }

  function finish(data: T, last: StreamCallResult, doc: unknown): StreamStructuredResult<T, E> {
    const finalArray = getAtPath(data, path);
    const docArray = arrayAtPath(doc, path) ?? [];
    if (!Array.isArray(finalArray) && !arrayAtPath(doc, path)) deps.logger?.warn({ route: req.route, elementPath: path }, "elementPath does not point at an array in the result; nothing was streamed element by element");
    const elements: E[] = (Array.isArray(finalArray) ? finalArray : docArray).map((v, i) => {
      const known = delivered.get(i);
      if (known !== undefined) return known;
      const parsed = req.elementSchema.safeParse(v);
      return (parsed.success ? parsed.data : v) as E;
    });
    const modified = fromLaterCall.size > 0 || calls > 1;
    phase = "done";
    report(true);
    return {
      text: modified ? JSON.stringify(doc) : last.text,
      json: data,
      usage,
      model: deps.modelId,
      modelKey: deps.modelKey,
      route: req.route,
      stopReason: last.stopReason,
      cost: sumMeters(meters, deps.modelId),
      mode: deps.mode,
      requestId,
      durationMs: now() - started,
      repaired: repaired || fromLaterCall.size > 0,
      warning: deps.warning,
      ...(deps.effort ? { effort: deps.effort } : {}),
      ...(speed ? { speed } : {}),
      elementPath: path,
      elements,
      repairedElements: [...fromLaterCall].sort((a, b) => a - b),
      firstTextMs,
      firstElementMs,
      calls,
    };
  }
}

/**
 * Stream through `client.streamStructured` when the client has it; otherwise one `complete()` call whose elements are
 * then delivered in order (hand-written test doubles, older clients). Prefer this helper over calling the method.
 */
export async function streamStructured<T, E>(client: ModelClient, req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
  if (typeof client.streamStructured === "function") return client.streamStructured(req);
  const started = Date.now();
  const { elementPath, elementSchema, onElement, onPartial, partialThrottleMs: _throttle, ...rest } = req;
  const result = await client.complete({ ...rest, schema: req.schema });
  const arr = getAtPath(result.json, elementPath);
  const elements: E[] = (Array.isArray(arr) ? arr : []).map((v) => {
    const parsed = elementSchema.safeParse(v);
    return (parsed.success ? parsed.data : v) as E;
  });
  let firstElementMs: number | undefined;
  for (const [index, value] of elements.entries()) {
    firstElementMs ??= Date.now() - started;
    if (onElement) await onElement({ index, value, path: elementPath, repaired: false, elapsedMs: Date.now() - started });
  }
  onPartial?.({ route: req.route, phase: "done", call: 0, chars: result.text.length, elementsEmitted: elements.length, elementsFailed: 0, writingIndex: null, elapsedMs: Date.now() - started, snapshot: () => result.json });
  return { ...result, elementPath, elements, repairedElements: [], firstElementMs, calls: 1 };
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

/** The element index an issue path points into, when it is inside the streamed array (`["concepts", 3, ...]`). */
export function elementIndexOf(issuePath: readonly PropertyKey[], pathKeys: readonly string[]): number | undefined {
  if (issuePath.length <= pathKeys.length) return undefined;
  for (let i = 0; i < pathKeys.length; i++) if (issuePath[i] !== pathKeys[i]) return undefined;
  const index = issuePath[pathKeys.length];
  return typeof index === "number" ? index : undefined;
}

function formatIssue(issue: { path: readonly PropertyKey[]; message: string }): string {
  return `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`;
}

function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string[] {
  return issues.map(formatIssue);
}

function safeStringify(v: unknown): string | undefined {
  try {
    return v === undefined ? undefined : JSON.stringify(v);
  } catch {
    return undefined;
  }
}

/** Element repair needs an object schema: structured outputs require an object at the root. */
function isObjectSchema(schema: z.ZodType): boolean {
  try {
    return (z.toJSONSchema(schema, { unrepresentable: "any" }) as { type?: unknown }).type === "object";
  } catch {
    return false;
  }
}

function elementRepairPrompt(path: string, index: number, issues: string[]): string {
  return [
    `Element ${index} of "${path}" in your previous reply (counting from 0) did not pass validation.`,
    "Validation issues:",
    ...issues.slice(0, 20).map((i) => `- ${i}`),
    `Return ONLY that one element, corrected, as a JSON object. Keep its content and intent; change only what the issues require. No prose, no code fences.`,
  ].join("\n");
}

function keptNote(path: string, kept: number[]): string[] {
  if (kept.length === 0) return [];
  const list = kept.sort((a, b) => a - b).join(", ");
  return [`The elements of "${path}" at positions ${list} (counting from 0) have already been accepted: repeat them exactly as they were, at the same positions.`];
}

function resumePrompt(path: string, kept: number[]): string {
  return [
    "Your previous reply was cut off by a network error before it finished.",
    ...keptNote(path, kept),
    "Reply again with the COMPLETE JSON object from the beginning. No prose, no code fences.",
  ].join("\n");
}

function repairPrompt(issues: string[], path: string, kept: number[]): string {
  return [
    "Your previous reply was not valid for the required JSON schema.",
    "Validation issues:",
    ...issues.slice(0, 20).map((i) => `- ${i}`),
    ...keptNote(path, kept),
    "Return ONLY the corrected JSON object that satisfies the schema. No prose, no code fences, no explanation.",
  ].join("\n");
}
