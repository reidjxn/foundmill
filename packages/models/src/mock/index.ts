/**
 * Deterministic mock model client (docs/ARCHITECTURE.md §6, BUILD §13.3 spirit).
 *
 * Every completion is keyed by `stableHash({ route, system, messages, schema })`; the same input always produces the
 * same output. Each route has a handcrafted generator that reads the real input (see ./inputs.ts for the conventions);
 * when the caller's schema is stricter than or different from the generator's default shape, a schema-driven
 * synthesizer produces a valid value instead, so `complete({ schema })` never fails in mock mode for a representable
 * schema.
 */
import { z } from "zod";
import { ModelAbortedError, ModelOutputError } from "../errors";
import { seededRng, stableHash } from "../hash";
import { parseJsonLoose } from "../json";
import { type MeterResult, addUsage, estimateTokens, meter, sumMeters } from "../pricing";
import { MODELS, type ModelId, type ModelKey, ROUTES, type RouteKey, resolveModel } from "../routing";
import {
  CategoriserOutput,
  ClassifierOutput,
  CoachOutput,
  CodeReviewOutput,
  CommentaryOutput,
  ComposerOutput,
  CyclePlanOutput,
  DepartmentLeadOutput,
  FoundationsOutput,
  FoundationsSkeletonOutput,
  IdeationOutput,
  IdeationSlateOutput,
  LinkerOutput,
  LogoDesignOutput,
  ModerationOutput,
  NightlyBatchOutput,
  PlanOutput,
  QuarantinedReaderOutput,
  SkillGradeOutput,
  TaskGraphOutput,
  WorkerOutput,
  AgentReplyOutput,
} from "../schemas";
import { JsonElementScanner } from "../stream-json";
import { type StreamCallArgs, type StreamCallResult, runStructuredStream } from "../structured-stream";
import type { BilledTo, CompleteRequest, CompleteResult, CompleteResultWithJson, ModelClient, ModelLogger, StreamStructuredRequest, StreamStructuredResult, TokenUsage, UsageEvent, UsageSink } from "../types";
import { generateChannelCreative, isChannelCreativeRequest } from "./channelCreative";
import { generateChiefOfStaff } from "./chiefOfStaff";
import { generateCategoriser, generateClassifier } from "./classifier";
import { generateCoach } from "./coach";
import { generateCodeReview } from "./codeReview";
import { generateDepartmentLead } from "./departmentLead";
import { generateFoundationsSkeleton, generateIdeationSlate } from "./drafts";
import { generateFoundations } from "./foundations";
import { generateIdeationRoute } from "./ideation";
import { generateInboxComposer } from "./inboxComposer";
import { type MockContext, buildMockContext, keywords } from "./inputs";
import { generateJourneyCommentary } from "./journeyCommentary";
import { generateLinker } from "./linker";
import { generateLogoDesigner } from "./logoDesigner";
import { generateModeration } from "./moderation";
import { generatePlanCompiler } from "./planCompiler";
import { generatePlanner } from "./planner";
import { generateQuarantinedReader } from "./quarantinedReader";
import { generateSkillGrader } from "./skillGrader";
import { generateSourceProposal, generateSourceRelevance, isSourceProposalRequest, isSourceRelevanceRequest } from "./sourceWatcher";
import { synthesizeFromZod } from "./synth";
import { generateNightlyBatch, generateWorker } from "./worker";
import { generateConversation } from "./conversation";

export type MockGenerator = (ctx: MockContext) => unknown;

export interface MockRouteDefinition {
  route: RouteKey;
  description: string;
  /** Default output schema of the handcrafted generator. */
  schema: z.ZodType;
  generate: MockGenerator;
}

