/**
 * founder.presence.ping (retention plan, 2026-11-11): the first ping of a session writes founder.session_started with
 * the founder as the actor; later pings in the same session write nothing; a notification link marks that notification
 * opened and the session says where it came from. Another business is FORBIDDEN.
 */
import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "founder-presence" });
}, 120_000);
afterAll(() => hz.close());

const sessions = async (businessId: string) => (await repos.events.list(hz.db, businessId, { type: "founder.session_started", limit: 20 })).items;

describe("founder.presence.ping", () => {
  it("starts a session once, then keeps it", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const first = await owner.founder.presence.ping({ businessId: hz.A.businessId });
    expect(first).toMatchObject({ recorded: true, newSession: true, previousSeenAt: null, sessions: 1 });
    expect(await owner.founder.presence.ping({ businessId: hz.A.businessId })).toMatchObject({ newSession: false, sessions: 1 });
    const evs = (await sessions(hz.A.businessId)).filter((e) => e.actor.id === hz.A.ownerId);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payload).toEqual({ via: "direct", notificationId: null, minutesAway: null, sessions: 1 });
    expect(await owner.founder.presence.get({ businessId: hz.A.businessId })).toMatchObject({ sessions: 1, lastVia: "direct" });
  });

  it("counts a return from a notification link and marks it opened", async () => {
    const member = hz.caller({ userId: hz.A.memberId });
    const n = await repos.notifications.claim(hz.db, hz.A.businessId, { userId: hz.A.memberId, kind: "daily_brief", dedupeKey: "brief:test", subject: "Your morning brief", bodyText: "", bodyHtml: "" });
    await member.founder.presence.ping({ businessId: hz.A.businessId, via: "email", notificationId: n!.id });
    const ev = (await sessions(hz.A.businessId)).find((e) => e.actor.id === hz.A.memberId)!;
    expect(ev.payload).toMatchObject({ via: "email", notificationId: n!.id });
    expect((await repos.notifications.get(hz.db, hz.A.businessId, n!.id))?.openedAt).toBeInstanceOf(Date);
  });

  it("someone else's notification, or none, counts as direct", async () => {
    const other = await repos.notifications.claim(hz.db, hz.A.businessId, { userId: hz.A.ownerId, kind: "win", dedupeKey: "win:other", subject: "Won", bodyText: "", bodyHtml: "" });
    const viewer = hz.caller({ userId: hz.A.viewerId });
    await viewer.founder.presence.ping({ businessId: hz.A.businessId, via: "email", notificationId: other!.id });
    expect((await sessions(hz.A.businessId)).find((e) => e.actor.id === hz.A.viewerId)!.payload).toMatchObject({ via: "direct", notificationId: null });
    expect((await repos.notifications.get(hz.db, hz.A.businessId, other!.id))?.openedAt).toBeNull();
  });

  it("a via without a notification counts as direct", async () => {
    const admin = hz.caller({ userId: hz.A.adminId });
    await admin.founder.presence.ping({ businessId: hz.A.businessId, via: "email" });
    expect((await sessions(hz.A.businessId)).find((e) => e.actor.id === hz.A.adminId)!.payload).toMatchObject({ via: "direct", notificationId: null });
  });

  it("refuses a business the caller does not belong to", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.founder.presence.ping({ businessId: hz.B.businessId })).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });
});
