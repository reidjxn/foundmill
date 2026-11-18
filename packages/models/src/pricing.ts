/**
 * Model prices and metering (BUILD §10.4, docs/ARCHITECTURE.md §6).
 *
 * Prices are CONFIG, not facts: they are list prices per million tokens as published by Anthropic on `PRICING_AS_OF`
 * and every number derived from them is an **Estimate** (BUILD §2.1 rule 6). The founder's invoice from Anthropic is
 * the only real cost. Update this table when prices change and bump `PRICING_AS_OF`.
 *
 * Arithmetic is done in integer micro-minor-units (1e-6 of a cent) so that thousands of tiny Haiku calls sum without
 * drift; callers writing `usage_ledger.cost_minor` should store `costMinorInt` per row and, when aggregating many rows,
 * sum `costMicroMinor` and round once.
 */
import { MODELS, type ModelId } from "./routing";
import type { TokenUsage } from "./types";

export const PRICING_CURRENCY = "USD" as const;
export const PRICING_LABEL = "Estimate" as const;
export const PRICING_AS_OF = "2026-10-05";

/** Message Batches API bills at 50% of the standard price. */
export const BATCH_DISCOUNT = 0.5;

export interface ModelPrice {
  /** USD per million uncached input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per million tokens written to the 5-minute prompt cache (1.25x input). */
  cacheWritePerMTok: number;
  /** USD per million tokens read from the prompt cache. */
  cacheReadPerMTok: number;
  /** Human label for settings screens. */
  displayName: string;
}

