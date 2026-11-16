/**
 * apps/sites on a real (PGlite) database, every call made as `sites_reader`: the login the service runs as is enough
 * to serve a published release, its preview, and a report, and a held release is never served.
 */
import { createHash } from "node:crypto";
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type SiteRelease } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSitesApp } from "../app";
import { sitesDeps } from "../index";

const DOMAIN = "sites.localhost";
const INDEX = "<!doctype html><html><body><h1>Alpha</h1></body></html>";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

let h: TestHarness;
let A: BusinessFixture;
let live: SiteRelease;
let held: SiteRelease;
let app: ReturnType<typeof createSitesApp>;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "sites-app-a");
  await h.db.execute(sql`insert into workspace_blobs (business_id, sha256, size_bytes, content) values (${A.businessId}, ${sha(INDEX)}, ${Buffer.byteLength(INDEX)}, ${Buffer.from(INDEX)})`);
  const files = [{ path: "index.html", sha256: sha(INDEX), size: Buffer.byteLength(INDEX) }];
  await h.service().run(async (tx) => {
    await repos.sites.ensure(tx, A.businessId, { slug: "alpha-site" });
    live = await repos.sites.saveRelease(tx, A.businessId, { files, state: "preview" });
    held = await repos.sites.saveRelease(tx, A.businessId, { files, state: "held" });
    await repos.sites.publish(tx, A.businessId, { releaseId: live.id, userId: A.ownerId });
  });
  const asReader = <T>(fn: (db: never) => Promise<T>) =>
    h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role sites_reader`);
      return fn(tx as never);
    });
  app = createSitesApp(sitesDeps({ env: { APP_ENV: "test", APP_URL: "http://localhost:3000", SITES_DOMAIN: DOMAIN, SITES_API_URL: "http://api.test", SITES_TURNSTILE_SITE_KEY: undefined }, run: asReader, log: { info: () => {}, warn: () => {} } }));
}, 120_000);
afterAll(() => h?.close());

const get = (host: string, path = "/", init: RequestInit = {}) => app.request(`http://${host}${path}`, { ...init, headers: { host, ...(init.headers as Record<string, string> | undefined) } });

describe("apps/sites as sites_reader", () => {
  it("serves the live release and its preview", async () => {
    const res = await get(`alpha-site.${DOMAIN}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Alpha</h1>");
    const preview = await get(`p-${live.previewToken}.${DOMAIN}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("never serves a held release", async () => {
    expect((await get(`p-${held.previewToken}.${DOMAIN}`)).status).toBe(404);
  });

  it("answers /health through the login", async () => {
    expect((await get("internal", "/health")).status).toBe(200);
  });

  it("records a report as one audit row on the project", async () => {
    const res = await get(`alpha-site.${DOMAIN}`, "/_fm/report", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "reason=scam&detail=fake+giveaway" });
    expect(res.status).toBe(200);
    const rows = (await h.db.execute(sql`select details from audit_log where business_id = ${A.businessId} and action = 'site.reported'`)) as unknown as { rows: { details: { reason: string } }[] };
    expect(rows.rows.map((r) => r.details.reason)).toEqual(["scam"]);
  });
});
