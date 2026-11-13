/**
 * The page quiz (migration 0101): readiness before any call, what the agent is given (no names, the customers'
 * words as untrusted data), the check of its answer (each refusal), the retry, the team's own "too little data", and
 * that mock mode drafts within the same rules.
 */
import { createModelClient, type CompleteResult } from "@foundmill/models";
import { PAGE_QUIZ_MIN_CUSTOMERS, pageQuizProblems } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { hasClubRulesPrefix } from "../club-rules";
import { PAGE_QUIZ_ROUTE, PAGE_QUIZ_USAGE_KIND, buildPageQuizRequest, finalisePageQuiz, pageQuizReadiness, pageQuizRefusalMessage, runPageQuizDraft, type PageQuizFacts } from "../page-quiz";

const customer = (n: number, kind: "person" | "organization", bought: string[], replies: string[] = []) => ({ ref: `c${n}`, kind, bought, replies });

/** Eight real customers: four bought the weekly box, four a gift bag. */
const facts = (over: Partial<PageQuizFacts> = {}): PageQuizFacts => ({
  businessName: "Ember Roasters",
  page: { pitch: "Fresh coffee for cafes and gifts", about: "Roasted every Monday.", forWhom: "", followForm: true },
  customers: [
    customer(1, "organization", ["p1"], ["We restock every Monday."]),
    customer(2, "organization", ["p1"]),
    customer(3, "organization", ["p1"]),
    customer(4, "organization", ["p1"]),
    customer(5, "person", ["p2"], ["It was a birthday present."]),
    customer(6, "person", ["p2"]),
    customer(7, "person", ["p2"]),
    customer(8, "person", ["p2"]),
  ],
  offers: [
    { ref: "p1", title: "Weekly coffee box", buyers: 4 },
    { ref: "p2", title: "Gift bag of beans", buyers: 4 },
  ],
  totals: { customers: 8, replies: 2, purchases: 11 },
  ...over,
});

const good = {
  outcome: "draft",
  reason: "Drawn from what customers bought.",
  types: [
    { name: "Cafes that restock weekly", summary: "They order the box every Monday.", customer_refs: ["c1", "c2", "c3", "c4"], offer_ref: "p1" },
    { name: "People buying a gift", summary: "One bag, for someone else.", customer_refs: ["c5", "c6", "c7"], offer_ref: "p2" },
  ],
  questions: [
    { text: "Who is it for?", answers: [{ text: "My cafe", type_index: 0 }, { text: "Someone else", type_index: 1 }] },
    { text: "How often would you want it?", answers: [{ text: "Every week", type_index: 0 }, { text: "Just once", type_index: 1 }] },
  ],
};

const result = (json: unknown) => ({ json, text: JSON.stringify(json), cost: { costMinorInt: 3 } }) as unknown as CompleteResult;

describe("readiness: no call without enough real customers", () => {
  it("refuses below the minimum with the real count, and with nothing to point to", () => {
    const few = facts({ customers: facts().customers.slice(0, 3) });
    expect(pageQuizReadiness(few)).toEqual({ ready: false, reason: "too_few_customers", customers: 3, need: PAGE_QUIZ_MIN_CUSTOMERS });
    expect(pageQuizRefusalMessage("too_few_customers", few)).toBe(`You have 3 customers on record. The team drafts a quiz from at least ${PAGE_QUIZ_MIN_CUSTOMERS} real customers, so nothing was drafted.`);
    const nothing = facts({ offers: [], page: { ...facts().page, followForm: false } });
    expect(pageQuizReadiness(nothing)).toMatchObject({ ready: false, reason: "no_offers" });
    expect(pageQuizReadiness(facts())).toEqual({ ready: true });
  });

  it("makes no call when not ready", async () => {
    let calls = 0;
    const client = { complete: async () => (calls++, result(good)) } as never;
    const out = await runPageQuizDraft(client, facts({ customers: facts().customers.slice(0, 2) }), { businessId: "b", kind: PAGE_QUIZ_USAGE_KIND });
    expect(out).toMatchObject({ outcome: "refused", reason: "too_few_customers", calls: 0, costMinor: 0 });
    expect(calls).toBe(0);
  });
});

