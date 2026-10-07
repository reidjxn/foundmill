import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "membership" });
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

describe("membership enforcement (businessProcedure)", () => {
  it("an anonymous caller gets UNAUTHORIZED", async () => {
    expect(await code(hz.caller(null).inbox.list({ businessId: hz.A.businessId }))).toBe("UNAUTHORIZED");
  });

  it("user B cannot read A's inbox (FORBIDDEN), while A's owner can", async () => {
    expect(await code(hz.caller({ userId: hz.B.ownerId }).inbox.list({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    const page = await hz.caller({ userId: hz.A.ownerId }).inbox.list({ businessId: hz.A.businessId });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.businessId === hz.A.businessId)).toBe(true);
  });

  it("B's owner cannot reach A's items by id, agents, departments or audit log", async () => {
    const b = hz.caller({ userId: hz.B.ownerId });
    expect(await code(b.inbox.get({ businessId: hz.A.businessId, itemId: hz.A.inboxItemId }))).toBe("FORBIDDEN");
    expect(await code(b.team.agents.list({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    expect(await code(b.department.list({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    expect(await code(b.business.audit({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    // And A's ids are not visible through B's own business either (RLS + business scoping).
    expect(await code(b.inbox.get({ businessId: hz.B.businessId, itemId: hz.A.inboxItemId }))).toBe("NOT_FOUND");
  });

  it("viewers read but never write; admins administer; members write but do not administer", async () => {
    const viewer = hz.caller({ userId: hz.A.viewerId });
    expect(await code(viewer.inbox.list({ businessId: hz.A.businessId }))).toBe("OK");
    expect(await code(viewer.inbox.archive({ businessId: hz.A.businessId, itemId: hz.A.inboxItemId }))).toBe("FORBIDDEN");
    expect(await code(viewer.business.stopAllAgents({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    const member = hz.caller({ userId: hz.A.memberId });
    expect(await code(member.business.setBusinessMode({ businessId: hz.A.businessId, businessMode: "augmented" }))).toBe("FORBIDDEN");
    expect(await code(member.department.create({ businessId: hz.A.businessId, name: "Ops", moduleKeys: ["development"] }))).toBe("FORBIDDEN");
    const admin = hz.caller({ userId: hz.A.adminId });
    expect(await code(admin.business.setBusinessMode({ businessId: hz.A.businessId, businessMode: "assisted" }))).toBe("OK");
  });

  it("section permissions restrict a member per section (BUILD §11.9)", async () => {
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { finance: "none", inbox: "read" });
    const member = hz.caller({ userId: hz.A.memberId });
    expect(await code(member.finance.overview({ businessId: hz.A.businessId }))).toBe("FORBIDDEN");
    expect(await code(member.inbox.list({ businessId: hz.A.businessId }))).toBe("OK");
    expect(await code(member.inbox.archive({ businessId: hz.A.businessId, itemId: hz.A.inboxItemId }))).toBe("FORBIDDEN");
    expect(await code(member.product.spec.get({ businessId: hz.A.businessId }))).toBe("OK");
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, {});
  });

  it("every mutation leaves an audit entry attributed to the user", async () => {
    const admin = hz.caller({ userId: hz.A.adminId });
    await admin.business.update({ businessId: hz.A.businessId, glossary: { customers: "clients" } });
    const log = await admin.business.audit({ businessId: hz.A.businessId, limit: 10 });
    const entry = log.items.find((e) => e.action === "business.update");
    expect(entry).toBeDefined();
    expect(entry!.actorKind).toBe("user");
    expect(entry!.actorId).toBe(hz.A.adminId);
    const verify = await repos.audit.verify(hz.db, hz.A.businessId);
    expect(verify.ok).toBe(true);
  });

  it("the profile gate: a user without a founder profile cannot take charge of an idea", async () => {
    const fresh = await hz.h.createUser("fresh@test.local");
    const caller = hz.caller({ userId: fresh });
    const me = await caller.founder.profile.get();
    expect(me.complete).toBe(false);
    const idea = await caller.idea.generate({ prompt: "accounting for freelancers" });
    expect(await code(caller.idea.commit({ ideaId: idea.ideas[0]!.id, name: "Test", archetype: "b2b_saas" }))).toBe("BAD_REQUEST");
  });
});