export const MOCK_ROUTES: Record<RouteKey, MockRouteDefinition> = {
  inboxComposer: { route: "inboxComposer", description: "One inbox note (fact → why → ask) in the from-agent's voice; Composer schema; manifest-only mentions; no invented numbers.", schema: ComposerOutput, generate: generateInboxComposer },
  planCompiler: { route: "planCompiler", description: "Founder free text → Plan of typed actions; hard gates → request_human_action; ambiguous → reply_only.", schema: PlanOutput, generate: generatePlanCompiler },
  chiefOfStaff: { route: "chiefOfStaff", description: "Cycle plan from open tasks within concurrency, budget and capacity; customer-unblocking work first.", schema: CyclePlanOutput, generate: generateChiefOfStaff },
  departmentLead: { route: "departmentLead", description: "Department task assignments, blockers and a short report; drafts a spec change from a source for the Source Watcher.", schema: DepartmentLeadOutput, generate: (ctx) => (isSourceProposalRequest(ctx) ? generateSourceProposal(ctx) : generateDepartmentLead(ctx)) },
  planner: { route: "planner", description: "Roadmap items → task graph with acceptance criteria, test expectations, file-scope hints and dependencies.", schema: TaskGraphOutput, generate: generatePlanner },
  codeReview: { route: "codeReview", description: "Deterministic review of a unified diff against the platform rules.", schema: CodeReviewOutput, generate: generateCodeReview },
  ideation: { route: "ideation", description: "6–12 concept cards with 10 attributes (1–20), evidence and ≥ 2 citations, seeded by the prompt; one card (keeping the slate item's name, archetype and angle) when the schema is a single card.", schema: IdeationOutput, generate: generateIdeationRoute },
  ideationSlate: { route: "ideationSlate", description: "The 6–12 names, archetypes and one-line angles of an ideation set, drafted by the ideation mock for the same prompt.", schema: IdeationSlateOutput, generate: generateIdeationSlate },
  logoDesigner: { route: "logoDesigner", description: "N distinct geometric logo marks as SVG on a 100 × 100 tile, in the brand colors; never a shield, badge, star or ball.", schema: LogoDesignOutput, generate: generateLogoDesigner },
  foundations: { route: "foundations", description: "Vision, Tiptap content for every outline section and a Now/Next/Later roadmap from the idea or the Import report; imported issues become roadmap items; figures labeled.", schema: FoundationsOutput, generate: generateFoundations },
  foundationsSkeleton: { route: "foundationsSkeleton", description: "The foundations vision, a one-sentence thesis per outline section and the roadmap's titles and horizons, from the foundations mock for the same brief.", schema: FoundationsSkeletonOutput, generate: generateFoundationsSkeleton },
  skillGrader: { route: "skillGrader", description: "Rubric grading 0–1 per line; deterministic checks are authoritative.", schema: SkillGradeOutput, generate: generateSkillGrader },
  coach: { route: "coach", description: "Up to 3 instruction diffs for the focus skills; never weakens house rules.", schema: CoachOutput, generate: generateCoach },
  worker: { route: "worker", description: "Generic Sonnet worker: a stepwise plan and artifact list for a task; a channel engine's weekly creative drafts (one per asset kind, from the campaign) when the schema asks for assets.", schema: WorkerOutput, generate: (ctx) => (isChannelCreativeRequest(ctx) ? generateChannelCreative(ctx) : generateWorker(ctx)) },
  journeyCommentary: { route: "journeyCommentary", description: "Customer Update narration: one line per touch, entities linked from the manifest.", schema: CommentaryOutput, generate: generateJourneyCommentary },
  nightlyBatch: { route: "nightlyBatch", description: "Nightly batch job summary with one result per item.", schema: NightlyBatchOutput, generate: generateNightlyBatch },
  linker: { route: "linker", description: "Proper-noun sweep: exact → alias → fuzzy against the manifest; ambiguous and unknown flagged.", schema: LinkerOutput, generate: generateLinker },
  classifier: { route: "classifier", description: "Picks one of the supplied labels by keyword overlap with a confidence; scores a source against spec blocks for the Source Watcher.", schema: ClassifierOutput, generate: (ctx) => (isSourceRelevanceRequest(ctx) ? generateSourceRelevance(ctx) : generateClassifier(ctx)) },
  categoriser: { route: "categoriser", description: "Bank transactions → standard chart of accounts with the rule that fired.", schema: CategoriserOutput, generate: generateCategoriser },
  quarantinedReader: { route: "quarantinedReader", description: "Extracts only the requested fields from untrusted content; instructions inside the content are ignored.", schema: QuarantinedReaderOutput, generate: generateQuarantinedReader },
  moderation: { route: "moderation", description: "Honest-agent and marketing-law pre-send check with flags and an allow/block verdict.", schema: ModerationOutput, generate: generateModeration },
  conversation: { route: "conversation", description: "A reply at the agent's desk: 1-3 bubbles in its voice quoting only figures from the inputs, a hand-off for instructions (never a claim that anything was done), 2-4 quick replies by subject.", schema: AgentReplyOutput, generate: generateConversation },
};

