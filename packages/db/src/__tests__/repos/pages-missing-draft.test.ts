/**
 * `repos.pages.listMissingTeamDraft` (WP-12 T1): the projects the page catch-up covers. Committed before the cutoff,
 * real, not archived, team running, no page row at all; oldest first; `limit` respected.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
const CUTOFF = new Date("2026-11-01T12:00:00Z");
const ids: Record<string, string> = {};

async function project(key: string, committedAt: string | null, over: Partial<typeof s.businesses.$inferInsert> = {}) {
  const b = await repos.businesses.create(r.db, { name: `Missing ${key}`, archetype: "b2b_saas" });
  await r.db.update(s.businesses).set({ committedAt: committedAt ? new Date(committedAt) : null, ...over }).where(eq(s.businesses.id, b.id));
  ids[key] = b.id;
  return b.id;
}

beforeAll(async () => {
  r = await setupRepoHarness("missing-draft");
  // The harness's own businesses are out of this test's way.
  for (const id of [r.A.businessId, r.B.businessId]) await r.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, id));
  await project("oldest", "2026-10-01T00:00:00Z");
  await project("newer", "2026-10-20T00:00:00Z");
  await project("has_page", "2026-10-02T00:00:00Z");
  await repos.pages.writeTeamDraft(r.db, ids.has_page!, { draft: { pitch: "Has a page", about: "", forWhom: "", stage: "idea", showFounders: false, followForm: true }, slug: "missing-has-page", agentId: null, source: "starter", reason: null, note: null });
  await project("sample", "2026-10-03T00:00:00Z", { isDemo: true });
  await project("archived", "2026-10-04T00:00:00Z", { archivedAt: new Date("2026-10-30T00:00:00Z") });
  await project("stopped", "2026-10-05T00:00:00Z", { agentsStoppedAt: new Date("2026-10-30T00:00:00Z"), agentsStoppedReason: "kill_switch" });
  await project("uncommitted", null);
  await project("too_new", "2026-11-01T12:30:00Z");
}, 120_000);
afterAll(() => r?.close());

describe("pages.listMissingTeamDraft", () => {
  it("lists real, committed, running projects with no page, oldest first", async () => {
    expect(await r.svc((tx) => repos.pages.listMissingTeamDraft(tx, { committedBefore: CUTOFF, limit: 50 }))).toEqual([ids.oldest, ids.newer]);
  });
  it("respects the limit and the cutoff", async () => {
    expect(await r.svc((tx) => repos.pages.listMissingTeamDraft(tx, { committedBefore: CUTOFF, limit: 1 }))).toEqual([ids.oldest]);
    expect(await r.svc((tx) => repos.pages.listMissingTeamDraft(tx, { committedBefore: new Date("2026-12-01T00:00:00Z"), limit: 50 }))).toContain(ids.too_new);
    expect(await r.svc((tx) => repos.pages.listMissingTeamDraft(tx, { committedBefore: CUTOFF, limit: 0 }))).toEqual([]);
  });
});
