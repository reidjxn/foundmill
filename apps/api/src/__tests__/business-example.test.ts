/**
 * The example business (docs/UX_AUDIT_AND_PLAN.md §12 item 5; 0065): business.example.get names the demo business a
 * founder may explore (Northwind's id first, else the oldest committed demo, null without one), business.example.open
 * writes an audited, idempotent viewer membership with source example and refuses a real member, business.example.leave
 * deletes only the caller's example row, and founder.businesses.list marks example memberships. An example viewer reads
 * the business and writes nothing: a decision, a settings update, Continue and Stop all agents are each refused.
 */
import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { EXAMPLE_BUSINESS_ID } from "@foundmill/db/seed/constants";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALREADY_A_MEMBER_OF_EXAMPLE } from "@foundmill/db/repos/memberships";
import { exampleMembershipOf, NO_EXAMPLE_BUSINESS } from "../routers/business";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let explorer: string;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "example" });
  explorer = await hz.h.createUser("example-explorer@test.local");
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

/** A committed demo business with the fixture's owner as its owner (the seeds set `isDemo`; nothing else does). */
async function demo(name: string, id?: string): Promise<string> {
  const b = await repos.businesses.create(hz.db, { id, name, isDemo: true, createdBy: hz.B.ownerId });
  await repos.memberships.add(hz.db, b.id, { userId: hz.B.ownerId, role: "owner", source: "founder" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "dtc_physical" });
  return b.id;
}

