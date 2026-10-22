/**
 * Offline checks of the Composer eval (UX plan §7.19): the corpus is complete and well formed, the replace-tier gate
 * catches what it must and nothing else, and the mock Composer, which is what mock-mode testers read, passes the gate
 * over all 100 notes with a because on every recommended option.
 */
import { describe, expect, it } from "vitest";
import { createModelClient } from "@foundmill/models";
import { PLAIN_LANGUAGE_TIERS } from "@foundmill/shared";
import { COMPOSER_CASE_KINDS, COMPOSER_CORPUS, COMPOSER_RUBRIC, composerSystemPrompt, corpusId, plainLanguageHits, replaceTierPatterns, runComposerCase, summariseComposer } from "../composer";

describe("composer eval corpus (AC-11.3.1, 100 notes)", () => {
  it("has 100 cases with unique ids, every note kind and every founder experience", () => {
    expect(COMPOSER_CORPUS.length).toBe(100);
    expect(new Set(COMPOSER_CORPUS.map((c) => c.id)).size).toBe(100);
    for (const kind of COMPOSER_CASE_KINDS) expect(COMPOSER_CORPUS.filter((c) => c.kind === kind).length, kind).toBe(10);
    expect(new Set(COMPOSER_CORPUS.map((c) => c.founderExperience))).toEqual(new Set(["first_time", "exited", "operator", "domain_expert"]));
  });

  it("every case is JSON data whose events name only manifest ids and whose voice is a manifest agent", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const c of COMPOSER_CORPUS) {
      expect(() => JSON.stringify(c.input)).not.toThrow();
      const ids = new Set(c.manifestIds);
      for (const id of c.manifestIds) expect(id).toMatch(uuid);
      expect(ids.has(c.voice.id), c.id).toBe(true);
      const events = c.input.events as Array<{ entity_ids: string[] }>;
      for (const e of events) for (const id of e.entity_ids) expect(ids.has(id), `${c.id} names ${id}`).toBe(true);
      expect(typeof c.input.now).toBe("string");
    }
    expect(corpusId("customer", 7)).toMatch(uuid);
    expect(corpusId("customer", 7)).not.toBe(corpusId("customer", 8));
  });

  it("renders the house rules and the Composer rules with the case's founder experience", () => {
    const first = COMPOSER_CORPUS[0]!;
    const [rules, composer] = composerSystemPrompt(first);
    expect(rules).toMatch(/^You are an AI agent working for Ledgerly/);
    expect(composer).toContain(`Founder experience: ${first.founderExperience}.`);
    expect(composer).toContain(`in the voice of ${first.voice.name}, ${first.voice.role}`);
  });
});

describe("the plain-language gate (replace tier of PLAIN_LANGUAGE_TIERS)", () => {
  it("builds one whole-word pattern per term, case-sensitive for the acronyms", () => {
    const patterns = replaceTierPatterns();
    expect(patterns.length).toBe(PLAIN_LANGUAGE_TIERS.replace.length);
    const hits = (text: string) => plainLanguageHits({ body_md: text, decision: null }, patterns).map((h) => h.term);
    expect(hits("Outbound to a narrow ICP")).toEqual(["ICP"]);
    expect(hits("the principal is unchanged")).toEqual([]);
    expect(hits("channel cpa stands at 12")).toEqual([]);
    expect(hits("The exhibit below is drawn from a named query.")).toEqual(["named query", "exhibit"]);
    expect(hits("The lead will Triage them.")).toEqual(["Triage"]);
    expect(hits("a time box of two hours")).toEqual(["time box"]);
    expect(hits("create a request_human_action")).toEqual(["request_human_action"]);
    expect(hits("the unit economics look fine")).toEqual(["unit economics"]);
    expect(hits("[[ent:0000cccc-0000-4000-8000-000000000001|ICP Ltd]] signed")).toEqual(["ICP"]);
  });

  it("reads the body, the subject and every option's label, consequence and because", () => {
    const hits = plainLanguageHits({
      subject: "Decision needed",
      body_md: "This is yours to decide because one option spends money you can't get back.",
      decision: {
        options: [
          { id: "a", label: "Approve", recommended: true, consequence: "The exhibit updates.", cost_minor: 0, reversible: true, because: "Recommended because it is free." },
          { id: "b", label: "Raise the CPA cap", recommended: false, consequence: "Spend continues.", cost_minor: 0, reversible: true, because: "The webhook fires." },
        ],
        free_text: true,
        expires_at: null,
      },
    });
    expect(hits.map((h) => `${h.field}:${h.term}`)).toEqual(["decision.options[0].consequence:exhibit", "decision.options[1].label:CPA", "decision.options[1].because:webhook"]);
  });

  it("the rubric has the three lines the plan names", () => {
    expect(COMPOSER_RUBRIC.length).toBe(3);
    expect(COMPOSER_RUBRIC[0]).toMatch(/business stake first/);
    expect(COMPOSER_RUBRIC[1]).toMatch(/[Dd]efines or avoids each term/);
    expect(COMPOSER_RUBRIC[2]).toMatch(/recommended option has a because/);
  });
});

describe("the mock Composer over the corpus (what mock-mode testers read)", () => {
  it("passes the plain-language gate on all 100 notes, with a because on every recommended option and under 180 words", async () => {
    const client = createModelClient({ mode: "mock" });
    const results = [];
    for (const c of COMPOSER_CORPUS) results.push(await runComposerCase(c, client, { grade: false }));
    const summary = summariseComposer(results);
    expect(results.filter((r) => r.error).map((r) => `${r.caseId}: ${r.error}`)).toEqual([]);
    expect(results.flatMap((r) => r.hits.map((h) => `${r.caseId} ${h.field}: ${h.text}`))).toEqual([]);
    expect(summary.noBecause).toEqual([]);
    expect(summary.passed).toBe(100);
    for (const r of results) {
      const words = r.output!.body_md.split(/\s+/).filter(Boolean).length;
      expect(words, r.caseId).toBeLessThanOrEqual(180);
      expect(words, r.caseId).toBeGreaterThan(0);
    }
    expect(Object.keys(summary.byKind).sort()).toEqual([...COMPOSER_CASE_KINDS].sort());
  });

  it("grades through the grader route and reports lines per rubric criterion", async () => {
    const client = createModelClient({ mode: "mock" });
    const r = await runComposerCase(COMPOSER_CORPUS[8]!, client);
    expect(r.error).toBeUndefined();
    expect(r.grader).not.toBeNull();
    expect(r.grader!.lines.length).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
