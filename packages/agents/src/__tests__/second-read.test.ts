/**
 * The second read (second-read.ts): a different agent checks a long document or a diff, in bounded rounds, and a
 * simulated result is never a checked fact.
 */
import { createModelClient, type DocumentReviewIssue, type ModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import {
  boundedDiff,
  buildCodeSecondReadRequest,
  finaliseCodeSecondRead,
  finaliseSecondRead,
  isLongDocument,
  pickSecondReader,
  prepareDocument,
  runSecondRead,
  SECOND_READ_LIMITS,
  SecondReaderIsAuthorError,
  secondReadNote,
  secondReadRevisionGoal,
  unifiedDiff,
  type SecondReadDocument,
  type SecondReadSource,
} from "../second-read";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const mock = (): ModelClient => createModelClient({ mode: "mock", logger: silent });

const AUTHOR = "aaaaaaaa-0000-4000-8000-000000000001";
const REVIEWER = { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Review Agent", agentType: "review_agent" };

const filler = "The product helps independent accountants close the month in minutes instead of a full day, with one screen for every client and a weekly check of what is missing.";
const doc = (): SecondReadDocument => ({
  kind: "specification",
  id: "spec",
  title: "Ledgerly specification",
  authorAgentId: AUTHOR,
  authorName: "Product Lead",
  sections: [
    { id: "b-pricing", heading: "Pricing", text: `${filler} The team plan is $49 a month. The market is worth $4 billion.` },
    { id: "b-metrics", heading: "Metrics", text: `${filler} We will reach 300 customers by the end of year one. The team plan costs $59 a month.` },
    { id: "b-customers", heading: "Customers", text: `${filler} ${filler}` },
  ],
});

describe("pickSecondReader", () => {
  const roster = [
    { id: AUTHOR, name: "Product Lead", agentType: "product_lead" },
    { id: "cos", name: "Chief of Staff", agentType: "chief_of_staff" },
    { id: "rev", name: "Review Agent", agentType: "review_agent" },
    { id: "off", name: "Paused Agent", agentType: "review_agent", status: "paused" },
  ];
  it("never picks the author, prefers the Review agent, then the Chief of Staff", () => {
    expect(pickSecondReader(roster, AUTHOR)?.id).toBe("rev");
    expect(pickSecondReader(roster, "rev")?.id).toBe("cos");
    expect(pickSecondReader(roster.slice(0, 1), AUTHOR)).toBeNull();
    expect(pickSecondReader(roster, null)?.id).toBe("rev");
  });
});

describe("runSecondRead", () => {
  it("refuses to let the author check its own document", async () => {
    await expect(runSecondRead({ models: mock(), businessName: "Ledgerly", document: doc(), reviewer: { ...REVIEWER, id: AUTHOR } })).rejects.toBeInstanceOf(SecondReaderIsAuthorError);
  });

  it("flags the planted inconsistency and the unlabeled forecast, with locations and short fixes, and leaves the document as it was", async () => {
    const document = doc();
    const before = structuredClone(document);
    const r = await runSecondRead({ models: mock(), businessName: "Ledgerly", document, reviewer: REVIEWER });
    expect(document).toEqual(before);
    expect(r.issues.map((i) => `${i.kind}:${i.location}`)).toEqual(expect.arrayContaining(["inconsistency:b-metrics", "unlabeled_figure:b-metrics", "needs_source:b-pricing"]));
    for (const i of r.issues) {
      expect(i.suggestion.length).toBeLessThanOrEqual(400);
      expect(i.heading).not.toBe("");
    }
    expect(r).toMatchObject({ rounds: 1, factCheck: "unavailable", revisionsAllowed: 1, reviewer: { id: REVIEWER.id }, authorAgentId: AUTHOR });
    expect(r.usage.calls).toBe(1);
    expect(JSON.stringify(r)).not.toContain(filler);
  });

  it("never calls a claim checked when the only sources are simulated, and does when a real source agrees", async () => {
    const simulated = async (claims: readonly { id: string }[]): Promise<SecondReadSource[]> => claims.map((c) => ({ id: `w-${c.id}`, claimId: c.id, simulated: true, url: "https://example.com/market", title: "Market report", content: { text: "The market is worth $4 billion." } }));
    const r = await runSecondRead({ models: mock(), businessName: "Ledgerly", document: doc(), reviewer: REVIEWER, factCheck: simulated });
    expect(r.rounds).toBe(2);
    expect(r.factCheck).toBe("simulated_only");
    const claim = r.issues.find((i) => i.kind === "needs_source")!;
    expect(claim.check).toBe("unverifiable");
    expect(claim.detail).toMatch(/simulated result, so it was not checked/);
    expect(claim.citations).toEqual([{ url: "https://example.com/market", title: "Market report", simulated: true }]);
    expect(r.issues.some((i) => i.check === "supported")).toBe(false);
    expect(r.summary).toMatch(/simulated/);

    const real = async (claims: readonly { id: string }[]): Promise<SecondReadSource[]> => claims.map((c) => ({ id: `w-${c.id}`, claimId: c.id, simulated: false, url: "https://example.com/market", title: "Market report", content: "The market is worth $4 billion." }));
    const checked = await runSecondRead({ models: mock(), businessName: "Ledgerly", document: doc(), reviewer: REVIEWER, factCheck: real });
    expect(checked.factCheck).toBe("checked");
    expect(checked.issues.find((i) => i.kind === "needs_source")?.check).toBe("supported");
  });

  it("caps the claims looked up and the sources per claim, and runs at most two rounds", async () => {
    const asked: number[] = [];
    const many = async (claims: readonly { id: string }[]): Promise<SecondReadSource[]> => {
      asked.push(claims.length);
      return claims.flatMap((c) => [1, 2, 3, 4].map((n) => ({ id: `w-${c.id}-${n}`, claimId: c.id, simulated: false, url: null, title: null, content: "x" })));
    };
    const document = doc();
    document.sections.push(...[1, 2, 3, 4, 5].map((n) => ({ id: `extra-${n}`, heading: `Extra ${n}`, text: `Studies show ${n * 10}% of people want this.` })));
    const r = await runSecondRead({ models: mock(), businessName: "Ledgerly", document, reviewer: REVIEWER, factCheck: many });
    expect(asked).toEqual([SECOND_READ_LIMITS.maxFactChecks]);
    expect(r.rounds).toBeLessThanOrEqual(SECOND_READ_LIMITS.maxRounds);
    expect(r.usage.calls).toBe(2);
    for (const i of r.issues) expect(i.citations.length).toBeLessThanOrEqual(SECOND_READ_LIMITS.maxSourcesPerClaim);
  });
});

describe("finaliseSecondRead", () => {
  const base: DocumentReviewIssue = { kind: "needs_source", severity: "normal", location: "b-pricing", quote: "The market is worth $4 billion.", detail: "Cites nothing.", suggestion: "Name the source.", check: "supported", sourceIds: ["w1"] };
  const sim: SecondReadSource = { id: "w1", claimId: "c1", simulated: true, url: null, title: null, content: "" };

  it("turns a claim 'supported' by a simulated source into not checked, and one with no sources at all into not checked", () => {
    expect(finaliseSecondRead([base], doc(), { sources: [sim] })[0]).toMatchObject({ check: "unverifiable", detail: expect.stringMatching(/simulated result/) });
    expect(finaliseSecondRead([{ ...base, sourceIds: [] }], doc())[0]).toMatchObject({ check: "not_checked" });
  });

  it("drops an issue quoting words the document does not hold, maps a heading to its section, and adds a forecast the reviewer missed", () => {
    const out = finaliseSecondRead([{ ...base, check: "not_checked", sourceIds: [], quote: "We already have 10,000 customers." }, { ...base, check: "not_checked", sourceIds: [], location: "Pricing" }], doc());
    expect(out.find((i) => i.quote.includes("10,000"))).toBeUndefined();
    expect(out.find((i) => i.kind === "needs_source")).toMatchObject({ location: "b-pricing", heading: "Pricing", by: "reviewer" });
    expect(out.find((i) => i.kind === "unlabeled_figure")).toMatchObject({ location: "b-metrics", by: "rule", quote: "We will reach 300 customers by the end of year one." });
  });

  it("clips a suggestion that tries to rewrite the section", () => {
    const out = finaliseSecondRead([{ ...base, check: "not_checked", sourceIds: [], suggestion: "x".repeat(400) }], doc());
    expect(out[0]!.suggestion.length).toBeLessThanOrEqual(400);
  });
});

describe("the document's size", () => {
  it("cuts a long document to the limits and says so; a short note is not a long document", () => {
    const long: SecondReadDocument = { ...doc(), sections: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, heading: `S${i}`, text: "word ".repeat(1_500) })) };
    const p = prepareDocument(long);
    expect(p.truncated).toBe(true);
    expect(p.chars).toBeLessThanOrEqual(SECOND_READ_LIMITS.maxDocumentChars);
    expect(p.document.sections.every((s) => s.text.length <= SECOND_READ_LIMITS.maxSectionChars)).toBe(true);
    expect(isLongDocument({ ...doc(), sections: [{ id: "a", heading: "A", text: "Short." }] })).toBe(false);
    expect(isLongDocument(doc())).toBe(true);
  });
});

