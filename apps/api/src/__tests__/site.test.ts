/**
 * site.* (WP-07 T5; services/sites.ts): the Site tab's view, Publish, Take down and the address. A member without
 * Product write cannot publish; an admin publishes and `site.published` and `deploy.succeeded` go through the outbox; a
 * held release is refused with its flags; the 21st publish of a day is refused; a sample business is refused; no agent
 * capability reaches these procedures; with SITES_DOMAIN unset the view says `enabled: false`.
 */
import { CAPABILITY_TOOLS } from "@foundmill/connectors";
import { repos, type SiteRelease } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SITE_PUBLISH_LIMIT_MESSAGE, SITE_PUBLISH_ROLE_MESSAGE } from "../services/sites";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let off: ApiHarness;
beforeAll(async () => {
  [hz, off] = await Promise.all([createApiHarness({ prefix: "site", env: { SITES_DOMAIN: "sites.localhost" } }), createApiHarness({ prefix: "site-off" })]);
}, 180_000);
afterAll(async () => {
  await hz?.close();
  await off?.close();
});

const FILE = { path: "index.html", sha256: "a".repeat(64), size: 10 };
let n = 0;
async function project(harness: ApiHarness, options: { demo?: boolean; site?: boolean } = {}) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => harness.h.createUser(`site-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(harness.db, { name: `Lunchbox ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(harness.db, b.id, { archetype: "b2b_saas" });
  if (options.demo) await harness.db.execute(sql`update businesses set is_demo = true where id = ${b.id}`);
  await repos.memberships.add(harness.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(harness.db, b.id, { userId: memberId!, role: "member" });
  let preview: SiteRelease | null = null;
  let held: SiteRelease | null = null;
  if (options.site !== false) {
    await repos.sites.ensure(harness.db, b.id, { slug: `lunchbox-${n}` });
    preview = await repos.sites.saveRelease(harness.db, b.id, { files: [FILE], state: "preview" });
    held = await repos.sites.saveRelease(harness.db, b.id, { files: [FILE], state: "held", screening: { flags: [{ rule: "script", path: "index.html", detail: "<script>" }] } });
  }
  return { id: b.id, owner: harness.caller({ userId: ownerId! }), member: harness.caller({ userId: memberId! }), preview: preview!, held: held! };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string; message?: string }) => `${err.code}: ${err.message}`);
const siteEvents = async (businessId: string) =>
  (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type.startsWith("site.") || o.event.type === "deploy.succeeded").map((o) => ({ type: o.event.type, payload: o.event.payload }));

describe("site.get", () => {
  it("shows the site, its releases and their preview links, and a held release in plain words", async () => {
    const p = await project(hz);
    const view = await p.owner.site.get({ businessId: p.id });
    expect(view.enabled).toBe(true);
    expect(view.canPublish).toBe(true);
    expect(view.site).toMatchObject({ status: "draft", url: `http://lunchbox-${n}.sites.localhost/`, liveReleaseNumber: null });
    expect(view.releases.map((r) => [r.number, r.state, r.previewUrl !== null])).toEqual([[2, "held", false], [1, "preview", true]]);
    expect(view.releases[0]!.heldSentence).toBe("Held back: it contains a script. The next round of work fixes it.");
    expect(view.releases[1]!.previewUrl).toBe(`http://p-${p.preview.previewToken}.sites.localhost/`);
  });

  it("adds the Product › Site tab when the site is created, once, and no tab without a site", async () => {
    const p = await project(hz, { site: false });
    const dept = await repos.departments.create(hz.db, p.id, { name: "Product", moduleKeys: ["product"] });
    const siteTabs = async () => (await repos.screens.list(hz.db, p.id, dept.id)).filter((t) => t.tabSlug === "site");
    expect(await siteTabs()).toEqual([]);
    await repos.sites.ensure(hz.db, p.id, { slug: `tab-${n}` });
    await repos.sites.ensure(hz.db, p.id, { slug: `tab-${n}` });
    expect((await siteTabs()).map((t) => [t.title, (t.layout as { widgets: { key: string }[] }).widgets[0]!.key])).toEqual([["Site", "module:product/site"]]);
  });

  it("is off, with nothing in it, while SITES_DOMAIN is unset", async () => {
    const p = await project(off, { site: false });
    expect(await p.owner.site.get({ businessId: p.id })).toEqual({ enabled: false, site: null, releases: [], canPublish: false });
    expect(await code(p.owner.site.unpublish({ businessId: p.id }))).toMatch(/^NOT_FOUND|sites_off/);
  });

  it("never shows another business's site", async () => {
    const a = await project(hz);
    const b = await project(hz);
    expect(await code(a.owner.site.get({ businessId: b.id }))).toMatch(/^FORBIDDEN|NOT_FOUND/);
  });
});

