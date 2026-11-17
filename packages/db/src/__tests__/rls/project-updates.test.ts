/**
 * 0134 `project_updates` and `project_update_deliveries` (WP-08 T3), tenancy by hand:
 *   - members of A read and write A's drafts (subject and body only); a viewer reads and writes nothing; nobody reaches B's;
 *   - a member cannot set the status, the approver or the drafting agent, and cannot edit an update once it is sending;
 *   - no member, of any role, reads or writes the delivery record (service role only), and it holds no address;
 * and the send's record on the service connection: confirmed, unwithdrawn followers only; a claim is taken once.
 */
import { randomUUID } from "node:crypto";
import { FOLLOW_CONSENT_PURPOSE, FOLLOW_SOURCE } from "@foundmill/shared";
import { suppressionHash } from "../../repos/channels";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

async function expectNoEffect(p: Promise<unknown>) {
  try {
    const rows = await p;
    if (Array.isArray(rows)) expect(rows).toHaveLength(0);
    else expect(rows).toBeNull();
  } catch (err) {
    expect((err as Error).message).toMatch(RLS_DENIED);
  }
}

/** A page follower of `businessId`: confirmed unless `pending`, withdrawn when `withdrawn`. */
async function follower(businessId: string, email: string, opts: { pending?: boolean; withdrawn?: boolean } = {}) {
  return h.service().run(async (tx) => {
    const entity = await repos.entities.create(tx, businessId, { kind: "person", displayName: "Follower", identifiers: { email } });
    await tx.insert(s.contactConsents).values({ businessId, entityId: entity.id, purpose: FOLLOW_CONSENT_PURPOSE, source: FOLLOW_SOURCE, sourceRef: "test-page", consentText: "I agree.", confirmedAt: opts.pending ? null : new Date(), withdrawnAt: opts.withdrawn ? new Date() : null, emailHash: suppressionHash("email", email) });
    return entity.id;
  });
}

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "updates-a");
  B = await createBusinessFixture(h, "updates-b");
}, 120_000);
afterAll(() => h?.close());

describe("project_updates: tenancy", () => {
  it("a member writes and edits a draft of their own project; B's members see none of it", async () => {
    const draft = await h.asUser(A.memberId).run((tx) => repos.updates.saveDraft(tx, A.businessId, { subject: "News", body: "We shipped." }));
    expect(draft).toMatchObject({ status: "draft", draftedByAgentId: null, approvedBy: null });
    const edited = await h.asUser(A.ownerId).run((tx) => repos.updates.saveDraft(tx, A.businessId, { id: draft.id, subject: "Big news", body: "We shipped it." }));
    expect(edited.subject).toBe("Big news");
    expect(await h.asUser(B.ownerId).run((tx) => repos.updates.get(tx, A.businessId, draft.id))).toBeNull();
    await expectNoEffect(h.asUser(B.ownerId).run((tx) => tx.update(s.projectUpdates).set({ subject: "x" }).where(eq(s.projectUpdates.id, draft.id)).returning()));
    await expectNoEffect(h.asUser(B.ownerId).run((tx) => tx.insert(s.projectUpdates).values({ businessId: A.businessId, subject: "x", body: "y" }).returning()));
  });

  it("a member cannot set the status, the approver or the drafting agent, and cannot edit an update once it is sending", async () => {
    const draft = await h.asUser(A.memberId).run((tx) => repos.updates.saveDraft(tx, A.businessId, { subject: "News", body: "Hi" }));
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => tx.update(s.projectUpdates).set({ status: "sent" }).where(eq(s.projectUpdates.id, draft.id)).returning()));
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => tx.update(s.projectUpdates).set({ approvedBy: A.ownerId }).where(eq(s.projectUpdates.id, draft.id)).returning()));
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => tx.insert(s.projectUpdates).values({ businessId: A.businessId, subject: "x", body: "y", status: "sent" }).returning()));
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => tx.insert(s.projectUpdates).values({ businessId: A.businessId, subject: "x", body: "y", draftedByAgentId: A.agentId }).returning()));
    await h.service().run((tx) => repos.updates.startSend(tx, A.businessId, draft.id, { userId: A.ownerId, at: new Date() }));
    await expectNoEffect(h.asUser(A.ownerId).run((tx) => tx.update(s.projectUpdates).set({ body: "changed" }).where(eq(s.projectUpdates.id, draft.id)).returning()));
    expect((await h.service().run((tx) => repos.updates.get(tx, A.businessId, draft.id)))!.body).toBe("Hi");
  });

  it("a viewer reads and writes nothing it may not", async () => {
    await expectNoEffect(h.asUser(A.viewerId).run((tx) => tx.insert(s.projectUpdates).values({ businessId: A.businessId, subject: "x", body: "y" }).returning()));
  });
});

