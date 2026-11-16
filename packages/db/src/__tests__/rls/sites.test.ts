/**
 * 0124 `sites` and `site_releases` (WP-07 T2). Not in the generated suite (one site per business, and a release needs
 * that site), so this file covers their tenancy, the founder's press (`sites_publish`, `site_releases_publish` and the
 * column grants), the same-business triggers, `site_resolve` and `site_file`, and the `sites_reader` login.
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { siteContentHash } from "../../repos/sites";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
/** C's site is taken down by the platform. */
let C: BusinessFixture;
let collaboratorId: string;
let outsiderId: string;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const INDEX_A = "<h1>A</h1>";
const ONLY_B = "<h1>only B</h1>";
const entry = (path: string, text: string) => ({ path, sha256: sha(text), size: Buffer.byteLength(text) });

/** A's releases: preview r1, held r2, preview r3. B: preview r1 (it also lists A's index blob, which B lacks). */
let aPreview: s.SiteRelease;
let aHeld: s.SiteRelease;
let aPreview2: s.SiteRelease;
let bPreview: s.SiteRelease;
let cPreview: s.SiteRelease;

const blob = (businessId: string, text: string) =>
  h.db.execute(sql`insert into workspace_blobs (business_id, sha256, size_bytes, content) values (${businessId}, ${sha(text)}, ${Buffer.byteLength(text)}, ${Buffer.from(text)})`);

/**
 * Whether this connection may `set role sites_reader`. PGlite's user is a superuser. On real Postgres (16+) the role's
 * creator holds ADMIN on it but not SET, so the test grants itself membership first; where even that is refused the
 * login tests skip rather than fail.
 */
async function canBecomeReader(): Promise<boolean> {
  const may = async () => ((await h.db.execute(sql`select pg_has_role(current_user, 'sites_reader', 'set') as ok`)) as unknown as { rows: { ok: boolean }[] }).rows[0]?.ok === true;
  if (await may()) return true;
  try {
    await h.db.execute(sql.raw("grant sites_reader to current_user"));
  } catch {
    return false;
  }
  return may();
}

/** Every message in a rejected promise's cause chain, joined ("" when it resolved). */
async function causes(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (err) {
    const out: string[] = [];
    for (let c: unknown = err; c; c = (c as { cause?: unknown }).cause) out.push((c as Error).message);
    return out.join(" | ");
  }
}

const siteOf = async (businessId: string) => (await h.service().run((tx) => repos.sites.get(tx, businessId)))!;
const resolve = (label: string) => h.service().run((tx) => repos.sites.resolveHost(tx, label));

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "sites-a");
  B = await createBusinessFixture(h, "sites-b");
  C = await createBusinessFixture(h, "sites-c");
  [collaboratorId, outsiderId] = await Promise.all([h.createUser("sites-collaborator@test.local"), h.createUser("sites-outsider@test.local")]);
  await h.db.execute(sql`insert into memberships (business_id, user_id, role, expires_at) values (${A.businessId}, ${collaboratorId}, 'collaborator', now() + interval '14 days')`);
  await blob(A.businessId, INDEX_A);
  await blob(B.businessId, ONLY_B);
  await h.service().run(async (tx) => {
    await repos.sites.ensure(tx, A.businessId, { slug: "alpha-site" });
    await repos.sites.ensure(tx, B.businessId, { slug: "beta-site" });
    await repos.sites.ensure(tx, C.businessId, { slug: "gamma-site" });
    aPreview = await repos.sites.saveRelease(tx, A.businessId, { files: [entry("index.html", INDEX_A)], state: "preview", taskId: A.taskId, sessionId: crypto.randomUUID() });
    aHeld = await repos.sites.saveRelease(tx, A.businessId, { files: [entry("index.html", INDEX_A)], state: "held", screening: { flags: ["script"] } });
    // Lists B's blob under A's release: site_file must never hand B's bytes to A.
    aPreview2 = await repos.sites.saveRelease(tx, A.businessId, { files: [entry("index.html", INDEX_A), entry("b.html", ONLY_B)], state: "preview", parentReleaseId: aPreview.id });
    bPreview = await repos.sites.saveRelease(tx, B.businessId, { files: [entry("index.html", ONLY_B), entry("a.html", INDEX_A)], state: "preview" });
    cPreview = await repos.sites.saveRelease(tx, C.businessId, { files: [entry("index.html", INDEX_A)], state: "preview" });
    await repos.sites.publish(tx, B.businessId, { releaseId: bPreview.id, userId: B.ownerId });
    await repos.sites.publish(tx, C.businessId, { releaseId: cPreview.id, userId: C.ownerId });
  });
  // The platform takes C down (service role, one statement).
  await h.service().execute(sql`update sites set status = 'taken_down', taken_down_reason = 'phishing' where business_id = ${C.businessId}`);
}, 120_000);
afterAll(() => h?.close());

