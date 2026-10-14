/**
 * The repository side of the agents-and-orchestration audit fixes (W01): one running vacation per business (0036),
 * vacations that end by their date, idempotent end, planning candidates beyond one recency page, duplicate tasks, roadmap
 * items without tasks, usage bookings keyed by what they settle, and a desk message keyed by the client's own id.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookUsage } from "../../billing";
import { HolidayRunningError, repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("orch");
});
afterAll(() => r?.close());

const DAY = 86_400_000;

describe("vacations (audit O-35, DB-14, OL-08, O-15)", () => {
  it("one vacation runs per business: the second start is refused with the running one's id, also when both race", async () => {
    const A = r.A.businessId;
    const first = await repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + 7 * DAY) });
    const second = await repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + DAY) }).catch((e: unknown) => e);
    expect(second).toBeInstanceOf(HolidayRunningError);
    expect((second as HolidayRunningError).holidayId).toBe(first.id);
    await repos.holidays.end(r.db, A, first.id);

    // The index itself refuses a second running row, whatever code writes it.
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + 3 * DAY) })));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason instanceof HolidayRunningError)).toBe(true);
    const current = await repos.holidays.current(r.db, A);
    await repos.holidays.end(r.db, A, current!.id);
    expect(await repos.holidays.current(r.db, A)).toBeNull();
  });

  it("a vacation whose date has passed is over even before its workflow writes the end (Continue is not refused past it)", async () => {
    const A = r.A.businessId;
    const started = new Date(Date.now() - 3 * DAY);
    const over = await repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + 2 * DAY), startedAt: started });
    expect((await repos.holidays.current(r.db, A))?.id).toBe(over.id);
    expect(await repos.holidays.current(r.db, A, new Date(Date.now() + 3 * DAY))).toBeNull();
    // The reconciler still finds it, so its workflow can write the away report.
    expect((await repos.holidays.running(r.db)).map((h) => h.id)).toContain(over.id);

    // A new vacation after the date closes the old row at its date instead of refusing.
    const later = await repos.holidays.start(r.db, A, { untilAt: new Date(Date.now() + 9 * DAY), startedAt: new Date(Date.now() + 3 * DAY) });
    const old = await repos.holidays.get(r.db, A, over.id);
    expect(old.endedAt?.getTime()).toBe(old.untilAt?.getTime());
    await repos.holidays.end(r.db, A, later.id);
  });

  it("ending is idempotent: the second end returns the row as it is and links the report once", async () => {
    const A = r.A.businessId;
    const h = await repos.holidays.start(r.db, A, { untilCondition: { text: "until I return" } });
    const ended = await repos.holidays.end(r.db, A, h.id, { endedAt: new Date(Date.now() - 1000) });
    const again = await repos.holidays.end(r.db, A, h.id);
    expect(again.endedAt?.getTime()).toBe(ended.endedAt?.getTime());
    expect(again.reportInboxItemId).toBeNull();
    const item = await repos.inbox.createItem(r.db, A, { type: "report", from_agent_id: r.A.agentId, subject: "While you were away", body_md: "x", status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] });
    const linked = await repos.holidays.end(r.db, A, h.id, { reportInboxItemId: item.id });
    expect(linked.reportInboxItemId).toBe(item.id);
    expect(linked.endedAt?.getTime()).toBe(ended.endedAt?.getTime());
    await expect(repos.holidays.end(r.db, A, "00000000-0000-4000-8000-000000000999")).rejects.toThrow(/not found/);
    await expect(repos.holidays.end(r.db, r.B.businessId, h.id)).rejects.toThrow(/not found/);
  });
});

describe("Automated businesses", () => {
  it("lists committed, live businesses in Automated mode", async () => {
    const A = r.A.businessId;
    expect((await repos.businesses.listAutomated(r.db)).map((b) => b.id)).not.toContain(A);
    await repos.businesses.commit(r.db, A, { archetype: "b2b_saas" });
    await repos.businesses.setBusinessMode(r.db, A, "automated");
    expect((await repos.businesses.listAutomated(r.db)).map((b) => b.id)).toContain(A);
    await repos.businesses.setBusinessMode(r.db, A, "assisted");
    expect((await repos.businesses.listAutomated(r.db)).map((b) => b.id)).not.toContain(A);
  });
});

describe("planning candidates (audit SOAK-04, OL-10)", () => {
  it("lists every dispatchable task, not a page of the newest: the oldest come first within a priority, and an old blocker still blocks", async () => {
    const A = r.A.businessId;
    const old = await repos.tasks.create(r.db, A, { kind: "ops", title: "Landed cost model v1", status: "planned" });
    const dependent = await repos.tasks.create(r.db, A, { kind: "ops", title: "Depends on the old one", status: "planned", dependsOn: [old.id] });
    for (let i = 0; i < 30; i++) await repos.tasks.create(r.db, A, { kind: "ops", title: `Newer task ${i}`, status: "ready" });
    const high = await repos.tasks.create(r.db, A, { kind: "ops", title: "Urgent", status: "ready", priority: 50 });

    const { items, total } = await repos.tasks.planningCandidates(r.db, A, { limit: 500 });
    expect(total).toBeGreaterThanOrEqual(33);
    expect(items[0]!.id).toBe(high.id);
    const ids = items.map((t) => t.id);
    expect(ids).toContain(old.id);
    expect(ids.indexOf(old.id)).toBeLessThan(ids.indexOf(dependent.id));
    const depRow = items.find((t) => t.id === dependent.id)!;
    expect(depRow).toMatchObject({ blocked: true, dependsOn: [old.id] });
    expect(items.find((t) => t.id === old.id)).toMatchObject({ blocked: false, awaitingApproval: false });

    await repos.tasks.setStatus(r.db, A, old.id, "running");
    await repos.tasks.setStatus(r.db, A, old.id, "done");
    expect((await repos.tasks.planningCandidates(r.db, A, { limit: 500 })).items.find((t) => t.id === dependent.id)?.blocked).toBe(false);
    // Running tasks are in flight, not candidates.
    await repos.tasks.setStatus(r.db, A, high.id, "running");
    expect((await repos.tasks.planningCandidates(r.db, A, { limit: 500 })).items.map((t) => t.id)).not.toContain(high.id);
    // Another business's tasks never appear.
    expect((await repos.tasks.planningCandidates(r.db, r.B.businessId, { limit: 500 })).items.every((t) => t.businessId === r.B.businessId)).toBe(true);
  });

  it("a task whose session holds an undecided approval says so", async () => {
    const A = r.A.businessId;
    const task = await repos.tasks.create(r.db, A, { kind: "code", title: "Needs a nod", status: "blocked" });
    const session = await repos.agents.createSession(r.db, A, { agentId: r.A.agentId, taskId: task.id });
    const approval = await repos.approvals.create(r.db, A, { agentId: r.A.agentId, sessionId: session.id, connectorKey: "github", tool: "run_migration" });
    expect((await repos.tasks.planningCandidates(r.db, A)).items.find((t) => t.id === task.id)?.awaitingApproval).toBe(true);
    await repos.approvals.resolve(r.db, A, approval.id, { outcome: "approved", byKind: "user", byId: r.A.ownerId });
    expect((await repos.tasks.planningCandidates(r.db, A)).items.find((t) => t.id === task.id)?.awaitingApproval).toBe(false);
  });

  it("finds an unfinished task that carries the same work, and the task a plan action created", async () => {
    const A = r.A.businessId;
    const first = await repos.tasks.create(r.db, A, { kind: "ops", title: "Lead with product work", goalMd: "Lead with product work. Focus.", status: "ready" });
    expect((await repos.tasks.openDuplicate(r.db, A, { title: "Lead with product work", goalMd: "Lead with product work. Focus." }))?.id).toBe(first.id);
    // The fixture already holds a task created by this plan action; the lookup finds that one, and nothing for another business's action.
    expect((await repos.tasks.byPlanAction(r.db, A, r.A.planActionId))?.planActionId).toBe(r.A.planActionId);
    expect(await repos.tasks.byPlanAction(r.db, r.B.businessId, r.A.planActionId)).toBeNull();
    expect(await repos.tasks.openDuplicate(r.db, A, { title: "Lead with product work", goalMd: "other" })).toBeNull();
    await repos.tasks.setStatus(r.db, A, first.id, "running");
    await repos.tasks.setStatus(r.db, A, first.id, "done");
    expect(await repos.tasks.openDuplicate(r.db, A, { title: "Lead with product work", goalMd: "Lead with product work. Focus." })).toBeNull();
  });

  it("lists roadmap items no task links to, Now first", async () => {
    const B = r.B.businessId;
    const later = await repos.product.upsertRoadmapItem(r.db, B, { title: "Later thing", horizon: "later" });
    const now = await repos.product.upsertRoadmapItem(r.db, B, { title: "Pricing experiment", horizon: "now" });
    const taken = await repos.product.upsertRoadmapItem(r.db, B, { title: "Already tasked", horizon: "now" });
    await repos.tasks.create(r.db, B, { kind: "code", title: "Build it", roadmapItemId: taken.id, status: "ready" });
    const titles = (await repos.product.untaskedRoadmap(r.db, B)).map((i) => i.title);
    expect(titles.indexOf("Pricing experiment")).toBeLessThan(titles.indexOf("Later thing"));
    expect(titles).not.toContain("Already tasked");
    expect(now.id).not.toBe(later.id);
  });
});

describe("usage bookings keyed by what they settle (audit O-33, BILL-20)", () => {
  const input = (costMinor: number, idempotencyKey?: string) => ({ agentId: r.A.agentId, kind: "tokens" as const, modelKey: "sonnet" as const, quantity: 1000, unit: "tokens", costMinor, billedTo: "credits" as const, occurredAt: new Date(Date.UTC(2026, 8, 3, 12)), ...(idempotencyKey ? { idempotencyKey } : {}) });

  it("a repeated booking returns the first row and charges the credits once", async () => {
    const A = r.A.businessId;
    const first = await bookUsage(r.db, A, input(40, "session:abc:tokens"));
    expect(first.replayed).toBeUndefined();
    expect(first.credits?.balance?.spentMinor).toBe(40);
    const again = await bookUsage(r.db, A, input(40, "session:abc:tokens"));
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect(again.credits).toBeNull();
    expect((await repos.usage.creditBalance(r.db, A, "2026-09"))?.spentMinor).toBe(40);
    // Different keys, and rows without a key, are separate bookings.
    await bookUsage(r.db, A, input(10, "session:abc:sandbox"));
    await bookUsage(r.db, A, input(5));
    await bookUsage(r.db, A, input(5));
    expect((await repos.usage.creditBalance(r.db, A, "2026-09"))?.spentMinor).toBe(60);
    expect(includedCreditsMinor("free")).toBeGreaterThan(60);
  });

  it("the charge, the pause and the note commit together", async () => {
    const A = r.A.businessId;
    const before = (await repos.inbox.list(r.db, A, { limit: 200 })).items.length;
    const last = await bookUsage(r.db, A, input(includedCreditsMinor("free"), "session:last:tokens"));
    expect(last.credits).toMatchObject({ exhausted: "now" });
    expect(last.credits!.noteId).not.toBeNull();
    expect((await repos.inbox.list(r.db, A, { limit: 200 })).items.length).toBe(before + 1);
    // A retry of that very booking neither charges nor warns again.
    const retry = await bookUsage(r.db, A, input(includedCreditsMinor("free"), "session:last:tokens"));
    expect(retry.replayed).toBe(true);
    expect((await repos.inbox.list(r.db, A, { limit: 200 })).items.length).toBe(before + 1);
  });
});

describe("a desk message keyed by the client's id (audit RES-09)", () => {
  it("a second message with the same client id in a thread is refused by the index, and findExchange returns the stored exchange", async () => {
    const A = r.A.businessId;
    const thread = await repos.conversations.ensureThread(r.db, A, { agentId: r.A.agentId, subjectKind: "inbox_item", subjectId: r.A.inboxItemId });
    const at = new Date();
    const founder = await repos.conversations.appendMessage(r.db, A, { threadId: thread.id, authorKind: "founder", authorUserId: r.A.ownerId, bubbles: ["What did the team finish yesterday?"], clientMessageId: "client-1234" }, { at });
    const agent = await repos.conversations.appendMessage(r.db, A, { threadId: thread.id, authorKind: "agent", agentId: r.A.agentId, bubbles: ["Two tasks."] }, { at: new Date(at.getTime() + 1) });
    await expect(repos.conversations.appendMessage(r.db, A, { threadId: thread.id, authorKind: "founder", authorUserId: r.A.ownerId, bubbles: ["What did the team finish yesterday?"], clientMessageId: "client-1234" })).rejects.toThrow();
    const found = await repos.conversations.findExchange(r.db, A, thread.id, "client-1234");
    expect(found?.founder.id).toBe(founder.id);
    expect(found?.reply?.id).toBe(agent.id);
    expect(await repos.conversations.findExchange(r.db, A, thread.id, "client-other")).toBeNull();
    // The same id in another thread is another message.
    const other = await repos.conversations.ensureThread(r.db, A, { agentId: r.A.agent2Id, subjectKind: "inbox_item", subjectId: r.A.inboxItemId });
    await expect(repos.conversations.appendMessage(r.db, A, { threadId: other.id, authorKind: "founder", authorUserId: r.A.ownerId, bubbles: ["Hi"], clientMessageId: "client-1234" })).resolves.toBeTruthy();
  });
});
