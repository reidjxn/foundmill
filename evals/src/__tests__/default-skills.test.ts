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
import { DEFAULT_SKILL_CASES, checkDefaultSkillsRequest, type StoredDefault } from "../skills/default-skills";

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
});
