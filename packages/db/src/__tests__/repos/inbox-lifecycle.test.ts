/**
 * The Inbox's lifecycle (founder, Nov 7, 2026, phase 1 of the first-time founder report): only a hard stop holds Continue
 * (0071, `holdsContinue`); a newer update from an agent replaces its older open ones (`supersedeUpdates`); notes that only
 * informed close themselves once their tasks settle or after a week untouched (`archiveSettled`), never a decision.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { holdsContinue, repos } from "../../repos";
import type { ComposerItem } from "../../repos/inbox";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("inboxlife");
}, 120_000);
afterAll(async () => {
  await r?.close();
});

const note = (over: Partial<ComposerItem>): ComposerItem => ({
  type: "update",
  from_agent_id: r.A.agentId,
  subject: "Progress",
  body_md: "The team made progress.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: null,
  blocks_continue: false,
  source_event_ids: [],
  entity_ids: [],
  ...over,
});
const options = { options: [{ id: "yes", label: "Yes", recommended: true, consequence: "It runs.", cost_minor: 0, reversible: true }, { id: "no", label: "No", recommended: false, consequence: "Nothing runs.", cost_minor: 0, reversible: true }], free_text: false, expires_at: null };

describe("only a hard stop holds Continue (0071)", () => {
  it("keeps the flag on a warning alone: a decision or a win asked to hold Continue does not", async () => {
    expect(holdsContinue("warning", true)).toBe(true);
    expect(holdsContinue("decision", true)).toBe(false);
    expect(holdsContinue("customer_won", true)).toBe(false);
    const decision = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "decision", subject: "Spend on ads?", decision: options, blocks_continue: true }));
    expect(decision.blocksContinue).toBe(false);
    const stop = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "warning", subject: "Credits used up", blocks_continue: true }));
    expect(stop.blocksContinue).toBe(true);
    expect(await repos.inbox.countBlocking(r.db, r.A.businessId)).toBe(1);
    // The decision still waits in Needs you (the Respond tab).
    const respond = await repos.inbox.list(r.db, r.A.businessId, { tab: "respond", limit: 50 });
    expect(respond.items.map((i) => i.id)).toEqual(expect.arrayContaining([decision.id, stop.id]));
    await repos.inbox.archive(r.db, r.A.businessId, stop.id, { force: true });
  });

  it("a customer win is good news, not a question: it never sits in Needs you", async () => {
    const win = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "customer_won", subject: "New customer", decision: options, blocks_continue: true }));
    expect(win.blocksContinue).toBe(false);
    const respond = await repos.inbox.list(r.db, r.A.businessId, { tab: "respond", limit: 50 });
    expect(respond.items.some((i) => i.id === win.id)).toBe(false);
    const customers = await repos.inbox.list(r.db, r.A.businessId, { tab: "customers", limit: 50 });
    expect(customers.items.some((i) => i.id === win.id)).toBe(true);
  });
});

describe("notes close themselves", () => {
  it("a newer update from an agent archives its older open updates, never another agent's or another kind", async () => {
    const first = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Week one" }));
    const warning = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "warning", subject: "Something slowed" }));
    const second = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Week two" }));
    expect((await repos.inbox.get(r.db, r.A.businessId, first.id)).state).toBe("archived");
    expect((await repos.inbox.get(r.db, r.A.businessId, second.id)).state).toBe("unread");
    expect((await repos.inbox.get(r.db, r.A.businessId, warning.id)).state).toBe("unread");
    // Another business's notes are never touched.
    const other = await repos.inbox.createItem(r.db, r.B.businessId, note({ from_agent_id: r.B.agentId, subject: "Elsewhere" }));
    await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Week three" }));
    expect((await repos.inbox.get(r.db, r.B.businessId, other.id)).state).toBe("unread");
  });

  it("archives notes that only informed once their tasks settle or after a week untouched; a decision stays", async () => {
    const task = await repos.tasks.create(r.db, r.A.businessId, { kind: "code", title: "Ship the pricing page", goalMd: "x", assigneeAgentId: r.A.agentId, status: "running" });
    const blocked = await repos.events.write(r.db, r.A.businessId, { type: "task.blocked", actor: { kind: "agent", id: r.A.agentId }, payload: { taskId: task.id, reason: "needs_update", detail: "x" } });
    const aboutTask = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "warning", subject: "The pricing page is stuck", source_event_ids: [blocked.id] }));
    const question = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "decision", subject: "Which price?", decision: options, source_event_ids: [blocked.id] }));
    const now = new Date();
    // The task is still open: nothing closes yet.
    expect(await repos.inbox.archiveSettled(r.db, r.A.businessId, { olderThan: new Date(now.getTime() - 7 * 86_400_000) })).not.toContain(aboutTask.id);
    await repos.tasks.setStatus(r.db, r.A.businessId, task.id, "done", { force: true });
    const closed = await repos.inbox.archiveSettled(r.db, r.A.businessId, { olderThan: new Date(now.getTime() - 7 * 86_400_000) });
    expect(closed).toContain(aboutTask.id);
    expect(closed).not.toContain(question.id);
    expect((await repos.inbox.get(r.db, r.A.businessId, question.id)).state).toBe("unread");
    // Untouched for longer than the window: an update with no task closes too.
    const stale = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Old news" }));
    expect(await repos.inbox.archiveSettled(r.db, r.A.businessId, { olderThan: new Date(now.getTime() + 60_000) })).toContain(stale.id);
  });
});