describe("sites: tenancy", () => {
  it("a member, a viewer and a collaborator of A read A's site and releases and none of B's", async () => {
    for (const userId of [A.ownerId, A.memberId, A.viewerId, collaboratorId]) {
      const siteRows = await h.asUser(userId).run((tx) => tx.select().from(s.sites));
      expect(siteRows.map((r) => r.businessId), userId).toEqual([A.businessId]);
      const releaseRows = await h.asUser(userId).run((tx) => tx.select().from(s.siteReleases));
      expect(new Set(releaseRows.map((r) => r.businessId)), userId).toEqual(new Set([A.businessId]));
      expect(releaseRows).toHaveLength(3);
    }
  });

  it("a non-member and anon see nothing", async () => {
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.sites))).toEqual([]);
    expect(await h.asUser(outsiderId).run((tx) => tx.select().from(s.siteReleases))).toEqual([]);
    await expect(h.anon().run((tx) => tx.select().from(s.sites))).rejects.toThrow(RLS_DENIED);
    await expect(h.anon().run((tx) => tx.select().from(s.siteReleases))).rejects.toThrow(RLS_DENIED);
  });

  it("no member, owner included, inserts a site or a release, or deletes one", async () => {
    const site = await siteOf(A.businessId);
    for (const userId of [A.ownerId, A.adminId, A.memberId]) {
      await expect(h.asUser(userId).run((tx) => repos.sites.saveRelease(tx, A.businessId, { files: [entry("index.html", INDEX_A)], state: "preview" }))).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(userId).run((tx) => tx.insert(s.sites).values({ businessId: A.businessId, slug: "alpha-two" }))).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(userId).run((tx) => tx.delete(s.siteReleases).where(eq(s.siteReleases.id, aPreview.id)))).rejects.toThrow(RLS_DENIED);
      await expect(h.asUser(userId).run((tx) => tx.delete(s.sites).where(eq(s.sites.id, site.id)))).rejects.toThrow(RLS_DENIED);
    }
    expect(await h.asUser(A.ownerId).run((tx) => repos.sites.listReleases(tx, A.businessId))).toHaveLength(3);
  });

  it("a release of one business never sits on another business's site, whoever writes", async () => {
    const bSite = await siteOf(B.businessId);
    const row = { businessId: A.businessId, siteId: bSite.id, number: 99, files: [], contentHash: sha("x"), state: "preview" as const, previewToken: "f".repeat(32) };
    expect(await causes(h.service().run((tx) => tx.insert(s.siteReleases).values(row)))).toMatch(/own business/);
    expect(await causes(h.db.insert(s.siteReleases).values(row))).toMatch(/own business/);
    expect(await causes(h.service().run((tx) => tx.update(s.sites).set({ liveReleaseId: bPreview.id }).where(eq(s.sites.businessId, A.businessId))))).toMatch(/own business/);
  });
});

