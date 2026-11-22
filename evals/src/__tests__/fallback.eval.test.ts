/**
 * WP-09 T5, live: one Opus call carries the server-side fallback beta (`SERVER_FALLBACK_BETA`, `fallbacks: "default"`)
 * and Anthropic accepts that request shape. Runs only with MODEL_MODE=live and ANTHROPIC_API_KEY (evals-models-live.yml).
 * The answer is priced by the model that served it: Opus itself, or one of `FALLBACK_SERVED_MODELS`. Cost: under $0.05
 * (Estimate).
 */
import { FALLBACK_SERVED_MODELS, MODELS } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { createEvalClient, isLiveEvalEnabled } from "../harness";

describe.skipIf(!isLiveEvalEnabled())("server-side fallback (live)", () => {
  it("an Opus route answers with the fallback beta on, and names the model that served it", async () => {
    const result = await createEvalClient().complete({ route: "planCompiler", messages: [{ role: "user", content: "Reply with the single word OK." }] });
    console.warn(`[eval] fallback: served by ${result.servedModel ?? result.model}, cost ${result.cost.costMinorInt} minor (Estimate)`);
    expect(result.mode).toBe("live");
    expect(result.modelKey).toBe("opus");
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect([MODELS.opus, ...Object.values(FALLBACK_SERVED_MODELS)]).toContain(result.servedModel ?? result.model);
  }, 120_000);
});
