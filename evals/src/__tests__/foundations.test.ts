/**
 * Offline structure tests for the foundations eval (run on every change, mock mode): the cases are well formed, the
 * injected strings really sit in the untrusted inputs (and only there), and the deterministic checks pass over the mock
 * drafter and catch what they are meant to catch.
 */
import { buildFoundationsRequest, docText, finaliseFoundations } from "@foundmill/agents";
import { MockModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { FOUNDATIONS_CASES } from "../foundations/cases";
import { LIVE_MARKUP_RE, checkFoundations, runFoundationsCase, runFoundationsStagedCase, storedStrings } from "../foundations/run";

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
      expect(user.match(/<\/untrusted_content>/g)?.length, c.id).toBe(user.match(/<untrusted_content /g)?.length);
    }
  });

  it("model output full of images, links, URLs and entity markup is stored as plain text (M1)", async () => {
    const ID = "5d6c7b8a-0000-4000-8000-00000000f00d";
    const poison = (s: string) => `${s} ![p](https://beacon.example/p.png) [verify](https://phish.example/login) [[ent:${ID}|Bank]] <img src=x> www.phish.example ops@phish.example`;
    const deep = (v: unknown, key = ""): unknown => {
      if (typeof v === "string") return ["type", "horizon", "label", "section", "sections"].includes(key) ? v : poison(v);
      if (Array.isArray(v)) return v.map((x) => deep(x, key));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, k)]));
      return v;
    };
    const client = new MockModelClient();
    for (const c of FOUNDATIONS_CASES) {
      const result = await client.complete({ ...buildFoundationsRequest(c.inputs) });
      // Not re-parsed: the schema caps lengths, and the point is what finalising does with any string.
      const hostile = deep(result.json) as typeof result.json;
      const draft = finaliseFoundations(hostile, c.inputs);
      const stored = storedStrings(c, draft);
      expect(stored.filter((t) => LIVE_MARKUP_RE.test(t)), c.id).toEqual([]);
      for (const bad of ["beacon.example", "phish.example", ID]) expect(stored.join("\n"), `${c.id}: ${bad}`).not.toContain(bad);
      // The checks agree: nothing stored is flagged, only what the raw text carried.
      expect(checkFoundations(c, draft, "").filter((p) => p.startsWith("stored text")), c.id).toEqual([]);
    }
  });

  it("the stored-text check flags live markup that reached the draft", async () => {
    const c = FOUNDATIONS_CASES[0]!;
    const result = await new MockModelClient().complete({ ...buildFoundationsRequest(c.inputs) });
    const draft = finaliseFoundations(result.json, c.inputs);
    draft.vision.statement = "See ![p](https://beacon.example/p.png)";
    expect(checkFoundations(c, draft, result.text).some((p) => p.startsWith("stored text carries live markup"))).toBe(true);
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

  it("the founder's words reach the stored draft verbatim, and a draft that paraphrases them away is caught", async () => {
    const c = FOUNDATIONS_CASES.find((x) => x.id === "foundations.door_a_founder_words")!;
    expect(c.inputs.idea.founderWords).toBe(c.mustStore![0]);
    const client = new MockModelClient();
    const result = await client.complete({ ...buildFoundationsRequest(c.inputs) });
    const draft = finaliseFoundations(result.json, c.inputs);
    expect(checkFoundations(c, draft, result.text)).toEqual([]);
    // The words sit in the specification itself, not only in a note about it.
    expect(draft.sections.some((s) => docText(s.content).includes(c.mustStore![0]!))).toBe(true);
    const paraphrased = { ...result.json, sections: result.json.sections.map((s) => ({ ...s, content: JSON.parse(JSON.stringify(s.content).split(c.mustStore![0]!).join("Students want shifts; venues want staff.")) })) };
    const problems = checkFoundations(c, finaliseFoundations(paraphrased, c.inputs), result.text);
    expect(problems.some((p) => p.startsWith("the founder's words were not kept verbatim"))).toBe(true);
  });
});

describe("foundations eval, staged drafting (audit P3)", () => {
  it("every case passes the deterministic checks through the staged drafting over the mock client", async () => {
    for (const c of FOUNDATIONS_CASES) {
      const r = await runFoundationsStagedCase(c, { client: new MockModelClient(), grade: false });
      expect(r.error, c.id).toBeUndefined();
      expect(r.problems, c.id).toEqual([]);
      expect(r.draft!.sections.map((s) => s.section), c.id).toEqual(c.inputs.outline.map((o) => o.section));
    }
  });
});