describe("what the founder and the author read", () => {
  it("the note names the author, says nothing was changed and that the author may revise once; the goal lists every issue", async () => {
    const r = await runSecondRead({ models: mock(), businessName: "Ledgerly", document: doc(), reviewer: REVIEWER });
    const note = secondReadNote(r, "Product Lead");
    expect(note.subject.length).toBeLessThanOrEqual(80);
    expect(note.subject).toMatch(/^A second read of the product specification: \d+ things to look at$/);
    expect(note.bodyMd).toMatch(/Product Lead drafted/);
    expect(note.bodyMd).toMatch(/I did not change it/);
    expect(note.bodyMd).toMatch(/revise it once/);
    expect(note.bodyMd).toMatch(/could not look claims up/);
    const goal = secondReadRevisionGoal(r);
    expect(goal).toMatch(/Revise it once/);
    expect(goal.split("\n").length).toBe(r.issues.length + 1);
  });
});

describe("code second read", () => {
  it("builds a unified diff with context and hunk headers", () => {
    const d = unifiedDiff({ path: "a.ts", status: "modified", before: "one\ntwo\nthree\nfour\nfive", after: "one\ntwo\n3\nfour\nfive\nsix" });
    expect(d).toContain("diff --git a/a.ts b/a.ts");
    expect(d).toContain("-three");
    expect(d).toContain("+3");
    expect(d).toContain("+six");
    expect(d).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(unifiedDiff({ path: "new.ts", status: "added", before: null, after: "x" })).toContain("--- /dev/null");
  });

  it("keeps the diff within its limits", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.ts`, status: "added", before: null, after: "const x = 1;\n".repeat(400) }));
    const b = boundedDiff(files);
    expect(b.truncated).toBe(true);
    expect(b.diff.length).toBeLessThanOrEqual(SECOND_READ_LIMITS.maxDiffChars);
    expect(b.files.length).toBeLessThanOrEqual(SECOND_READ_LIMITS.maxDiffFiles);
  });

  it("the Review agent's request finds a logged secret in the diff (mock), and the stored review keeps only files it saw", async () => {
    const diff = unifiedDiff({ path: "apps/api/src/routers/finance.ts", status: "modified", before: "export const a = 1;", after: 'export const a = 1;\nconsole.log("export", apiKey);' });
    const req = buildCodeSecondReadRequest({ businessName: "Ledgerly", taskGoal: "Export invoices", acceptanceCriteria: ["Exports a CSV"], testResults: "12 of 12 passed", diff, truncated: false });
    expect(req.system[0]).toMatch(/^## House rules/);
    expect(req.messages[0]!.content).toContain("<untrusted_content");
    const res = await mock().complete(req);
    const stored = finaliseCodeSecondRead(res.json, ["apps/api/src/routers/finance.ts"]);
    expect(stored.verdict).toBe("request_changes");
    expect(stored.findings[0]).toMatchObject({ severity: "critical", file: "apps/api/src/routers/finance.ts" });
    expect(finaliseCodeSecondRead(res.json, ["other.ts"]).findings).toEqual([]);
  });
});