export interface MockRouteInfo {
  route: RouteKey;
  model: ModelId;
  modelKey: ModelKey;
  locked: boolean;
  batch: boolean;
  description: string;
}

/** Every mock route with its resolved model and what the fixture generator does. */
export function listMockRoutes(): MockRouteInfo[] {
  return (Object.keys(ROUTES) as RouteKey[]).map((route) => {
    const r = resolveModel(route);
    return { route, model: r.modelId, modelKey: r.modelKey, locked: r.locked, batch: r.batch, description: MOCK_ROUTES[route].description };
  });
}

export interface MockModelClientOptions {
  /** Who pays for calls made through this client (default `credits`); see `LiveModelClientOptions.billedTo`. */
  billedTo?: BilledTo;
  onUsage?: UsageSink;
  logger?: ModelLogger;
  /** Replace the generator for a route (tests, scenario fixtures, recorded sessions). */
  overrides?: Partial<Record<RouteKey, MockGenerator>>;
  /** Simulated latency per call in ms (default 0): the whole wait of `complete()`, the time to first token of a stream. */
  latencyMs?: number;
  /** Simulated writing time per streamed element in ms (default 0). `createModelClient` reads MOCK_MODEL_STREAM_MS. */
  streamElementMs?: number;
  /** Simulated latency jitter in ms (default 0). */
  latencyJitterMs?: number;
  /** Fail a route with this error on every call (for resilience tests). */
  failWith?: Partial<Record<RouteKey, Error>>;
  sleep?: (ms: number) => Promise<void>;
}

