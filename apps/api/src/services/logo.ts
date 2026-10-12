/**
 * Business logos (BUILD §11.1 Commit screen "logo and brand colours, generated or from an uploaded logo"; §11.15
 * Settings › Business). The procedures in routers/logo.ts and idea.commit share this module:
 *
 * - `LogoChoice` is what a client sends: a `data:` URL (a raster the browser normalised to about 512 px, an SVG file,
 *   or a generated mark it was given) and where it came from. `toLogoInput` decodes it; `checkLogo`
 *   (@foundmill/shared/logo) is the gate: magic bytes, header dimensions and size for rasters, the strict sanitiser for
 *   SVG. Nothing a client sends is stored or echoed without passing it.
 * - `generateLogoOptions` asks the logo designer (Opus, `logoDesigner` route, `logo_mark` prompt) for one mark per
 *   direction (monogram, geometric, negative space, abstract), all at once, and checks each mark the moment its call
 *   ends; a mark the sanitiser cannot keep whole is dropped. `onOption` hands each mark over as it passes, which the
 *   streamed procedures (`idea.logo.stream`, `business.logo.stream`) turn into `LogoEvent`s for the picker. Every call is
 *   metered and the set's cost is reported as an Estimate. `takeLogoAllowance` bounds sets per signed-in user and
 *   per business: one set per request, however many calls it takes.
 */
import { prompts } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { LogoDesignOutput, ModelAbortedError, ModelOutputError, resolveModel, type CompleteResultWithJson, type ModelClient, type ModelKey, type UsageAttribution } from "@foundmill/models";
import { AppError, ARCHETYPE_LABELS, ValidationError, type Archetype } from "@foundmill/shared";
import { base64ToBytes, checkLogo, LOGO_SOURCES, SVG_MAX_INPUT_CHARS, utf8Decode, type CheckedLogo, type LogoInput } from "@foundmill/shared/logo";
import { createHash } from "node:crypto";
import { z } from "zod";
import { RateLimitedError, takeOrThrow, type LimitTicket, type RateLimitStore } from "./rate-limit";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Base64 of the largest SVG file accepted, plus the `data:` prefix. Rasters are checked against LOGO_MAX_BYTES later. */
const DATA_URL_MAX = 64 + Math.ceil(SVG_MAX_INPUT_CHARS / 3) * 4;
const LOGO_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;

export const LogoDataUrl = z.string().max(DATA_URL_MAX, "The file is too large.").regex(LOGO_DATA_URL_RE, "Use a PNG, JPEG, WebP or SVG image.");

/** A logo as a client sends it, with where it came from (shown in Settings and kept in the audit trail). */
export const LogoChoice = z.object({ source: z.enum(LOGO_SOURCES), dataUrl: LogoDataUrl });
export type LogoChoice = z.infer<typeof LogoChoice>;

export const BrandColours = z.object({ primary: Hex, secondary: Hex });

/** Decodes a `data:` URL into the input `checkLogo` takes (SVG markup as text, rasters as base64). */
export function toLogoInput(dataUrl: string): LogoInput {
  const m = LOGO_DATA_URL_RE.exec(dataUrl);
  if (!m) throw new ValidationError("Use a PNG, JPEG, WebP or SVG image.");
  const mime = m[1] as LogoInput["mime"];
  if (mime !== "image/svg+xml") return { mime, base64: m[2]! };
  const bytes = base64ToBytes(m[2]!);
  const text = bytes ? utf8Decode(bytes) : null;
  if (text === null) throw new ValidationError("The SVG is not valid UTF-8 text.");
  return { mime, svg: text };
}

/** Runs the gate and throws a ValidationError with its reason; returns what would be stored. */
export function checkLogoChoice(choice: LogoChoice): CheckedLogo {
  const result = checkLogo(toLogoInput(choice.dataUrl));
  if (!result.ok) throw new ValidationError(result.reason);
  return result.logo;
}

/** What the browser shows after a check: the stored form as a data URL, its size and suggested brand colours. */
export function preparedView(logo: CheckedLogo) {
  return { dataUrl: logo.dataUrl, mime: logo.mime, width: logo.width, height: logo.height, bytes: logo.bytes.length, colours: logo.colours.slice(0, 4), removed: sanitisedSummary(logo) };
}

