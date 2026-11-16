/**
 * repos.replies (0125; WP-08 T2): a kept reply, its idempotency, the daily cap, the deletion rule, the founders' answer,
 * and that business B never reads business A's reply text (cross-tenant, through withRls).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPLY_BODY_MAX } from "@foundmill/shared";
import { repos } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let H: RepoHarness;
beforeAll(async () => {
  H = await setupRepoHarness("replies");
});
afterAll(async () => {
  await H.close();
});

const at = new Date("2026-11-16T10:00:00.000Z");
const store = (businessId: string, over: Partial<Parameters<typeof repos.replies.storeInbound>[2]> = {}) =>
  H.svc((tx) => repos.replies.storeInbound(tx, businessId, { interactionId: randomUUID(), email: "Sam.Reader@Example.com", subject: "Re: hello", body: "Yes please, I want one.", occurredAt: at, dailyCap: 200, ...over }));

describe("repos.replies", () => {
  it("keeps a reply under the event's id, on a new person whose address is masked and who has no lawful basis", async () => {
    const interactionId = randomUUID();
    const noted: string[] = [];
    const r = await store(H.A.businessId, { interactionId, onStored: async (_tx, x) => void noted.push(x.displayName) });
    expect(r.status).toBe("stored");
    const [row] = await H.svc((tx) => tx.select().from(s.interactions).where(eq(s.interactions.id, interactionId)));
    expect(row).toMatchObject({ kind: "email", direction: "inbound", summary: "Re: hello", bodyUntrusted: "Yes please, I want one.", entityIds: [r.entityId] });
    const entity = await H.svc((tx) => repos.entities.get(tx, H.A.businessId, r.entityId!));
    expect(entity).toMatchObject({ kind: "person", displayName: "Contact (sa***@example.com)", source: "reply", lawfulBasis: null });
    expect(entity.identifiers.email).toBe("sam.reader@example.com");
    expect(noted).toEqual(["Contact (sa***@example.com)"]);
  });

  it("writes nothing twice for the same id, and reuses the person for a second reply", async () => {
    const interactionId = randomUUID();
    const first = await store(H.A.businessId, { interactionId });
    const again = await store(H.A.businessId, { interactionId, onStored: async () => { throw new Error("must not run"); } });
    expect(again).toEqual({ status: "duplicate", entityId: first.entityId });
    const people = await H.svc((tx) => tx.select().from(s.entities).where(and(eq(s.entities.businessId, H.A.businessId), eq(s.entities.source, "reply"))));
    expect(people).toHaveLength(1);
  });

  it("cuts the text at 20,000 characters", async () => {
    const interactionId = randomUUID();
    await store(H.A.businessId, { interactionId, email: "long@example.com", body: "x".repeat(REPLY_BODY_MAX + 50) });
    const [row] = await H.svc((tx) => tx.select().from(s.interactions).where(eq(s.interactions.id, interactionId)));
    expect(row!.bodyUntrusted).toHaveLength(REPLY_BODY_MAX);
  });

  it("keeps nothing past the day's cap, and nothing for a record whose deletion was requested", async () => {
    const cap = await H.svc((tx) => repos.replies.storeInbound(tx, H.A.businessId, { interactionId: randomUUID(), email: "cap@example.com", subject: "", body: "hi", occurredAt: at, dailyCap: 1 }));
    expect(cap).toEqual({ status: "over_cap", entityId: null });
    const gone = await H.svc((tx) => repos.entities.create(tx, H.A.businessId, { kind: "person", displayName: "Gone", identifiers: { email: "gone@example.com" } }));
    await H.svc((tx) => repos.entities.requestDeletion(tx, H.A.businessId, gone.id, { delayDays: 7 }));
    expect(await store(H.A.businessId, { email: "gone@example.com" })).toEqual({ status: "deleted", entityId: null });
  });

  it("lists replies and answers newest first, marks an answered reply, and gives the gateway the address to answer", async () => {
    const interactionId = randomUUID();
    const r = await store(H.A.businessId, { interactionId, email: "answer.me@example.com", subject: "Question" });
    const before = await H.as(H.A.ownerId, (tx) => repos.replies.list(tx, H.A.businessId, { entityId: r.entityId!, limit: 50 }));
    expect(before).toEqual([expect.objectContaining({ id: interactionId, direction: "inbound", answered: false, text: "Yes please, I want one.", from: "Contact (an***@example.com)" })]);
    expect(await H.svc((tx) => repos.replies.forAnswer(tx, H.A.businessId, interactionId))).toEqual({ interactionId, entityId: r.entityId, email: "answer.me@example.com", subject: "Question" });
    await H.svc((tx) => repos.replies.recordAnswer(tx, H.A.businessId, { entityId: r.entityId!, subject: "Re: Question", text: "Thanks!", at: new Date(at.getTime() + 60_000) }));
    const after = await H.as(H.A.ownerId, (tx) => repos.replies.list(tx, H.A.businessId, { entityId: r.entityId!, limit: 50 }));
    expect(after.map((m) => [m.direction, m.answered])).toEqual([["outbound", false], ["inbound", true]]);
    // An answer is never itself answered, and B's id is not A's.
    expect(await H.svc((tx) => repos.replies.forAnswer(tx, H.A.businessId, after[0]!.id))).toBeNull();
    expect(await H.svc((tx) => repos.replies.forAnswer(tx, H.B.businessId, interactionId))).toBeNull();
  });

  it("business B cannot read business A's reply text (RLS)", async () => {
    const interactionId = randomUUID();
    await store(H.A.businessId, { interactionId, email: "private@example.com" });
    const asB = await H.as(H.B.ownerId, (tx) => tx.select({ body: s.interactions.bodyUntrusted }).from(s.interactions).where(eq(s.interactions.id, interactionId)));
    expect(asB).toEqual([]);
    expect(await H.as(H.B.ownerId, (tx) => repos.replies.list(tx, H.A.businessId, { limit: 50 }))).toEqual([]);
    const asA = await H.as(H.A.ownerId, (tx) => tx.select({ body: s.interactions.bodyUntrusted }).from(s.interactions).where(eq(s.interactions.id, interactionId)));
    expect(asA).toEqual([{ body: "Yes please, I want one." }]);
  });

  it("the text is deleted with the person's record", async () => {
    const interactionId = randomUUID();
    const r = await store(H.A.businessId, { interactionId, email: "purge.me@example.com" });
    await H.svc((tx) => repos.entities.requestDeletion(tx, H.A.businessId, r.entityId!, { delayDays: 0 }));
    const purged = await H.svc((tx) => repos.entities.purge(tx, H.A.businessId, r.entityId!));
    expect(purged.purged).toContain(r.entityId);
    expect(await H.svc((tx) => tx.select().from(s.interactions).where(eq(s.interactions.id, interactionId)))).toEqual([]);
  });

  it("an address whose record was erased is never imported again, even when the person writes", async () => {
    const r = await store(H.A.businessId, { email: "erased@example.com" });
    await H.svc((tx) => repos.entities.requestDeletion(tx, H.A.businessId, r.entityId!, { delayDays: 0 }));
    await H.svc((tx) => repos.entities.purge(tx, H.A.businessId, r.entityId!));
    expect(await store(H.A.businessId, { email: "erased@example.com" })).toEqual({ status: "deleted", entityId: null });
    expect(await H.svc((tx) => repos.entities.findByIdentifier(tx, H.A.businessId, "email", "erased@example.com"))).toBeNull();
  });

  it("an id another project holds is a duplicate and leaves no stray person behind", async () => {
    const interactionId = randomUUID();
    await store(H.B.businessId, { interactionId, email: "both@example.com" });
    expect(await store(H.A.businessId, { interactionId, email: "both@example.com" })).toEqual({ status: "duplicate", entityId: null });
    expect(await H.svc((tx) => repos.entities.findByIdentifier(tx, H.A.businessId, "email", "both@example.com"))).toBeNull();
  });

  it("a reply on a record merged away is not answered from it", async () => {
    const interactionId = randomUUID();
    const r = await store(H.A.businessId, { interactionId, email: "merged.away@example.com" });
    const kept = await H.svc((tx) => repos.entities.create(tx, H.A.businessId, { kind: "person", displayName: "Kept" }));
    await H.svc((tx) => tx.update(s.entities).set({ mergedIntoId: kept.id }).where(eq(s.entities.id, r.entityId!)));
    expect(await H.svc((tx) => repos.replies.forAnswer(tx, H.A.businessId, interactionId))).toBeNull();
  });
});
