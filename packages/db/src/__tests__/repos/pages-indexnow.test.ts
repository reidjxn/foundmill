/**
 * `repos.pages.public.indexNowKeyBySlug`: the IndexNow key a public page's address serves at `/p/<slug>/<key>.txt`.
 * Only for a published page of a real business whose IndexNow integration is connected or degraded, not archived, and
 * whose stored config says hosted for this very slug with a well-formed key. Everything else is null.
 */
import type { ProjectPageContent } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
const KEY = "a1b2c3d4e5f6";
const KEY_B = "b9b9b9b9b9b9";
const SLUG_A = "alpha-hosted";
const SLUG_B = "bravo-hosted";

const content = (): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches.", forWhom: "People in small apartments", stage: "building", showFounders: false, followForm: true });
const config = (slug: string, key: string, over: Record<string, unknown> = {}) => ({ config: { host: "foundmill.test.app", keyLocation: `https://foundmill.test.app/p/${slug}/${key}.txt`, key, hosted: true, slug, ...over } });
const keyAt = (slug: string) => r.svc((tx) => repos.pages.public.indexNowKeyBySlug(tx, slug));

/** Writes (or rewrites) the business's one IndexNow row. */
async function setIntegration(businessId: string, over: { status?: (typeof s.integrations.$inferInsert)["status"]; settings?: Record<string, unknown>; archived?: boolean }) {
  const values = { status: over.status ?? "connected", settings: over.settings ?? {}, archivedAt: over.archived ? new Date("2026-11-01T00:00:00Z") : null };
  await r.db.insert(s.integrations).values({ businessId, connectorKey: "indexnow", authKind: "api_key", ...values }).onConflictDoUpdate({ target: [s.integrations.businessId, s.integrations.connectorKey], set: values });
}

beforeAll(async () => {
  r = await setupRepoHarness("indexnow");
  for (const id of [r.A.businessId, r.B.businessId]) await r.db.update(s.businesses).set({ committedAt: new Date("2026-10-01T00:00:00Z") }).where(eq(s.businesses.id, id));
  await r.svc((tx) => repos.pages.publish(tx, r.A.businessId, { content: content(), slug: SLUG_A, userId: r.A.ownerId }));
  await r.svc((tx) => repos.pages.publish(tx, r.B.businessId, { content: content(), slug: SLUG_B, userId: r.B.ownerId }));
}, 120_000);
afterAll(() => r?.close());

describe("pages.public.indexNowKeyBySlug", () => {
  it("is null while the business has no IndexNow integration", async () => {
    expect(await keyAt(SLUG_A)).toBeNull();
  });

  it("returns the key for a published page with a connected or degraded hosted integration", async () => {
    await setIntegration(r.A.businessId, { settings: config(SLUG_A, KEY) });
    expect(await keyAt(SLUG_A)).toBe(KEY);
    await setIntegration(r.A.businessId, { status: "degraded", settings: config(SLUG_A, KEY) });
    expect(await keyAt(SLUG_A)).toBe(KEY);
  });

  it("is null for a disconnected, expired, mock or archived integration", async () => {
    for (const status of ["disconnected", "expired", "mock"] as const) {
      await setIntegration(r.A.businessId, { status, settings: config(SLUG_A, KEY) });
      expect(await keyAt(SLUG_A), status).toBeNull();
    }
    await setIntegration(r.A.businessId, { archived: true, settings: config(SLUG_A, KEY) });
    expect(await keyAt(SLUG_A)).toBeNull();
  });

  it("is null unless the config says hosted for this slug with a well-formed key", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["hosted missing", { config: { key: KEY, slug: SLUG_A } }],
      ["hosted false", config(SLUG_A, KEY, { hosted: false })],
      ["hosted as a string", config(SLUG_A, KEY, { hosted: "true" })],
      ["slug mismatch", config("someone-else", KEY)],
      ["slug missing", config(SLUG_A, KEY, { slug: undefined })],
      ["key too short", config(SLUG_A, "short")],
      ["key with a path in it", config(SLUG_A, "../../etc/passwd")],
      ["key not a string", config(SLUG_A, KEY, { key: 12345678 })],
      ["no config", {}],
    ];
    for (const [label, settings] of cases) {
      await setIntegration(r.A.businessId, { settings });
      expect(await keyAt(SLUG_A), label).toBeNull();
    }
  });

  it("is null for a page that is not published, and again once it is back up", async () => {
    await setIntegration(r.A.businessId, { settings: config(SLUG_A, KEY) });
    expect(await keyAt(SLUG_A)).toBe(KEY);
    await r.svc((tx) => repos.pages.unpublish(tx, r.A.businessId, { userId: r.A.ownerId }));
    expect(await keyAt(SLUG_A)).toBeNull();
    await r.svc((tx) => repos.pages.publish(tx, r.A.businessId, { content: content(), slug: SLUG_A, userId: r.A.ownerId }));
    expect(await keyAt(SLUG_A)).toBe(KEY);
  });

  it("is null for a slug that is malformed or unknown", async () => {
    for (const slug of ["", "x", "No Such Page", "../etc", "no-such-page"]) expect(await keyAt(slug), slug).toBeNull();
  });

  it("never serves one business's key at another business's address", async () => {
    await setIntegration(r.A.businessId, { settings: config(SLUG_A, KEY) });
    await setIntegration(r.B.businessId, { settings: config(SLUG_B, KEY_B) });
    expect(await keyAt(SLUG_A)).toBe(KEY);
    expect(await keyAt(SLUG_B)).toBe(KEY_B);
    // B's integration claiming A's address does not leak B's key there, and A's key is never read at B's.
    await setIntegration(r.B.businessId, { settings: config(SLUG_A, KEY_B) });
    expect(await keyAt(SLUG_A)).toBe(KEY);
    expect(await keyAt(SLUG_B)).toBeNull();
    // A config copied from A onto B's row is refused at B's address (slug mismatch).
    await setIntegration(r.B.businessId, { settings: config(SLUG_A, KEY) });
    expect(await keyAt(SLUG_B)).toBeNull();
    // B without an integration at all gets nothing, whatever A holds.
    await r.db.delete(s.integrations).where(sql`business_id = ${r.B.businessId} and connector_key = 'indexnow'`);
    expect(await keyAt(SLUG_B)).toBeNull();
  });

  it("is null for a sample business", async () => {
    await setIntegration(r.B.businessId, { settings: config(SLUG_B, KEY_B) });
    expect(await keyAt(SLUG_B)).toBe(KEY_B);
    // A sample business never publishes, so a page that was live before the flag still reads as not public.
    await r.db.update(s.businesses).set({ isDemo: true }).where(eq(s.businesses.id, r.B.businessId));
    expect(await keyAt(SLUG_B)).toBeNull();
  });
});