describe("sites: the founder's press", () => {
  it("an owner cannot point the site at a held release, nor at B's release", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => repos.sites.publish(tx, A.businessId, { releaseId: aHeld.id, userId: A.ownerId }))).rejects.toThrow(/not a preview/);
    expect(await causes(h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set({ status: "live", liveReleaseId: aHeld.id }).where(eq(s.sites.businessId, A.businessId))))).toMatch(RLS_DENIED);
    expect(await causes(h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set({ status: "live", liveReleaseId: bPreview.id }).where(eq(s.sites.businessId, A.businessId))))).not.toBe("");
    await expect(h.asUser(A.ownerId).run((tx) => repos.sites.publish(tx, A.businessId, { releaseId: bPreview.id, userId: A.ownerId }))).rejects.toThrow(/not a preview/);
    expect((await siteOf(A.businessId)).status).toBe("draft");
  });

  it("an owner cannot touch B's site", async () => {
    const changed = await h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set({ status: "draft", liveReleaseId: null }).where(eq(s.sites.businessId, B.businessId)).returning());
    expect(changed).toEqual([]);
    await expect(h.asUser(A.ownerId).run((tx) => repos.sites.unpublish(tx, B.businessId))).rejects.toThrow(/not yours/);
    expect((await siteOf(B.businessId)).status).toBe("live");
  });

  it("a plain member, a viewer and a collaborator cannot publish; an admin and an owner can, stamped with their own name", async () => {
    for (const userId of [A.memberId, A.viewerId, collaboratorId]) {
      await expect(h.asUser(userId).run((tx) => repos.sites.publish(tx, A.businessId, { releaseId: aPreview.id, userId })), userId).rejects.toThrow();
    }
    expect((await siteOf(A.businessId)).status).toBe("draft");
    const { site, release } = await h.asUser(A.adminId).run((tx) => repos.sites.publish(tx, A.businessId, { releaseId: aPreview.id, userId: A.adminId }));
    expect([site.status, site.liveReleaseId, release.publishedBy]).toEqual(["live", aPreview.id, A.adminId]);
    expect(release.publishedAt).toBeInstanceOf(Date);
    // Never in someone else's name.
    await expect(h.asUser(A.ownerId).run((tx) => repos.sites.publish(tx, A.businessId, { releaseId: aPreview2.id, userId: A.adminId }))).rejects.toThrow(RLS_DENIED);
    const again = await h.asUser(A.ownerId).run((tx) => repos.sites.publish(tx, A.businessId, { releaseId: aPreview2.id, userId: A.ownerId }));
    expect([again.site.liveReleaseId, again.release.publishedBy]).toEqual([aPreview2.id, A.ownerId]);
    expect(await h.service().run((tx) => repos.sites.publishesToday(tx, A.businessId))).toBe(2);
    expect(await h.service().run((tx) => repos.sites.publishesToday(tx, A.businessId, { now: new Date(Date.now() + 2 * 86_400_000) }))).toBe(0);
  });

  it("an owner cannot stamp a held release, nor write any other column of a release", async () => {
    expect(await h.asUser(A.ownerId).run((tx) => tx.update(s.siteReleases).set({ publishedBy: A.ownerId, publishedAt: new Date() }).where(eq(s.siteReleases.id, aHeld.id)).returning())).toEqual([]);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.siteReleases).set({ state: "preview" }).where(eq(s.siteReleases.id, aHeld.id)))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.siteReleases).set({ files: [] }).where(eq(s.siteReleases.id, aPreview.id)))).rejects.toThrow(/permission denied/);
  });

  it("an owner may rename and unpublish, but never sets status taken_down nor writes the takedown reason, business or starter", async () => {
    expect(await causes(h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set({ status: "taken_down" }).where(eq(s.sites.businessId, A.businessId))))).toMatch(RLS_DENIED);
    for (const patch of [{ takenDownReason: "none" }, { businessId: B.businessId }, { starterKey: "other" }]) {
      await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set(patch).where(eq(s.sites.businessId, A.businessId))), Object.keys(patch)[0]).rejects.toThrow(/permission denied/);
    }
    const renamed = await h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set({ slug: "alpha-renamed" }).where(eq(s.sites.businessId, A.businessId)).returning());
    expect(renamed.map((r) => r.slug)).toEqual(["alpha-renamed"]);
    const draft = await h.asUser(A.ownerId).run((tx) => repos.sites.unpublish(tx, A.businessId));
    expect([draft.status, draft.liveReleaseId]).toEqual(["draft", null]);
    await h.asUser(A.ownerId).run((tx) => tx.update(s.sites).set({ slug: "alpha-site" }).where(eq(s.sites.businessId, A.businessId)));
  });

  it("an owner cannot change a taken-down site, nor undo the takedown", async () => {
    for (const patch of [{ status: "draft" as const }, { status: "live" as const, liveReleaseId: cPreview.id }, { slug: "gamma-new" }]) {
      expect(await h.asUser(C.ownerId).run((tx) => tx.update(s.sites).set(patch).where(eq(s.sites.businessId, C.businessId)).returning())).toEqual([]);
    }
    await expect(h.asUser(C.ownerId).run((tx) => repos.sites.publish(tx, C.businessId, { releaseId: cPreview.id, userId: C.ownerId }))).rejects.toThrow(/taken down/);
    await expect(h.asUser(C.ownerId).run((tx) => repos.sites.unpublish(tx, C.businessId))).rejects.toThrow(/taken down/);
    const c = await siteOf(C.businessId);
    expect([c.status, c.slug, c.takenDownReason]).toEqual(["taken_down", "gamma-site", "phishing"]);
  });
});

