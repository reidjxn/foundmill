/**
 * The page catch-up (WP-12 T1): a real project older than public pages gets a drafted, never-published page and the
 * Product lead's note, once. Skipped: a project with any page row (a founder's saved draft included), a sample, an
 * archived, an uncommitted, a stopped and a very new one (its own first session is drafting).
 */
import { PAGE_READY_NOTE, soloGuardViolations } from "@foundmill/shared";
import { repos } from "@foundmill/db";
import { MockModelClient, ModelUnavailableError } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFoundationsActivities, PAGE_CATCH_UP_MIN_AGE_MS } from "../activities/foundations";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
const NOW = new Date("2026-11-16T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "page-catch-up" });
  // The harness business is a project of its own with a page-less history; keep it out of these cases.
  await setColumns(t.businessId, { is_demo: true });
}, 120_000);
afterAll(() => t?.close());

/** Sets columns of one business by name (the test database is raw SQL away). */
async function setColumns(id: string, columns: Record<string, unknown>) {
  const names = Object.keys(columns);
  await t.h.pg.query(`update businesses set ${names.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`, [id, ...names.map((c) => columns[c])]);
}

let n = 0;
async function project(over: Record<string, unknown> = {}, committedAgo = 3 * DAY) {
  n += 1;
  const b = await repos.businesses.create(t.db, { name: `Catch Up ${n}`, archetype: "b2b_saas" });
  await setColumns(b.id, { committed_at: new Date(NOW.getTime() - committedAgo), ...over });
  const chief = await repos.agents.create(t.db, b.id, { name: "Ines Park", agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  return { id: b.id, chiefId: chief.id };
}
const openNotes = async (id: string) => {
  const rows = (await t.h.pg.query<{ id: string; type: string; subject: string; body_md: string; from_agent_id: string | null; blocks_continue: boolean; decision: { key?: string } | null }>("select id, type, subject, body_md, from_agent_id, blocks_continue, decision from inbox_items where business_id = $1", [id])).rows;
  return rows.filter((i) => i.decision?.key === PAGE_READY_NOTE.key);
};
const run = (models = new MockModelClient(), input: Parameters<ReturnType<typeof createFoundationsActivities>["draftMissingProjectPages"]>[0] = {}) =>
  createFoundationsActivities({ ...t.deps, models }).draftMissingProjectPages({ at: NOW.toISOString(), ...input });

describe("draftMissingProjectPages", () => {
  it("drafts one unpublished page and one held-back note for a project with none, and a second run writes nothing", async () => {
    const p = await project();
    const first = await run(new MockModelClient(), { businessIds: [p.id] });
    expect(first).toMatchObject({ businesses: 1, touched: 1 });
    const page = (await repos.pages.get(t.db, p.id))!;
    expect(page).toMatchObject({ published: null, publishedAt: null, updatedBy: null, draft: { showFounders: false } });
    const notes = await openNotes(p.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "decision", subject: PAGE_READY_NOTE.subject, from_agent_id: p.chiefId, blocks_continue: false, decision: { key: PAGE_READY_NOTE.key, catch_up: true } });
    const created = (await repos.events.list(t.db, p.id, { type: "inbox.item_created" })).items.filter((e) => (e.payload as { inboxItemId?: string }).inboxItemId === notes[0]!.id);
    expect(created).toHaveLength(1);
    // The solo guard: nothing in the note or the draft is about people.
    expect(soloGuardViolations(`${notes[0]!.subject}\n${notes[0]!.body_md}\n${JSON.stringify(page.draft)}`)).toEqual([]);
    expect(page.draft.showFounders).toBe(false);

    const second = await run(new MockModelClient(), { businessIds: [p.id] });
    expect(second).toMatchObject({ touched: 0 });
    expect(await openNotes(p.id)).toHaveLength(1);
  });

  it("leaves a founder's saved draft, a sample, an archived, an uncommitted, a stopped and a very new project alone", async () => {
    const saved = await project();
    await repos.pages.writeTeamDraft(t.db, saved.id, { draft: { pitch: "Mine", about: "", forWhom: "", stage: "idea", showFounders: false, followForm: true }, slug: `catch-up-saved-${n}`, agentId: null, source: "starter", reason: null, note: null });
    const others = [await project({ is_demo: true }), await project({ archived_at: new Date(NOW.getTime() - DAY) }), await project({ committed_at: null }), await project({ agents_stopped_at: new Date(NOW.getTime() - DAY), agents_stopped_reason: "kill_switch" }), await project({}, PAGE_CATCH_UP_MIN_AGE_MS - 60_000)];
    const models = new MockModelClient();
    await run(models, { businessIds: [saved.id, ...others.map((o) => o.id)] });
    expect((await repos.pages.get(t.db, saved.id))!.draft.pitch).toBe("Mine");
    for (const o of others) expect(await repos.pages.get(t.db, o.id)).toBeNull();
    expect(models.history.filter((r) => r.route === "projectPage")).toHaveLength(0);
  });

  it("a failed model call still writes the starter draft; limit is respected, oldest first", async () => {
    const a = await project({}, 9 * DAY);
    const b = await project({}, 8 * DAY);
    const failing = new MockModelClient({ failWith: { projectPage: new ModelUnavailableError("upstream 529") } });
    const done = await run(failing, { businessIds: [a.id, b.id], limit: 1 });
    expect(done.touched).toBe(1);
    expect((await repos.pages.get(t.db, a.id))!.draft).toMatchObject({ stage: "idea", showFounders: false });
    expect(await repos.pages.get(t.db, b.id)).toBeNull();
    const audit = (await repos.audit.list(t.db, a.id, { limit: 20 })).items.find((e) => e.action === "page.draft_written");
    expect(audit?.details).toMatchObject({ source: "starter", published: false });
  });
});
