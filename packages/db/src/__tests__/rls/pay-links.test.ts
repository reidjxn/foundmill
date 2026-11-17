/**
 * 0131 `pay_links` (WP-07 T7). The generated suite (`tables.ts`) covers tenancy and the owner-or-admin write; this
 * file covers `site_pay_link`, the one way apps/sites reaches a link: only a live site's or a servable preview's own
 * business, never an archived, simulated, taken-down or other business's link, and the URL check.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let C: BusinessFixture;
let aPreviewToken: string;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const entry = (text: string) => ({ path: "index.html", sha256: sha(text), size: Buffer.byteLength(text) });
const link = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, url: `https://buy.stripe.com/${key.replace(/-/g, "_")}`, ...extra });
const pay = (label: string, key: string) => h.service().run((tx) => repos.payLinks.forSite(tx, label, key));

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "pay-a");
  B = await createBusinessFixture(h, "pay-b");
  C = await createBusinessFixture(h, "pay-c");
  await h.service().run(async (tx) => {
    // A: a draft site with a preview. B: a live site. C: a live site the platform takes down.
    await repos.sites.ensure(tx, A.businessId, { slug: "alpha-pay" });
    await repos.sites.ensure(tx, B.businessId, { slug: "beta-pay" });
    await repos.sites.ensure(tx, C.businessId, { slug: "gamma-pay" });
    aPreviewToken = (await repos.sites.saveRelease(tx, A.businessId, { files: [entry("a")], state: "preview" })).previewToken;
    const b = await repos.sites.saveRelease(tx, B.businessId, { files: [entry("b")], state: "preview" });
    const c = await repos.sites.saveRelease(tx, C.businessId, { files: [entry("c")], state: "preview" });
    await repos.sites.publish(tx, B.businessId, { releaseId: b.id, userId: B.ownerId });
    await repos.sites.publish(tx, C.businessId, { releaseId: c.id, userId: C.ownerId });
    await repos.payLinks.add(tx, A.businessId, link("a-only"));
    await repos.payLinks.add(tx, B.businessId, link("starter"));
    await repos.payLinks.add(tx, B.businessId, link("sim", { simulated: true, source: "stripe" }));
    const old = await repos.payLinks.add(tx, B.businessId, link("old"));
    await repos.payLinks.archive(tx, B.businessId, old.id);
    await repos.payLinks.add(tx, C.businessId, link("starter"));
  });
  await h.service().execute(sql`update sites set status = 'taken_down', taken_down_reason = 'scam' where business_id = ${C.businessId}`);
});

afterAll(() => h?.close());

describe("site_pay_link", () => {
  it("answers a live site's own link", async () => {
    expect(await pay("beta-pay", "starter")).toBe("https://buy.stripe.com/starter");
    expect(await pay("BETA-PAY", "starter")).toBe("https://buy.stripe.com/starter");
  });

  it("answers a servable preview's own link, so the founder can try the button", async () => {
    expect(await pay(`p-${aPreviewToken}`, "a-only")).toBe("https://buy.stripe.com/a_only");
  });

  it("never another business's, an archived, a simulated or an unknown link", async () => {
    expect(await pay("beta-pay", "a-only")).toBeNull();
    expect(await pay(`p-${aPreviewToken}`, "starter")).toBeNull();
    expect(await pay("beta-pay", "old")).toBeNull();
    expect(await pay("beta-pay", "sim")).toBeNull();
    expect(await pay("beta-pay", "nothing")).toBeNull();
  });

  it("never a draft site's (by its slug) or a taken-down site's", async () => {
    expect(await pay("alpha-pay", "a-only")).toBeNull();
    expect(await pay("gamma-pay", "starter")).toBeNull();
    expect(await pay(`p-${"0".repeat(32)}`, "starter")).toBeNull();
  });

  it("sites_reader may call it and reads no pay_links row", async (ctx) => {
    const [{ ok } = { ok: false }] = ((await h.db.execute(sql`select pg_has_role(current_user, 'sites_reader', 'member') as ok`)) as unknown as { rows: { ok: boolean }[] }).rows;
    if (!ok) ctx.skip();
    const asReader = (q: ReturnType<typeof sql>) =>
      h.db.transaction(async (tx) => {
        await tx.execute(sql`set local role sites_reader`);
        return (await tx.execute(q)) as unknown as { rows: Record<string, unknown>[] };
      });
    expect((await asReader(sql`select site_pay_link('beta-pay', 'starter') as url`)).rows).toEqual([{ url: "https://buy.stripe.com/starter" }]);
    await expect(asReader(sql`select * from pay_links`)).rejects.toThrow();
  });

  it("is not callable by app roles", async () => {
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`select site_pay_link('beta-pay', 'starter')`))).rejects.toThrow(/permission denied/);
  });
});

describe("pay_links writes", () => {
  it("a member reads but cannot add; an owner adds; a URL off buy.stripe.com is refused by the database", async () => {
    expect((await h.asUser(B.memberId).run((tx) => tx.select().from(s.payLinks))).map((r) => r.businessId)).toContain(B.businessId);
    await expect(h.asUser(B.memberId).run((tx) => repos.payLinks.add(tx, B.businessId, link("member-try")))).rejects.toThrow(RLS_DENIED);
    expect((await h.asUser(B.ownerId).run((tx) => repos.payLinks.add(tx, B.businessId, link("owner-add")))).key).toBe("owner-add");
    for (const url of ["http://buy.stripe.com/x", "https://evil.example/x", "https://buy.stripe.com.evil.example/x", "https://u@buy.stripe.com/x", "https://buy.stripe.com/x?y=1"]) {
      await expect(h.asUser(B.ownerId).run((tx) => repos.payLinks.add(tx, B.businessId, { ...link("bad-url"), url })), url).rejects.toThrow();
    }
  });

  it("no owner changes where a link sends people, fakes a team-made or simulated link, or deletes one; archiving is all", async () => {
    const [mine] = await h.asUser(B.ownerId).run((tx) => tx.select().from(s.payLinks).where(sql`key = 'starter'`));
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`update pay_links set url = 'https://buy.stripe.com/attacker' where id = ${mine!.id}`))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`update pay_links set simulated = true where id = ${mine!.id}`))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`update pay_links set key = 'other-key' where id = ${mine!.id}`))).rejects.toThrow(RLS_DENIED);
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`delete from pay_links where id = ${mine!.id}`))).rejects.toThrow(RLS_DENIED);
    const [sim] = await h.service().run((tx) => tx.select().from(s.payLinks).where(sql`key = 'sim'`));
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`update pay_links set archived_at = now() where id = ${sim!.id}`))).resolves.toBeDefined();
    for (const extra of [{ simulated: true }, { source: "stripe" }, { providerLinkId: "plink_x" }]) {
      await expect(h.asUser(B.ownerId).run((tx) => repos.payLinks.add(tx, B.businessId, link(`fake-${Object.keys(extra)[0]!.toLowerCase()}`, extra))), JSON.stringify(extra)).rejects.toThrow(RLS_DENIED);
    }
    // An archived link stays archived: no app role brings it back.
    await expect(h.asUser(B.ownerId).run((tx) => tx.execute(sql`update pay_links set archived_at = null where id = ${sim!.id}`))).resolves.toBeDefined();
    expect((await h.service().run((tx) => tx.select().from(s.payLinks).where(sql`key = 'sim'`)))[0]!.archivedAt).not.toBeNull();
    expect((await h.service().run((tx) => tx.select().from(s.payLinks).where(sql`key = 'starter'`)))[0]!.url).toBe("https://buy.stripe.com/starter");
  });

  it("an owner of B cannot add a link to A", async () => {
    await expect(h.asUser(B.ownerId).run((tx) => repos.payLinks.add(tx, A.businessId, link("cross")))).rejects.toThrow(RLS_DENIED);
    expect(await h.asUser(B.ownerId).run((tx) => repos.payLinks.archive(tx, A.businessId, crypto.randomUUID()))).toBeNull();
  });
});
