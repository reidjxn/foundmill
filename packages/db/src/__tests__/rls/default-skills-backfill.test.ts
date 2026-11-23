/**
 * 0141 — the boot backfill of default skills per role (WP-06 T6; founder, Nov 16, 2026: D3). It runs on real
 * projects' agents, so it runs here on PGlite and, in CI's Real Postgres job, on a real server: it gives each live
 * agent hired before a release of defaults the ones it lacks, once; it never re-adds a default the founder removed; a
 * later release adds only its new default; and one business's run never writes another business's rows.
 */
import { DEFAULT_SKILLS_VERSION, SKILL_LIBRARY, defaultSkillKeysFor, librarySkillKey, type LibrarySkill } from "@foundmill/agents";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hireFromTemplate } from "../../hire";
import { repos } from "../../repos";
import { attachDefaultSkills, backfillDefaultSkills } from "../../skill-attach";
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

/** An agent as it was before 0141: no default skills, release 0. */
async function hiredBefore0141(businessId: string, templateKey: string) {
  const hired = await hireFromTemplate(h.db, businessId, templateKey);
  for (const key of expected(templateKey)) await repos.skills.removeFromAgent(h.db, businessId, hired.agent.id, key);
  await h.db.execute(sql`update agents set default_skills_version = 0 where id = ${hired.agent.id}::uuid`);
  return hired.agent;
}

describe("default skills backfill (0141)", () => {
  it("gives older agents their defaults once, never re-adds one the founder removed, and keeps each business to its own rows", async () => {
    const qa = await hiredBefore0141(A.businessId, "qa_engineer");
    const writer = await hiredBefore0141(B.businessId, "docs_writer");
    const released = await hiredBefore0141(A.businessId, "planner");
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
    // The release after the current one (release 2 added the tool scout, Nov 22, 2026).
    const next = DEFAULT_SKILLS_VERSION + 1;
    const extra = SKILL_LIBRARY.find((s) => s.key === "web_app_testing")!;
    expect(extra.defaultFor).not.toContain("planner");
    const library: LibrarySkill[] = SKILL_LIBRARY.map((s) => (s.key === extra.key ? { ...s, defaultFor: [...s.defaultFor, "planner"], defaultSince: next } : s));
    const run = await backfillDefaultSkills(h.db, { library, version: next });
    expect(run.failed).toEqual([]);
    const now = await defaults(A.businessId, planner.agent.id, planner.agent.agentType);
    expect(now).toContain(librarySkillKey(extra.key));
    expect(now).not.toContain(removed);
    expect((await repos.agents.get(h.db, A.businessId, planner.agent.id)).defaultSkillsVersion).toBe(next);
    expect((await backfillDefaultSkills(h.db, { library, version: next })).attached).toBe(0);
  });

  it("never gives back a skill removed before 0141, and records what it gave in the audit log", async () => {
    const qa = await hiredBefore0141(B.businessId, "qa_engineer");
    // As the founder's removal of one, before 0141, left it: an agent.skills.remove audit row.
    const removed = expected("qa_engineer")[1]!;
    await repos.audit.append(h.db, B.businessId, { actorKind: "user", actorId: B.ownerId, action: "agent.skills.remove", target: { kind: "skill_definition", id: B.agentId }, details: { agentId: qa.id, skillKey: removed, source: "library" } });
    expect((await backfillDefaultSkills(h.db)).failed).toEqual([]);
    const now = await defaults(B.businessId, qa.id, qa.agentType);
    expect(now).not.toContain(removed);
    expect(now).toEqual(expected("qa_engineer").filter((k) => k !== removed));
    const entry = (await repos.audit.list(h.db, B.businessId, { action: "agent.skills.add_defaults" })).items.find((e) => (e.target as { id?: string }).id === qa.id);
    expect(entry).toMatchObject({ actorKind: "system", details: { version: DEFAULT_SKILLS_VERSION } });
    expect([...(entry!.details as { skillKeys: string[] }).skillKeys].sort()).toEqual(now);
  });

  it("refuses to give defaults to another business's agent", async () => {
    const theirs = await hiredBefore0141(B.businessId, "planner");
    await expect(h.db.transaction((tx) => attachDefaultSkills(tx, A.businessId, [{ id: theirs.id, agentType: theirs.agentType, templateKey: "planner" }]))).rejects.toThrow(/own agents/);
    expect(await defaults(B.businessId, theirs.id, theirs.agentType)).toEqual([]);
    await backfillDefaultSkills(h.db);
  });

  it("WP-06 T13: an agent already on release 1 gets only release 2's two coding skills, and a role that writes no code gets nothing", async () => {
    const onRelease1 = async (templateKey: string) => {
      const hired = await hireFromTemplate(h.db, A.businessId, templateKey);
      for (const key of ["library_smallest_change", "library_terse_working_notes"]) await repos.skills.removeFromAgent(h.db, A.businessId, hired.agent.id, key);
      await h.db.execute(sql`update agents set default_skills_version = 1 where id = ${hired.agent.id}::uuid`);
      return hired.agent;
    };
    const coder = await onRelease1("backend_engineer");
    const lead = await onRelease1("finance_lead");
    const before = await defaults(A.businessId, coder.id, coder.agentType);
    expect((await backfillDefaultSkills(h.db)).failed).toEqual([]);
    const after = await defaults(A.businessId, coder.id, coder.agentType);
    expect(after.filter((k) => !before.includes(k))).toEqual(["library_smallest_change", "library_terse_working_notes"]);
    expect(await defaults(A.businessId, lead.id, lead.agentType)).toEqual(expected("finance_lead"));
    expect((await repos.agents.get(h.db, A.businessId, lead.id)).defaultSkillsVersion).toBe(DEFAULT_SKILLS_VERSION);
  });
});

