/**
 * 0037 over data that already exists: the demo channels' "for this club" text, the first channel task and consumer-app
 * Board decision with the football word, the four offline channel agents' "(wings line)" and the Chief of Staff's
 * doubled role all read the current words, and anything a founder wrote is left alone.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../migrations";
import { createTestDb, type TestHarness } from "../testing/pglite";

const TAG = "0037_copy_rules";
let h: TestHarness;
let businessId = "";

const one = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;

beforeAll(async () => {
  const all = readMigrations();
  h = await createTestDb({ migrations: all.filter((m) => m.tag !== TAG) });
  const owner = await h.createUser("owner@m37.test");
  businessId = (await h.pg.query<{ id: string }>(`insert into businesses (name, slug, created_by) values ('m37', 'm37', $1) returning id`, [owner])).rows[0]!.id;

  await h.pg.query(`insert into channels (business_id, channel_key, line, why_md) values ($1, 'paid_ads', 'attack', 'Paid advertising: fit 16/20 for this club (Estimate). Recommended starter.')`, [businessId]);
  await h.pg.query(`insert into channels (business_id, channel_key, line, why_md) values ($1, 'seo', 'defence', 'Organic reach suits a club-sized budget, the founder says.')`, [businessId]);
  await h.pg.query(`insert into tasks (business_id, kind, title, goal_md) values ($1, 'channel', 'Score the 15 channels', 'Score every channel 1-20 on fit and propose the starting formation with cost-per-customer ranges labeled Estimate.')`, [businessId]);
  await h.pg.query(`insert into tasks (business_id, kind, title, goal_md) values ($1, 'ops', 'Company formation', 'File the company formation papers.')`, [businessId]);
  await h.pg.query(`insert into inbox_items (business_id, type, subject, body_md) values ($1, 'decision', 'Paid acquisition or organic first?', 'The team is in place. Distribution has a formation ready; Development is planning onboarding.')`, [businessId]);
  const agent = async (type: string, description: string) =>
    (await h.pg.query<{ id: string }>(`insert into agents (business_id, name, agent_type, description_md) values ($1, $2, $2, $3) returning id`, [businessId, type, description])).rows[0]!.id;
  await agent("channel_print", 'I run the Print channel engine for this business (wings line). What I do: flyers.');
  await agent("channel_outdoor", 'I run the Outdoor channel engine for this business (wings line). What I do: billboards.');
  await agent("channel_seo", 'I run the SEO channel engine for this business (Organic line). What I do: audits.');
  const cos = await agent("chief_of_staff", "I plan each business cycle.");
  const version = async (agentId: string, role: string, v: number) =>
    h.pg.query(`insert into agent_versions (business_id, agent_id, version, instructions) values ($1, $2, $3, $4::jsonb)`, [businessId, agentId, v, JSON.stringify({ role, goals: ["x"] })]);
  await version(cos, "Chief of Staff and Chief of Staff: you run the cycle so the founder only has to read the Inbox and decide.", 1);
  await version(cos, "Chief of Staff: you run the cycle.", 2);
  // Live prompts and profiles of agents hired before the switch (the template text 0037 brings up to date).
  const lead = await agent("engineering_lead", "I run the Development department: I take the Planner's task graph. Core metric: merges. Ship through the Development flow.");
  await version(lead, "Engineering lead for this business's Development department.", 1);
  await h.pg.query(`update agent_versions set instructions = jsonb_set(instructions, '{goals}', $2::jsonb) where agent_id = $1`, [
    lead,
    JSON.stringify(["Keep the Development team's measured pace honest; labelled work on holiday waits; apologise to the founder, analyse each merge.", "Date the release 3 Oct 2026 and the review Oct 9, 2026, never day-first."]),
  ]);
  await h.pg.exec(all.find((m) => m.tag === TAG)!.sql);
});
afterAll(() => h?.close());

describe("0037 applied over existing rows", () => {
  it("channel Why text says business, and only the default phrase changes", async () => {
    const rows = await one<{ channel_key: string; why_md: string }>(sql`select channel_key, why_md from channels order by channel_key`);
    expect(rows.find((r) => r.channel_key === "paid_ads")?.why_md).toBe("Paid advertising: fit 16/20 for this business (Estimate). Recommended starter.");
    expect(rows.find((r) => r.channel_key === "seo")?.why_md).toBe("Organic reach suits a club-sized budget, the founder says.");
  });

  it("the first channel task and the Board decision read the Channel Board; legal company formation stays", async () => {
    const tasks = await one<{ title: string; goal_md: string }>(sql`select title, goal_md from tasks order by title`);
    expect(tasks.find((t) => t.title === "Score the 15 channels")?.goal_md).toBe("Score every channel 1-20 on fit and propose the starting channels for the Channel Board with cost-per-customer ranges labeled Estimate.");
    expect(tasks.find((t) => t.title === "Company formation")?.goal_md).toBe("File the company formation papers.");
    const items = await one<{ body_md: string }>(sql`select body_md from inbox_items`);
    expect(items[0]?.body_md).toBe("The team is in place. Distribution has its Channel Board ready; Development is planning onboarding.");
  });

  it("the offline channel agents read the Offline line", async () => {
    const rows = await one<{ agent_type: string; description_md: string }>(sql`select agent_type, description_md from agents where agent_type like 'channel_%'`);
    expect(rows.find((r) => r.agent_type === "channel_print")?.description_md).toContain("(Offline line)");
    expect(rows.find((r) => r.agent_type === "channel_outdoor")?.description_md).toContain("(Offline line)");
    expect(rows.some((r) => r.description_md.includes("wings"))).toBe(false);
    expect(rows.find((r) => r.agent_type === "channel_seo")?.description_md).toContain("(Organic line)");
  });

  it("the Chief of Staff's role is no longer doubled", async () => {
    const rows = await one<{ version: number; role: string }>(sql`select version, instructions->>'role' as role from agent_versions where instructions->>'role' like 'Chief of Staff%' order by version`);
    expect(rows[0]?.role).toBe("Chief of Staff: you run the cycle so the founder only has to read the Inbox and decide.");
    expect(rows[1]?.role).toBe("Chief of Staff: you run the cycle.");
    const kept = await one<{ goals: unknown }>(sql`select instructions->'goals' as goals from agent_versions where version = 1 and instructions->>'role' like 'Chief of Staff%'`);
    expect(kept[0]?.goals).toEqual(["x"]);
  });

  it("the live prompts and profiles read US English, the vacation word and the engineering department", async () => {
    const lead = await one<{ description_md: string; goals: string[]; role: string }>(sql`select a.description_md, v.instructions->'goals' as goals, v.instructions->>'role' as role from agents a join agent_versions v on v.agent_id = a.id where a.agent_type = 'engineering_lead'`);
    expect(lead[0]?.description_md).toBe("I run engineering for this business: I take the Planner's task graph. Core metric: merges. Ship through the engineering flow.");
    expect(lead[0]?.role).toBe("Engineering lead for this business: the department that builds and ships the product.");
    expect(lead[0]?.goals).toEqual([
      "Keep the engineering team's measured pace honest; labeled work on vacation waits; apologize to the founder, analyze each merge.",
      "Date the release Oct 3, 2026 and the review Oct 9, 2026, never day-first.",
    ]);
    // A second run changes nothing: the migration is a phrase-for-phrase rewrite, not a re-dating.
    await h.pg.exec(readMigrations().find((m) => m.tag === TAG)!.sql);
    const again = await one<{ goals: string[] }>(sql`select v.instructions->'goals' as goals from agent_versions v join agents a on a.id = v.agent_id where a.agent_type = 'engineering_lead'`);
    expect(again[0]?.goals[1]).toBe("Date the release Oct 3, 2026 and the review Oct 9, 2026, never day-first.");
  });
});