describe("sites: releases", () => {
  it("numbers releases per site, hashes the sorted manifest and is idempotent on the session", async () => {
    expect([aPreview.number, aHeld.number, aPreview2.number, bPreview.number]).toEqual([1, 2, 3, 1]);
    expect(aPreview2.contentHash).toBe(siteContentHash([entry("b.html", ONLY_B), entry("index.html", INDEX_A)]));
    expect(aPreview2.contentHash).toBe(sha(`b.html:${sha(ONLY_B)}\nindex.html:${sha(INDEX_A)}\n`));
    expect([aPreview2.fileCount, aPreview2.totalBytes]).toEqual([2, Buffer.byteLength(INDEX_A) + Buffer.byteLength(ONLY_B)]);
    expect(aPreview.previewToken).toMatch(/^[0-9a-f]{32}$/);
    const again = await h.service().run((tx) => repos.sites.saveRelease(tx, A.businessId, { files: [], state: "preview", sessionId: aPreview.sessionId }));
    expect(again.id).toBe(aPreview.id);
    expect(await h.service().run((tx) => repos.sites.latestRelease(tx, A.businessId))).toMatchObject({ id: aPreview2.id });
  });
});

describe("site_resolve", () => {
  it("resolves a live slug to its live release and a preview token to its preview release", async () => {
    expect(await resolve("beta-site")).toEqual({ releaseId: bPreview.id, businessId: B.businessId, kind: "live", planTier: "free" });
    expect(await resolve(`p-${aPreview.previewToken}`)).toEqual({ releaseId: aPreview.id, businessId: A.businessId, kind: "preview", planTier: "free" });
    // A host label arrives in any case.
    expect(await resolve("BETA-SITE")).toMatchObject({ releaseId: bPreview.id, kind: "live" });
  });

  it("returns nothing for a draft site, a held release or an unknown label", async () => {
    expect((await siteOf(A.businessId)).status).toBe("draft");
    expect(await resolve("alpha-site")).toBeNull();
    expect(await resolve(`p-${aHeld.previewToken}`)).toBeNull();
    for (const label of ["nobody-here", `p-${"0".repeat(32)}`, "", "p-", aPreview.previewToken]) expect(await resolve(label), label).toBeNull();
  });

  it("answers taken_down for a taken-down slug, and nothing for that site's preview token", async () => {
    expect(await resolve("gamma-site")).toEqual({ releaseId: null, businessId: C.businessId, kind: "taken_down", planTier: "free" });
    expect(await resolve(`p-${cPreview.previewToken}`)).toBeNull();
  });

  it("no client role may call site_resolve, site_file or site_report", async () => {
    await expect(h.asUser(B.ownerId).execute(sql`select site_report('beta-site', 'scam', null)`)).rejects.toThrow(/permission denied for function site_report/);
    await expect(h.asUser(A.ownerId).execute(sql`select * from site_resolve('beta-site')`)).rejects.toThrow(/permission denied for function site_resolve/);
    await expect(h.anon().execute(sql`select * from site_file(${bPreview.id}::uuid, 'index.html')`)).rejects.toThrow(/permission denied for function site_file/);
  });
});

