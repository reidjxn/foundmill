/**
 * Business logos (BUILD §11.1 Commit screen "logo and brand colours, generated or from an uploaded logo"; §11.15
 * Settings › Business). The procedures in routers/logo.ts and idea.commit share this module:
 *
 * - `LogoChoice` is what a client sends: a `data:` URL (a raster the browser normalised to about 512 px, an SVG file,
 *   or a generated mark it was given) and where it came from. `toLogoInput` decodes it; `checkLogo`
 *   (@foundmill/shared/logo) is the gate: magic bytes, header dimensions and size for rasters, the strict sanitiser for
 *   SVG. Nothing a client sends is stored or echoed without passing it.
 * - `generateLogoOptions` asks the logo designer (Opus, `logoDesigner` route, `logo_designer` prompt) for N marks and
 *   sanitises each before it leaves the api; a mark the sanitiser cannot keep whole is dropped. Every call is metered and
 *   its cost is reported as an Estimate. `logoLimiter` bounds calls per signed-in user and per business.
 */
import { prompts } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { LogoDesignOutput, ModelOutputError, type ModelClient, type ModelKey, type UsageAttribution } from "@foundmill/models";
import { AppError, ARCHETYPE_LABELS, ValidationError, type Archetype } from "@foundmill/shared";
import { base64ToBytes, checkLogo, LOGO_SOURCES, SVG_MAX_INPUT_CHARS, utf8Decode, type CheckedLogo, type LogoInput } from "@foundmill/shared/logo";
import { createHash } from "node:crypto";
import { z } from "zod";
import { RateLimitedError, SlidingWindowLimiter } from "./rate-limit";

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
  return { counts: logo.removedCounts, names: logo.removed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------------------------------

/** One process-wide limiter (see rate-limit.ts for the replica caveat). */
export const logoLimiter = new SlidingWindowLimiter();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const LOGO_LIMITS = {
  user: { limit: LIMITS.logoSetsPerUserPerHour, windowMs: HOUR },
  business: { limit: LIMITS.logoSetsPerBusinessPerDay, windowMs: DAY },
  checks: { limit: LIMITS.logoChecksPerUserPerHour, windowMs: HOUR },
} as const;

/** Spends one upload check (prepare, upload), or throws TOO_MANY_REQUESTS. */
export function takeLogoCheck(userId: string): void {
  const r = logoLimiter.takeAll([{ key: `logo:check:${userId}`, rule: LOGO_LIMITS.checks }]);
  if (!r.ok) throw new RateLimitedError("Logo upload", r.retryAfterMs);
}

/** Output budget: four marks of at most ~3,000 characters each plus names and concepts, with margin. */
export const LOGO_MAX_TOKENS = 8_000;

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
  /** Marks the model returned that the sanitiser could not keep. */
  dropped: number;
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

/** Spends one set from every limit that applies, or throws TOO_MANY_REQUESTS. */
export function takeLogoAllowance(scope: { userId: string; businessId?: string }): { keys: string[]; remaining: number } {
  const entries = [{ key: `logo:user:${scope.userId}`, rule: LOGO_LIMITS.user }, ...(scope.businessId ? [{ key: `logo:business:${scope.businessId}`, rule: LOGO_LIMITS.business }] : [])];
  const r = logoLimiter.takeAll(entries);
  if (!r.ok) throw new RateLimitedError("Logo generation", r.retryAfterMs);
  return { keys: entries.map((e) => e.key), remaining: r.remaining };
}

export async function generateLogoOptions(models: ModelClient, brief: LogoBrief, opts: { scope: string; attribution: UsageAttribution }): Promise<{ set: Omit<LogoSet, "remaining">; usage: LogoSetUsage }> {
  const count = brief.count ?? LIMITS.logoOptionsPerSet;
  const archetype = brief.archetype ? ARCHETYPE_LABELS[brief.archetype] : "new";
  const pitch = brief.pitch.trim().slice(0, 600) || `A ${archetype} business called ${brief.businessName}.`;
  // Instructions only in the system prompt; the founder's brief goes in the user message as data.
  const system = prompts.logoDesignerPrompt.render({ count });
  const userBrief: prompts.LogoDesignerBrief = { business_name: brief.businessName.slice(0, 120), pitch, archetype, brand_colours: brief.colours, count, round: brief.round };
  const result = await models
    .complete({
      route: "logoDesigner",
      system,
      // The brief, as data (the prompt says so); `round` varies the set.
      messages: [{ role: "user", content: "```json\n" + JSON.stringify(userBrief) + "\n```" }],
      schema: LogoDesignOutput,
      maxTokens: LOGO_MAX_TOKENS,
      scope: opts.scope,
      attribution: opts.attribution,
    })
    .catch((err: unknown) => {
      if (err instanceof ModelOutputError) throw new AppError("logo_generation_failed", "The logo designer did not return usable marks. Try again.", 502);
      throw err;
    });

  const options: LogoOption[] = [];
  const seen = new Set<string>();
  for (const mark of result.json.marks) {
    const checked = checkLogo({ mime: "image/svg+xml", svg: mark.svg });
    if (!checked.ok) continue;
    const id = createHash("sha256").update(checked.logo.bytes).digest("hex").slice(0, 16);
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({ id, name: mark.name.slice(0, 40), concept: mark.concept.slice(0, 240), dataUrl: checked.logo.dataUrl, colours: checked.logo.colours.slice(0, 4) });
    if (options.length === count) break;
  }
  if (options.length === 0) throw new AppError("logo_generation_failed", "None of the generated marks could be used. Try again.", 502);
  const u = result.usage;
  return {
    set: { options, dropped: result.json.marks.length - options.length, cost: { amountMinor: result.cost.costMinorInt, currency: result.cost.currency, label: "Estimate" }, mode: result.mode },
    usage: { tokens: u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens, modelKey: result.modelKey, model: result.model },
  };
}
