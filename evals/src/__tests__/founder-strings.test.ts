/**
 * Offline checks of the founder-language eval (founder, 2026-11-01): the corpus holds the engineering shapes, the title
 * rules catch what they must, and the mock `founderTitle` route (what mock-mode testers read on the Plan) passes every
 * rule over the whole corpus. The live run is `pnpm evals`.
 */
import { createModelClient } from "@foundmill/models";
import { founderJargonHits, founderTitleProblems } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { FOUNDER_TITLE_CORPUS, founderTitlesSystemPrompt, runFounderTitlesCase, summariseFounderTitles } from "../founder-strings";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("founder-language eval", () => {
  it("the corpus is the engineering vocabulary a founder met on Nov 1, 2026, and every technical title fails the rules", () => {
    expect(FOUNDER_TITLE_CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(FOUNDER_TITLE_CORPUS.map((c) => c.id)).size).toBe(FOUNDER_TITLE_CORPUS.length);
    const technical = FOUNDER_TITLE_CORPUS.filter((c) => founderTitleProblems(c.title).length > 0);
    expect(technical.map((c) => c.id)).toEqual(expect.arrayContaining(["t01", "t02", "t03", "t04", "t05", "t06", "t08", "t09", "t10", "t15"]));
  });

  it("the prompt carries the whole vocabulary map and the banned words, and names no model", () => {
    const system = founderTitlesSystemPrompt();
    expect(system).toContain('"merge" → "put live"');
    expect(system).toContain('"pull request" → "a finished change"');
    expect(system).toContain('"hydration mismatch" → "a display bug"');
    expect(system).toContain("Never use these words: ICP, CPA");
    expect(system).toContain("Pull request");
    expect(system).toMatch(/At most 10 words/);
    expect(system).not.toMatch(/claude|opus|sonnet|haiku/i);
  });

  it("the mock route's titles pass every rule over the whole corpus (what mock-mode testers read)", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    const run = await runFounderTitlesCase(client);
    const summary = summariseFounderTitles(run);
    expect(run.error).toBeUndefined();
    // The deterministic rewrite leaves a task untitled when no rewrite meets the rules (the live route is expected to
    // title every one); what it does write passes every rule, and it titles most of the corpus.
    const badTitles = summary.failed.filter((f) => f.title !== null);
    expect(badTitles, JSON.stringify(badTitles, null, 2)).toEqual([]);
    expect(summary.passed).toBeGreaterThanOrEqual(15);
    for (const r of run.results) if (r.title) expect(r.title.split(/\s+/).length).toBeLessThanOrEqual(10);
    // The plain titles come through as they were; the technical ones changed.
    const byId = new Map(run.results.map((r) => [r.caseId, r.title]));
    expect(byId.get("t12")).toBe("Reconcile September invoices");
    expect(byId.get("t02")).toBe("Fix a display bug in the dashboard page");
    // The rebase onto main: either untitled by the rewrite (too long) or titled without a single engineering word.
    expect(byId.get("t01") ?? "").not.toMatch(/rebase|merge|agent\//i);
  });

  it("founderJargonHits reads prose the way the title rules read titles, without the length and case rules", () => {
    expect(founderJargonHits("Sam's change is ready to go live. The repository's automatic tests run next.")).toEqual([]);
    expect(founderJargonHits("Approved → went live at 3:02 PM")).toEqual([]);
    expect(founderJargonHits("Merge the PR once CI is green on the branch").map((h) => h.term)).toEqual(["Merge", "PR", "CI", "branch"]);
    expect(founderJargonHits("The orchestrator held the merge because of the Cedar policy").map((h) => h.term)).toEqual(["orchestrator", "merge", "Cedar"]);
  });
});
