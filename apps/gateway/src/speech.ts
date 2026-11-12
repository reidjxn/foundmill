/**
 * Speech for Team call (docs/TEAM_CALL.md §3): `POST /v1/speech/synthesize` speaks one agent turn, `POST
 * /v1/speech/transcribe` transcribes one recording of the founder. Only the api asks (service token `svc: api`), and only
 * when the `elevenlabs` connector runs live here (`INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` naming it): where it runs
 * its mock the api runs the mock itself and never calls these routes, so the golden path needs no gateway. A gateway still
 * on mock that is asked anyway answers the mock's silent audio, marked `simulated` with the usual notice.
 *
 * What the api sends is a speech accent key and words, never a vendor id: the accent → ElevenLabs id map is the
 * connector's. Checks run in this order, before any vendor call:
 *   1. the accent is one of `SPEECH_ACCENTS` (400 `unknown_speech_accent`);
 *   2. the text is 1 to 600 characters (400 `validation`); a recording is a known type and at most 8 MiB (400);
 *   3. the business's window on the connector (`rl:<businessId>:elevenlabs`, 429 `rate_limited`);
 *   4. the business's spoken characters today (synthesize only): `sp:<businessId>:day`, a Redis INCRBY of the text's
 *      length in a UTC-day window shared by every replica, ceiling `TEAM_CALL_LIMITS.speechCharsPerBusinessPerDay`
 *      (429 `speech_daily_limit`). Like the sending address's daily cap, a live call outside development and test is
 *      refused (503 `speech_store_unavailable`) while the count is not shared (no Redis, or Redis down and the store
 *      counting in this process's memory), because a ceiling nobody else sees caps nothing. The characters are given back
 *      when the call is refused after counting them, when the key is missing, and when the vendor refused outright (a
 *      4xx: nothing was spoken); after a timeout or a 5xx the audio may have been made and billed, so they stay counted.
 * The audit rows (`gateway.speech.synthesized`, `gateway.speech.transcribed`) carry ids, the accent, counts and the mode,
 * never the words said or heard. The cost is booked to the usage ledger as a tool row labeled Estimate, in USD (the
 * vendor's currency). Vendor failures reach the api as a code, a status and a fixed sentence, never the vendor's words.
 * A missing ELEVENLABS_API_KEY is 503 `speech_unconfigured`.
 */
import { z } from "zod";
import { isConfigError, decodedBytes, ELEVENLABS_KEY, mockIntegrationRecord, SynthesizeSpeechOutput, TranscribeSpeechOutput, type ToolContext, type ToolResult } from "@foundmill/connectors";
import { bookUsage, repos } from "@foundmill/db";
import { isSpeechAccentKey, TEAM_CALL_AUDIO_MIMES, TEAM_CALL_LIMITS } from "@foundmill/shared";
import { GatewayError, modeFor, safeError, type GatewayDeps } from "./pipeline";
import { checkRateLimit, DAY_MS } from "./rate-limit";
import { SIMULATED_NOTICE } from "./types";

export const SPEECH_SYNTHESIZE_ROUTE = "/v1/speech/synthesize";
export const SPEECH_TRANSCRIBE_ROUTE = "/v1/speech/transcribe";

/** A recording of at most 8 MiB is 11.2 MB of base64, plus the JSON around it. */
export const MAX_TRANSCRIBE_BODY_BYTES = 12 * 1024 * 1024;

export const SynthesizeSpeechRequest = z.object({
  businessId: z.guid(),
  callId: z.guid(),
  turnId: z.string().min(1).max(64),
  /** A key of `SPEECH_ACCENTS`; anything else is a 400 `unknown_speech_accent`. */
  speechAccent: z.string().min(1).max(40),
  /** Its length is checked after the accent, so the order of the refusals is the documented one. */
  text: z.string().max(100_000),
});
export type SynthesizeSpeechRequest = z.infer<typeof SynthesizeSpeechRequest>;

