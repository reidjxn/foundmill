/**
 * Nobody gives access they do not have (security audit, 2026-11-13; services/grants.ts). An admin walled off from some
 * sections could give another person, or a second account of their own, more than they hold themselves through
 * `team.humans.role` (Finance write with Finance none; an admin role with no walls) and through `team.humans.invite` (a
 * silent add as an unwalled admin). Each path refuses a widening past the grantor's own access and a role above theirs,
 * still lets them narrow and lower, and leaves an owner unlimited.
 */
import { repos, type SectionPermissions } from "@foundmill/db";
import type { MembershipRole } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GRANT_BEYOND_OWN_ACCESS, grantOverreach, ROLE_RANK, sectionAccessOf, withinGrantorAccess } from "../services/grants";
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
/** A new account, not yet in any business. */
const newAccount = async () => hz.h.createUser(`grants-new-${++n}@test.local`);
/** A new person of business A in `role`, with `sections`. */
const personIn = async (role: MembershipRole, sectionPermissions: SectionPermissions = {}) => {
  n += 1;
  const userId = await hz.h.createUser(`grants-${role}-${n}@test.local`);
  await repos.memberships.add(hz.db, hz.A.businessId, { userId, role, sectionPermissions });
  return userId;
};
const as = (userId: string) => hz.caller({ userId });
const rowOf = (userId: string) => repos.memberships.get(hz.db, hz.A.businessId, userId);
const FORBIDDEN = { code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS };

describe("withinGrantorAccess", () => {
  const m = (role: MembershipRole, sectionPermissions: Record<string, "none" | "read" | "write"> = {}) => ({ role, sectionPermissions });

  it("measures access as the walls are enforced: the role's default where no entry is set, write only for a writer", () => {
    expect(sectionAccessOf(m("admin"), "finance")).toBe("write");
    expect(sectionAccessOf(m("member", { finance: "read" }), "finance")).toBe("read");
    expect(sectionAccessOf(m("viewer"), "finance")).toBe("read");
    expect(sectionAccessOf(m("viewer", { finance: "write" }), "finance")).toBe("read");
    expect(sectionAccessOf(m("advisor", { product: "none" }), "product")).toBe("none");
    expect(sectionAccessOf(m("owner", { finance: "none" }), "finance")).toBe("write");
  });

  it("refuses a section above the grantor's own level, whether set or the role's default", () => {
    const grantor = m("admin", { finance: "none", legal: "read" });
    expect(grantOverreach(grantor, m("member", { finance: "write" }))).toEqual({ role: false, sections: ["finance", "legal"] });
    // No entry means the role's default: a viewer reads Finance, which this admin cannot.
    expect(withinGrantorAccess(grantor, m("viewer"))).toBe(false);
    expect(withinGrantorAccess(grantor, m("viewer", { finance: "none" }))).toBe(true);
    expect(withinGrantorAccess(grantor, m("member", { finance: "none", legal: "read" }))).toBe(true);
    // An admin with no walls, over a viewer: everything the grantor holds is theirs to give, the rest is not.
    expect(grantOverreach(grantor, m("admin"), m("viewer"))).toEqual({ role: false, sections: ["finance", "legal"] });
  });

  it("refuses a role ranked above the grantor's own", () => {
    expect(ROLE_RANK.viewer).toBe(ROLE_RANK.advisor);
    expect(grantOverreach(m("admin"), m("owner"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("member"), m("admin"), m("viewer"))?.role).toBe(true);
    expect(grantOverreach(m("member"), m("member"), m("viewer"))).toBeNull();
    expect(grantOverreach(m("viewer"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("admin"), m("admin"))).toBeNull();
  });

  it("a stored wider entry that a role change would turn on is a widening", () => {
    const grantor = m("admin", { finance: "none" });
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("viewer", { finance: "write" }))).toBe(false);
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("advisor", { finance: "write" }))).toBe(false);
  });

  it("narrowing and lowering stay free, even past what the grantor holds", () => {
    const grantor = m("admin", { finance: "none" });
    const current = m("member");
    expect(withinGrantorAccess(grantor, m("member", { product: "read" }), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("member", { finance: "read" }), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("viewer"), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("advisor"), current)).toBe(true);
    // A new membership has nothing to keep: the same grant is judged against the grantor alone.
    expect(withinGrantorAccess(grantor, m("member", { product: "read" }))).toBe(false);
  });

  it("an owner is not limited", () => {
    expect(withinGrantorAccess(m("owner", { finance: "none" }), m("admin"))).toBe(true);
    expect(withinGrantorAccess(m("owner"), m("owner"), m("viewer"))).toBe(true);
  });
});

