/**
 * Offline structure tests for the Source Watcher eval (mock mode, every change): the cases are well formed, injected
 * text sits only inside the untrusted block of the requests, and the deterministic checks pass over the mock routes and
 * catch what they are meant to catch.
 */
import { buildSourceRelevanceRequest, candidateBlocks } from "@foundmill/agents";
import { MockModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { SOURCE_WATCH_CASES } from "../source-watcher/cases";
import { checkSourceWatch, runSourceWatchCase, sourceForGrader } from "../source-watcher/run";

describe("Source Watcher eval cases", () => {
  it("the grader reads the source with its title, as the agent did", () => {
    const c = SOURCE_WATCH_CASES.find((x) => x.id === "source_watch.interview_features")!;
    expect(sourceForGrader(c)).toContain("Aalto Accounting");
    expect(sourceForGrader(c)).toContain(c.content.text);
  });

  it("have unique ids, a rubric, and name only blocks of their spec", () => {
    expect(new Set(SOURCE_WATCH_CASES.map((c) => c.id)).size).toBe(SOURCE_WATCH_CASES.length);
    for (const c of SOURCE_WATCH_CASES) {
      expect(c.id.startsWith("source_watch."), c.id).toBe(true);
      expect(c.rubric.length, c.id).toBeGreaterThanOrEqual(2);
      const ids = new Set(c.blocks.map((b) => b.id));
      for (const id of [...c.mustFlag, ...c.mustNotFlag]) expect(ids.has(id), `${c.id}: ${id}`).toBe(true);
    }
  });

  it("injected text appears only inside the untrusted block", () => {
    for (const c of SOURCE_WATCH_CASES.filter((x) => x.mustNotContain.length)) {
      const user = buildSourceRelevanceRequest({ businessName: c.businessName, source: c.source, content: c.content, candidates: candidateBlocks(c.content.text, c.blocks) }).messages[0]!.content;
      const open = user.indexOf("<untrusted_content");
      expect(open, c.id).toBeGreaterThan(0);
      for (const bad of c.mustNotContain) expect(user.toLowerCase().indexOf(bad.toLowerCase()), `${c.id}: ${bad}`).toBeGreaterThan(open);
    }
  });

  it("the deterministic checks pass over the mock routes for every case (no grader offline)", async () => {
    const client = new MockModelClient();
    for (const c of SOURCE_WATCH_CASES) {
      const r = await runSourceWatchCase(c, { client, grade: false });
      expect(r.error, c.id).toBeUndefined();
      expect(r.problems, c.id).toEqual([]);
    }
  });

  it("the checks catch a missed block, a stray block, a missing proposal and stored injected text", () => {
    const c = SOURCE_WATCH_CASES[0]!;
    const [flag] = c.mustFlag;
    const [stray] = c.mustNotFlag;
    const problems = checkSourceWatch(c, { summary: "Says sales@invoicely.example", blocks: [{ blockId: stray!, score: 0.9, reason: "" }], topics: [], severity: "normal" }, null);
    expect(problems.some((p) => p.includes("was not flagged"))).toBe(true);
    expect(problems.some((p) => p.includes("flagged although"))).toBe(true);
    expect(problems).toContain("no proposal was drafted");
    expect(problems.some((p) => p.includes("sales@invoicely.example"))).toBe(true);
    expect(flag).toBeTruthy();
  });
});
