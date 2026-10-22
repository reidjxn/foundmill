/**
 * Example memberships on the network and in the archive (0065; docs/UX_AUDIT_AND_PLAN.md §12 item 5): an example
 * membership is a read-only walk around a demo business, not belonging to it. So it never lifts the demo onto the
 * network for its holder (`demoBusinessesHiddenFrom`), never makes the demo "one of the viewer's businesses" in
 * `lookupPeople`, never answers for a listed business's owner, and never travels in the business's Export everything
 * archive. A real seat still does all of these.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
let explorer: string;
beforeAll(async () => {
  r = await setupRepoHarness("exnet");
  explorer = await r.h.createUser("example-network@test.local");
  // A is the demo the explorer walks around; B stays an ordinary business.
  await r.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, r.A.businessId));
  await repos.memberships.openExample(r.db, r.A.businessId, explorer);
});
afterAll(() => r?.close());

describe("example memberships on the network", () => {
  it("keeps the demo hidden from its example viewer, as from any outsider; a real member still sees it", async () => {
    expect([...(await repos.social.demoBusinessesHiddenFrom(r.db, explorer, [r.A.businessId, r.B.businessId]))]).toEqual([r.A.businessId]);
    expect([...(await repos.social.demoBusinessesHiddenFrom(r.db, r.A.viewerId, [r.A.businessId]))]).toEqual([]);
  });

  it("does not count the demo as one of the example viewer's own businesses in lookupPeople", async () => {
    // Uncommitted, so no public profile answers for it: only a real membership would.
    await r.db.update(s.businesses).set({ committedAt: null }).where(eq(s.businesses.id, r.A.businessId));
    const asExplorer = await repos.social.lookupPeople(r.db, explorer, { businessIds: [r.A.businessId] });
    expect(asExplorer.businesses).toEqual([]);
    const asMember = await repos.social.lookupPeople(r.db, r.A.memberId, { businessIds: [r.A.businessId] });
    expect(asMember.businesses.map((b) => b.businessId)).toEqual([r.A.businessId]);
  });

  it("answers a listed business's owner from its real seats, never from an example row", async () => {
    // B listed (LIVE, committed) with an example visitor beside its real owner. An example row is a viewer by check
    // (0065 memberships_example_is_viewer); the source filter in listedBusinessOwner is the second lock.
    await r.db.update(s.businesses).set({ gameMode: "live", committedAt: new Date() }).where(eq(s.businesses.id, r.B.businessId));
    await repos.memberships.openExample(r.db, r.B.businessId, explorer);
    expect(await repos.social.listedBusinessOwner(r.db, r.B.businessId)).toBe(r.B.ownerId);
  });
});

describe("example memberships in Export everything", () => {
  it("leaves the example row out of the memberships table; the real seats stay", async () => {
    const page = await repos.portability.page(r.db, r.A.businessId, "memberships", { limit: 500 });
    const users = page.rows.map((m) => m.userId);
    expect(users).not.toContain(explorer);
    expect(users).toEqual(expect.arrayContaining([r.A.ownerId, r.A.adminId, r.A.memberId, r.A.viewerId]));
    expect(page.rows.every((m) => Object.keys(m).sort().join() === "createdAt,id,role,userId")).toBe(true);
  });
});