/** What the sanitiser took out, bounded (counts per kind, at most 20 names of 40 characters): safe for the audit log. */
export function sanitisedSummary(logo: CheckedLogo): { counts: Record<string, number>; names: string[] } {
  // Copies: the checked result is frozen.
  return { counts: { ...logo.removedCounts }, names: [...logo.removed] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------------------------------

// The windows live in the api's limit store (`ctx.limits`: Redis across replicas, memory in development; rate-limit.ts).
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const LOGO_LIMITS = {
  user: { limit: LIMITS.logoSetsPerUserPerHour, windowMs: HOUR },
  business: { limit: LIMITS.logoSetsPerBusinessPerDay, windowMs: DAY },
  checks: { limit: LIMITS.logoChecksPerUserPerHour, windowMs: HOUR },
} as const;

/** Spends one upload check (prepare, upload), or throws TOO_MANY_REQUESTS. */
export async function takeLogoCheck(limits: RateLimitStore, userId: string): Promise<void> {
  await takeOrThrow(limits, "Logo upload", [{ key: `logo:check:${userId}`, rule: LOGO_LIMITS.checks }]);
}

export interface LogoBrief {
  businessName: string;
  pitch: string;
  archetype: Archetype | null;
  colours: { primary: string; secondary: string };
  /** 0 for the first set; "Generate again" sends the next number so the set differs. */
  round: number;
  count?: number;
}

export interface LogoOption {
  /** Stable for the same mark (first 16 hex of the sanitised document's sha256). */
  id: string;
  name: string;
  concept: string;
  /** The sanitised mark as `data:image/svg+xml;base64,…`, for `<img src>` only. */
  dataUrl: string;
  /** Hex colours the mark uses, most used first (brand colour suggestions). */
  colours: string[];
}

export interface LogoSet {
  options: LogoOption[];
  /** Marks the model returned that the sanitiser could not keep (or that repeated another mark of the set). */
  dropped: number;
  /** Mark calls that failed outright (the rest of the set is unaffected). */
  failed: number;
  cost: { amountMinor: number; currency: string; label: "Estimate" };
  mode: "mock" | "live";
  /** Sets left in the tightest window after this one. */
  remaining: number;
}

/** What the call used, for the usage ledger (not sent to the browser). */
export interface LogoSetUsage {
  tokens: number;
  modelKey: ModelKey;
  model: string;
}

/** One set's spend: the hit to give back when the set fails before any tokens are spent, and the sets left. */
export interface LogoAllowance {
  ticket: LimitTicket;
  remaining: number;
}

/** Spends one set from every limit that applies, or throws TOO_MANY_REQUESTS. */
export async function takeLogoAllowance(limits: RateLimitStore, scope: { userId: string; businessId?: string }): Promise<LogoAllowance> {
  const entries = [{ key: `logo:user:${scope.userId}`, rule: LOGO_LIMITS.user }, ...(scope.businessId ? [{ key: `logo:business:${scope.businessId}`, rule: LOGO_LIMITS.business }] : [])];
  const r = await limits.take(entries);
  if (!r.ok) throw new RateLimitedError("Logo generation", r.retryAfterMs);
  return { ticket: r.ticket, remaining: r.remaining };
}

/** What the mark calls of one set have used so far, filled in as each call ends (so a stopped set is metered too). */
export interface LogoSpend {
  calls: number;
  tokens: number;
  costMicroMinor: number;
  currency: string;
  modelKey: ModelKey | null;
  model: string | null;
}

export const emptyLogoSpend = (): LogoSpend => ({ calls: 0, tokens: 0, costMicroMinor: 0, currency: "USD", modelKey: null, model: null });

/** A mark slot: one direction of the set (what the picker labels the slot with while the mark is drawn). */
export interface LogoSlot {
  index: number;
  direction: prompts.LogoDirectionKey;
  label: string;
}

/** What a streamed set reports (`idea.logo.stream` / `business.logo.stream`). */
export type LogoEvent =
  /** The set began: one slot per direction, drawn at the same time. */
  | { type: "started"; total: number; slots: LogoSlot[]; mode: "mock" | "live" }
  /** A mark passed the check: show it in its slot now. */
  | { type: "option"; index: number; option: LogoOption }
  /** A slot ended without a usable mark (the call failed, or the check refused the mark). */
  | { type: "failed"; index: number; message: string }
  /** The set is complete (the same answer as `generate`). */
  | { type: "done"; set: LogoSet };

export interface GenerateLogoOptions {
  scope: string;
  attribution: UsageAttribution;
  signal?: AbortSignal;
  /** Each mark the moment it passes the check, with its slot. Awaited, and never called concurrently. */
  onOption?: (option: LogoOption, slot: LogoSlot) => void | Promise<void>;
  /** A slot that ended without a usable mark. */
  onFailed?: (slot: LogoSlot, message: string) => void;
  /** Filled in as calls end (pass your own to meter a set that was stopped part way). */
  spend?: LogoSpend;
}

/** The slots of a set of `count` marks (monogram, geometric, negative space, abstract; repeated past four). */
export function logoSlots(count: number = LIMITS.logoOptionsPerSet): LogoSlot[] {
  return prompts.logoDirectionsFor(count).map((d, index) => ({ index, direction: d.key, label: d.label }));
}

const SLOT_FAILED = "The logo designer could not draw this one. The others are unaffected.";
const SLOT_REFUSED = "This mark did not pass the safety check, so it is not shown.";

/**
 * Draws a set as parallel single-mark calls, one per direction (audit P6): the first mark is ready when the fastest
 * call ends instead of when all four are written in one reply. Each mark is checked (`checkLogo`, the same gate as an
 * upload) the moment its call ends and handed to `onOption`; a call that fails or a mark the check refuses loses only
 * its own slot. Fails only when no slot produced a usable mark: `logo_generation_failed` (502) once tokens were spent,
 * otherwise the model error itself (unavailable, rate limited), so the caller can give the allowance back.
 */
export async function generateLogoOptions(models: ModelClient, brief: LogoBrief, opts: GenerateLogoOptions): Promise<{ set: Omit<LogoSet, "remaining">; usage: LogoSetUsage }> {
  const slots = logoSlots(brief.count ?? LIMITS.logoOptionsPerSet);
  const archetype = brief.archetype ? ARCHETYPE_LABELS[brief.archetype] : "new";
  const pitch = brief.pitch.trim().slice(0, 600) || `A ${archetype} business called ${brief.businessName}.`;
  // Instructions (and the slot's direction) only in the system prompt; the founder's brief goes in the user message as data.
  const base = { business_name: brief.businessName.slice(0, 120), pitch, archetype, brand_colours: brief.colours, round: brief.round };
  const spend = opts.spend ?? emptyLogoSpend();
  const bySlot: (LogoOption | undefined)[] = [];
  const seen = new Set<string>();
  const errors: unknown[] = [];
  let dropped = 0;
  let mode = models.mode;
  // Marks are handed over one at a time, in the order they pass the check.
  let handing: Promise<void> = Promise.resolve();

  const drawSlot = async (slot: LogoSlot): Promise<void> => {
    const direction = prompts.logoDirection(slot.direction);
    let result: CompleteResultWithJson<LogoDesignOutput>;
    try {
      result = await models.complete({ ...prompts.buildLogoMarkRequest(base, direction), schema: LogoDesignOutput, scope: opts.scope, attribution: opts.attribution, signal: opts.signal });
    } catch (err) {
      errors.push(err);
      if (!opts.signal?.aborted) opts.onFailed?.(slot, SLOT_FAILED);
      return;
    }
    const u = result.usage;
    spend.calls++;
    spend.tokens += u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
    spend.costMicroMinor += result.cost.costMicroMinor;
    spend.currency = result.cost.currency;
    spend.modelKey = result.modelKey;
    spend.model = result.model;
    mode = result.mode;
    const mark = result.json.marks[0];
    const checked = mark ? checkLogo({ mime: "image/svg+xml", svg: mark.svg }) : null;
    const id = checked?.ok ? createHash("sha256").update(checked.logo.bytes).digest("hex").slice(0, 16) : null;
    if (!mark || !checked?.ok || !id || seen.has(id)) {
      dropped++;
      opts.onFailed?.(slot, SLOT_REFUSED);
      return;
    }
    seen.add(id);
    const option: LogoOption = { id, name: mark.name.slice(0, 40), concept: mark.concept.slice(0, 240), dataUrl: checked.logo.dataUrl, colours: checked.logo.colours.slice(0, 4) };
    bySlot[slot.index] = option;
    const hand = handing.then(() => opts.onOption?.(option, slot));
    handing = hand.catch(() => undefined);
    await hand;
  };

  await Promise.all(slots.map(drawSlot));
  if (opts.signal?.aborted) throw new ModelAbortedError();

  const options = bySlot.filter((o): o is LogoOption => Boolean(o));
  if (options.length === 0) {
    const spent = spend.calls > 0 || errors.some((e) => e instanceof ModelOutputError);
    // Nothing was spent (the model was unavailable or rate limited): pass the error on, so the allowance is given back.
    if (!spent && errors.length > 0) throw errors[0];
    throw new AppError("logo_generation_failed", spend.calls > 0 ? "None of the generated marks could be used. Try again." : "The logo designer did not return usable marks. Try again.", 502);
  }
  const fallback = resolveModel("logoDesigner");
  return {
    set: { options, dropped, failed: errors.length, cost: { amountMinor: Math.round(spend.costMicroMinor / 1_000_000), currency: spend.currency, label: "Estimate" }, mode },
    usage: { tokens: spend.tokens, modelKey: spend.modelKey ?? fallback.modelKey, model: spend.model ?? fallback.modelId },
  };
}
