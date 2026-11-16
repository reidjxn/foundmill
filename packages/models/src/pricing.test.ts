import { describe, expect, it } from "vitest";
import { BATCH_DISCOUNT, MODEL_PRICING, PRICING_LABEL, WEB_SEARCH_FEE_MICRO_MINOR, addUsage, estimateTokens, meter, meterWebSearch, sumMeters } from "./pricing";
import { MODELS } from "./routing";

const usage = (inputTokens: number, outputTokens: number, cacheCreationInputTokens = 0, cacheReadInputTokens = 0) => ({ inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens });

describe("pricing and metering (BUILD §10.4)", () => {
  it("has a price for every routed model and labels everything an estimate", () => {
    for (const id of Object.values(MODELS)) {
      expect(MODEL_PRICING[id].inputPerMTok).toBeGreaterThan(0);
      expect(MODEL_PRICING[id].outputPerMTok).toBeGreaterThan(MODEL_PRICING[id].inputPerMTok);
    }
    expect(meter(usage(1, 1), MODELS.haiku).label).toBe(PRICING_LABEL);
  });

  it("meters a web search as its tokens plus $10 per 1,000 searches (pricing page, Nov 16, 2026)", () => {
    const u = usage(2_000, 100);
    const m = meterWebSearch(u, MODELS.sonnet, 1);
    expect(WEB_SEARCH_FEE_MICRO_MINOR).toBe(1_000_000);
    expect(m.costMicroMinor).toBe(meter(u, MODELS.sonnet).costMicroMinor + 1_000_000);
    expect(m.breakdown.webSearch).toBe(1);
    expect(m.label).toBe(PRICING_LABEL);
    expect(meterWebSearch(u, MODELS.sonnet, 0).costMicroMinor).toBe(meter(u, MODELS.sonnet).costMicroMinor);
  });

  it("meters a million tokens of Opus exactly", () => {
    const m = meter(usage(1_000_000, 1_000_000), MODELS.opus);
    expect(m.costMinor).toBe(2400); // $4 + $20 in cents
    expect(m.costMinorInt).toBe(2400);
    expect(m.costMicroMinor).toBe(2_400_000_000);
    expect(m.breakdown).toEqual({ input: 400, output: 2000, cacheWrite: 0, cacheRead: 0 });
    expect(m.currency).toBe("USD");
    expect(m.batch).toBe(false);
  });

  it("keeps sub-cent calls exact in micro-minor units and rounds the integer form", () => {
    const m = meter(usage(500, 0), MODELS.haiku); // $1/MTok → 500 tokens = 0.05 cents
    expect(m.costMinor).toBeCloseTo(0.05, 9);
    expect(m.costMicroMinor).toBe(50_000);
    expect(m.costMinorInt).toBe(0);
    const rounded = meter(usage(0, 1_100), MODELS.haiku); // 1100 * $5/MTok = 0.55 cents → 1
    expect(rounded.costMinorInt).toBe(1);
  });

  it("prices cache writes and reads at their own rates", () => {
    const m = meter(usage(0, 0, 1_000_000, 1_000_000), MODELS.opus);
    expect(m.breakdown.cacheWrite).toBe(500); // $5/MTok
    expect(m.breakdown.cacheRead).toBe(20); // $0.20/MTok
    expect(m.costMinor).toBe(520);
  });

  it("applies the batch discount only when asked", () => {
    const full = meter(usage(0, 1_000_000), MODELS.sonnet);
    const batch = meter(usage(0, 1_000_000), MODELS.sonnet, { batch: true });
    expect(full.costMinor).toBe(1000);
    expect(batch.costMinor).toBe(1000 * BATCH_DISCOUNT);
    expect(batch.batch).toBe(true);
  });

  it("ignores negative or non-finite token counts", () => {
    const m = meter({ inputTokens: -5, outputTokens: Number.NaN, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, MODELS.haiku);
    expect(m.costMicroMinor).toBe(0);
  });

  it("sums meters without rounding until the end", () => {
    const parts = Array.from({ length: 10 }, () => meter(usage(500, 0), MODELS.haiku)); // 10 × 0.05 cents
    const total = sumMeters(parts, MODELS.haiku);
    expect(total.costMicroMinor).toBe(500_000);
    expect(total.costMinor).toBeCloseTo(0.5, 9);
    expect(total.costMinorInt).toBe(1);
    expect(parts.reduce((acc, p) => acc + p.costMinorInt, 0)).toBe(0); // per-row rounding would have lost it
  });

  it("adds usage and estimates tokens at ~4 chars/token", () => {
    expect(addUsage(usage(1, 2, 3, 4), usage(10, 20, 30, 40))).toEqual(usage(11, 22, 33, 44));
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(401))).toBe(101);
  });
});