export const MODEL_PRICING: Record<ModelId, ModelPrice> = {
  [MODELS.opus]: { displayName: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 },
  [MODELS.sonnet]: { displayName: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  // Haiku 5.5 for prompts up to 100K tokens (Anthropic's model reference, Nov 16, 2026); a longer prompt is billed at
  // $0.50 / $2.50, which this table does not model (no route sends one).
  [MODELS.haiku]: { displayName: "Claude Haiku 5.5", inputPerMTok: 0.1, outputPerMTok: 0.5, cacheWritePerMTok: 0.125, cacheReadPerMTok: 0.01 },
  // Z.ai's list price on Nov 16, 2026 (docs.z.ai/guides/overview/pricing): $0.15 in, $0.03 cached, $0.50 out; no cache
  // write fee is listed, so a write is priced as plain input.
  [MODELS.glm]: { displayName: "GLM-5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5, cacheWritePerMTok: 0.15, cacheReadPerMTok: 0.03 },
};

/**
 * Opus fast mode (beta, `speed: "fast"`): 2× the standard price on every component ($8 / $40 per MTok for Opus 5.5,
 * Anthropic's published fast-mode price on 2026-10-09; cache components assumed 2× as well). Models without fast mode
 * are absent.
 */
export const FAST_MODE_PRICING: Partial<Record<ModelId, ModelPrice>> = {
  [MODELS.opus]: { displayName: "Claude Opus 5.5 (fast mode)", inputPerMTok: 8, outputPerMTok: 40, cacheWritePerMTok: 10, cacheReadPerMTok: 0.4 },
};

/**
 * The server web search fee (`web_search_20260209`), on top of the tokens: $10 per 1,000 searches, one per search the
 * response counts in `usage.server_tool_use.web_search_requests`; a search that fails with an error is not billed.
 * Read from Anthropic's pricing page (platform.claude.com/docs/en/about-claude/pricing, "Web search tool") on
 * `WEB_SEARCH_PRICING_AS_OF`. An Estimate like every price here.
 */
export const WEB_SEARCH_USD_PER_SEARCH = 0.01;
export const WEB_SEARCH_PRICING_AS_OF = "2026-11-16";
/** One search's fee in micro-minor units (1e-6 cent): 1 cent. */
export const WEB_SEARCH_FEE_MICRO_MINOR = Math.round(WEB_SEARCH_USD_PER_SEARCH * 100 * 1_000_000);

export interface MeterBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  /** The server web search fee in minor units, when the call searched (`meterWebSearch`). */
  webSearch?: number;
}

export interface MeterResult {
  modelId: ModelId;
  currency: typeof PRICING_CURRENCY;
  /** Exact cost in minor units (cents). May be fractional for small calls. */
  costMinor: number;
  /** Cost in minor units rounded half-up to an integer: what one ledger row stores. */
  costMinorInt: number;
  /** Cost in integer micro-minor-units (1e-6 cent) for lossless aggregation across rows. */
  costMicroMinor: number;
  /** Exact per-component cost in minor units. */
  breakdown: MeterBreakdown;
  /** Always "Estimate": list-price arithmetic, not an invoice (BUILD §2.1 rule 6). */
  label: typeof PRICING_LABEL;
  pricingAsOf: string;
  batch: boolean;
  /** Present (true) when the call ran in Opus fast mode and was metered at the fast-mode price. */
  fast?: true;
}

export interface MeterOptions {
  /** Apply the Message Batches discount. Only when the call really went through the Batches API. */
  batch?: boolean;
  /** `fast` meters at FAST_MODE_PRICING (falls back to the standard price for a model without fast mode). */
  speed?: "standard" | "fast";
}

/** USD per million tokens → integer micro-cents per token. ($4/MTok = 400 cents/MTok = 400 micro-cents per token.) */
const microPerToken = (usdPerMTok: number): number => Math.round(usdPerMTok * 100 * 1_000_000) / 1_000_000;

export function priceFor(modelId: ModelId): ModelPrice {
  const price = MODEL_PRICING[modelId];
  if (!price) throw new Error(`No price configured for model ${modelId}`);
  return price;
}

/** Cost of a completion in minor units (labelled estimate). */
export function meter(usage: TokenUsage, modelId: ModelId, opts: MeterOptions = {}): MeterResult {
  const fastPrice = opts.speed === "fast" ? FAST_MODE_PRICING[modelId] : undefined;
  const price = fastPrice ?? priceFor(modelId);
  const batch = opts.batch === true;
  const factor = batch ? BATCH_DISCOUNT : 1;
  const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

  const micro = {
    input: Math.round(nonNeg(usage.inputTokens) * microPerToken(price.inputPerMTok) * factor),
    output: Math.round(nonNeg(usage.outputTokens) * microPerToken(price.outputPerMTok) * factor),
    cacheWrite: Math.round(nonNeg(usage.cacheCreationInputTokens) * microPerToken(price.cacheWritePerMTok) * factor),
    cacheRead: Math.round(nonNeg(usage.cacheReadInputTokens) * microPerToken(price.cacheReadPerMTok) * factor),
  };
  const costMicroMinor = micro.input + micro.output + micro.cacheWrite + micro.cacheRead;
  const toMinor = (m: number) => m / 1_000_000;
  return {
    modelId,
    currency: PRICING_CURRENCY,
    costMinor: toMinor(costMicroMinor),
    costMinorInt: Math.round(toMinor(costMicroMinor)),
    costMicroMinor,
    breakdown: { input: toMinor(micro.input), output: toMinor(micro.output), cacheWrite: toMinor(micro.cacheWrite), cacheRead: toMinor(micro.cacheRead) },
    label: PRICING_LABEL,
    pricingAsOf: PRICING_AS_OF,
    batch,
    ...(fastPrice ? { fast: true as const } : {}),
  };
}

/** Cost of a web search call: its tokens at the model's price plus the fee for each search it ran (labelled estimate). */
export function meterWebSearch(usage: TokenUsage, modelId: ModelId, searches: number): MeterResult {
  const tokens = meter(usage, modelId);
  const feeMicro = Math.max(0, Math.floor(Number.isFinite(searches) ? searches : 0)) * WEB_SEARCH_FEE_MICRO_MINOR;
  const costMicroMinor = tokens.costMicroMinor + feeMicro;
  return { ...tokens, costMinor: costMicroMinor / 1_000_000, costMinorInt: Math.round(costMicroMinor / 1_000_000), costMicroMinor, breakdown: { ...tokens.breakdown, webSearch: feeMicro / 1_000_000 } };
}

/** Sum several meter results (same currency). Rounds once at the end. */
export function sumMeters(results: readonly MeterResult[], modelId: ModelId): MeterResult {
  const micro = results.reduce((acc, r) => acc + r.costMicroMinor, 0);
  const breakdown = results.reduce<MeterBreakdown>(
    (acc, r) => ({ input: acc.input + r.breakdown.input, output: acc.output + r.breakdown.output, cacheWrite: acc.cacheWrite + r.breakdown.cacheWrite, cacheRead: acc.cacheRead + r.breakdown.cacheRead }),
    { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  );
  return {
    modelId,
    currency: PRICING_CURRENCY,
    costMinor: micro / 1_000_000,
    costMinorInt: Math.round(micro / 1_000_000),
    costMicroMinor: micro,
    breakdown,
    label: PRICING_LABEL,
    pricingAsOf: PRICING_AS_OF,
    batch: results.length > 0 && results.every((r) => r.batch),
    ...(results.some((r) => r.fast) ? { fast: true as const } : {}),
  };
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

/**
 * The one definition of a usage ledger row's token figures (WP-09 T1): `quantity` counts every token the call was billed
 * for (input, output and both cache figures), and `tokens` keeps each, so the cost report can read the cache share.
 */
export function usageForLedger(usage: TokenUsage): { quantity: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } } {
  const tokens = { input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadInputTokens, cacheWrite: usage.cacheCreationInputTokens };
  return { quantity: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite, tokens };
}

/**
 * Rough token estimate (≈ 4 characters per token for English prose and JSON). Used for rate-limit reservations and for
 * mock-mode usage. Label anything derived from it an estimate.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
