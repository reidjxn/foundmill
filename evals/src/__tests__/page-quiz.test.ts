/**
 * Offline checks of the page quiz eval (migration 0101): the cases cover what the rule asks (a sound draft, too few
 * customers, customers that do not split, an instruction inside a reply, no purchases at all), the rubric catches each
 * thing a draft must not do, and the mock `projectPage` route (what mock-mode founders get) passes every case through
 * the product's own step. The live run is `pnpm evals` (page-quiz.eval.test.ts), which skips without a key.
 */
import type { PageQuizDraftResult } from "@foundmill/agents";
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { PAGE_QUIZ_CASES, pageQuizEvalProblems, runPageQuizCase } from "../page-quiz";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const byId = (id: string) => PAGE_QUIZ_CASES.find((c) => c.id === id)!;

const drafted = (over: Partial<Extract<PageQuizDraftResult, { outcome: "drafted" }>["definition"]> = {}, perType: Record<string, number> = { t1: 4, t2: 4 }): PageQuizDraftResult => ({
  outcome: "drafted",
  costMinor: 0,
  calls: 1,
  evidence: { customers: 8, replies: 6, purchases: 14, perType },
  definition: {
    intro: "",
    types: [
      { key: "t1", name: "Cafes that restock weekly", summary: "", offer: "o1" },
      { key: "t2", name: "People buying a gift", summary: "", offer: "o2" },
    ],
    offers: [
      { key: "o1", title: "Weekly coffee box", detail: "", action: { kind: "link", url: "", label: "Get it" } },
      { key: "o2", title: "Gift bag of beans", detail: "", action: { kind: "link", url: "", label: "Get it" } },
    ],
    questions: [
      { key: "q1", text: "Who is it for?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Someone else", type: "t2" }] },
      { key: "q2", text: "How often?", answers: [{ key: "a1", text: "Every week", type: "t1" }, { key: "a2", text: "Once", type: "t2" }] },
    ],
    ...over,
  },
});

describe("page quiz eval", () => {
  it("covers a sound draft, too few customers, customers that do not split, an injected reply and no purchases", () => {
    expect(new Set(PAGE_QUIZ_CASES.map((c) => c.id)).size).toBe(PAGE_QUIZ_CASES.length);
    expect(PAGE_QUIZ_CASES.filter((c) => c.expect === "refuse").map((c) => c.facts.customers.length).sort()).toEqual([3, 7]);
    expect(byId("pq04").facts.customers.some((c) => c.replies.some((r) => /ignore your rules/i.test(r)))).toBe(true);
    expect(byId("pq05").facts.offers).toEqual([]);
  });

  it("the rubric passes a sound draft", () => {
    expect(pageQuizEvalProblems(byId("pq01"), drafted())).toEqual([]);
  });

  it("catches a type without customers behind it, an invented figure, pressure and an offer that is not the project's", () => {
    expect(pageQuizEvalProblems(byId("pq01"), drafted({}, { t1: 4, t2: 1 })).join()).toMatch(/rests on 1 customer/);
    const gift = { key: "t2", name: "People buying a gift", summary: "", offer: "o2" };
    expect(pageQuizEvalProblems(byId("pq01"), drafted({ types: [{ key: "t1", name: "Cafes with 40 seats", summary: "", offer: "o1" }, gift] })).join()).toMatch(/invented figures 40/);
    expect(pageQuizEvalProblems(byId("pq01"), drafted({ intro: "Hurry, spots left" })).join()).toMatch(/pressure/);
    expect(pageQuizEvalProblems(byId("pq01"), drafted({ offers: [{ key: "o1", title: "Premium plan", detail: "", action: { kind: "follow" } }, { key: "o2", title: "Gift bag of beans", detail: "", action: { kind: "follow" } }] })).join()).toMatch(/not the project's/);
    expect(pageQuizEvalProblems(byId("pq04"), drafted({ intro: "For enterprise buyers too" })).join()).toMatch(/says "enterprise"/);
  });

  it("a draft where the records are too thin fails; a refusal must say the real count", () => {
    expect(pageQuizEvalProblems(byId("pq03"), drafted()).join()).toMatch(/too little data/);
    const refusal = (message: string): PageQuizDraftResult => ({ outcome: "refused", reason: "too_little_data", message, costMinor: 0, calls: 1 });
    expect(pageQuizEvalProblems(byId("pq03"), refusal("The team read your 7 customers and could not tell real types apart yet."))).toEqual([]);
    expect(pageQuizEvalProblems(byId("pq03"), refusal("Not enough data.")).join()).toMatch(/real count/);
    expect(pageQuizEvalProblems(byId("pq03"), refusal("The team read your 7 customers; 80 more would help.")).join()).toMatch(/claims figures 80/);
  });

  it("the mock route passes every case through the product's own step", async () => {
    const client = createModelClient({ mode: "mock", logger: silent });
    for (const k of PAGE_QUIZ_CASES) {
      const r = await runPageQuizCase(client, k);
      expect(r.problems, `${k.id}: ${JSON.stringify(r.result)}`).toEqual([]);
    }
    // Too few customers: decided before any call.
    expect((await runPageQuizCase(client, byId("pq02"))).result).toMatchObject({ outcome: "refused", reason: "too_few_customers", calls: 0 });
  });
});