describe("site_file", () => {
  it("reads a file of a release from its own business's blobs", async () => {
    const f = await h.service().run((tx) => repos.sites.readFile(tx, aPreview2.id, "index.html"));
    expect(f && { text: Buffer.from(f.content).toString(), sha256: f.sha256, size: f.size }).toEqual({ text: INDEX_A, sha256: sha(INDEX_A), size: Buffer.byteLength(INDEX_A) });
    expect(await h.service().run((tx) => repos.sites.readFile(tx, aPreview2.id, "missing.html"))).toBeNull();
  });

  it("never returns a blob that exists only for another business", async () => {
    expect(await h.service().run((tx) => repos.sites.readFile(tx, aPreview2.id, "b.html"))).toBeNull();
    expect(await h.service().run((tx) => repos.sites.readFile(tx, bPreview.id, "a.html"))).toBeNull();
    expect(Buffer.from((await h.service().run((tx) => repos.sites.readFile(tx, bPreview.id, "index.html")))!.content).toString()).toBe(ONLY_B);
  });
});

describe("site_file: what may be served", () => {
  it("never reads a held release or a taken-down site's release, even by id", async () => {
    expect(await h.service().run((tx) => repos.sites.readFile(tx, aHeld.id, "index.html"))).toBeNull();
    expect(await h.service().run((tx) => repos.sites.readFile(tx, cPreview.id, "index.html"))).toBeNull();
  });

  it("refuses a reserved word as a site address", async () => {
    expect(await causes(h.service().run((tx) => repos.sites.ensure(tx, A.businessId, { slug: "admin" })))).toMatch(/sites_slug_format|unique|duplicate|check/);
  });
});

describe("site_report", () => {
  const report = (label: string, reason: string, detail: string | null = null) => h.service().run((tx) => repos.sites.report(tx, label, { reason, detail }));
  const reports = async (businessId: string) =>
    (await h.service().run((tx) => tx.select().from(s.auditLog).where(eq(s.auditLog.businessId, businessId)))).filter((r) => r.action === "site.reported");

  it("records one audit row for a live site, with nothing about the reporter, and the note cut to 1,000 characters", async () => {
    const bSite = await siteOf(B.businessId);
    expect(await report("beta-site", "phishing", "x".repeat(1500))).toBe("recorded");
    const [row, ...rest] = await reports(B.businessId);
    expect(rest).toEqual([]);
    expect([row!.actorKind, row!.actorId, row!.target]).toEqual(["system", null, { siteId: bSite.id, slug: "beta-site" }]);
    expect(row!.details).toEqual({ reason: "phishing", detail: "x".repeat(1000) });
  });

  it("records a report on a servable preview link against its site", async () => {
    expect(await report(`p-${aPreview.previewToken}`, "scam")).toBe("recorded");
    expect((await reports(A.businessId)).map((r) => r.target)).toEqual([{ siteId: (await siteOf(A.businessId)).id, slug: "alpha-site" }]);
  });

  it("answers unknown for a held preview, a taken-down site's preview, a draft, a taken-down site or an unknown label, and invalid for another reason", async () => {
    for (const label of [`p-${aHeld.previewToken}`, `p-${cPreview.previewToken}`, "alpha-site", "gamma-site", "nobody-here"]) expect(await report(label, "scam"), label).toBe("unknown");
    expect(await report("beta-site", "boring")).toBe("invalid");
    expect(await reports(C.businessId)).toEqual([]);
  });

  it("limits a site to 5 reports a minute", async () => {
    for (let i = 0; i < 4; i++) expect(await report("beta-site", "other", `note ${i}`)).toBe("recorded");
    expect(await report("beta-site", "other", "sixth")).toBe("limited");
    expect(await reports(B.businessId)).toHaveLength(5);
  });
});