describe("team.humans.role gives no more than the editor's own access", () => {
  it("a walled admin cannot widen a section, for someone else or a second account of their own", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "none" });
    const viewer = await personIn("viewer", { finance: "none" });
    for (const sectionPermissions of [{ finance: "read" }, { finance: "write" }, {}] as SectionPermissions[]) {
      expect(await refusal(as(admin).team.humans.role({ businessId, userId: viewer, sectionPermissions }))).toEqual(FORBIDDEN);
    }
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: viewer, role: "member" }))).toBeNull();
    expect(await rowOf(viewer)).toMatchObject({ role: "member", sectionPermissions: { finance: "none" } });
    // Their second account, in as a viewer: an admin with no walls would be more than they hold.
    const second = await personIn("viewer");
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: second, role: "admin", sectionPermissions: {} }))).toEqual(FORBIDDEN);
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: second, role: "admin" }))).toEqual(FORBIDDEN);
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: second, role: "member" }))).toEqual(FORBIDDEN);
    expect(await rowOf(second)).toMatchObject({ role: "viewer", sectionPermissions: {} });
    // With their own wall carried over, the same promotion is within their access.
    expect((await as(admin).team.humans.role({ businessId, userId: second, role: "admin", sectionPermissions: { finance: "none" } })).role).toBe("admin");
  });

  it("an admin walled to read cannot hand out write on that section", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "read" });
    const member = await personIn("member", { finance: "none" });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { finance: "write" } }))).toEqual(FORBIDDEN);
    expect((await as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { finance: "read" } })).sectionPermissions).toEqual({ finance: "read" });
  });

  it("a higher role is refused: ownership is an owner's to give", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    const member = await personIn("member");
    expect((await refusal(as(admin).team.humans.role({ businessId, userId: member, role: "owner" })))?.code).toBe("FORBIDDEN");
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
    // Another admin behind the same wall, lowered to a member: nothing rises, nothing to refuse.
    const other = await personIn("admin", { finance: "none" });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: other, role: "member" }))).toBeNull();
  });

  it("an owner is unrestricted", async () => {
    const { businessId } = hz.A;
    const someone = await personIn("viewer", { finance: "none" });
    expect((await as(hz.A.ownerId).team.humans.role({ businessId, userId: someone, role: "admin", sectionPermissions: {} })).role).toBe("admin");
    expect((await rowOf(someone))?.sectionPermissions).toEqual({});
  });
});

describe("team.humans.invite adds nobody with more than the inviter's own access", () => {
  it("a walled admin cannot add a second account as an unwalled admin, or with any section above their own", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "none" });
    for (const [role, sectionPermissions] of [["admin", {}], ["admin", { finance: "write" }], ["member", {}], ["member", { finance: "read" }], ["viewer", {}], ["advisor", {}]] as [MembershipRole, SectionPermissions][]) {
      const second = await newAccount();
      expect(await refusal(as(admin).team.humans.invite({ businessId, userId: second, role, sectionPermissions }))).toEqual(FORBIDDEN);
      expect(await rowOf(second)).toBeNull();
    }
    // The role's default, with no permissions given (a member writes Finance): refused too.
    const byDefault = await newAccount();
    expect(await refusal(as(admin).team.humans.invite({ businessId, userId: byDefault }))).toEqual(FORBIDDEN);
    expect(await rowOf(byDefault)).toBeNull();
  });

  it("refuses before the account is looked up, so the refusal says nothing about the email", async () => {
    const admin = await personIn("admin", { finance: "none" });
    expect(await refusal(as(admin).team.humans.invite({ businessId: hz.A.businessId, email: `grants-nobody-${++n}@test.local`, role: "admin" }))).toEqual(FORBIDDEN);
  });

  it("a walled admin may add someone within their own access", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "none", legal: "read" });
    for (const role of ["admin", "member", "viewer", "advisor"] as const) {
      const someone = await newAccount();
      expect(await as(admin).team.humans.invite({ businessId, userId: someone, role, sectionPermissions: { finance: "none", legal: "read" } })).toMatchObject({ role, sectionPermissions: { finance: "none", legal: "read" } });
    }
  });

  it("an unwalled admin may add an admin; ownership is never given by invitation", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    expect((await as(admin).team.humans.invite({ businessId, userId: await newAccount(), role: "admin" })).role).toBe("admin");
    expect((await refusal(as(admin).team.humans.invite({ businessId, userId: await newAccount(), role: "owner" })))?.code).toBe("BAD_REQUEST");
  });

  it("an owner is unrestricted", async () => {
    const { businessId } = hz.A;
    expect(await as(hz.A.ownerId).team.humans.invite({ businessId, userId: await newAccount(), role: "admin", sectionPermissions: { finance: "write" } })).toMatchObject({ role: "admin", sectionPermissions: { finance: "write" } });
  });
});