export class MockModelClient implements ModelClient {
  readonly mode = "mock" as const;
  /** Every request seen, oldest first (tests and the dev Simulate panel). */
  readonly history: CompleteRequest[] = [];
  private readonly seenSystems = new Set<string>();
  private readonly opts: MockModelClientOptions;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: MockModelClientOptions = {}) {
    this.opts = opts;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  complete<T>(req: CompleteRequest<T> & { schema: z.ZodType<T> }): Promise<CompleteResultWithJson<T>>;
  complete(req: CompleteRequest<unknown> & { schema?: undefined }): Promise<CompleteResult<unknown>>;
  async complete<T = unknown>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
    const started = Date.now();
    // Like the live client: an aborted request makes no call, and one aborted during the (simulated) wait answers nothing.
    if (req.signal?.aborted) throw new ModelAbortedError();
    const out = this.produce(req);
    const latency = (this.opts.latencyMs ?? 0) + (this.opts.latencyJitterMs ? Math.round(out.rng.next() * this.opts.latencyJitterMs) : 0);
    if (latency > 0) await this.sleep(latency);
    if (req.signal?.aborted) throw new ModelAbortedError();
    const durationMs = Math.max(latency, Date.now() - started);
    await this.emitUsage(req, out.usage, out.cost, durationMs, 0);

    return {
      text: out.text,
      json: out.json,
      usage: out.usage,
      model: out.resolution.modelId,
      modelKey: out.resolution.modelKey,
      route: req.route,
      stopReason: "end_turn",
      cost: sumMeters([out.cost], out.resolution.modelId),
      mode: "mock",
      durationMs,
      repaired: out.repaired,
      warning: out.resolution.warning,
    };
  }

  /**
   * Streamed structured output with the same contract as the live client. The deterministic fixture is serialised and
   * fed through the same scanner and repair logic; `latencyMs` passes before the first character and `streamElementMs`
   * before each element completes (both 0 by default, so tests and e2e see every element at once, in order).
   */
  async streamStructured<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
    const resolution = resolveModel(req.route, req.modelOverride);
    return runStructuredStream(req, {
      mode: "mock",
      modelId: resolution.modelId,
      modelKey: resolution.modelKey,
      warning: resolution.warning,
      maxTokens: req.maxTokens ?? resolution.maxTokens,
      logger: this.opts.logger,
      streamCall: (args) => this.streamCall(req, args),
      complete: (r) => this.complete(r),
    });
  }

  private async streamCall<T, E>(req: StreamStructuredRequest<T, E>, args: StreamCallArgs): Promise<StreamCallResult> {
    const started = Date.now();
    const { elementPath, elementSchema: _e, onElement: _o, onPartial: _p, partialThrottleMs: _t, ...rest } = req;
    const out = this.produce({ ...rest, messages: args.messages });
    const text = out.text;
    const latency = (this.opts.latencyMs ?? 0) + (this.opts.latencyJitterMs ? Math.round(out.rng.next() * this.opts.latencyJitterMs) : 0);
    const perElement = this.opts.streamElementMs ?? 0;
    const abortIfNeeded = () => {
      if (req.signal?.aborted) throw new ModelAbortedError();
    };
    abortIfNeeded();
    if (latency > 0) await this.sleep(latency);
    abortIfNeeded();
    // Cut the text where each element ends so every element "arrives" in its own delta, after its writing time.
    const ends = new JsonElementScanner({ path: elementPath }).feed(text).map((el) => el.end);
    let at = 0;
    const firstCut = Math.min(text.length, ends.length > 0 ? Math.max(1, Math.floor((ends[0] as number) / 2)) : text.length);
    for (const cut of [firstCut, ...ends, text.length]) {
      if (cut <= at) continue;
      if (perElement > 0 && cut !== firstCut && cut !== text.length) await this.sleep(perElement);
      abortIfNeeded();
      await args.onText(text.slice(at, cut));
      at = cut;
    }
    const durationMs = Math.max(latency + perElement * ends.length, Date.now() - started);
    await this.emitUsage(req, out.usage, out.cost, durationMs, args.call, true);
    return { text, stopReason: "end_turn", usage: out.usage, cost: out.cost };
  }

  /** The deterministic output for a request (no waiting, no usage event). */
  private produce<T>(req: CompleteRequest<T>) {
    this.history.push(req as CompleteRequest);
    const failure = this.opts.failWith?.[req.route];
    if (failure) throw failure;

    const resolution = resolveModel(req.route, req.modelOverride);
    if (resolution.warning) this.opts.logger?.warn({ route: req.route, override: req.modelOverride }, resolution.warning);

    const schemaJson = req.schema ? safeJsonSchema(req.schema) : undefined;
    const hash = stableHash({ route: req.route, system: req.system ?? null, messages: req.messages, schema: schemaJson ?? null });
    const rng = seededRng(hash);
    const schemaKeys = schemaJson && typeof schemaJson.properties === "object" && schemaJson.properties ? Object.keys(schemaJson.properties as Record<string, unknown>) : [];
    const ctx = buildMockContext(req as CompleteRequest, hash, rng, schemaKeys);

    const generate = this.opts.overrides?.[req.route] ?? MOCK_ROUTES[req.route].generate;
    const raw = generate(ctx);

    let json: T | undefined;
    let text: string;
    let repaired = false;
    if (req.schema) {
      const candidate = typeof raw === "string" ? parseJsonLoose(raw) : ({ ok: true, value: raw } as const);
      const first = candidate.ok ? req.schema.safeParse(candidate.value) : undefined;
      if (first?.success) {
        json = first.data;
      } else {
        repaired = true;
        const issues = first ? first.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) : [candidate.ok ? "" : candidate.error];
        this.opts.logger?.debug({ route: req.route, issues }, "mock generator output did not match the caller schema; synthesizing from schema");
        const fallback = synthesizeFromZod(req.schema, seededRng(`${hash}:fallback`), { hints: keywords(ctx.userText || ctx.allText, 6) });
        const second = req.schema.safeParse(fallback);
        if (!second.success) {
          throw new ModelOutputError(`Mock output for route "${req.route}" cannot satisfy the requested schema`, { generatorIssues: issues, fallbackIssues: second.error.issues }, "mock");
        }
        json = second.data;
      }
      text = JSON.stringify(json, null, 2);
    } else {
      text = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
      json = typeof raw === "object" && raw !== null ? (raw as T) : undefined;
    }

    const usage = this.estimateUsage(req, text);
    const cost = meter(usage, resolution.modelId);
    return { resolution, rng, json, text, repaired, usage, cost };
  }

  private async emitUsage(req: Pick<CompleteRequest, "route" | "modelOverride" | "scope" | "attribution">, usage: TokenUsage, cost: MeterResult, durationMs: number, attempt: number, streamed = false): Promise<void> {
    if (!this.opts.onUsage) return;
    const resolution = resolveModel(req.route, req.modelOverride);
    const event: UsageEvent = {
      route: req.route,
      model: resolution.modelId,
      modelKey: resolution.modelKey,
      mode: "mock",
      billedTo: this.opts.billedTo ?? "credits",
      usage,
      cost,
      scope: req.scope,
      attribution: req.attribution,
      durationMs,
      occurredAt: new Date().toISOString(),
      attempt,
      ...(streamed ? { streamed } : {}),
    };
    await this.opts.onUsage(event);
  }

  /** Token estimate: chars/4. With `cacheSystem`, a repeated system prompt is counted as a cache read. */
  private estimateUsage(req: CompleteRequest, outputText: string): TokenUsage {
    const system = Array.isArray(req.system) ? req.system.join("\n\n") : typeof req.system === "string" ? req.system : "";
    const messagesText = req.messages.map((m) => m.content).join("\n");
    const systemTokens = estimateTokens(system);
    let usage: TokenUsage = { inputTokens: estimateTokens(messagesText), outputTokens: estimateTokens(outputText), cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    if (system) {
      if (req.cacheSystem) {
        const key = stableHash(system);
        if (this.seenSystems.has(key)) usage = addUsage(usage, { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: systemTokens });
        else {
          this.seenSystems.add(key);
          usage = addUsage(usage, { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: systemTokens, cacheReadInputTokens: 0 });
        }
      } else usage = addUsage(usage, { inputTokens: systemTokens, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    }
    return usage;
  }
}

function safeJsonSchema(schema: z.ZodType): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export { MODELS };
export type { MockContext } from "./inputs";
export { buildMockContext, extractJsonValues, normaliseManifest, agentsFrom, numbersIn, keywords, wordCount } from "./inputs";
export { synthesizeFromZod, synthesizeFromJsonSchema } from "./synth";
export { compilePlanRuleBased, detectAmounts, detectChannels, detectHardGates, detectAudience, detectTimeframe, inferTaskKind, type PlanCompilerContext, type HardGate, type DetectedAmount } from "./planCompiler";
export { compileOptionPlan, NO_ACTION_OPTION_RE, type DecisionOption, type OptionPlanContext } from "./optionPlan";
export { generateInboxComposer } from "./inboxComposer";
export { generateIdeation, generateConceptCard, generateIdeationRoute, type MockCardSpec } from "./ideation";
export { generateLogoDesigner, MOCK_LOGO_DIRECTION_FAMILIES, MOCK_LOGO_FAMILIES } from "./logoDesigner";
export { generateFoundations } from "./foundations";
export { generateChiefOfStaff, readTasks, scoreTask } from "./chiefOfStaff";
export { generateDepartmentLead } from "./departmentLead";
export { generatePlanner } from "./planner";
export { generateCodeReview, parseDiff } from "./codeReview";
export { generateSkillGrader } from "./skillGrader";
export { generateCoach } from "./coach";
export { generateJourneyCommentary } from "./journeyCommentary";
export { generateLinker, resolve as resolveMention, dice } from "./linker";
export { generateClassifier, generateCategoriser } from "./classifier";
export { generateQuarantinedReader, sanitise as sanitiseUntrusted, requestedFields } from "./quarantinedReader";
export { generateModeration } from "./moderation";
export { generateWorker, generateNightlyBatch } from "./worker";
export { generateConversation } from "./conversation";
