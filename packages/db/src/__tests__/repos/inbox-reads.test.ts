/**
 * Inbox read state is per person (0048; audit RUI-16, RUI-X1): one member opening a note no longer marks it read for the
 * others, viewers keep their own markers (the Inbox policy keeps them from writing notes, not from reading), and the
 * receipts are tenant-safe. Also: a blocking decision that still waits for its answer cannot be archived (audit RUI-14).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, type ComposerItem } from "../../repos";
import { inboxItemReads } from "../../schema";
import { RLS_DENIED } from "../rls/fixtures";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("inbox-reads");
}, 120_000);
afterAll(() => r?.close());

const note = (over: Partial<ComposerItem> = {}): ComposerItem => ({
  type: "update",
  from_agent_id: r.A.agentId,
  subject: "Week 1 shipped",
  body_md: "The first landing page is live.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: null,
  blocks_continue: false,
  source_event_ids: [],
  entity_ids: [],
  ...over,
});

const decisionNote = (): ComposerItem =>
  note({
    type: "decision",
    subject: "Approve the supplier deposit",
    decision: {
      options: [
        { id: "pay", label: "Pay the deposit", recommended: true, consequence: "The deposit goes out", cost_minor: 40000, reversible: false },
        { id: "wait", label: "Wait a week", recommended: false, consequence: "Nothing happens", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: true,
  });

const stateFor = (userId: string, itemId: string) => r.as(userId, async (tx) => (await repos.inbox.get(tx, r.A.businessId, itemId, userId)).state);

describe("read receipts are per person", () => {
  it("one person opening a note does not mark it read for anyone else", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, note());
    for (const u of [r.A.ownerId, r.A.memberId, r.A.viewerId]) expect(await stateFor(u, item.id)).toBe("unread");

    await r.as(r.A.memberId, (tx) => repos.inbox.markRead(tx, r.A.businessId, item.id, r.A.memberId));

    expect(await stateFor(r.A.memberId, item.id)).toBe("read");
    expect(await stateFor(r.A.ownerId, item.id)).toBe("unread");
    expect(await stateFor(r.A.viewerId, item.id)).toBe("unread");
    // The stored state is untouched: nothing but the person's own receipt moved.
    expect((await repos.inbox.get(r.db, r.A.businessId, item.id)).state).toBe("unread");
  });

  it("a viewer clears their own marker, and reading twice is harmless", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Viewer reads" }));
    const first = await r.as(r.A.viewerId, (tx) => repos.inbox.markRead(tx, r.A.businessId, item.id, r.A.viewerId));
    expect(first.state).toBe("read");
    await r.as(r.A.viewerId, (tx) => repos.inbox.markRead(tx, r.A.businessId, item.id, r.A.viewerId));
    expect(await stateFor(r.A.viewerId, item.id)).toBe("read");
    expect(await stateFor(r.A.ownerId, item.id)).toBe("unread");
    // The viewer still cannot write the note itself.
    await expect(r.as(r.A.viewerId, (tx) => repos.inbox.archive(tx, r.A.businessId, item.id))).rejects.toThrow();
    expect((await repos.inbox.get(r.db, r.A.businessId, item.id)).state).toBe("unread");
  });

  it("lists, state filters and a win waiting for its Customer Update follow the viewer", async () => {
    const win = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "customer_won", subject: "New order from Wren Garza" }));
    await r.as(r.A.memberId, (tx) => repos.inbox.markRead(tx, r.A.businessId, win.id, r.A.memberId));

    const unreadWins = (userId: string) => r.as(userId, async (tx) => (await repos.inbox.list(tx, r.A.businessId, { type: "customer_won", state: "unread" }, userId)).items.map((i) => i.id));
    expect(await unreadWins(r.A.memberId)).not.toContain(win.id);
    expect(await unreadWins(r.A.ownerId)).toContain(win.id);

    const rows = await r.as(r.A.memberId, (tx) => repos.inbox.list(tx, r.A.businessId, { type: "customer_won" }, r.A.memberId));
    expect(rows.items.find((i) => i.id === win.id)?.state).toBe("read");
    // Callers with no viewer (the composer, the orchestrator) see the stored state.
    expect((await repos.inbox.list(r.db, r.A.businessId, { type: "customer_won" })).items.find((i) => i.id === win.id)?.state).toBe("unread");
  });

  it("the system reading a note for the business (the Chief of Staff on vacation) reads it for everyone", async () => {
    const win = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "customer_won", subject: "Anchor Logistics subscribed" }));
    await repos.inbox.markRead(r.db, r.A.businessId, win.id);
    for (const u of [r.A.ownerId, r.A.memberId, r.A.viewerId]) expect(await stateFor(u, win.id)).toBe("read");
  });

  it("an answered note stays answered for everyone, whatever they opened", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, decisionNote());
    await r.as(r.A.memberId, (tx) => repos.inbox.markRead(tx, r.A.businessId, item.id, r.A.memberId));
    await repos.inbox.decide(r.db, r.A.businessId, item.id, { chosenOption: "wait", decidedBy: r.A.ownerId });
    expect(await stateFor(r.A.memberId, item.id)).toBe("answered");
    expect(await stateFor(r.A.viewerId, item.id)).toBe("answered");
  });
});

describe("read receipts are tenant-safe (0048)", () => {
  it("members see only their own receipts; another business and other people see none", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Receipts" }));
    await r.as(r.A.memberId, (tx) => repos.inbox.markRead(tx, r.A.businessId, item.id, r.A.memberId));
    await r.as(r.A.ownerId, (tx) => repos.inbox.markRead(tx, r.A.businessId, item.id, r.A.ownerId));
    const seenBy = (userId: string) => r.as(userId, (tx) => tx.select().from(inboxItemReads).where(eq(inboxItemReads.inboxItemId, item.id)));
    expect((await seenBy(r.A.memberId)).map((x) => x.userId)).toEqual([r.A.memberId]);
    expect((await seenBy(r.A.ownerId)).map((x) => x.userId)).toEqual([r.A.ownerId]);
    expect(await seenBy(r.B.ownerId)).toEqual([]);
  });

  it("nobody writes a receipt for someone else, for another business's note, or without membership", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, note({ subject: "Spoof" }));
    // As someone else.
    await expect(r.as(r.A.memberId, (tx) => tx.insert(inboxItemReads).values({ businessId: r.A.businessId, inboxItemId: item.id, userId: r.A.ownerId }))).rejects.toThrow(RLS_DENIED);
    // As a member of B, into A.
    await expect(r.as(r.B.memberId, (tx) => tx.insert(inboxItemReads).values({ businessId: r.A.businessId, inboxItemId: item.id, userId: r.B.memberId }))).rejects.toThrow(RLS_DENIED);
    // A receipt in B's name for A's note is not a pair that exists: the composite key refuses it even for the service role.
    await expect(r.svc((tx) => tx.insert(inboxItemReads).values({ businessId: r.B.businessId, inboxItemId: item.id, userId: r.B.memberId }))).rejects.toThrow(/foreign key|violates|inbox_item_reads_item_fkey/i);
    expect(await r.svc((tx) => tx.select().from(inboxItemReads).where(and(eq(inboxItemReads.inboxItemId, item.id))))).toEqual([]);
  });
});

describe("a blocking decision cannot be archived before it is answered (audit RUI-14)", () => {
  it("is refused while it waits, and allowed once answered", async () => {
    const item = await repos.inbox.createItem(r.db, r.A.businessId, decisionNote());
    await expect(repos.inbox.archive(r.db, r.A.businessId, item.id)).rejects.toThrow(/waiting for your answer/);
    expect((await repos.inbox.get(r.db, r.A.businessId, item.id)).state).toBe("unread");
    expect(await repos.inbox.countBlocking(r.db, r.A.businessId)).toBeGreaterThanOrEqual(1);

    await repos.inbox.decide(r.db, r.A.businessId, item.id, { chosenOption: "wait", decidedBy: r.A.ownerId });
    expect((await repos.inbox.archive(r.db, r.A.businessId, item.id)).state).toBe("archived");
  });

  it("still archives notes that block with nothing to choose, and decisions that do not block", async () => {
    const warning = await repos.inbox.createItem(r.db, r.A.businessId, note({ type: "warning", subject: "Runway under 3 months", blocks_continue: true }));
    expect((await repos.inbox.archive(r.db, r.A.businessId, warning.id)).state).toBe("archived");
    const soft = await repos.inbox.createItem(r.db, r.A.businessId, { ...decisionNote(), blocks_continue: false });
    expect((await repos.inbox.archive(r.db, r.A.businessId, soft.id)).state).toBe("archived");
  });
});