describe("sites_reader", () => {
  /** One statement as `sites_reader`, in its own transaction (a refused one aborts it). */
  const asReader = (q: ReturnType<typeof sql>) =>
    h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role sites_reader`);
      return (await tx.execute(q)) as unknown as { rows: Record<string, unknown>[] };
    });

  it("reads no table, and calls the two functions", async (ctx) => {
    if (!(await canBecomeReader())) ctx.skip();
    for (const table of ["sites", "site_releases", "workspace_blobs", "businesses", "audit_log"]) {
      expect(await causes(asReader(sql.raw(`select * from ${table}`))), table).toMatch(/permission denied for table/);
    }
    expect((await asReader(sql`select * from site_resolve('beta-site')`)).rows).toEqual([{ release_id: bPreview.id, business_id: B.businessId, kind: "live", plan_tier: "free" }]);
    expect((await asReader(sql`select site_report('nobody-here', 'scam', null) as r`)).rows).toEqual([{ r: "unknown" }]);
    expect((await asReader(sql`select size from site_file(${bPreview.id}::uuid, 'index.html')`)).rows).toEqual([{ size: Buffer.byteLength(ONLY_B) }]);
  });
});

describe("hardening", () => {
  it("a temporary table cannot shadow the tables the functions read (search_path pins pg_temp last)", async (ctx) => {
    if (!(await canBecomeReader())) ctx.skip();
    const fake = crypto.randomUUID();
    const rows = await h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role sites_reader`);
      await tx.execute(sql`create temp table site_releases (id uuid, site_id uuid, business_id uuid, files jsonb, state text) on commit drop`);
      await tx.execute(sql`create temp table sites (id uuid, status text) on commit drop`);
      await tx.execute(sql`insert into pg_temp.sites values (${fake}::uuid, 'live')`);
      await tx.execute(sql`insert into pg_temp.site_releases values (${fake}::uuid, ${fake}::uuid, ${B.businessId}::uuid, ${JSON.stringify([entry("x", ONLY_B)])}::jsonb, 'preview')`);
      return ((await tx.execute(sql`select size from site_file(${fake}::uuid, 'x')`)) as unknown as { rows: unknown[] }).rows;
    });
    expect(rows).toEqual([]);
  });

  it("stops serving a live release that is later held", async () => {
    await h.service().execute(sql`update site_releases set state = 'held' where id = ${bPreview.id}`);
    try {
      expect(await resolve("beta-site")).toBeNull();
    } finally {
      await h.service().execute(sql`update site_releases set state = 'preview' where id = ${bPreview.id}`);
    }
  });

  it("serves only the newest 3 previews of a site, and the live release whatever its age", async () => {
    const index = [entry("index.html", ONLY_B)];
    const newer = await h.service().run(async (tx) => {
      const out = [];
      for (let i = 0; i < 3; i++) out.push(await repos.sites.saveRelease(tx, B.businessId, { files: index, state: "preview" }));
      return out;
    });
    expect(await resolve(`p-${bPreview.previewToken}`)).toBeNull();
    for (const r of newer) expect(await resolve(`p-${r.previewToken}`)).toMatchObject({ releaseId: r.id, kind: "preview" });
    expect(await resolve("beta-site")).toMatchObject({ releaseId: bPreview.id, kind: "live" });
    expect(await h.service().run((tx) => repos.sites.report(tx, `p-${bPreview.previewToken}`, { reason: "scam" }))).toBe("unknown");
  });
});
