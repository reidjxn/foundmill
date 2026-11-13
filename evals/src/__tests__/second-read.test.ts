/**
 * Offline checks of the second read eval: the rubric catches what it must, and the mock `documentReview` route (what
 * mock-mode founders get) passes every case through the product's own rounds. The live run is `pnpm evals`
 * (second-read.eval.test.ts), which skips without a key.
 */
import type { SecondReadResult } from "@foundmill/agents";
import { createModelClient, type ModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { runSecondReadCase, SECOND_READ_CASES, secondReadProblems } from "../second-read";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const ledgerly = SECOND_READ_CASES[0]!;

const issue = (over: Partial<SecondReadResult["issues"][number]>): SecondReadResult["issues"][number] => ({ kind: "needs_source", severity: "normal", location: "metrics", heading: "Metrics", quote: "", detail: "d", suggestion: "s", check: "not_checked", citations: [], by: "reviewer", ...over });
const result = (issues: SecondReadResult["issues"], over: Partial<SecondReadResult> = {}): SecondReadResult => ({ document: { kind: "specification", id: "x", title: "x" }, reviewer: { id: "r", name: "R", agentType: "review_agent" }, authorAgentId: "a", rounds: 1, summary: "s", issues, truncated: false, factCheck: "not_needed", revisionsAllowed: 1, usage: { calls: 1, inputTokens: 0, outputTokens: 0, costMinor: 0, mode: "mock", model: null }, ...over });
const planted = [issue({ kind: "inconsistency", location: "pricing" }), issue({ kind: "unlabeled_figure", location: "metrics" })];

describe("second read eval", () => {
  it("covers a case with simulated web sources and one without the web", () => {
    expect(SECOND_READ_CASES.some((c) => c.web === "simulated")).toBe(true);
    expect(SECOND_READ_CASES.some((c) => c.web === "none")).toBe(true);
  });

  it("the rubric passes a good read and catches a missed problem, a claim verified by a simulated source, and a rewrite", () => {
    const doc = ledgerly.document;
    expect(secondReadProblems(ledgerly, doc, doc, result(planted))).toEqual([]);
    expect(secondReadProblems(ledgerly, doc, doc, result(planted.slice(1))).join()).toMatch(/missed the inconsistency/);
    expect(secondReadProblems(ledgerly, doc, doc, result([...planted.slice(0, 1), issue({ kind: "unlabeled_figure", location: "plan" })])).join()).toMatch(/missed the unlabeled figure in metrics/);
    expect(secondReadProblems(ledgerly, doc, doc, result([...planted, issue({ check: "supported", citations: [{ url: null, title: null, simulated: true }] })])).join()).toMatch(/simulated sources only/);
    expect(secondReadProblems(ledgerly, doc, doc, result(planted, { factCheck: "checked" })).join()).toMatch(/fact-check as done/);
    const metrics = doc.sections.find((s) => s.id === "metrics")!.text;
    expect(secondReadProblems(ledgerly, doc, doc, result([...planted, issue({ suggestion: metrics })])).join()).toMatch(/rewrote the Metrics section/);
    const changed = { ...doc, sections: doc.sections.map((s) => (s.id === "metrics" ? { ...s, text: "Rewritten." } : s)) };
    expect(secondReadProblems(ledgerly, doc, changed, result(planted)).join()).toMatch(/changed the document/);
  });

  it("the mock route passes every case through the product's rounds; a simulated source never verifies a claim", async () => {
    const client: ModelClient = createModelClient({ mode: "mock", logger: silent });
    const results = await Promise.all(SECOND_READ_CASES.map((c) => runSecondReadCase(client, c)));
    for (const r of results) expect(r.problems, r.caseId).toEqual([]);
    const simulated = results.find((r) => r.caseId === "sr01")!.result!;
    expect(simulated.factCheck).toBe("simulated_only");
    expect(simulated.issues.find((i) => i.kind === "needs_source")).toMatchObject({ check: "unverifiable" });
    expect(results.find((r) => r.caseId === "sr02")!.result!.factCheck).toBe("unavailable");
  });
});
