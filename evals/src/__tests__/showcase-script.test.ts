/**
 * Offline checks of the showcase script eval (docs/THESIS_REVIEW.md §13 item 15): the fixtures cover solo and
 * multi-founder projects and never hand the model how many founders there are; the rubric's code checks catch each
 * thing a script must not do; every adversarial answer is dropped by the product's own step; and the mock route (what
 * mock-mode stacks get) passes every case. The live run with the judge is `pnpm evals` (showcase-script.eval.test.ts).
 */
import { buildShowcaseScriptRequest, runShowcaseScriptStep } from "@foundmill/agents";
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { SHOWCASE_ADVERSARIAL_OUTPUTS, SHOWCASE_SCRIPT_CASES, runShowcaseScriptCase, showcaseEvalFacts, showcaseScriptProblems } from "../showcase-script";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const maple = SHOWCASE_SCRIPT_CASES.find((c) => c.id === "ss01")!;
const mapleFacts = showcaseEvalFacts(maple);
const script = (post: string, caption = "Nov 12: page live") => ({ shots: [{ milestoneId: mapleFacts.cards[0]!.milestoneId, caption }], postText: post });

describe("showcase script eval", () => {
  it("covers solo and multi-founder projects, and the founders' number never reaches the model", () => {
    expect(SHOWCASE_SCRIPT_CASES.some((c) => c.founders === 1)).toBe(true);
    expect(SHOWCASE_SCRIPT_CASES.some((c) => c.founders > 1)).toBe(true);
    for (const c of SHOWCASE_SCRIPT_CASES) {
      const req = buildShowcaseScriptRequest(showcaseEvalFacts(c));
      expect(req.messages[0]!.content).not.toMatch(/founder|cofounder|people|owner/i);
      expect(Object.keys(showcaseEvalFacts(c)).sort()).toEqual(["cards", "maxChars", "projectName"]);
    }
  });

  it("the rubric passes a script made of the facts", () => {
    expect(showcaseScriptProblems(maple, script("How Maple Bakes was built. Page live on Nov 12, 2026."))).toEqual([]);
  });

  it("the rubric catches people counts, lack framing, work framing, rankings and invented facts", () => {
    expect(showcaseScriptProblems(maple, script("Two people built Maple Bakes. Page live on Nov 12, 2026.")).join()).toMatch(/\(a\)/);
    expect(showcaseScriptProblems(maple, script("Maple Bakes was built alone. Page live on Nov 12, 2026.")).join()).toMatch(/\(b\)/);
    expect(showcaseScriptProblems(maple, script("Maple Bakes went live on Nov 12, 2026 instead of a job.")).join()).toMatch(/\(c\)|banned/);
    expect(showcaseScriptProblems(maple, script("Maple Bakes is the top bakery. Page live on Nov 12, 2026.")).join()).toMatch(/\(d\)/);
    expect(showcaseScriptProblems(maple, script("Maple Bakes went live on Nov 12, 2026 with 40 loaves.")).join()).toMatch(/\(e\)/);
  });

  it("every adversarial answer is dropped by the product's step, after its one retry, and nothing is stored", async () => {
    for (const adv of SHOWCASE_ADVERSARIAL_OUTPUTS) {
      const models = { complete: async () => ({ json: { shots: [{ card: "c1", caption: "Nov 12: page live" }], post: adv.post }, cost: { costMinorInt: 0 }, model: "m", mode: "mock" }) as never };
      const out = await runShowcaseScriptStep({ models: models as never, facts: mapleFacts });
      expect(out.outcome, adv.id).toBe("dropped");
      if (out.outcome === "dropped") expect(out.refusals, adv.id).toEqual([adv.breaks, adv.breaks]);
    }
  });

  it("the mock route passes every case through the product's own step", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    for (const c of SHOWCASE_SCRIPT_CASES) {
      const r = await runShowcaseScriptCase(client, c);
      expect(r.problems, `${c.id}: ${JSON.stringify(r.script)}`).toEqual([]);
      expect(r.passed).toBe(true);
    }
  });
});
