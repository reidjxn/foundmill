/**
 * Default skills per role (WP-06 T6), offline: an agent hired for a role (on PGlite, through the one hire
 * implementation) carries exactly its role's library skills, marked as having come with it, and a task one of them
 * covers gets a request that offers `read_skill` and carries that skill's index line, with no body loaded. Live
 * behavior (the agent reads that skill first): default-skills.eval.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultSkillKeysFor, librarySkillKey } from "@foundmill/agents";
import { hireFromTemplate, repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { DEFAULT_SKILL_CASES, checkDefaultSkillsRequest, defaultSkillsRequest, type StoredDefault } from "../skills/default-skills";

let h: TestHarness;
const stored = new Map<string, StoredDefault[]>();

beforeAll(async () => {
  h = await createTestDb();
  const db = h.db as unknown as Db;
  const business = await repos.businesses.create(db, { name: "Northwind Skincare" });
  for (const c of DEFAULT_SKILL_CASES) {
    if (stored.has(c.templateKey)) continue;
    const hired = await hireFromTemplate(db, business.id, c.templateKey);
    const added = await repos.skills.listAddedForAgent(db, business.id, hired.agent.id, hired.agent.agentType);
    expect(added.every((a) => a.addedBy === "template")).toBe(true);
    stored.set(c.templateKey, added);
  }
}, 120_000);
afterAll(() => h?.close());

describe("skills.default (offline)", () => {
  for (const c of DEFAULT_SKILL_CASES) {
    it(`${c.id}: the hire carries its role's skills, and the task's request offers read_skill and the index line`, () => {
      const skills = stored.get(c.templateKey)!;
      expect(skills.map((s) => s.skillKey).sort()).toEqual(defaultSkillKeysFor(c.templateKey).map(librarySkillKey).sort());
      expect(checkDefaultSkillsRequest(c, skills)).toEqual([]);
    });
  }

  it("skills.default.coding (WP-06 T13): a coding hire carries both coding skills, and its code task loads both only when the preload is on", () => {
    const c = DEFAULT_SKILL_CASES.find((x) => x.templateKey === "qa_engineer")!;
    const skills = stored.get(c.templateKey)!;
    expect(skills.map((s) => s.skillKey)).toEqual(expect.arrayContaining(["library_smallest_change", "library_terse_working_notes"]));
    const codeCase = { ...c, task: { title: "Fix the signup form", goal: "The email check rejects valid addresses." } };
    const loaded = (preload: boolean) => defaultSkillsRequest(codeCase, skills, preload).system;
    expect(loaded(true)).toContain("# Smallest complete change");
    expect(loaded(true)).toContain("# Terse working notes");
    expect(loaded(false)).not.toContain("# Smallest complete change");
    expect(loaded(false)).not.toContain("# Terse working notes");
  });
});