describe("project_update_deliveries: service role only", () => {
  it("no member of any role reads or writes it", async () => {
    const draft = await h.service().run((tx) => repos.updates.draftByAgent(tx, A.businessId, { subject: "News", body: "Hi", agentId: A.agentId }));
    await h.service().run((tx) => repos.updates.claim(tx, A.businessId, { updateId: draft.id, entityId: A.entityId, recipientHash: "a".repeat(64), at: new Date() }));
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId, B.ownerId]) {
      await expectNoEffect(h.asUser(userId).run((tx) => tx.select().from(s.projectUpdateDeliveries)));
      await expectNoEffect(h.asUser(userId).run((tx) => tx.insert(s.projectUpdateDeliveries).values({ updateId: draft.id, businessId: A.businessId, entityId: A.entity2Id, recipientHash: "b".repeat(64), state: "sent" }).returning()));
    }
    const cols = Object.keys((await h.service().run((tx) => tx.select().from(s.projectUpdateDeliveries).limit(1)))[0]!);
    expect(cols.sort()).toEqual(["at", "businessId", "createdAt", "entityId", "id", "messageRef", "reason", "recipientHash", "state", "updateId", "updatedAt"]);
  });

  it("recipients are confirmed, unwithdrawn followers without a delivery row; a claim is taken once", async () => {
    const yes = await follower(A.businessId, "yes@example.com");
    await follower(A.businessId, "pending@example.com", { pending: true });
    await follower(A.businessId, "gone@example.com", { withdrawn: true });
    await follower(B.businessId, "other@example.com");
    const draft = await h.service().run((tx) => repos.updates.draftByAgent(tx, A.businessId, { subject: "News", body: "Hi", agentId: A.agentId }));
    const recipients = await h.service().run((tx) => repos.updates.pendingRecipients(tx, A.businessId, draft.id, 50));
    expect(recipients).toEqual([{ entityId: yes, email: "yes@example.com", recipientHash: suppressionHash("email", "yes@example.com") }]);
    expect(await h.service().run((tx) => repos.updates.claim(tx, A.businessId, { updateId: draft.id, entityId: yes, recipientHash: suppressionHash("email", "yes@example.com"), at: new Date() }))).toBe(true);
    expect(await h.service().run((tx) => repos.updates.claim(tx, A.businessId, { updateId: draft.id, entityId: yes, recipientHash: suppressionHash("email", "yes@example.com"), at: new Date() }))).toBe(false);
    expect(await h.service().run((tx) => repos.updates.pendingRecipients(tx, A.businessId, draft.id, 50))).toEqual([]);
    await h.service().run((tx) => repos.updates.settle(tx, A.businessId, { updateId: draft.id, entityId: yes, outcome: { state: "sent", messageRef: randomUUID() }, at: new Date() }));
    const done = await h.service().run((tx) => repos.updates.finishBatch(tx, A.businessId, draft.id, new Date()));
    expect(done).toMatchObject({ sentCount: 1, skippedCount: 0, remainingCount: 0, status: "sent" });
  });

  it("a contact whose address was edited after they agreed is not a recipient; one address on two records is reached once", async () => {
    const C = await createBusinessFixture(h, "updates-c");
    const edited = await follower(C.businessId, "agreed@example.com");
    await h.service().run((tx) => tx.update(s.entities).set({ identifiers: { email: "someone.else@example.com" } }).where(eq(s.entities.id, edited)));
    const one = await follower(C.businessId, "twice@example.com");
    const two = await follower(C.businessId, "twice@example.com");
    const draft = await h.service().run((tx) => repos.updates.draftByAgent(tx, C.businessId, { subject: "News", body: "Hi", agentId: C.agentId }));
    const recipients = await h.service().run((tx) => repos.updates.pendingRecipients(tx, C.businessId, draft.id, 50));
    expect(recipients.map((r) => r.email)).toEqual(["twice@example.com"]);
    expect([one, two]).toContain(recipients[0]!.entityId);
    expect(await h.service().run((tx) => repos.updates.pendingCount(tx, C.businessId, draft.id))).toBe(1);
    const other = recipients[0]!.entityId === one ? two : one;
    await h.service().run((tx) => repos.updates.claim(tx, C.businessId, { updateId: draft.id, entityId: recipients[0]!.entityId, recipientHash: recipients[0]!.recipientHash, at: new Date() }));
    expect(await h.service().run((tx) => repos.updates.claim(tx, C.businessId, { updateId: draft.id, entityId: other, recipientHash: recipients[0]!.recipientHash, at: new Date() }))).toBe(false);
    expect(await h.service().run((tx) => repos.updates.pendingRecipients(tx, C.businessId, draft.id, 50))).toEqual([]);
  });

  it("a send starts only from the words the founder saw, never from a canceled update; the team keeps one open draft", async () => {
    const draft = await h.asUser(A.memberId).run((tx) => repos.updates.saveDraft(tx, A.businessId, { subject: "Seen", body: "Words" }));
    await h.asUser(A.memberId).run((tx) => repos.updates.saveDraft(tx, A.businessId, { id: draft.id, subject: "Seen", body: "Changed after the preview" }));
    expect(await h.service().run((tx) => repos.updates.startSend(tx, A.businessId, draft.id, { userId: A.ownerId, at: new Date(), seenUpdatedAt: draft.updatedAt }))).toBeNull();
    await h.service().run((tx) => repos.updates.cancel(tx, A.businessId, draft.id));
    expect(await h.service().run((tx) => repos.updates.startSend(tx, A.businessId, draft.id, { userId: A.ownerId, at: new Date() }))).toBeNull();
    expect(await h.service().run((tx) => repos.updates.finishBatch(tx, A.businessId, draft.id, new Date()))).toBeNull();
    const first = await h.service().run((tx) => repos.updates.draftByAgent(tx, B.businessId, { subject: "One", body: "Hi", agentId: B.agentId }));
    const second = await h.service().run((tx) => repos.updates.draftByAgent(tx, B.businessId, { subject: "Two", body: "Hi again", agentId: B.agentId }));
    expect(second.id).toBe(first.id);
    expect(second.subject).toBe("Two");
  });
});
