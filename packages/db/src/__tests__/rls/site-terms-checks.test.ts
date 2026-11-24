/**
 * 0174 `site_terms_checks`: the platform-wide terms check of a website, one row per host, fresh for 30 days. A
 * platform table: no app role reads or writes it; only the service connection does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
const day = 86_400_000;
const check = { host: "shop.example.com", verdict: "unclear", line: null, termsUrl: "https://shop.example.com/terms", signInHosts: ["accounts.example.com"], simulated: false } as const;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "terms-a");
});
afterAll(async () => {
  await h?.close();
});

describe("site_terms_checks", () => {
  it("is fresh for 30 days, replaced by the next check, and never crosses the live and simulated modes", async () => {
    const t0 = new Date("2026-11-24T10:00:00Z");
    await h.service().run((tx) => repos.siteTermsChecks.put(tx, check, t0));
    const get = (simulated: boolean, at: Date) => h.service().run((tx) => repos.siteTermsChecks.get(tx, "SHOP.example.com", { simulated, now: at }));
    expect((await get(false, new Date(t0.getTime() + 29 * day)))?.verdict).toBe("unclear");
    expect(await get(false, new Date(t0.getTime() + 31 * day))).toBeNull();
    expect(await get(true, t0)).toBeNull();
    // A host has one row per mode: a mock answer neither replaces nor hides the live one.
    await h.service().run((tx) => repos.siteTermsChecks.put(tx, { ...check, verdict: "allows", simulated: true }, t0));
    expect((await get(true, t0))?.verdict).toBe("allows");
    expect((await get(false, t0))?.verdict).toBe("unclear");
    expect(await h.service().run((tx) => tx.select().from(s.siteTermsChecks))).toHaveLength(2);
    await h.service().run((tx) => repos.siteTermsChecks.put(tx, { ...check, verdict: "forbids", line: "No bots." }, new Date(t0.getTime() + 40 * day)));
    expect(await h.service().run((tx) => tx.select().from(s.siteTermsChecks))).toHaveLength(2);
    expect((await get(false, new Date(t0.getTime() + 41 * day)))?.line).toBe("No bots.");
  });

  it("keeps the category that made a site a never site, and refuses one that is not a category", async () => {
    const row = await h.service().run((tx) => repos.siteTermsChecks.put(tx, { host: "bank-like.example.com", verdict: "forbids", line: null, termsUrl: null, signInHosts: [], simulated: false, neverCategory: "payment" }));
    expect(row.neverCategory).toBe("payment");
    await expect(h.pg.query("insert into site_terms_checks (host, verdict, never_category) values ('x.example.com', 'forbids', 'shop')")).rejects.toThrow();
  });

  it("no app role reads or writes it", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect(await h.asUser(userId).run((tx) => tx.select().from(s.siteTermsChecks)).catch(() => [])).toEqual([]);
      await expect(h.asUser(userId).run((tx) => tx.insert(s.siteTermsChecks).values({ host: "evil.example.com", verdict: "allows" }))).rejects.toThrow(RLS_DENIED);
    }
    expect(await h.anon().run((tx) => tx.select().from(s.siteTermsChecks)).catch(() => [])).toEqual([]);
  });
});
