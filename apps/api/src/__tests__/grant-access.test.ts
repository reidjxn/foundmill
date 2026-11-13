/**
 * Nobody gives access they do not have (security audit, 2026-11-13; services/grants.ts). An admin walled off from some
 * sections could give another person, or a second account of their own, more than they hold themselves through
 * `team.humans.role` (Finance write with Finance none; an admin role with no walls) and through a collaborator
 * invitation whose role opens sections they are walled from. Each path refuses a widening past the grantor's own access
 * and a role above theirs, still lets them narrow and lower, and leaves an owner's standing unlimited.
 */
import { repos, type SectionPermissions } from "@foundmill/db";
import { COLLABORATOR_SECTIONS, type MembershipRole } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GRANT_BEYOND_OWN_ACCESS, grantOverreach, ROLE_RANK, sectionAccessOf, withinGrantorAccess } from "../services/grants";
import { INVITATION_BEYOND_OWN_ACCESS } from "../services/invitations";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "grants" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    return { code: err.code, message: err.message };
  }
};
let n = 0;
/** A new person of business A in `role`, with `sections`. */
const personIn = async (role: MembershipRole, sectionPermissions: SectionPermissions = {}) => {
  n += 1;
  const userId = await hz.h.createUser(`grants-${role}-${n}@test.local`);
  await repos.memberships.add(hz.db, hz.A.businessId, { userId, role, sectionPermissions });
  return userId;
};
const as = (userId: string) => hz.caller({ userId });
const rowOf = (userId: string) => repos.memberships.get(hz.db, hz.A.businessId, userId);
const tokenOf = (link: string) => link.split("/i/")[1]!;

describe("withinGrantorAccess", () => {
  const m = (role: MembershipRole, sectionPermissions: Record<string, "none" | "read" | "write"> = {}) => ({ role, sectionPermissions });

  it("measures access as the walls are enforced: the role's default where no entry is set, a collaborator's cap, write only for a writer", () => {
    expect(sectionAccessOf(m("admin"), "finance")).toBe("write");
    expect(sectionAccessOf(m("viewer"), "finance")).toBe("read");
    expect(sectionAccessOf(m("viewer", { finance: "write" }), "finance")).toBe("read");
    expect(sectionAccessOf(m("collaborator", { finance: "write" }), "finance")).toBe("none");
    expect(sectionAccessOf(m("collaborator", { product: "read" }), "product")).toBe("read");
    expect(sectionAccessOf(m("cofounder", { finance: "none" }), "finance")).toBe("write");
  });

  it("refuses a section above the grantor's own level, whether set or the role's default", () => {
    const grantor = m("admin", { finance: "none", legal: "read" });
    expect(grantOverreach(grantor, m("member", { finance: "write" }))).toEqual({ role: false, sections: ["finance", "legal"] });
    // No entry means the role's default: a viewer reads Finance, which this admin cannot.
    expect(withinGrantorAccess(grantor, m("viewer"))).toBe(false);
    expect(withinGrantorAccess(grantor, m("viewer", { finance: "none" }))).toBe(true);
    expect(withinGrantorAccess(grantor, m("member", { finance: "none", legal: "read" }))).toBe(true);
    // An admin with no walls, over a collaborator: everything the grantor holds is theirs to give, the rest is not.
    expect(grantOverreach(grantor, m("admin"), m("collaborator"))).toEqual({ role: false, sections: ["finance", "legal"] });
  });

  it("refuses a role ranked above the grantor's own", () => {
    expect(ROLE_RANK.owner).toBe(ROLE_RANK.cofounder);
    expect(grantOverreach(m("admin"), m("cofounder"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("member"), m("admin"), m("viewer"))?.role).toBe(true);
    expect(grantOverreach(m("member"), m("member"), m("viewer"))).toBeNull();
    expect(grantOverreach(m("collaborator"), m("member"))?.role).toBe(true);
  });

  it("a stored wider entry that a role change would turn on is a widening", () => {
    const grantor = m("admin", { finance: "none" });
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("viewer", { finance: "write" }))).toBe(false);
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("collaborator", { finance: "write" }))).toBe(false);
  });

  it("narrowing and lowering stay free, even past what the grantor holds", () => {
    const grantor = m("admin", { finance: "none" });
    const current = m("member");
    expect(withinGrantorAccess(grantor, m("member", { product: "read" }), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("member", { finance: "read" }), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("viewer"), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("collaborator"), current)).toBe(true);
    // A new membership has nothing to keep: the same grant is judged against the grantor alone.
    expect(withinGrantorAccess(grantor, m("member", { product: "read" }))).toBe(false);
  });

  it("an owner's standing is not limited", () => {
    for (const role of ["owner", "cofounder"] as const) {
      expect(withinGrantorAccess(m(role, { finance: "none" }), m("admin"))).toBe(true);
      expect(withinGrantorAccess(m(role), m("cofounder"), m("collaborator"))).toBe(true);
    }
  });
});

