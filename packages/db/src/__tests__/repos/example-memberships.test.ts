/**
 * Example memberships (0065; docs/UX_AUDIT_AND_PLAN.md §12 item 5): "Explore an example" gives a founder a viewer
 * membership of a demo business that is not staff, not a seat and not a business of their own. `openExample` is
 * idempotent and refuses someone who belongs for real; `leaveExample` removes only an example row; the staff list and
 * the seat count leave example viewers out; `listSummariesForUser` marks them; `businesses.example` picks the example.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { ALREADY_A_MEMBER_OF_EXAMPLE } from "../../repos/memberships";
import { seatAllowance } from "../../tiers";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
let explorer: string;
beforeAll(async () => {
  r = await setupRepoHarness("example");
  explorer = await r.h.createUser("example-explorer@test.local");
});
afterAll(() => r?.close());

describe("memberships.openExample / leaveExample", () => {
  it("opens once, answers the same row again, and is a viewer with source example", async () => {
    const first = await repos.memberships.openExample(r.db, r.A.businessId, explorer);
    expect(first.created).toBe(true);
    expect(first.membership).toMatchObject({ businessId: r.A.businessId, userId: explorer, role: "viewer", source: "example", sectionPermissions: {} });
    const again = await repos.memberships.openExample(r.db, r.A.businessId, explorer);
    expect(again.created).toBe(false);
    expect(again.membership.id).toBe(first.membership.id);
    expect((await repos.memberships.get(r.db, r.A.businessId, explorer))?.source).toBe("example");
  });

  it("refuses someone who belongs to the business for real, and never rewrites their seat", async () => {
    await expect(repos.memberships.openExample(r.db, r.A.businessId, r.A.viewerId)).rejects.toThrow(ALREADY_A_MEMBER_OF_EXAMPLE);
    await expect(repos.memberships.openExample(r.db, r.A.businessId, r.A.ownerId)).rejects.toThrow(ALREADY_A_MEMBER_OF_EXAMPLE);
    expect((await repos.memberships.get(r.db, r.A.businessId, r.A.viewerId))).toMatchObject({ role: "viewer", source: "invite" });
    expect((await repos.memberships.get(r.db, r.A.businessId, r.A.ownerId))).toMatchObject({ role: "owner", source: "invite" });
  });

  it("is neither staff nor a seat: list and listNamed leave the example viewer out, the seat count does not move", async () => {
    const before = await seatAllowance(r.db, { id: r.A.businessId, planTier: "free" });
    expect((await repos.memberships.list(r.db, r.A.businessId)).map((m) => m.userId)).not.toContain(explorer);
    expect((await repos.memberships.list(r.db, r.A.businessId, { includeExample: true })).map((m) => m.userId)).toContain(explorer);
    expect((await repos.memberships.list(r.db, r.A.businessId, { role: "viewer" })).map((m) => m.userId)).toEqual([r.A.viewerId]);
    expect((await repos.memberships.listNamed(r.db, r.A.businessId)).map((m) => m.userId)).not.toContain(explorer);
    // Four fixture memberships (owner, admin, member, viewer): the example viewer is not a fifth.
    expect(before.used).toBe(4);
    // The row still opens the business for its holder (businessProcedure's access check).
    const access = await repos.memberships.access(r.db, r.A.businessId, explorer);
    expect(access.membership?.source).toBe("example");
    expect(access.business?.id).toBe(r.A.businessId);
  });

  it("founder.businesses.list marks the example membership; the founder's own businesses are not marked", async () => {
    const mine = await r.as(explorer, (tx) => repos.businesses.listSummariesForUser(tx, explorer));
    expect(mine).toEqual([expect.objectContaining({ id: r.A.businessId, role: "viewer", isExample: true })]);
    const owner = await r.as(r.A.ownerId, (tx) => repos.businesses.listSummariesForUser(tx, r.A.ownerId));
    expect(owner.find((b) => b.id === r.A.businessId)).toMatchObject({ role: "owner", isExample: false });
  });

  it("leaveExample removes only the caller's example row; a real seat is untouched; a second leave finds nothing", async () => {
    expect(await repos.memberships.leaveExample(r.db, r.A.businessId, r.A.viewerId)).toBeNull();
    expect(await repos.memberships.get(r.db, r.A.businessId, r.A.viewerId)).not.toBeNull();
    const gone = await repos.memberships.leaveExample(r.db, r.A.businessId, explorer);
    expect(gone?.userId).toBe(explorer);
    expect(await repos.memberships.get(r.db, r.A.businessId, explorer)).toBeNull();
    expect(await repos.memberships.leaveExample(r.db, r.A.businessId, explorer)).toBeNull();
    // Opening again writes a fresh row: nothing from the earlier walk is kept.
    const reopened = await repos.memberships.openExample(r.db, r.A.businessId, explorer);
    expect(reopened.created).toBe(true);
    expect(reopened.membership.id).not.toBe(gone!.id);
  });

  it("add never writes an example row by itself (its source is an invitation or the founder's seat)", async () => {
    const other = await r.h.createUser("example-other@test.local");
    const added = await repos.memberships.add(r.db, r.B.businessId, { userId: other, role: "member" });
    expect(added.source).toBe("invite");
    await expect(repos.memberships.add(r.db, r.B.businessId, { userId: explorer, role: "viewer", source: "example" as never })).rejects.toThrow(/Invalid membership/);
  });
});

describe("businesses.example", () => {
  it("is null without a committed demo business, prefers the given id, else the oldest demo", async () => {
    expect(await repos.businesses.example(r.db)).toBeNull();
    const older = await repos.businesses.create(r.db, { name: "Older Demo", isDemo: true, createdBy: r.A.ownerId });
    // Not committed yet: still no example.
    expect(await repos.businesses.example(r.db, { prefer: older.id })).toBeNull();
    await repos.businesses.commit(r.db, older.id, { archetype: "b2b_saas" });
    const newer = await repos.businesses.create(r.db, { name: "Newer Demo", isDemo: true, createdBy: r.A.ownerId });
    await repos.businesses.commit(r.db, newer.id, { archetype: "b2b_saas" });
    expect((await repos.businesses.example(r.db))?.id).toBe(older.id);
    expect((await repos.businesses.example(r.db, { prefer: newer.id }))?.id).toBe(newer.id);
    // A preferred id that is not a demo (or does not exist) falls back to the oldest demo.
    expect((await repos.businesses.example(r.db, { prefer: r.A.businessId }))?.id).toBe(older.id);
    // An archived demo is never the example.
    await repos.businesses.archive(r.db, older.id);
    expect((await repos.businesses.example(r.db))?.id).toBe(newer.id);
  });
});