export const TranscribeSpeechRequest = z.object({
  businessId: z.guid(),
  callId: z.guid(),
  mime: z.string().min(1).max(60),
  base64: z.string().min(1),
});
export type TranscribeSpeechRequest = z.infer<typeof TranscribeSpeechRequest>;

export interface SynthesizeSpeechResponse {
  mode: "mock" | "live";
  mime: "audio/mpeg" | "audio/wav";
  base64: string;
  simulated: boolean;
  notice?: string;
  characters: number;
  costMinor: number;
}

export interface TranscribeSpeechResponse {
  mode: "mock" | "live";
  text: string;
  simulated: boolean;
  notice?: string;
  durationSeconds: number;
  costMinor: number;
}

/** The business's spoken characters today (a UTC-day window; the store appends the window start). */
export const speechDayKey = (businessId: string): string => `sp:${businessId}:day`;

const NIL_ID = "00000000-0000-0000-0000-000000000000";
const VENDOR_CODE = /^[a-z][a-z0-9_]{0,59}$/;
/** A spoken turn of 600 characters is under 1 MB of audio; past this the vendor sent something that is not speech. */
const MAX_AUDIO_BASE64_CHARS = 6 * 1024 * 1024;

export interface SpeechFailure {
  code: "speech_refused" | "speech_rate_limited" | "speech_unavailable";
  message: string;
  status: number;
  details: { vendorStatus: number | null; vendorCode: string | null };
  /** Nothing was spoken or heard: the vendor refused outright, so the day's characters are given back. */
  nothingDone: boolean;
}

/**
 * What the api is told when the speech vendor did not do the work: a code, a status and a fixed sentence, never the
 * vendor's own words. 429 waits; a refusal of this very request (a 4xx) will not succeed if repeated; a refused key (401,
 * 403) or a failing vendor is 502 and retried later by the next turn.
 */
export function speechFailure(error: { code?: string; status?: number; details?: unknown } | undefined): SpeechFailure {
  const vendorStatus = typeof error?.status === "number" ? error.status : null;
  const raw = (error?.details as { code?: unknown } | undefined) ?? {};
  const details = { vendorStatus, vendorCode: typeof raw.code === "string" && VENDOR_CODE.test(raw.code) ? raw.code : null };
  const outright = vendorStatus !== null && vendorStatus >= 400 && vendorStatus < 500 && vendorStatus !== 408;
  if (vendorStatus === 429 || error?.code === "rate_limited") return { code: "speech_rate_limited", message: "The speech service is busy. Try again in a moment.", status: 429, details, nothingDone: true };
  if (outright && vendorStatus !== 401 && vendorStatus !== 403) return { code: "speech_refused", message: "The speech service refused this request.", status: 422, details, nothingDone: true };
  return { code: "speech_unavailable", message: "Speech is not available right now.", status: 502, details, nothingDone: outright };
}