describe("site.publish", () => {
  it("is refused to a member without the admin role", async () => {
    const p = await project(hz);
    expect(await code(p.member.site.publish({ businessId: p.id, releaseId: p.preview.id }))).toMatch(/^FORBIDDEN/);
    expect(SITE_PUBLISH_ROLE_MESSAGE).toMatch(/owner or an admin/);
  });

  it("publishes a preview: site.published and deploy.succeeded through the outbox, audited", async () => {
    const p = await project(hz);
    const res = await p.owner.site.publish({ businessId: p.id, releaseId: p.preview.id });
    expect(res.outcome).toBe("published");
    if (res.outcome !== "published") return;
    expect(res.url).toBe(`http://lunchbox-${n}.sites.localhost/`);
    expect(res.view.site).toMatchObject({ status: "live", liveReleaseNumber: 1 });
    const events = await siteEvents(p.id);
    expect(events.map((e) => e.type)).toEqual(["site.published", "deploy.succeeded"]);
    expect(events[1]!.payload).toMatchObject({ environment: "production", provider: "foundmill", url: res.url, commitSha: p.preview.contentHash });
    const audits = (await hz.db.execute(sql`select action from audit_log where business_id = ${p.id} and action = 'site.published'`)) as unknown as { rows: unknown[] };
    expect(audits.rows).toHaveLength(1);
    // Take down: site.unpublished by the founder.
    const view = await p.owner.site.unpublish({ businessId: p.id });
    expect(view.site?.status).toBe("draft");
    expect((await siteEvents(p.id)).at(-1)).toMatchObject({ type: "site.unpublished", payload: { by: "founder" } });
  });

  it("refuses a held release with its flags, and another business's release", async () => {
    const p = await project(hz);
    const other = await project(hz);
    const res = await p.owner.site.publish({ businessId: p.id, releaseId: p.held.id });
    expect(res).toMatchObject({ outcome: "held", flags: [{ rule: "script" }] });
    expect(await code(p.owner.site.publish({ businessId: p.id, releaseId: other.preview.id }))).toMatch(/^BAD_REQUEST/);
    expect(await siteEvents(p.id)).toEqual([]);
  });

  it("refuses the 21st publish of a day", async () => {
    const p = await project(hz);
    for (let i = 0; i < 20; i++) expect((await p.owner.site.publish({ businessId: p.id, releaseId: p.preview.id })).outcome).toBe("published");
    expect(await code(p.owner.site.publish({ businessId: p.id, releaseId: p.preview.id }))).toBe(`BAD_REQUEST: ${SITE_PUBLISH_LIMIT_MESSAGE}`);
  }, 60_000);

  it("refuses a taken-down site, and offers no Publish on it", async () => {
    const p = await project(hz);
    await hz.db.execute(sql`update sites set status = 'taken_down', taken_down_reason = 'test' where business_id = ${p.id}`);
    expect(await code(p.owner.site.publish({ businessId: p.id, releaseId: p.preview.id }))).toMatch(/taken down/);
    expect((await p.owner.site.get({ businessId: p.id })).canPublish).toBe(false);
  });

  it("refuses a sample business", async () => {
    const p = await project(hz, { demo: true });
    expect(await code(p.owner.site.publish({ businessId: p.id, releaseId: p.preview.id }))).toMatch(/sample business/);
  });
});

describe("site.setSlug", () => {
  it("moves the address, refuses a reserved word and a taken address", async () => {
    const a = await project(hz);
    const b = await project(hz);
    const view = await a.owner.site.setSlug({ businessId: a.id, slug: "fresh-lunches" });
    expect(view.site?.slug).toBe("fresh-lunches");
    expect(await code(a.owner.site.setSlug({ businessId: a.id, slug: "status" }))).toMatch(/^BAD_REQUEST/);
    expect(await code(b.owner.site.setSlug({ businessId: b.id, slug: "fresh-lunches" }))).toMatch(/^CONFLICT/);
    expect(await code(a.member.site.setSlug({ businessId: a.id, slug: "other-name" }))).toMatch(/^FORBIDDEN/);
  });
});

describe("no agent capability reaches the site procedures", () => {
  it("names no site tool in any connector's capability map", () => {
    const names = Object.values(CAPABILITY_TOOLS).flatMap((m) => Object.entries(m as Record<string, readonly string[]>).flatMap(([cap, tools]) => [cap, ...tools]));
    expect(names.filter((x) => /^site[._]|publish_site|site\.publish/.test(x))).toEqual([]);
  });
});
