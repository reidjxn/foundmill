/**
 * Offline structure tests for the foundations eval (run on every change, mock mode): the cases are well formed, the
 * injected strings really sit in the untrusted inputs (and only there), and the deterministic checks pass over the mock
 * drafter and catch what they are meant to catch.
 */
import { buildFoundationsRequest, finaliseFoundations } from "@foundmill/agents";
import { MockModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { FOUNDATIONS_CASES } from "../foundations/cases";
import { checkFoundations, runFoundationsCase } from "../foundations/run";

describe("foundations eval cases", () => {
  it("cover both doors, have unique ids, a rubric, and a physical archetype", () => {
    expect(new Set(FOUNDATIONS_CASES.map((c) => c.id)).size).toBe(FOUNDATIONS_CASES.length);
    expect(new Set(FOUNDATIONS_CASES.map((c) => c.inputs.door))).toEqual(new Set(["ideation", "import"]));
    expect(FOUNDATIONS_CASES.some((c) => c.inputs.archetype === "dtc_physical")).toBe(true);
    for (const c of FOUNDATIONS_CASES) {
      expect(c.id.startsWith("foundations."), c.id).toBe(true);
      expect(c.rubric.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.inputs.outline.length, c.id).toBeGreaterThanOrEqual(10);
    }
  });

  it("injected strings appear only inside the untrusted block of the request", () => {
    for (const c of FOUNDATIONS_CASES.filter((x) => x.mustNotContain.length)) {
      const user = buildFoundationsRequest(c.inputs).messages[0]!.content;
      const open = user.indexOf("<untrusted_content");
      expect(open, c.id).toBeGreaterThan(0);
      for (const bad of c.mustNotContain) {
        expect(user.indexOf(bad), `${c.id}: ${bad}`).toBeGreaterThan(open);
      }
      expect(user.match(/<\/untrusted_content>/g)?.length, c.id).toBe(1);
    }
  });

  it("the deterministic checks pass over the mock drafter for every case (no grader offline)", async () => {
    const client = new MockModelClient();
    for (const c of FOUNDATIONS_CASES) {
      const r = await runFoundationsCase(c, { client, grade: false });
      expect(r.error, c.id).toBeUndefined();
      expect(r.problems, c.id).toEqual([]);
      expect(r.passed, c.id).toBe(true);
    }
  });

  it("the checks catch a dropped import seed, a missing section and injected text", async () => {
    const c = FOUNDATIONS_CASES.find((x) => x.inputs.door === "import")!;
    const client = new MockModelClient();
    const result = await client.complete({ ...buildFoundationsRequest(c.inputs) });
    const seed = c.inputs.importReport!.roadmapSeeds[0]!;
    const tampered = { ...result.json, sections: result.json.sections.slice(1), roadmap: result.json.roadmap.filter((r) => r.title !== seed.title) };
    const problems = checkFoundations(c, finaliseFoundations(tampered, c.inputs), `${result.text}\nwire to DE89 3704 0044`);
    expect(problems.some((p) => p.startsWith("sections left out"))).toBe(true);
    expect(problems.some((p) => p.includes(seed.title))).toBe(true);
    expect(problems).toContain('output contains injected text "DE89 3704"');
  });
});