describe("business.example.get", () => {
  it("is null without a committed demo business, then the oldest demo, then Northwind's id when it exists", async () => {
    expect(await hz.caller({ userId: explorer }).business.example.get()).toBeNull();
    await expect(hz.caller({ userId: explorer }).business.example.open()).rejects.toMatchObject({ code: "NOT_FOUND", message: NO_EXAMPLE_BUSINESS });
    const first = await demo("First Demo");
    expect(await hz.caller({ userId: explorer }).business.example.get()).toMatchObject({ id: first, name: "First Demo", membership: "none" });
    const northwind = await demo("Northwind Skincare", EXAMPLE_BUSINESS_ID);
    expect(northwind).toBe(EXAMPLE_BUSINESS_ID);
    const view = await hz.caller({ userId: explorer }).business.example.get();
    expect(view).toMatchObject({ id: EXAMPLE_BUSINESS_ID, name: "Northwind Skincare", slug: "northwind-skincare", membership: "none" });
    expect(view).not.toHaveProperty("glossary");
    // Its owner stands to it as a member: the door hides for them.
    expect((await hz.caller({ userId: hz.B.ownerId }).business.example.get())?.membership).toBe("member");
    await expect(hz.caller(null).business.example.get()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps a membership row to the door's word", () => {
    expect(exampleMembershipOf(null)).toBe("none");
    expect(exampleMembershipOf({ source: "example" })).toBe("example");
    expect(exampleMembershipOf({ source: "invite" })).toBe("member");
    expect(exampleMembershipOf({ source: "founder" })).toBe("member");
  });
});

describe("business.example.open / leave", () => {
  it("opens once (audited), answers the same row again, lists under isExample, and reads the business", async () => {
    const opened = await hz.caller({ userId: explorer }).business.example.open();
    expect(opened).toMatchObject({ businessId: EXAMPLE_BUSINESS_ID, created: true });
    const again = await hz.caller({ userId: explorer }).business.example.open();
    expect(again).toEqual({ ...opened, created: false });
    expect((await hz.caller({ userId: explorer }).business.example.get())?.membership).toBe("example");
    const trail = await repos.audit.list(hz.db, EXAMPLE_BUSINESS_ID, { action: "business.example.open" });
    expect(trail.items).toHaveLength(1);
    expect(trail.items[0]).toMatchObject({ actorKind: "user", actorId: explorer, target: { kind: "membership", id: opened.membershipId } });

    const mine = await hz.caller({ userId: explorer }).founder.businesses.list();
    expect(mine.businesses).toEqual([expect.objectContaining({ id: EXAMPLE_BUSINESS_ID, role: "viewer", isDemo: true, isExample: true })]);
    // Its owner's own row is not an example.
    expect((await hz.caller({ userId: hz.B.ownerId }).founder.businesses.list()).businesses.find((b) => b.id === EXAMPLE_BUSINESS_ID)).toMatchObject({ role: "owner", isExample: false });

    const got = await hz.caller({ userId: explorer }).business.get({ businessId: EXAMPLE_BUSINESS_ID });
    expect(got.role).toBe("viewer");
    expect(got.membership.source).toBe("example");
    expect(got.business.isDemo).toBe(true);
    // Not staff: the owner's staff list never shows the explorer; the seat count did not move.
    expect((await hz.caller({ userId: hz.B.ownerId }).team.humans.list({ businessId: EXAMPLE_BUSINESS_ID })).map((m) => m.userId)).not.toContain(explorer);
  });

  it("an example viewer writes nothing: a decision, a settings update, Continue, Stop all agents, a note archive", async () => {
    const viewer = hz.caller({ userId: explorer });
    const bid = EXAMPLE_BUSINESS_ID;
    expect(await code(viewer.inbox.list({ businessId: bid }))).toBe("OK");
    expect(await code(viewer.business.update({ businessId: bid, name: "Renamed" }))).toBe("FORBIDDEN");
    expect(await code(viewer.business.continue({ businessId: bid }))).toBe("FORBIDDEN");
    expect(await code(viewer.business.stopAllAgents({ businessId: bid }))).toBe("FORBIDDEN");
    expect(await code(viewer.business.setBusinessMode({ businessId: bid, businessMode: "automated" }))).toBe("FORBIDDEN");
    expect(await code(viewer.inbox.refresh({ businessId: bid }))).toBe("FORBIDDEN");
    expect(await code(viewer.team.humans.invite({ businessId: bid, userId: hz.A.memberId }))).toBe("FORBIDDEN");
    expect((await repos.businesses.get(hz.db, bid)).name).toBe("Northwind Skincare");
  });

  it("refuses a real member (CONFLICT) and never rewrites their seat", async () => {
    await expect(hz.caller({ userId: hz.B.ownerId }).business.example.open()).rejects.toMatchObject({ code: "CONFLICT", message: ALREADY_A_MEMBER_OF_EXAMPLE });
    expect((await repos.memberships.get(hz.db, EXAMPLE_BUSINESS_ID, hz.B.ownerId))).toMatchObject({ role: "owner", source: "founder" });
    // A real viewer of the example (invited) is a member too.
    await repos.memberships.add(hz.db, EXAMPLE_BUSINESS_ID, { userId: hz.A.viewerId, role: "viewer" });
    await expect(hz.caller({ userId: hz.A.viewerId }).business.example.open()).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await hz.caller({ userId: hz.A.viewerId }).business.example.get())?.membership).toBe("member");
  });

  it("leave deletes only the caller's example row (audited); a real seat is never removed by it; a second leave is a no-op", async () => {
    // A real viewer cannot leave through the example path.
    expect(await hz.caller({ userId: hz.A.viewerId }).business.example.leave({ businessId: EXAMPLE_BUSINESS_ID })).toEqual({ businessId: EXAMPLE_BUSINESS_ID, left: false });
    expect(await repos.memberships.get(hz.db, EXAMPLE_BUSINESS_ID, hz.A.viewerId)).not.toBeNull();
    // The explorer leaves: the business is gone from their lists and refuses them.
    expect(await hz.caller({ userId: explorer }).business.example.leave({ businessId: EXAMPLE_BUSINESS_ID })).toEqual({ businessId: EXAMPLE_BUSINESS_ID, left: true });
    expect(await repos.memberships.get(hz.db, EXAMPLE_BUSINESS_ID, explorer)).toBeNull();
    expect((await hz.caller({ userId: explorer }).founder.businesses.list()).businesses).toEqual([]);
    expect(await code(hz.caller({ userId: explorer }).business.get({ businessId: EXAMPLE_BUSINESS_ID }))).toBe("FORBIDDEN");
    expect((await repos.audit.list(hz.db, EXAMPLE_BUSINESS_ID, { action: "business.example.leave" })).items).toHaveLength(1);
    expect(await hz.caller({ userId: explorer }).business.example.leave({ businessId: EXAMPLE_BUSINESS_ID })).toEqual({ businessId: EXAMPLE_BUSINESS_ID, left: false });
    // Leaving a business the caller never belonged to changes nothing, and says so.
    expect(await hz.caller({ userId: explorer }).business.example.leave({ businessId: hz.A.businessId })).toEqual({ businessId: hz.A.businessId, left: false });
    // Opening again is a fresh row: the door reads "none" after a leave and "example" after the open.
    expect((await hz.caller({ userId: explorer }).business.example.get())?.membership).toBe("none");
    expect((await hz.caller({ userId: explorer }).business.example.open()).created).toBe(true);
  });
});
