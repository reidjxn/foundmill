/**
 * Nobody gives access they do not have (security audit, 2026-11-13; services/grants.ts). An admin walled off from some
 * sections could give another person, or a second account of their own, more than they hold themselves through
 * `team.humans.role` (Finance write with Finance none; an admin role with no walls) and through a collaborator
 * invitation whose role opens sections they are walled from. Each path refuses a widening past the grantor's own access
 * and a role above theirs, still lets them narrow and lower, and leaves an owner's standing unlimited. main's copy of
 * this rule (#113) also guarded `team.humans.invite`, the silent add; that route is gone here (an invitation is the only
 * way in), so its tests went with it.
 */
import { repos, type SectionPermissions } from "@foundmill/db";
import { COLLABORATOR_SECTIONS, type MembershipRole } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GRANT_BEYOND_OWN_ACCESS, grantOverreach, ROLE_RANK, sectionAccessOf, withinGrantorAccess } from "../services/grants";
import { INVITATION_BEYOND_OWN_ACCESS } from "../services/invitations";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "grants" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());
afterEach(() => vi.restoreAllMocks());

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
    expect(sectionAccessOf(m("member", { finance: "read" }), "finance")).toBe("read");
    expect(sectionAccessOf(m("viewer", { finance: "write" }), "finance")).toBe("read");
    expect(sectionAccessOf(m("advisor", { product: "none" }), "product")).toBe("none");
    expect(sectionAccessOf(m("owner", { finance: "none" }), "finance")).toBe("write");
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
    expect(grantOverreach(grantor, m("admin"), m("viewer"))).toEqual({ role: false, sections: ["finance", "legal"] });
  });

  it("refuses a role ranked above the grantor's own", () => {
    expect(ROLE_RANK.owner).toBe(ROLE_RANK.cofounder);
    expect(ROLE_RANK.viewer).toBe(ROLE_RANK.advisor);
    expect(grantOverreach(m("admin"), m("cofounder"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("admin"), m("owner"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("member"), m("admin"), m("viewer"))?.role).toBe(true);
    expect(grantOverreach(m("member"), m("member"), m("viewer"))).toBeNull();
    expect(grantOverreach(m("collaborator"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("viewer"), m("member"))?.role).toBe(true);
    expect(grantOverreach(m("admin"), m("admin"))).toBeNull();
  });

  it("a stored wider entry that a role change would turn on is a widening", () => {
    const grantor = m("admin", { finance: "none" });
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("viewer", { finance: "write" }))).toBe(false);
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("collaborator", { finance: "write" }))).toBe(false);
    expect(withinGrantorAccess(grantor, m("member", { finance: "write" }), m("advisor", { finance: "write" }))).toBe(false);
  });

  it("narrowing and lowering stay free, even past what the grantor holds", () => {
    const grantor = m("admin", { finance: "none" });
    const current = m("member");
    expect(withinGrantorAccess(grantor, m("member", { product: "read" }), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("member", { finance: "read" }), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("viewer"), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("collaborator"), current)).toBe(true);
    expect(withinGrantorAccess(grantor, m("advisor"), current)).toBe(true);
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
    // The same for a second account in as a viewer; and the viewer kept behind the wall may become a member.
    const third = await personIn("viewer");
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: third, role: "admin", sectionPermissions: {} }))).toEqual({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: third, role: "admin" }))).toEqual({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: third, role: "member" }))).toEqual({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    expect(await rowOf(third)).toMatchObject({ role: "viewer", sectionPermissions: {} });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: viewer, role: "member" }))).toBeNull();
    expect(await rowOf(viewer)).toMatchObject({ role: "member", sectionPermissions: { finance: "none" } });
  });

  it("an admin walled to read cannot hand out write on that section", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin", { finance: "read" });
    const member = await personIn("member", { finance: "none" });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { finance: "write" } }))).toEqual({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    expect((await as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { finance: "read" } })).sectionPermissions).toEqual({ finance: "read" });
  });

  // The rank check (`grantOverreach(...).role`) is not reachable through this router: only an admin or someone with an
  // owner's standing may call it (`sectionAdmin`), an owner's standing is not limited, and the only roles ranked above an
  // admin are an owner's and a cofounder's, which the older owner check refuses first. Its cases are the helper's tests
  // above ("refuses a role ranked above the grantor's own"); these pin down why the router never gets that far.
  it("a higher role is refused: an owner's standing is an owner's or a cofounder's to give (the owner check answers first)", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    const member = await personIn("member");
    for (const role of ["owner", "cofounder"] as const) expect(await refusal(as(admin).team.humans.role({ businessId, userId: member, role }))).toEqual({ code: "FORBIDDEN", message: "Only an owner or a cofounder can make someone an owner or a cofounder" });
    expect((await rowOf(member))?.role).toBe("member");
  });

  it("nobody ranked below an admin edits roles at all, so the rank check has no other case to meet here", async () => {
    const { businessId } = hz.A;
    const viewer = await personIn("viewer");
    for (const role of ["member", "collaborator", "viewer", "advisor"] as const) {
      const editor = await personIn(role);
      expect((await refusal(as(editor).team.humans.role({ businessId, userId: viewer, role: "admin" })))?.code, role).toBe("FORBIDDEN");
    }
    expect((await rowOf(viewer))?.role).toBe("viewer");
    // An admin's grants, by role: only an owner's standing is ranked above theirs.
    const above = (["owner", "cofounder", "admin", "member", "collaborator", "viewer", "advisor"] as const).filter((role) => ROLE_RANK[role] > ROLE_RANK.admin);
    expect(above).toEqual(["owner", "cofounder"]);
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
    // Another admin behind the same wall, lowered to a member: nothing rises, nothing to refuse.
    const other = await personIn("admin", { finance: "none" });
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: other, role: "member" }))).toBeNull();
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

