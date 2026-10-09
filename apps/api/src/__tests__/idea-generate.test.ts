/**
 * idea.generate asks the Ideation agent for 6-12 full concept cards. The output budget must hold twelve of them (the
 * client's 4,096-token default cut live drafts off mid-JSON), and a draft that still runs out of room says so plainly.
 */
import { ModelOutputError, type ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDEATION_MAX_TOKENS } from "../routers/idea";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ideagen" });
}, 120_000);
afterAll(() => hz.close());

describe("idea.generate", () => {
  it("gives the Ideation agent room for twelve cards and keeps evidence short", async () => {
    const seen: { maxTokens?: number; system?: unknown }[] = [];
    const models = hz.deps.models;
    const spy: ModelClient = { ...models, complete: ((req: { maxTokens?: number; system?: unknown }) => (seen.push({ maxTokens: req.maxTokens, system: req.system }), models.complete(req as never))) as ModelClient["complete"] };
    const userId = await hz.h.createUser("ideas@test.local");
    const { createCaller } = await import("../router");
    const caller = createCaller({ ...hz.deps, models: spy }, { userId, email: "ideas@test.local" });
    const r = await caller.idea.generate({ prompt: "AI agents that help EU companies expand to the US" });
    expect(r.ideas.length).toBeGreaterThanOrEqual(6);
    expect(seen[0]!.maxTokens).toBe(IDEATION_MAX_TOKENS);
    expect(IDEATION_MAX_TOKENS).toBeGreaterThanOrEqual(16_000);
    expect(String(seen[0]!.system)).toMatch(/evidence at most 25 words/);
  });

  it("explains a draft that ran out of room instead of showing the model error", async () => {
    const userId = await hz.h.createUser("ideas2@test.local");
    const truncated: ModelClient = { ...hz.deps.models, complete: (async () => { throw new ModelOutputError('Output truncated at max_tokens=20000 before valid JSON was produced for route "ideation"', {}, "max_tokens"); }) as ModelClient["complete"] };
    const { createCaller } = await import("../router");
    await expect(createCaller({ ...hz.deps, models: truncated }, { userId }).idea.generate({ prompt: "x" })).rejects.toThrow("The Ideation agent ran out of room before finishing the concepts. Try again, or narrow the brief.");
  });
});
