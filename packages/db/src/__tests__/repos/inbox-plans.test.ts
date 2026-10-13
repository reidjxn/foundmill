/** inbox (Composer shape validation, tabs, decide, buffer), plans (create → confirm → actions → roll-up) and cursor pagination. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { repos, type ComposerItem } from "../../repos";
import { businesses } from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("inbox");
});
afterAll(() => r?.close());

const note = (overrides: Partial<ComposerItem> = {}): ComposerItem => ({
  type: "update",
  from_agent_id: r.A.agentId,
  subject: "Weekly digest",
  body_md: "Three things happened this week.",
  status_strip: [{ metric: "cash", source: "accounts" }],
  exhibit: { kind: "none", spec_ref: null },
  decision: null,
  blocks_continue: false,
  source_event_ids: [],
  entity_ids: [],
  ...overrides,
});

const decisionNote = (): ComposerItem =>
  note({
    type: "decision",
    subject: "Pick a launch channel",
    blocks_continue: true,
    decision: {
      options: [
        { id: "a", label: "LinkedIn", recommended: true, consequence: "€500 spend", cost_minor: 50000, reversible: true },
        { id: "b", label: "Wait", recommended: false, consequence: "Nothing", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
  });

describe("inbox.createItem validates the Composer schema", () => {
  it("accepts a valid note and persists the fields", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, note({ source_event_ids: [r.A.eventIds[0]!], entity_ids: [r.A.entityId] }), { costMinor: 12 });
    expect(item.businessId).toBe(r.A.businessId);
    expect(item.state).toBe("unread");
    expect(item.costMinor).toBe(12);
    expect(item.sourceEventIds).toEqual([r.A.eventIds[0]]);
  });

  it("rejects a decision without a decision block, two recommended options, and a subject over 80 chars", async () => {
    await expect(repos.inbox.createItem(r.db, r.A.businessId, note({ type: "decision" }))).rejects.toThrow(/Invalid composer item/);
    const bad = decisionNote();
    (bad.decision as { options: { recommended: boolean }[] }).options[1]!.recommended = true;
    await expect(repos.inbox.createItem(r.db, r.A.businessId, bad)).rejects.toThrow(/Invalid composer item/);
    await expect(repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "x".repeat(81) }))).rejects.toThrow(/Invalid composer item/);
    const err = await repos.inbox.createItem(r.db, r.A.businessId, note({ exhibit: { kind: "chart", spec_ref: null } })).catch((e: unknown) => e as Error & { details?: { message: string }[] });
    expect(err).toBeInstanceOf(Error);
    expect(JSON.stringify((err as { details?: unknown }).details)).toMatch(/named query/);
  });

  it("refuses ids that belong to another business", async () => {
    await expect(repos.inbox.createItem(r.db, r.A.businessId, note({ from_agent_id: r.B.agentId }))).rejects.toThrow(/not an agent of this business/);
    await expect(repos.inbox.createItem(r.db, r.A.businessId, note({ source_event_ids: [r.B.eventIds[0]!] }))).rejects.toThrow(/events of this business/);
    await expect(repos.inbox.createItem(r.db, r.A.businessId, note({ entity_ids: [r.B.entityId] }))).rejects.toThrow(/entities of this business/);
  });
});

describe("inbox.createItem stores notes in the business's own words (Settings › Glossary, AC-11.13.6)", () => {
  const setGlossary = (glossary: Record<string, string>) => r.db.update(businesses).set({ glossary }).where(eq(businesses.id, r.B.businessId));
  afterAll(() => setGlossary({}));

  it("renames nouns in the subject, body and decision options of composed and templated notes", async () => {
    await setGlossary({ customer: "client", team: "crew" });
    const item = await repos.inbox.createItem(r.db, r.B.businessId, {
      ...note({ from_agent_id: r.B.agentId, type: "decision", subject: "Customers this week", body_md: "The team keeps working; the customers week stands at 0. [[ent:" + r.B.entityId + "|Customer Co]] is the first customer." }),
      decision: { options: [{ id: "a", label: "Call the customer", recommended: true, consequence: "The team calls today", cost_minor: 0, reversible: true }, { id: "b", label: "Wait", recommended: false, consequence: "Nothing", cost_minor: 0, reversible: true }], free_text: false, expires_at: null },
      entity_ids: [r.B.entityId],
    });
    expect(item.subject).toBe("Clients this week");
    expect(item.bodyMd).toBe(`The crew keeps working; the clients week stands at 0. [[ent:${r.B.entityId}|Customer Co]] is the first client.`);
    expect((item.decision as { options: { label: string; consequence: string }[] }).options[0]).toMatchObject({ label: "Call the client", consequence: "The crew calls today" });
    // Another business's notes keep the default words.
    expect((await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Customers this week" }))).subject).toBe("Customers this week");
  });

  it("never rewrites a person's own message, and keeps the subject within its limit", async () => {
    await setGlossary({ customer: "client relationship" });
    const human = await repos.inbox.createHumanMessage(r.db, r.B.businessId, { fromUserId: r.B.ownerId, subject: "About the customer", bodyMd: "The customer called." });
    expect([human.subject, human.bodyMd]).toEqual(["About the customer", "The customer called."]);
    const long = await repos.inbox.createItem(r.db, r.B.businessId, note({ from_agent_id: r.B.agentId, subject: `${"x".repeat(70)} customer` }));
    expect(long.subject.length).toBeLessThanOrEqual(80);
    expect(long.subject.endsWith("…")).toBe(true);
  });
});

describe("inbox tabs, blocking count and decide", () => {
  let decisionId: string;
  beforeAll(async () => {
    decisionId = (await repos.inbox.createItem(r.db, r.A.businessId, decisionNote())).id;
    await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "customer_won", subject: "New customer", blocks_continue: true }));
    await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "milestone", subject: "10 customers" }));
    await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "report", subject: "Monthly report" }));
    await repos.inbox.createHumanMessage(r.db, r.A.businessId, { fromUserId: r.A.ownerId, subject: "Hello", bodyMd: "Hi team" });
    const archived = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Old" }));
    await repos.inbox.archive(r.db, r.A.businessId, archived.id);
    // Noise in business B that must never show up.
    await repos.inbox.createItem(r.db, r.B.businessId, { ...decisionNote(), from_agent_id: r.B.agentId });
  });

  it("filters by tab", async () => {
    const respond = await repos.inbox.list(r.db, r.A.businessId, { tab: "respond" });
    // The RLS fixture seeds one decision item too (not blocking, but a decision sits in Respond until answered).
    expect(respond.items.map((i) => i.type).sort()).toEqual(["customer_won", "decision", "decision"]);
    const customers = await repos.inbox.list(r.db, r.A.businessId, { tab: "customers" });
    expect(customers.items.every((i) => i.type === "customer_won")).toBe(true);
    const updates = await repos.inbox.list(r.db, r.A.businessId, { tab: "updates" });
    expect(new Set(updates.items.map((i) => i.type))).toEqual(new Set(["update", "milestone", "report"]));
    const messages = await repos.inbox.list(r.db, r.A.businessId, { tab: "messages" });
    expect(messages.items).toHaveLength(1);
    expect(messages.items[0]!.fromUserId).toBe(r.A.ownerId);
    const archive = await repos.inbox.list(r.db, r.A.businessId, { tab: "archive" });
    expect(archive.items.map((i) => i.subject)).toEqual(["Old"]);
    const all = await repos.inbox.list(r.db, r.A.businessId, { tab: "all" });
    expect(all.items.some((i) => i.state === "archived")).toBe(false);
    expect(all.items.every((i) => i.businessId === r.A.businessId)).toBe(true);
    const counts = await repos.inbox.countByTab(r.db, r.A.businessId);
    expect(counts.respond).toBe(3);
    expect(counts.archive).toBe(1);
  });

  it("filters by state/type and the service role is still scoped to the business", async () => {
    const decisions = await r.svc((tx) => repos.inbox.list(tx, r.A.businessId, { type: "decision", state: ["unread", "read"] }));
    expect(decisions.items).toHaveLength(2); // fixture decision + the one above
    expect(decisions.items.every((i) => i.businessId === r.A.businessId)).toBe(true);
  });

  it("countBlocking counts unanswered blockers (AC-11.3.3) and decide releases one", async () => {
    expect(await repos.inbox.countBlocking(r.db, r.A.businessId)).toBe(2);
    await expect(repos.inbox.decide(r.db, r.A.businessId, decisionId, { chosenOption: "zzz" })).rejects.toThrow(/not one of the item's options/);
    const { item, decision } = await repos.inbox.decide(r.db, r.A.businessId, decisionId, { chosenOption: "a", decidedBy: r.A.ownerId });
    expect(item.state).toBe("answered");
    expect(item.blocksContinue).toBe(false);
    expect(decision.chosenOption).toBe("a");
    expect(await repos.inbox.countBlocking(r.db, r.A.businessId)).toBe(1);
    await expect(repos.inbox.decide(r.db, r.A.businessId, decisionId, { chosenOption: "a" })).rejects.toThrow(/already answered/);
    expect(await repos.inbox.decisionsFor(r.db, r.A.businessId, decisionId)).toHaveLength(1);
  });

  it("markRead is idempotent and a member of A cannot read B's item", async () => {
    const [first] = (await repos.inbox.list(r.db, r.A.businessId, { tab: "updates", limit: 1 })).items;
    const read = await repos.inbox.markRead(r.db, r.A.businessId, first!.id);
    expect(read.state).toBe("read");
    expect((await repos.inbox.markRead(r.db, r.A.businessId, first!.id)).state).toBe("read");
    const bItem = (await repos.inbox.list(r.db, r.B.businessId)).items[0]!;
    await expect(repos.inbox.get(r.db, r.A.businessId, bItem.id)).rejects.toThrow(/not found/);
    const underRls = await r.as(r.A.memberId, (tx) => repos.inbox.list(tx, r.B.businessId));
    expect(underRls.items).toHaveLength(0);
  });

  it("composer buffer: push replaces by source hash, consume pops by priority, invalidate clears", async () => {
    await repos.inbox.bufferPush(r.db, r.A.businessId, { candidate: note({ subject: "low" }), sourceHash: "h1", priority: 1 });
    await repos.inbox.bufferPush(r.db, r.A.businessId, { candidate: note({ subject: "high" }), sourceHash: "h2", priority: 5 });
    await repos.inbox.bufferPush(r.db, r.A.businessId, { candidate: note({ subject: "high v2" }), sourceHash: "h2", priority: 5 });
    expect((await repos.inbox.bufferList(r.db, r.A.businessId)).map((b) => (b.candidate as { subject: string }).subject)).toEqual(["high v2", "low"]);
    const popped = await repos.inbox.bufferConsume(r.db, r.A.businessId);
    expect((popped!.candidate as { subject: string }).subject).toBe("high v2");
    expect(await repos.inbox.bufferInvalidate(r.db, r.A.businessId)).toBe(1);
    expect(await repos.inbox.bufferConsume(r.db, r.A.businessId)).toBeNull();
    await expect(repos.inbox.bufferPush(r.db, r.A.businessId, { candidate: { ...note(), subject: "" } as ComposerItem, sourceHash: "bad" })).rejects.toThrow(/Invalid buffer candidate/);
  });

  it("composer buffer: a served candidate stays served when the same key is pushed again (audit CML-01)", async () => {
    const A = r.A.businessId;
    await repos.inbox.bufferPush(r.db, A, { candidate: note({ subject: "insight" }), sourceHash: "insight:cpa:x", priority: 199 });
    const served = await repos.inbox.bufferConsume(r.db, A);
    expect(served?.sourceHash).toBe("insight:cpa:x");
    // The background refill pushes the unchanged insight again: the row is not revived as a candidate.
    const again = await repos.inbox.bufferPush(r.db, A, { candidate: note({ subject: "insight again" }), sourceHash: "insight:cpa:x", priority: 199 });
    expect(again.consumedAt).not.toBeNull();
    expect((await repos.inbox.bufferList(r.db, A)).map((b) => b.sourceHash)).not.toContain("insight:cpa:x");
    expect(await repos.inbox.bufferConsume(r.db, A)).toBeNull();
    expect([...(await repos.inbox.bufferServed(r.db, A, ["insight:cpa:x", "insight:cpa:y"]))]).toEqual(["insight:cpa:x"]);
    expect((await repos.inbox.bufferServed(r.db, r.B.businessId, ["insight:cpa:x"])).size).toBe(0);
    expect((await repos.inbox.bufferServed(r.db, A, [])).size).toBe(0);
    // A note written on demand is recorded as served under its key, and a pending candidate under that key is closed.
    await repos.inbox.bufferPush(r.db, A, { candidate: note({ subject: "decision" }), sourceHash: "decision:x:1", priority: 100 });
    const marked = await repos.inbox.bufferMarkServed(r.db, A, { candidate: note({ subject: "decision" }), sourceHash: "decision:x:1", priority: 100 });
    expect(marked.consumedAt).not.toBeNull();
    const fresh = await repos.inbox.bufferMarkServed(r.db, A, { candidate: note({ subject: "cold" }), sourceHash: "event:cold", priority: 300 });
    expect(fresh.consumedAt).not.toBeNull();
    expect(await repos.inbox.bufferList(r.db, A)).toEqual([]);
    expect((await repos.inbox.bufferServed(r.db, A, ["decision:x:1", "event:cold"])).size).toBe(2);
  });
});

describe("pagination", () => {
  it("cursor pages never repeat or skip rows and offset paging works", async () => {
    for (let i = 0; i < 12; i++) await repos.inbox.createItem(r.db, r.B.businessId, { ...note({ subject: `B note ${i}` }), from_agent_id: r.B.agentId });
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await repos.inbox.list(r.db, r.B.businessId, { limit: 5, cursor });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    const all = await repos.inbox.list(r.db, r.B.businessId, { limit: 100 });
    expect(seen).toEqual(all.items.map((i) => i.id));
    expect(new Set(seen).size).toBe(seen.length);
    const offset = await repos.inbox.list(r.db, r.B.businessId, { limit: 5, offset: 5 });
    expect(offset.items.length).toBeGreaterThan(0);
    await expect(repos.inbox.list(r.db, r.B.businessId, { cursor: "not-a-cursor" })).rejects.toThrow(/Malformed pagination cursor/);
    await expect(repos.inbox.list(r.db, r.B.businessId, { limit: 0 })).rejects.toThrow(/Invalid inbox filter/);
  });
});

describe("plans", () => {
  it("creates a plan with ordered actions, confirms it and rolls action results up", async () => {
    const plan = await repos.plans.create(r.db, r.A.businessId, {
      origin: "free_text",
      summaryMd: "Spend €500 on LinkedIn",
      inboxItemId: r.A.inboxItemId,
      actions: [
        { type: "enable_channel", params: { channelKey: "paid_ads" }, policyOutcome: "allow" },
        { type: "set_budget", params: { amountMinor: 50000 }, policyOutcome: "ask", status: "awaiting_approval" },
        { type: "create_task", params: { title: "Write ad copy" }, agentId: r.A.agentId },
      ],
    });
    expect(plan.actions.map((a) => a.position)).toEqual([0, 1, 2]);
    expect(plan.status).toBe("pending_confirmation");
    expect((await repos.plans.forInboxItem(r.db, r.A.businessId, r.A.inboxItemId))?.id).toBe(plan.id);

    const confirmed = await repos.plans.confirm(r.db, r.A.businessId, plan.id, { workflowId: "plan:1" });
    expect(confirmed.status).toBe("executing");
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    await expect(repos.plans.confirm(r.db, r.A.businessId, plan.id)).rejects.toThrow(/not pending confirmation/);

    const next = await repos.plans.nextPendingAction(r.db, r.A.businessId, plan.id);
    expect(next?.type).toBe("enable_channel");
    await repos.plans.startAction(r.db, r.A.businessId, next!.id);
    await expect(repos.plans.startAction(r.db, r.A.businessId, next!.id)).rejects.toThrow(/is running/);
    let res = await repos.plans.finishAction(r.db, r.A.businessId, next!.id, { status: "done", result: { channelId: r.A.channelId } });
    expect(res.plan.status).toBe("executing");
    const status = await repos.plans.status(r.db, r.A.businessId, plan.id);
    expect(status.counts.done).toBe(1);
    expect(status.counts.awaiting_approval).toBe(1);
    expect(status.progress).toBeCloseTo(1 / 3);

    const [, approvalAction, taskAction] = plan.actions;
    await repos.plans.finishAction(r.db, r.A.businessId, approvalAction!.id, { status: "denied" });
    res = await repos.plans.finishAction(r.db, r.A.businessId, taskAction!.id, { status: "done" });
    expect(res.plan.status).toBe("done");
    expect(res.plan.completedAt).toBeInstanceOf(Date);
  });

  it("a failed action fails the plan; lists filter by status and are scoped", async () => {
    const plan = await repos.plans.create(r.db, r.A.businessId, { origin: "option", status: "executing", actions: [{ type: "reply_only" }] });
    const { plan: after } = await repos.plans.finishAction(r.db, r.A.businessId, plan.actions[0]!.id, { status: "failed", result: { error: "boom" } });
    expect(after.status).toBe("failed");
    const failed = await repos.plans.list(r.db, r.A.businessId, { status: "failed" });
    expect(failed.items.map((p) => p.id)).toContain(plan.id);
    const bPlans = await r.svc((tx) => repos.plans.list(tx, r.B.businessId));
    expect(bPlans.items.every((p) => p.businessId === r.B.businessId)).toBe(true);
    expect(bPlans.items.map((p) => p.id)).not.toContain(plan.id);
    await expect(repos.plans.get(r.db, r.B.businessId, plan.id)).rejects.toThrow(/not found/);
    await expect(repos.plans.create(r.db, r.A.businessId, { origin: "option", actions: [] })).rejects.toThrow(/Invalid plan/);
  });
});