describe("team.humans.role judges the rows as they are inside its transaction", () => {
  /** The request reads the editor's access as it was; `change` then commits before the procedure's transaction starts. */
  const staleRequest = (editor: string, change: () => Promise<unknown>) => {
    const access = repos.memberships.access.bind(repos.memberships);
    vi.spyOn(repos.memberships, "access").mockImplementation(async (db, businessId, userId, options) => {
      const seen = await access(db, businessId, userId, options);
      if (userId === editor) await change();
      return seen;
    });
  };

  it("an editor walled after the request read their access is judged on their row as it is now", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    const viewer = await personIn("viewer", { finance: "none" });
    staleRequest(admin, () => repos.memberships.setSectionPermissions(hz.db, businessId, admin, { finance: "none" }));
    expect(await refusal(as(admin).team.humans.role({ businessId, userId: viewer, sectionPermissions: { finance: "read" } }))).toEqual({ code: "FORBIDDEN", message: GRANT_BEYOND_OWN_ACCESS });
    expect(await rowOf(viewer)).toMatchObject({ sectionPermissions: { finance: "none" } });
  });

  it("an editor lowered from admin, or removed, after the request read their access changes nothing", async () => {
    const { businessId } = hz.A;
    for (const change of ["lowered", "walled from Team", "removed"] as const) {
      const admin = await personIn("admin");
      const viewer = await personIn("viewer");
      staleRequest(admin, () =>
        change === "lowered" ? repos.memberships.setRole(hz.db, businessId, admin, "member") : change === "removed" ? repos.memberships.remove(hz.db, businessId, admin) : repos.memberships.setSectionPermissions(hz.db, businessId, admin, { team: "read" }),
      );
      expect(await refusal(as(admin).team.humans.role({ businessId, userId: viewer, role: "member" })), change).toEqual({ code: "FORBIDDEN", message: "You can no longer change people's access in this business" });
      expect((await rowOf(viewer))?.role, change).toBe("viewer");
      vi.restoreAllMocks();
    }
  });

  it("takes the owner lock, then the editor's row for share and the person's for update, before it changes anything", async () => {
    const { businessId } = hz.A;
    const admin = await personIn("admin");
    const member = await personIn("member");
    const order: string[] = [];
    const m = repos.memberships;
    const lockOwners = m.lockOwners.bind(m);
    const mine = m.getMineForShare.bind(m);
    const forUpdate = m.getForUpdate.bind(m);
    const setSections = m.setSectionPermissions.bind(m);
    vi.spyOn(m, "lockOwners").mockImplementation(async (db, bid) => (order.push("owner lock"), lockOwners(db, bid)));
    vi.spyOn(m, "getMineForShare").mockImplementation(async (db, bid, uid) => (order.push(`share ${uid === admin ? "editor" : uid}`), mine(db, bid, uid)));
    vi.spyOn(m, "getForUpdate").mockImplementation(async (db, bid, uid) => (order.push(`update ${uid === member ? "person" : uid}`), forUpdate(db, bid, uid)));
    vi.spyOn(m, "setSectionPermissions").mockImplementation(async (db, bid, uid, p) => (order.push("change"), setSections(db, bid, uid, p)));
    await as(admin).team.humans.role({ businessId, userId: member, sectionPermissions: { product: "read" } });
    expect(order).toEqual(["owner lock", "share editor", "update person", "change"]);
  });

  it("an unknown section is refused in plain words, and nothing is stored", async () => {
    const { businessId } = hz.A;
    const member = await personIn("member");
    expect(await refusal(as(hz.A.ownerId).team.humans.role({ businessId, userId: member, sectionPermissions: { money: "write" } as never }))).toEqual({ code: "BAD_REQUEST", message: expect.stringContaining("No such section: money") });
    expect(await rowOf(member)).toMatchObject({ sectionPermissions: {} });
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
    expect((await refusal(as(newcomer).invitation.accept({ confirmAdult: true, token: tokenOf(link) })))?.code).toBe("NOT_FOUND");
    expect(await rowOf(newcomer)).toBeNull();
    await repos.memberships.setSectionPermissions(hz.db, businessId, admin, { finance: "none" });
    expect(await hz.caller(null).invitation.byToken({ token: tokenOf(link) })).toMatchObject({ state: "pending" });
    expect(await as(newcomer).invitation.accept({ confirmAdult: true, token: tokenOf(link) })).toEqual({ businessId, already: false });
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
