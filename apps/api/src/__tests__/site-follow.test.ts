/**
 * A site's sign-up form (WP-07 T6): `publicPage.follow` with `via: "site"` uses the same path as the page's form (the
 * same limits, the same answer, the same confirmation email), found by the live site's address. A live site and no
 * published page records a pending consent with `source_ref = site:<slug>`; a draft or taken-down site is closed; the
 * bot check is asked for the site's own host; `publicPage.siteConsent` gives the sentence the record keeps.
 */
import { contactConsents, repos } from "@foundmill/db";
import { followConsentText } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GatewayConfirmFollowRequest, GatewayTurnstileRequest } from "../services/gateway";
import { followPage } from "../services/pages";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const TOKEN = "a-token-from-the-widget";
const asked: GatewayConfirmFollowRequest[] = [];
const checked: GatewayTurnstileRequest[] = [];
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "site-follow", env: { SITES_DOMAIN: "sites.localhost" } });
  hz.deps.gateway.confirmFollow = async (input) => {
    asked.push(input);
    return { sent: true, simulated: true };
  };
  hz.deps.gateway.verifyTurnstile = async (input) => {
    checked.push(input);
    return input.token === TOKEN ? { ok: true, reason: "ok", simulated: false } : { ok: false, reason: "invalid", simulated: false };
  };
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => {
  hz.limits.reset();
  asked.length = 0;
  checked.length = 0;
});

let n = 0;
async function project(status: "live" | "draft" | "taken_down") {
  n += 1;
  const b = await repos.businesses.create(hz.db, { name: `Lunchbox ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  const slug = `lunch-site-${n}`;
  await repos.sites.ensure(hz.db, b.id, { slug });
  const release = await repos.sites.saveRelease(hz.db, b.id, { files: [{ path: "index.html", sha256: "a".repeat(64), size: 1 }], state: "preview" });
  if (status !== "draft") await hz.db.execute(sql`update sites set status = 'live', live_release_id = ${release.id} where business_id = ${b.id}`);
  if (status === "taken_down") await hz.db.execute(sql`update sites set status = 'taken_down', taken_down_reason = 'test' where business_id = ${b.id}`);
  return { id: b.id, name: b.name, slug };
}

const anon = () => hz.caller(null);
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { cause?: { code?: string } }) => err.cause?.code ?? "unknown");

describe("publicPage.follow via a site", () => {
  it("records a pending consent for a live site with no page, and sends one confirmation", async () => {
    const p = await project("live");
    expect(await anon().publicPage.follow({ slug: p.slug, email: "Visitor@Example.com", consent: true, turnstile: TOKEN, via: "site" })).toEqual({ ok: true });
    const rows = await hz.db.select().from(contactConsents).where(eq(contactConsents.businessId, p.id));
    expect(rows.map((r) => [r.sourceRef, r.pageId, r.confirmedAt, r.consentText])).toEqual([[`site:${p.slug}`, null, null, followConsentText(p.name)]]);
    expect(asked.map((a) => a.businessId)).toEqual([p.id]);
    expect(await repos.events.outboxPending(hz.db, p.id).then((o) => o.filter((e) => e.event.type === "page.followed"))).toEqual([]);
  });

  it("is closed for a draft or a taken-down site, and for a page address that is no site", async () => {
    for (const status of ["draft", "taken_down"] as const) {
      const p = await project(status);
      expect(await code(anon().publicPage.follow({ slug: p.slug, email: "a@example.com", consent: true, turnstile: TOKEN, via: "site" }))).toBe("follow_closed");
    }
    expect(await code(anon().publicPage.follow({ slug: "no-such-site", email: "a@example.com", consent: true, turnstile: TOKEN, via: "site" }))).toBe("follow_closed");
    expect(asked).toEqual([]);
  });

  it("asks the bot check for the site's own host on staging and production", async () => {
    const p = await project("live");
    const env = { ...hz.deps.env, APP_ENV: "staging" as const, APP_URL: "https://foundmill.com", SITES_DOMAIN: "foundmill.app" };
    // Platform mail is off on this stack, so the follow then closes; the bot check ran first, for the site's host.
    await followPage({ db: hz.db, limits: hz.limits, env, gateway: hz.deps.gateway, log: hz.deps.log }, { slug: p.slug, email: "b@example.com", consent: true, turnstile: TOKEN, via: "site" }).catch(() => undefined);
    expect(checked.map((c) => c.hostname)).toEqual([`${p.slug}.foundmill.app`]);
  });

  it("counts a flood on one site against that site only, not every site's form", async () => {
    const a = await project("live");
    const b = await project("live");
    let refusedAt = 0;
    for (let i = 1; i <= 200 && !refusedAt; i++) {
      const r = await anon().publicPage.follow({ slug: a.slug, email: "x@example.com", consent: true, turnstile: "bad", via: "site" }).then(() => "ok", (e: { code?: string }) => e.code);
      if (r === "TOO_MANY_REQUESTS") refusedAt = i;
    }
    expect(refusedAt).toBeGreaterThan(0);
    expect(await anon().publicPage.follow({ slug: b.slug, email: "y@example.com", consent: true, turnstile: TOKEN, via: "site" })).toEqual({ ok: true });
  }, 60_000);

  it("is closed when the founders turned Follow off on their page, or the live release is held", async () => {
    const p = await project("live");
    await hz.db.execute(sql`insert into project_pages (business_id, slug, draft) values (${p.id}, ${`page-${p.slug}`}, ${JSON.stringify({ pitch: "p", about: "a", forWhom: "", stage: "idea", showFounders: false, followForm: false })}::jsonb)`);
    expect(await code(anon().publicPage.follow({ slug: p.slug, email: "c@example.com", consent: true, turnstile: TOKEN, via: "site" }))).toBe("follow_closed");
    const q = await project("live");
    await hz.db.execute(sql`update site_releases set state = 'held' where business_id = ${q.id}`);
    expect(await anon().publicPage.siteConsent({ slug: q.slug })).toBeNull();
  });

  it("gives the consent sentence for a live site only", async () => {
    const live = await project("live");
    const draft = await project("draft");
    expect(await anon().publicPage.siteConsent({ slug: live.slug })).toEqual({ consentText: followConsentText(live.name) });
    expect(await anon().publicPage.siteConsent({ slug: draft.slug })).toBeNull();
  });
});