describe("the request", () => {
  it("carries the house rules, the Product lead, and the customers only as untrusted data with opaque refs", () => {
    const req = buildPageQuizRequest(facts());
    expect(req.route).toBe(PAGE_QUIZ_ROUTE);
    expect(hasClubRulesPrefix(req.system[0]!)).toBe(true);
    const user = req.messages[0]!.content;
    expect(user).toMatch(/<untrusted_content kind="customers">/);
    expect(user).toMatch(/<untrusted_content kind="offers">/);
    expect(user).toContain('"ref":"follow"');
    expect(user).not.toMatch(/@|entity_id|display_name/);
    expect(buildPageQuizRequest(facts(), "a type rested on one customer").messages[0]!.content).toMatch(/could not be used: a type rested on one customer/);
  });
});

describe("finalisePageQuiz", () => {
  it("turns a sound answer into a definition whose evidence is counted from the refs, not taken from the model", () => {
    const fin = finalisePageQuiz(good, facts());
    if (!("definition" in fin)) throw new Error(JSON.stringify(fin));
    expect(fin.definition.types.map((t) => [t.key, t.offer])).toEqual([["t1", "o1"], ["t2", "o2"]]);
    expect(fin.definition.offers.map((o) => o.title)).toEqual(["Weekly coffee box", "Gift bag of beans"]);
    // A bought offer waits for the founder's own pay link before it can be approved.
    expect(fin.definition.offers[0]!.action).toEqual({ kind: "link", url: "", label: "Get it" });
    expect(pageQuizProblems(fin.definition, { followForm: true }).every((p) => /^offers\.\d+\.action$/.test(p.path))).toBe(true);
    expect(fin.evidence).toEqual({ customers: 8, replies: 2, purchases: 11, perType: { t1: 4, t2: 3 } });
  });

  it("the Follow form is an offer only when the page has it", () => {
    const toFollow = { ...good, types: [good.types[0]!, { ...good.types[1]!, offer_ref: "follow" }] };
    const fin = finalisePageQuiz(toFollow, facts());
    expect("definition" in fin && fin.definition.offers[1]).toEqual({ key: "o2", title: "Follow Ember Roasters", detail: "", action: { kind: "follow" } });
    expect(finalisePageQuiz(toFollow, facts({ page: { ...facts().page, followForm: false } }))).toMatchObject({ refused: "unknown_offer" });
  });

  it("never a type without real customers behind it", () => {
    expect(finalisePageQuiz({ ...good, types: [good.types[0]!, { ...good.types[1]!, customer_refs: ["c5"] }] }, facts())).toMatchObject({ refused: "unsupported_type" });
    expect(finalisePageQuiz({ ...good, types: [good.types[0]!, { ...good.types[1]!, customer_refs: ["c5", "c99"] }] }, facts())).toMatchObject({ refused: "unsupported_type" });
    expect(finalisePageQuiz({ ...good, types: [good.types[0]!, { ...good.types[1]!, customer_refs: ["c5", "c5"] }] }, facts())).toMatchObject({ refused: "unsupported_type" });
  });

  it("never an offer that is not in the records", () => {
    expect(finalisePageQuiz({ ...good, types: [good.types[0]!, { ...good.types[1]!, offer_ref: "p9" }] }, facts())).toMatchObject({ refused: "unknown_offer" });
  });

  it("never a figure or a count it does not have", () => {
    for (const name of ["Cafes ordering 40 bags", "Most of our customers", "The 80% who reorder", "Dozens of cafes"]) {
      expect(finalisePageQuiz({ ...good, types: [{ ...good.types[0]!, name }, good.types[1]!] }, facts()), name).toMatchObject({ refused: "invented_figure" });
    }
    // A figure the project's own words carry is fine.
    const own = facts({ offers: [{ ref: "p1", title: "12 bag subscription", buyers: 4 }, facts().offers[1]!] });
    expect("definition" in finalisePageQuiz({ ...good, types: [{ ...good.types[0]!, name: "Cafes on the 12 bag plan" }, good.types[1]!] }, own)).toBe(true);
  });

  it("never pressure, markup or links", () => {
    expect(finalisePageQuiz({ ...good, questions: [{ ...good.questions[0]!, text: "Hurry, who is it for?" }, good.questions[1]!] }, facts())).toMatchObject({ refused: "pressure" });
    expect(finalisePageQuiz({ ...good, questions: [{ ...good.questions[0]!, text: "Who is it for!" }, good.questions[1]!] }, facts())).toMatchObject({ refused: "pressure" });
    expect(finalisePageQuiz({ ...good, types: [{ ...good.types[0]!, summary: "See https://x.example" }, good.types[1]!] }, facts())).toMatchObject({ refused: "markup" });
    expect(finalisePageQuiz({ ...good, types: [{ ...good.types[0]!, name: "**Cafes**" }, good.types[1]!] }, facts())).toMatchObject({ refused: "markup" });
  });

  it("a quiz a visitor can answer: every type reached, every question telling types apart", () => {
    const flat = { ...good, questions: good.questions.map((q) => ({ ...q, answers: q.answers.map((a) => ({ ...a, type_index: 0 })) })) };
    expect(finalisePageQuiz(flat, facts())).toMatchObject({ refused: "limits" });
    expect(finalisePageQuiz({ ...good, questions: [good.questions[0]!] }, facts())).toMatchObject({ refused: "limits" });
  });

  it("the team's own too-little-data answer is a refusal, and so is a single type", () => {
    expect(finalisePageQuiz({ outcome: "too_little_data", reason: "Every customer bought the same thing.", types: [], questions: [] }, facts())).toMatchObject({ refused: "too_little_data" });
    expect(finalisePageQuiz({ ...good, types: [good.types[0]!] }, facts())).toMatchObject({ refused: "too_little_data" });
  });
});