describe("team.humans.role gives no more than the editor's own access", () => {
  it("a walled admin cannot widen a section, for someone else or a second account of their own", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "none" });
    const viewer = await personIn("viewer", { finance: "none" });
    for (const sectionPermissions of [{ finance: "read" }, { finance: "write" }, {}] as SectionPermissions[]) {
      expect(await refusal(as(admin).team.humans.role({ businessId, userId: viewer, sectionPermissions }))).toEqual({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    }
    // Their second account, in as a collaborator: an admin with no walls would be more than they hold.
    const second = await personIn("collaborator");
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: second, role: "admin", sectionPermissions: {} }))).toMatchObject({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: second, role: "member" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await rowOf(viewer)).toMatchObject({ role: "viewer", sectionPermissions: { finance: "none" } });
    expect(await rowOf(second)).toMatchObject({ role: "collaborator", sectionPermissions: {} });
    // With their own wall carried over, the same promotion is within their access.
    expect((await as(admin).team.humans.role({ businessId, userId: second, role: "admin", sectionPermissions: { finance: "none" } })).role).toBe("admin");
  });

  it("a higher role is refused: an owner's standing is an owner's or a cofounder's to give", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    const member = await personIn("member");
    for (const role of ["owner", "cofounder"] as const) expect((await refusal(as(admin).team.humans.role({ businessId, userId: member, role })))?.code).toBe("FORBIDDEN");
    expect((await rowOf(member))?.role).toBe("member");
  });

  it("a walled admin may still narrow and lower someone who holds more than they do", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "none" });
    const member = await personIn("member");
    // The member writes Finance (an owner's doing); narrowing Product leaves that as it is.
    expect((await as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { product: "read" } })).sectionPermissions).toEqual({ product: "read" });
    expect((await as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { product: "read", finance: "read" } })).sectionPermissions).toEqual({ product: "read", finance: "read" });
    expect((await as(admin).team.humans.role({ businessId, userId: member, role: "viewer" })).role).toBe("viewer");
    // An end date only shortens a running collaborator's access.
    const collaborator = await personIn("collaborator");
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: collaborator, expiresAt: new Date(Date.now() + 7 * 86_400_000) }))).toBeNull();
  });

  it("a new date on an ended collaborator is a grant, judged against the editor's own access", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { product: "read" });
    const ended = await personIn("collaborator");
    await repos.memberships.setExpiry(hz.db, businessId, ended, new Date(Date.now() - 60_000));
    expect((await refusal(as(admin).team.humans.role({ businessId, userId: ended, expiresAt: new Date(Date.now() + 7 * 86_400_000) })))?.code).toBe("FORBIDDEN");
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: ended, sectionPermissions: { product: "read" }, expiresAt: new Date(Date.now() + 7 * 86_400_000) }))).toBeNull();
  });

  it("an owner and a cofounder are unrestricted", async () => {
    const { businessId } = hz.A;
    const cofounder = await personIn("cofounder", { finance: "none" });
    for (const editor of [hz.A.ownerId, cofounder]) {
      const someone = await personIn("collaborator");
      expect((await as(editor).team.humans.role({ businessId, userId: someone, role: "admin", sectionPermissions: {} })).role).toBe("admin");
      expect((await as(editor).team.humans.role({ businessId, userId: someone, role: "cofounder" })).role).toBe("cofounder");
    }
  });
});

describe("invitations give no more than the inviter's own access", () => {
  it("a walled admin cannot invite a collaborator whose access is wider than their own", async () => {
    const { businessId } = hz.A;
    for (const walls of [{ product: "read" }, { crm: "none" }, { inbox: "none" }] as SectionPermissions[]) {
      const admin = await personIn("admin", walls);
      expect(await refusal(as(admin).invitation.create({ businessId, role: "collaborator" }))).toEqual({ code: "FORBIDDEN", message: INVITATION_BEYOND_OWN_ACCESS });
    }
    // Walls on what a collaborator never opens (Money, Settings) do not stop it.
    const walledFromMoney = await personIn("admin", { finance: "none", legal: "none", billing: "none", settings: "none", live: "none" });
    expect((await as(walledFromMoney).invitation.create({ businessId, role: "collaborator" })).invitation.role).toBe("collaborator");
    expect(Object.entries(COLLABORATOR_SECTIONS).filter(([, level]) => level === "none").map(([s]) => s).sort()).toEqual(["billing", "finance", "legal", "live", "settings"]);
  });

  it("a higher role is refused: an admin cannot invite a cofounder", async () => {
    const admin = await personIn("admin");
    expect((await refusal(as(admin).invitation.create({ businessId: hz.A.businessId, role: "cofounder", email: "grants-cofounder@example.com" })))?.code).toBe("FORBIDDEN");
  });

  it("an inviter narrowed after making the link can no longer have it read or accepted; given the access back, it works again", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    const { link } = await as(admin).invitation.create({ businessId, role: "collaborator" });
    await repos.memberships.setSectionPermissions(hz.db, businessId, admin, { distribution: "read" });
    const newcomer = await hz.h.createUser(`grants-newcomer-${++n}@test.local`);
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(link) })).toEqual({ state: "unavailable" });
    expect((await refusal(as(newcomer).invitation.accept({ token: tokenOf(link) })))?.code).toBe("NOT_FOUND");
    expect(await rowOf(newcomer)).toBeNull();
    await repos.memberships.setSectionPermissions(hz.db, businessId, admin, { finance: "none" });
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(link) })).toMatchObject({ state: "pending" });
    expect(await as(newcomer).invitation.accept({ token: tokenOf(link) })).toEqual({ businessId, already: false });
    expect(await rowOf(newcomer)).toMatchObject({ role: "collaborator", sectionPermissions: {} });
  });

  it("an owner and a cofounder are unrestricted", async () => {
    const { businessId } = hz.A;
    const cofounder = await personIn("cofounder", { product: "none", crm: "none" });
    for (const inviter of [hz.A.ownerId, cofounder]) {
      expect((await as(inviter).invitation.create({ businessId, role: "collaborator" })).invitation.role).toBe("collaborator");
      expect((await as(inviter).invitation.create({ businessId, role: "cofounder", email: `grants-cf-${++n}@example.com` })).invitation.role).toBe("cofounder");
    }
  });
});