/** Everything both routes do before the vendor: the business, the connector and its window. */
async function prepare(deps: GatewayDeps, businessId: string) {
  const now = deps.now ?? (() => new Date());
  const business = await repos.businesses.get(deps.db, businessId).catch(() => {
    throw new GatewayError("business_not_found", `business ${businessId} is not available to this gateway`, 404);
  });
  const mode = modeFor(deps, ELEVENLABS_KEY);
  const connector = deps.registry.get(ELEVENLABS_KEY, mode);
  const limit = await checkRateLimit(deps.rateLimits, { businessId, connector: ELEVENLABS_KEY, limits: connector.rateLimits ?? {} }, now().getTime());
  if (!limit.allowed) {
    throw new GatewayError("rate_limited", `Too many spoken turns for this project. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
  }
  const ctx: ToolContext = { businessId, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(ELEVENLABS_KEY, businessId, mode === "live" ? { status: "connected" } : {}), log: deps.log, mode };
  return { business, mode, connector, ctx, now };
}

/** Runs a tool; a missing key is the 503, anything else thrown is a 502 (and keeps the count: the vendor may have acted). */
async function runTool(deps: GatewayDeps, prepared: Awaited<ReturnType<typeof prepare>>, tool: string, args: unknown, giveBack: () => Promise<void>): Promise<ToolResult> {
  try {
    return await prepared.connector.callTool(tool, args, prepared.ctx);
  } catch (e) {
    if (isConfigError(e)) {
      await giveBack();
      throw new GatewayError("speech_unconfigured", "Speech is not set up on this server yet (ELEVENLABS_API_KEY is missing on the gateway)", 503);
    }
    deps.log.warn({ err: safeError(e), businessId: prepared.ctx.businessId, tool }, "speech call failed");
    throw new GatewayError("speech_unavailable", "Speech is not available right now.", 502);
  }
}

/** The audit row, then the usage row: each best effort, because the speech is already made and paid for. */
async function record(deps: GatewayDeps, prepared: Awaited<ReturnType<typeof prepare>>, input: { action: string; target: { kind: "team_call"; id: string }; details: Record<string, string | number | boolean | null>; tool: string; costMinor: number; service: string }): Promise<void> {
  const { business, mode, now } = prepared;
  const audit = await repos.audit
    .append(deps.db, business.id, { actorKind: "system", action: input.action, target: input.target, details: { service: input.service, mode, ...input.details, label: "Estimate", costEstimateMinor: input.costMinor } })
    .catch((e: unknown) => {
      deps.log.error({ err: safeError(e), action: input.action }, "speech ran but its audit row could not be written");
      return null;
    });
  if (input.costMinor <= 0) return;
  try {
    await bookUsage(deps.db, business.id, {
      kind: "tool",
      quantity: 1,
      unit: "calls",
      costMinor: input.costMinor,
      // The vendor prices in US dollars; the figure is an estimate in cents, whatever the business's own currency.
      currency: "USD",
      billedTo: business.modelBilling,
      occurredAt: now(),
      details: { connector: ELEVENLABS_KEY, tool: input.tool, mode, label: "Estimate", service: input.service, ...(audit ? { auditId: audit.id } : {}) },
    });
  } catch (e) {
    deps.log.error({ err: safeError(e), auditId: audit?.id ?? null, costMinor: input.costMinor }, "speech ran but its usage could not be booked");
  }
}

const devStack = (deps: GatewayDeps): boolean => deps.appEnv === undefined || deps.appEnv === "development" || deps.appEnv === "test";

export async function synthesizeSpeech(deps: GatewayDeps, input: SynthesizeSpeechRequest, service: string): Promise<SynthesizeSpeechResponse> {
  // 1 and 2. The accent, then the words.
  if (!isSpeechAccentKey(input.speechAccent)) throw new GatewayError("unknown_speech_accent", "That is not a speech accent", 400);
  const text = input.text.trim();
  if (text.length < 1 || text.length > TEAM_CALL_LIMITS.maxTurnChars) throw new GatewayError("validation", `Speak between 1 and ${TEAM_CALL_LIMITS.maxTurnChars} characters at a time`, 400);

  // 3. The business's window on the connector.
  const prepared = await prepare(deps, input.businessId);
  const { mode } = prepared;
  const nowMs = prepared.now().getTime();

  // 4. The business's spoken characters today.
  const dayKey = speechDayKey(input.businessId);
  const characters = text.length;
  const hit = await deps.rateLimits.hit(dayKey, DAY_MS, nowMs, characters);
  let counted = true;
  const giveBack = async () => {
    if (!counted) return;
    counted = false;
    await deps.rateLimits.release?.(dayKey, DAY_MS, nowMs, characters);
  };
  if (mode === "live" && !devStack(deps) && deps.rateLimits.durable !== true) {
    await giveBack();
    throw new GatewayError("speech_store_unavailable", "Speech is paused for a moment while the server's counters recover. Try again shortly.", 503);
  }
  const ceiling = TEAM_CALL_LIMITS.speechCharsPerBusinessPerDay;
  if (hit.count > ceiling) {
    await giveBack();
    throw new GatewayError("speech_daily_limit", `Your team has spoken as much as one project can in a day (${ceiling.toLocaleString("en-US")} characters). Speaking starts again tomorrow; you can keep going by typing and reading.`, 429, {
      retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - nowMs) / 1000)),
      limit: ceiling,
    });
  }

  // Then the call.
  const result = await runTool(deps, prepared, "synthesize_speech", { speechAccent: input.speechAccent, text }, giveBack);
  if (!result.ok) {
    const failure = speechFailure(result.error);
    if (failure.nothingDone) await giveBack();
    deps.log.warn({ businessId: input.businessId, callId: input.callId, speechAccent: input.speechAccent, code: result.error?.code, status: result.error?.status, vendorCode: failure.details.vendorCode }, "speech refused");
    throw new GatewayError(failure.code, failure.message, failure.status, failure.details);
  }
  const data = SynthesizeSpeechOutput.safeParse(result.data);
  if (!data.success || data.data.base64.length > MAX_AUDIO_BASE64_CHARS) throw new GatewayError("speech_unavailable", "Speech is not available right now.", 502);

  const costMinor = Math.max(0, Math.round(result.costMinor ?? 0));
  await record(deps, prepared, {
    action: "gateway.speech.synthesized",
    target: { kind: "team_call", id: input.callId },
    details: { callId: input.callId, turnId: input.turnId, speechAccent: input.speechAccent, characters: data.data.characters, mime: data.data.mime },
    tool: "synthesize_speech",
    costMinor,
    service,
  });
  const simulated = mode === "mock";
  return { mode, mime: data.data.mime, base64: data.data.base64, simulated, ...(simulated ? { notice: SIMULATED_NOTICE } : {}), characters: data.data.characters, costMinor };
}

export async function transcribeSpeech(deps: GatewayDeps, input: TranscribeSpeechRequest, service: string): Promise<TranscribeSpeechResponse> {
  if (!(TEAM_CALL_AUDIO_MIMES as readonly string[]).includes(input.mime)) throw new GatewayError("unsupported_audio", "That recording type is not supported", 400);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0) throw new GatewayError("validation", "The recording is not valid base64", 400);
  if (decodedBytes(input.base64) > TEAM_CALL_LIMITS.maxAudioBytes) throw new GatewayError("audio_too_large", `A recording can be at most ${TEAM_CALL_LIMITS.maxAudioBytes / 1024 / 1024} MiB`, 413);

  const prepared = await prepare(deps, input.businessId);
  const { mode } = prepared;
  const result = await runTool(deps, prepared, "transcribe_speech", { mime: input.mime, base64: input.base64 }, async () => {});
  if (!result.ok) {
    const failure = speechFailure(result.error);
    deps.log.warn({ businessId: input.businessId, callId: input.callId, code: result.error?.code, status: result.error?.status, vendorCode: failure.details.vendorCode }, "transcription refused");
    throw new GatewayError(failure.code, failure.message, failure.status, failure.details);
  }
  const data = TranscribeSpeechOutput.safeParse(result.data);
  if (!data.success) throw new GatewayError("speech_unavailable", "Speech is not available right now.", 502);

  const costMinor = Math.max(0, Math.round(result.costMinor ?? 0));
  await record(deps, prepared, {
    action: "gateway.speech.transcribed",
    target: { kind: "team_call", id: input.callId },
    details: { callId: input.callId, durationSeconds: data.data.durationSeconds, language: data.data.languageCode || null },
    tool: "transcribe_speech",
    costMinor,
    service,
  });
  const simulated = mode === "mock";
  return { mode, text: data.data.text, simulated, ...(simulated ? { notice: SIMULATED_NOTICE } : {}), durationSeconds: data.data.durationSeconds, costMinor };
}