describe("runPageQuizDraft", () => {
  const harness = (answers: unknown[]) => {
    const seen: string[] = [];
    const client = { complete: async (req: { messages: { content: string }[] }) => (seen.push(req.messages[0]!.content), result(answers.shift())) } as never;
    return { client, seen };
  };

  it("retries once with the reason when a rule was broken, then drafts", async () => {
    const h = harness([{ ...good, types: [good.types[0]!, { ...good.types[1]!, customer_refs: ["c5"] }] }, good]);
    const out = await runPageQuizDraft(h.client, facts(), { businessId: "b", kind: PAGE_QUIZ_USAGE_KIND });
    expect(out).toMatchObject({ outcome: "drafted", calls: 2, costMinor: 6 });
    expect(h.seen[1]).toMatch(/could not be used: the type "People buying a gift" must rest on at least 2 customers/);
  });

  it("the team's own too-little-data is final and said plainly", async () => {
    const h = harness([{ outcome: "too_little_data", reason: "No difference between them.", types: [], questions: [] }]);
    const out = await runPageQuizDraft(h.client, facts(), { businessId: "b", kind: PAGE_QUIZ_USAGE_KIND });
    expect(out).toMatchObject({ outcome: "refused", reason: "too_little_data", calls: 1 });
    expect(out.outcome === "refused" && out.message).toBe("The team read your 8 customers and could not tell real types apart yet, so it drafted nothing rather than guess. More purchases and replies on record will help.");
  });

  it("two broken answers: nothing is saved, and the founder is told why in one sentence", async () => {
    const bad = { ...good, types: [{ ...good.types[0]!, name: "Cafes ordering 40 bags" }, good.types[1]!] };
    const out = await runPageQuizDraft(harness([bad, bad]).client, facts(), { businessId: "b", kind: PAGE_QUIZ_USAGE_KIND });
    expect(out).toMatchObject({ outcome: "refused", reason: "invented_figure", calls: 2 });
  });
});

describe("mock mode", () => {
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const client = createModelClient({ mode: "mock", logger: silent });
  const attribution = { businessId: "00000000-0000-4000-8000-0000000000aa", kind: PAGE_QUIZ_USAGE_KIND };

  it("drafts from what customers bought, within every rule, the same every time", async () => {
    const a = await runPageQuizDraft(client, facts(), attribution);
    const b = await runPageQuizDraft(client, facts(), attribution);
    if (a.outcome !== "drafted") throw new Error(JSON.stringify(a));
    expect(a.definition).toEqual(b.outcome === "drafted" ? b.definition : null);
    expect(a.definition.types).toHaveLength(2);
    expect(a.evidence.perType).toEqual({ t1: 4, t2: 4 });
  });

  it("falls back to people and organizations, pointing to the Follow form when nothing was bought", async () => {
    const none = facts({ customers: facts().customers.map((c) => ({ ...c, bought: [] })), offers: [] });
    const out = await runPageQuizDraft(client, none, attribution);
    if (out.outcome !== "drafted") throw new Error(JSON.stringify(out));
    expect(out.definition.offers).toEqual([{ key: "o1", title: "Follow Ember Roasters", detail: "", action: { kind: "follow" } }]);
    expect(pageQuizProblems(out.definition, { followForm: true })).toEqual([]);
  });

  it("says too little data when the customers do not split", async () => {
    const same = facts({ customers: facts().customers.map((c) => ({ ...c, kind: "person" as const, bought: ["p1"] })) });
    expect(await runPageQuizDraft(client, same, attribution)).toMatchObject({ outcome: "refused", reason: "too_little_data" });
  });
});
