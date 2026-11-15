/**
 * team.humans.invite / role / remove keep ownership with owners (audit DB-02 / SECX-4 / ARB-03): an invited admin can
 * neither demote the owner (by role or by re-inviting them) nor mint owners, an invitation never overwrites a member,
 * nobody edits their own role or section permissions, and a business always keeps an owner.
 */
import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "guards" });
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
const roleOf = async (userId: string) => (await repos.memberships.get(hz.db, hz.A.businessId, userId))?.role ?? null;

describe("team.humans: ownership stays with owners", () => {
  it("an admin cannot demote the owner, by role or by an invitation the owner accepts", async () => {
    const admin = hz.caller({ userId: hz.A.adminId });
    const businessId = hz.A.businessId;
    expect(await code(admin.team.humans.role({ businessId, userId: hz.A.ownerId, role: "viewer" }))).toBe("FORBIDDEN");
    expect(await code(admin.team.humans.role({ businessId, userId: hz.A.ownerId, sectionPermissions: { billing: "none" } }))).toBe("FORBIDDEN");
    // A collaborator invitation the owner opens changes nothing: they are already one of the project's people.
    const { link } = await admin.invitation.create({ businessId, role: "collaborator" });
    expect(await hz.caller({ userId: hz.A.ownerId }).invitation.accept({ confirmAdult: true, token: link.split("/i/")[1]! })).toEqual({ businessId, already: true });
    expect(await roleOf(hz.A.ownerId)).toBe("owner");
    // So the takeover path (demote, then remove) is closed too, and the owner keeps owner-only actions.
    expect(await code(admin.team.humans.remove({ businessId, userId: hz.A.ownerId }))).toBe("BAD_REQUEST");
    expect(await code(hz.caller({ userId: hz.A.ownerId }).business.get({ businessId }))).toBe("OK");
  });

  it("an admin cannot grant ownership, by role or by a cofounder invitation (an owner's alone)", async () => {
    const admin = hz.caller({ userId: hz.A.adminId });
    const businessId = hz.A.businessId;
    expect(await code(admin.team.humans.role({ businessId, userId: hz.A.memberId, role: "owner" }))).toBe("FORBIDDEN");
    expect(await code(admin.invitation.create({ businessId, role: "cofounder" }))).toBe("FORBIDDEN");
    expect(await roleOf(hz.A.memberId)).toBe("member");
  });

  it("an invitation never overwrites an existing member, the inviter included, and stays for the person it was for", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const businessId = hz.A.businessId;
    // The sole owner accepting their own collaborator invitation would have orphaned the business (ARB-03).
    const { link } = await owner.invitation.create({ businessId, role: "collaborator" });
    const token = link.split("/i/")[1]!;
    expect(await owner.invitation.accept({ confirmAdult: true, token })).toEqual({ businessId, already: true });
    expect(await hz.caller({ userId: hz.A.memberId }).invitation.accept({ confirmAdult: true, token })).toEqual({ businessId, already: true });
    expect(await roleOf(hz.A.ownerId)).toBe("owner");
    expect((await repos.memberships.get(hz.db, businessId, hz.A.memberId))?.role).toBe("member");
    // A newcomer accepts it: a collaborator (THESIS_REVIEW 3.3), whose walls are the role's own.
    const newcomer = await hz.h.createUser("guards-invitee@test.local");
    expect(await hz.caller({ userId: newcomer }).invitation.accept({ confirmAdult: true, token })).toEqual({ businessId, already: false });
    expect(await repos.memberships.get(hz.db, businessId, newcomer)).toMatchObject({ role: "collaborator", sectionPermissions: {}, expiresAt: null });
  });

  it("nobody edits their own role or section permissions", async () => {
    const businessId = hz.A.businessId;
    expect(await code(hz.caller({ userId: hz.A.ownerId }).team.humans.role({ businessId, userId: hz.A.ownerId, role: "admin" }))).toBe("BAD_REQUEST");
    // An admin walled from Finance cannot lift their own wall.
    await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.adminId, { finance: "none" });
    expect(await code(hz.caller({ userId: hz.A.adminId }).team.humans.role({ businessId, userId: hz.A.adminId, sectionPermissions: { finance: "write" } }))).toBe("BAD_REQUEST");
    expect((await repos.memberships.get(hz.db, businessId, hz.A.adminId))?.sectionPermissions).toEqual({ finance: "none" });
    await repos.memberships.setSectionPermissions(hz.db, businessId, hz.A.adminId, {});
  });

  it("an owner grants and takes back ownership; the business always keeps an owner", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const businessId = hz.A.businessId;
    expect((await owner.team.humans.role({ businessId, userId: hz.A.adminId, role: "owner" })).role).toBe("owner");
    // The new owner may now step the first one down (someone else always does it), and back.
    const second = hz.caller({ userId: hz.A.adminId });
    expect((await second.team.humans.role({ businessId, userId: hz.A.ownerId, role: "admin" })).role).toBe("admin");
    expect(await code(owner.team.humans.role({ businessId, userId: hz.A.adminId, role: "admin" }))).toBe("FORBIDDEN");
    expect((await second.team.humans.role({ businessId, userId: hz.A.ownerId, role: "owner" })).role).toBe("owner");
    expect((await owner.team.humans.role({ businessId, userId: hz.A.adminId, role: "admin" })).role).toBe("admin");
    expect((await repos.memberships.list(hz.db, businessId, { role: "owner" })).map((m) => m.userId)).toEqual([hz.A.ownerId]);
  });
});
