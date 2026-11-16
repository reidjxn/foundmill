/**
 * 0143 — the boot backfill of default skills per role (WP-06 T6; founder, Nov 16, 2026: D3). It runs on real
 * projects' agents, so it runs here on PGlite and, in CI's Real Postgres job, on a real server: it gives each live
 * agent hired before a release of defaults the ones it lacks, once; it never re-adds a default the founder removed; a
 * later release adds only its new default; and one business's run never writes another business's rows.
 */
import { SKILL_LIBRARY, defaultSkillKeysFor, librarySkillKey, type LibrarySkill } from "@foundmill/agents";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hireFromTemplate } from "../../hire";
import { repos } from "../../repos";
import { backfillDefaultSkills } from "../../skill-attach";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "defaults-a");
  B = await createBusinessFixture(h, "defaults-b");
});
afterAll(() => h?.close());

const expected = (templateKey: string) => defaultSkillKeysFor(templateKey).map(librarySkillKey).sort();
const defaults = async (businessId: string, agentId: string, agentType: string) =>
  (await repos.skills.listAddedForAgent(h.db, businessId, agentId, agentType)).filter((s) => s.addedBy === "template").map((s) => s.skillKey).sort();

/** An agent as it was before 0143: no default skills, release 0. */
async function hiredBefore0143(businessId: string, templateKey: string) {
  const hired = await hireFromTemplate(h.db, businessId, templateKey);
  for (const key of expected(templateKey)) await repos.skills.removeFromAgent(h.db, businessId, hired.agent.id, key);
  await h.db.execute(sql`update agents set default_skills_version = 0 where id = ${hired.agent.id}::uuid`);
  return hired.agent;
}

describe("default skills backfill (0143)", () => {
  it("gives older agents their defaults once, never re-adds one the founder removed, and keeps each business to its own rows", async () => {
    const qa = await hiredBefore0143(A.businessId, "qa_engineer");
    const writer = await hiredBefore0143(B.businessId, "docs_writer");
    const released = await hiredBefore0143(A.businessId, "planner");
    await repos.agents.release(h.db, A.businessId, released.id);

    const first = await backfillDefaultSkills(h.db);
    expect(first.failed).toEqual([]);
    expect(first.attached).toBeGreaterThanOrEqual(expected("qa_engineer").length + expected("docs_writer").length);
    expect(await defaults(A.businessId, qa.id, qa.agentType)).toEqual(expected("qa_engineer"));
    expect(await defaults(B.businessId, writer.id, writer.agentType)).toEqual(expected("docs_writer"));
    // An agent that left the team is left alone.
    expect(await defaults(A.businessId, released.id, released.agentType)).toEqual([]);
    // Every row written belongs to its agent's business.
    const crossed = await h.db.execute(sql`select count(*)::int as n from agent_skills s join agents a on a.id = s.agent_id where s.added_by = 'template' and s.business_id <> a.business_id`);
    expect((crossed as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(0);

    // The founder removes one; the next boot's backfill does nothing at all.
    const removed = expected("qa_engineer")[0]!;
    await repos.skills.removeFromAgent(h.db, A.businessId, qa.id, removed);
    expect(await backfillDefaultSkills(h.db)).toEqual({ businesses: 0, agents: 0, attached: 0, failed: [] });
    expect(await defaults(A.businessId, qa.id, qa.agentType)).not.toContain(removed);
  });

  it("a later release adds only its new default, once, and not the one the founder removed", async () => {
    const planner = await hireFromTemplate(h.db, A.businessId, "planner");
    const removed = expected("planner")[0]!;
    await repos.skills.removeFromAgent(h.db, A.businessId, planner.agent.id, removed);
    const extra = SKILL_LIBRARY.find((s) => s.key === "web_app_testing")!;
    expect(extra.defaultFor).not.toContain("planner");
    const library: LibrarySkill[] = SKILL_LIBRARY.map((s) => (s.key === extra.key ? { ...s, defaultFor: [...s.defaultFor, "planner"], defaultSince: 2 } : s));
    const run = await backfillDefaultSkills(h.db, { library, version: 2 });
    expect(run.failed).toEqual([]);
    const now = await defaults(A.businessId, planner.agent.id, planner.agent.agentType);
    expect(now).toContain(librarySkillKey(extra.key));
    expect(now).not.toContain(removed);
    expect((await repos.agents.get(h.db, A.businessId, planner.agent.id)).defaultSkillsVersion).toBe(2);
    expect((await backfillDefaultSkills(h.db, { library, version: 2 })).attached).toBe(0);
  });
});
