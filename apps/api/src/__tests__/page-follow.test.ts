/**
 * publicPage.follow — following a project from its public page (docs/THESIS_REVIEW.md package 1.6; services/pages.ts
 * `followPage`, repos.followers, 0079 `contact_consents`). Double opt-in (SECURITY_REVIEW, Nov 11 2026).
 *
 * A signup on a published page whose switch is on writes a pending consent record (the exact sentence, the page's
 * address, the time) and asks the gateway for the one confirmation email; nothing is consent, nothing counts and no
 * `page.followed` is written until the person confirms (ingest `/mail/confirm`, here `repos.followers.confirm`). An
 * existing contact keeps its name, lawful basis and roles; a new one is "Follower (ma***@example.com)" with no lawful
 * basis. The answer is the same for a new address, a repeat, a suppressed address and a filled hidden field. Repeats and
 * unknown addresses never spend a page's budget; the email keys are an HMAC of the address. Nothing is recorded, sent
 * or spent from a person's allowance without a valid Turnstile token, checked through the gateway (security audit
 * 2026-11-13, finding 10).
 */
import { contactConsents, entities, repos, suppressionHash } from "@foundmill/db";
import { FOLLOW_ERRORS, followConsentText, type ProjectPageContent } from "@foundmill/shared";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOLLOW_MOCK_TURNSTILE_TOKEN, followAddressKey, followLimitKeys, followPage, PAGE_FOLLOW_LIMITS, publicPageBySlug } from "../services/pages";
import type { GatewayConfirmFollowRequest, GatewayConfirmFollowResult, GatewayTurnstileRequest, GatewayTurnstileResult } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
/** What the stand-in gateway was asked for, and what it answers next. */
const asked: GatewayConfirmFollowRequest[] = [];
let answer: (input: GatewayConfirmFollowRequest) => Promise<GatewayConfirmFollowResult> = async () => ({ sent: true, simulated: true });
/** The token the stand-in gateway's Turnstile check passes; what it was asked, and what it answers next. */
const TOKEN = "a-token-from-the-widget";
const checked: GatewayTurnstileRequest[] = [];
const passes = async (input: GatewayTurnstileRequest): Promise<GatewayTurnstileResult> => (input.token === TOKEN ? { ok: true, reason: "ok", simulated: false } : { ok: false, reason: "invalid", simulated: false });
let turnstile: (input: GatewayTurnstileRequest) => Promise<GatewayTurnstileResult> = passes;
const verifyTurnstile = async (input: GatewayTurnstileRequest) => {
  checked.push(input);
  return turnstile(input);
};
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "follow" });
  hz.deps.gateway.confirmFollow = async (input) => {
    asked.push(input);
    return answer(input);
  };
  hz.deps.gateway.verifyTurnstile = verifyTurnstile;
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => {
  hz.limits.reset();
  asked.length = 0;
  checked.length = 0;
  answer = async () => ({ sent: true, simulated: true });
  turnstile = passes;
  hz.deps.gateway.verifyTurnstile = verifyTurnstile;
});

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Candles that smell like a walk in the woods", about: "Small batches, poured by hand.", forWhom: "", stage: "idea", showFounders: false, followForm: true, ...over });

let n = 0;
async function project(name: string, options: { publish?: Partial<ProjectPageContent> | false } = {}) {
  n += 1;
  const [ownerId, memberId] = await Promise.all(["owner", "member"].map((r) => hz.h.createUser(`follow-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  const owner = hz.caller({ userId: ownerId! });
  let slug = "";
  if (options.publish !== false) {
    const r = await owner.page.publish({ businessId: b.id, content: page(options.publish ?? {}) });
    slug = r.page.slug;
  }
  const pageId = slug ? (await repos.pages.get(hz.db, b.id))!.id : "";
  return { id: b.id, name: b.name, slug, pageId, owner, member: hz.caller({ userId: memberId! }) };
}

const anon = () => hz.caller(null);
/** A signed-out follow from the page, with the widget's token unless the input says otherwise. */
const follow = (input: { slug: string; email: string; consent: boolean; website?: string | null; turnstile?: string | null }) => anon().publicPage.follow({ turnstile: TOKEN, ...input });
const refusal = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string; cause?: { code?: string } }) => `${err.code}:${err.cause?.code ?? ""}`);
const followEvents = async (businessId: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === "page.followed").map((o) => o.event);
const consents = async (businessId: string) => hz.db.select().from(contactConsents).where(eq(contactConsents.businessId, businessId));
const leads = async (businessId: string) => (await repos.entities.listByRole(hz.db, businessId, "lead")).items;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
/** What ingest's `/mail/confirm` does with a valid link (apps/ingest platform-mail.ts `handleFollowConfirm`). */
const confirmFrom = (businessId: string, req: GatewayConfirmFollowRequest) => hz.db.transaction((tx) => repos.followers.confirm(tx, { businessId, consentId: req.consentId, emailHash: suppressionHash("email", req.email), tokenHash: sha256(req.nonce) }));
/** Fills a window up to `left` free hits. */
async function fill(key: string, rule: { limit: number; windowMs: number }, left = 0) {
  for (let i = 0; i < rule.limit - left; i++) await hz.limits.take([{ key, rule }]);
}

describe("publicPage.follow (double opt-in)", () => {
  it("a signup is a pending record and one confirmation email; only the confirmation makes it consent and a follower", async () => {
    const b = await project("Northwood");
    expect(await follow({ slug: b.slug, email: "  Maya.Lee@Example.com ", consent: true, website: "" })).toEqual({ ok: true });

    const [lead] = await leads(b.id);
    // The address only in the identifier; no lawful basis before the person confirms.
    expect(lead).toMatchObject({ kind: "person", displayName: "Follower (ma***@example.com)", source: "page", lawfulBasis: null, identifiers: { email: "maya.lee@example.com" } });
    expect(lead!.role).toMatchObject({ role: "lead", stage: "new", ownerRef: null });
    const rows = await consents(b.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: lead!.id, purpose: "email", source: "page", sourceRef: b.slug, consentText: followConsentText(b.name), confirmedAt: null, withdrawnAt: null });
    expect(rows[0]!.confirmationSentAt).toBeInstanceOf(Date);

    // One email asked for, with a nonce whose hash only the record keeps.
    expect(asked).toEqual([{ businessId: b.id, consentId: rows[0]!.id, email: "maya.lee@example.com", nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }]);
    expect(rows[0]!.confirmationTokenHash).toBe(sha256(asked[0]!.nonce));

    // Not a follower yet: no event, no count, "Not confirmed yet" for the founders.
    expect(await followEvents(b.id)).toEqual([]);
    expect((await b.member.page.get({ businessId: b.id })).followers).toBe(0);
    const pending = await b.member.crm.entity.get({ businessId: b.id, entityId: lead!.id });
    expect(pending).toMatchObject({ emailConsentAt: null, emailConsentPending: true });
    expect((await b.member.crm.roles.byRole({ businessId: b.id, role: "lead" })).items.find((e) => e.id === lead!.id)).toMatchObject({ emailConsentAt: null, emailConsentPending: true });
    const audit = (await repos.audit.list(hz.db, b.id, { action: "page.follow_requested" })).items;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/maya/i);

    // The person confirms: consent, the lawful basis, the count and "Agreed to email on …".
    expect(await confirmFrom(b.id, asked[0]!)).toMatchObject({ status: "confirmed", entityId: lead!.id, consentId: rows[0]!.id, lawfulBasisSet: true });
    const [after] = await consents(b.id);
    expect(after!.confirmedAt).toBeInstanceOf(Date);
    expect(after!.confirmationTokenHash).toBeNull();
    expect((await repos.entities.get(hz.db, b.id, lead!.id)).lawfulBasis).toBe("consent");
    expect((await b.member.page.get({ businessId: b.id })).followers).toBe(1);
    expect(await b.member.crm.entity.get({ businessId: b.id, entityId: lead!.id })).toMatchObject({ emailConsentAt: after!.confirmedAt, emailConsentPending: false });
    // The link works once; a second use changes nothing.
    expect(await confirmFrom(b.id, asked[0]!)).toEqual({ status: "already" });
  });

  it("a follow without a valid Turnstile token is refused before anything is recorded, sent or spent", async () => {
    const b = await project("Unchecked");
    // No token, an empty one, or one the check refuses: the same plain refusal, and nothing anywhere.
    for (const token of [null, "", "   ", "a-made-up-token"]) {
      expect(await refusal(follow({ slug: b.slug, email: "maya@example.com", consent: true, turnstile: token })), String(token)).toBe("FORBIDDEN:follow_unverified");
    }
    const err = await follow({ slug: b.slug, email: "maya@example.com", consent: true, turnstile: null }).catch((e: Error) => e);
    expect((err as Error).message).toBe(FOLLOW_ERRORS.unverified);
    // An expired token, a token from another site or for another action: refused the same way.
    for (const reason of ["expired", "hostname", "action"] as const) {
      turnstile = async () => ({ ok: false, reason, simulated: false });
      expect(await refusal(follow({ slug: b.slug, email: "maya@example.com", consent: true })), reason).toBe("FORBIDDEN:follow_unverified");
    }
    // The check cannot run (no secret on the gateway, Cloudflare down, the gateway unreachable): fails closed.
    for (const down of [async () => ({ ok: false, reason: "unconfigured" as const, simulated: false }), async () => ({ ok: false, reason: "unavailable" as const, simulated: false }), async () => Promise.reject(new Error("gateway unreachable"))]) {
      turnstile = down;
      expect(await refusal(follow({ slug: b.slug, email: "maya@example.com", consent: true }))).toBe("SERVICE_UNAVAILABLE:follow_unavailable");
    }
    expect(await leads(b.id)).toEqual([]);
    expect(await consents(b.id)).toHaveLength(0);
    expect(asked).toEqual([]);
    // The check is the page's own action, from the site's address, without the address the api sees (the web's).
    expect(checked.at(-1)).toEqual({ token: TOKEN, remoteIp: null, hostname: null, action: "page_follow" });
    // Nothing was taken from the person's allowance or the page's: with a valid token the same address follows at once.
    turnstile = passes;
    expect(await follow({ slug: b.slug, email: "maya@example.com", consent: true })).toEqual({ ok: true });
    expect(await consents(b.id)).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("without the gateway only a development or test stack on mock integrations passes, and only the mock token", async () => {
    const b = await project("NoGateway");
    delete hz.deps.gateway.verifyTurnstile;
    expect(await refusal(follow({ slug: b.slug, email: "dev@example.com", consent: true, turnstile: TOKEN }))).toBe("SERVICE_UNAVAILABLE:follow_unavailable");
    expect(await follow({ slug: b.slug, email: "dev@example.com", consent: true, turnstile: FOLLOW_MOCK_TURNSTILE_TOKEN })).toEqual({ ok: true });
    expect(asked).toHaveLength(1);
    // Live integrations, or staging: the mock token is no pass.
    for (const env of [{ ...hz.deps.env, INTEGRATIONS_MODE: "live" as const }, { ...hz.deps.env, APP_ENV: "staging" as const }]) {
      expect(await followPage({ ...hz.deps, env }, { slug: b.slug, email: "other@example.com", consent: true, turnstile: FOLLOW_MOCK_TURNSTILE_TOKEN }).then(() => "ok", (e: { code?: string }) => e.code)).toBe("follow_unavailable");
    }
    expect(asked).toHaveLength(1);
  });

  it("on staging and production the token must come from the site's own hostname", async () => {
    const b = await project("Hostname");
    const env = { ...hz.deps.env, APP_ENV: "production" as const, APP_URL: "https://www.foundmill.com", PLATFORM_MAIL_DOMAIN: "mail.foundmill.com", LIVE_CONNECTORS: "sendgrid" };
    expect(await followPage({ ...hz.deps, env }, { slug: b.slug, email: "host@example.com", consent: true, turnstile: TOKEN })).toEqual({ ok: true });
    expect(checked.at(-1)).toMatchObject({ hostname: "foundmill.com", action: "page_follow" });
  });

  it("a second signup with the same address answers the same, writes nothing and sends nothing", async () => {
    const b = await project("Repeat");
    await follow({ slug: b.slug, email: "sam@example.com", consent: true });
    const before = await leads(b.id);
    expect(await follow({ slug: b.slug, email: "SAM@example.com ", consent: true })).toEqual({ ok: true });
    expect(await leads(b.id)).toEqual(before);
    expect(await consents(b.id)).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("an existing contact keeps its name, lawful basis and roles; only a contact with no basis gets consent, and only on confirmation", async () => {
    const b = await project("Known");
    const kept = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Lee Park", identifiers: { email: "lee@example.com" }, source: "manual", lawfulBasis: "contract" });
    await repos.entities.addRole(hz.db, b.id, kept.id, { role: "customer", stage: "active" });
    const bare = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Ana Ruiz", identifiers: { email: "ana@example.com" }, source: "manual" });
    await follow({ slug: b.slug, email: "lee@example.com", consent: true });
    hz.limits.reset();
    await follow({ slug: b.slug, email: "ana@example.com", consent: true });
    for (const [e, basis] of [[kept, "contract"], [bare, null]] as const) {
      const now = await repos.entities.get(hz.db, b.id, e.id);
      expect(now).toMatchObject({ displayName: e.displayName, source: "manual", lawfulBasis: basis });
      // No lead role added to a contact that was already there.
      expect((await repos.entities.listRoles(hz.db, b.id, e.id)).map((r) => r.role)).toEqual(e.id === kept.id ? ["customer"] : []);
    }
    expect(await consents(b.id)).toHaveLength(2);
    expect(await confirmFrom(b.id, asked.find((a) => a.email === "lee@example.com")!)).toMatchObject({ status: "confirmed", lawfulBasisSet: false });
    expect((await repos.entities.get(hz.db, b.id, kept.id)).lawfulBasis).toBe("contract");
    expect(await confirmFrom(b.id, asked.find((a) => a.email === "ana@example.com")!)).toMatchObject({ status: "confirmed", lawfulBasisSet: true });
    expect((await repos.entities.get(hz.db, b.id, bare.id)).lawfulBasis).toBe("consent");
  });

  it("the hidden field filled in, or a suppressed address: the same answer, nothing written, nothing sent", async () => {
    const b = await project("Quiet");
    expect(await follow({ slug: b.slug, email: "bot@example.com", consent: true, website: "http://spam.example" })).toEqual({ ok: true });
    await repos.channels.addSuppression(hz.db, b.id, { emailHash: suppressionHash("email", "gone@example.com"), reason: "Unsubscribed", scope: "business", source: "test" });
    expect(await follow({ slug: b.slug, email: "Gone@example.com", consent: true })).toEqual({ ok: true });
    expect(await leads(b.id)).toEqual([]);
    expect(await consents(b.id)).toHaveLength(0);
    expect(asked).toEqual([]);
  });

  it("a contact the founder archived is not brought back and gets no new record", async () => {
    const b = await project("Archived");
    const old = await repos.entities.create(hz.db, b.id, { kind: "person", displayName: "Old Friend", identifiers: { email: "old@example.com" }, source: "manual" });
    await repos.entities.archive(hz.db, b.id, old.id);
    expect(await follow({ slug: b.slug, email: "old@example.com", consent: true })).toEqual({ ok: true });
    expect((await repos.entities.get(hz.db, b.id, old.id)).archivedAt).not.toBeNull();
    expect((await hz.db.select().from(entities).where(and(eq(entities.businessId, b.id), sql`${entities.identifiers} ->> 'email' = 'old@example.com'`))).length).toBe(1);
    expect(await consents(b.id)).toHaveLength(0);
    expect(asked).toEqual([]);
  });

  it("refuses an unusable address (201 characters included) or an unticked box in plain words", async () => {
    const b = await project("Refuse");
    const at200 = `${"a".repeat(200 - "@example.com".length)}@example.com`;
    for (const email of ["", "maya", "maya@example", "a b@example.com", `a${at200}`]) expect(await refusal(follow({ slug: b.slug, email, consent: true })), email.slice(0, 20)).toBe("BAD_REQUEST:follow_email");
    expect(await refusal(follow({ slug: b.slug, email: "maya@example.com", consent: false }))).toBe("BAD_REQUEST:follow_consent");
    const err = await follow({ slug: b.slug, email: `a${at200}`, consent: true }).catch((e: Error) => e);
    expect((err as Error).message).toBe(FOLLOW_ERRORS.email);
    expect(await leads(b.id)).toEqual([]);
    // 200 characters is fine.
    expect(await follow({ slug: b.slug, email: at200, consent: true })).toEqual({ ok: true });
    expect(await consents(b.id)).toHaveLength(1);
  });

  it("takes nobody on a page that is not public, a sample, a page with the switch off, or one published before the switch existed", async () => {
    const off = await project("Off", { publish: { followForm: false } });
    const draftOnly = await project("Draft", { publish: false });
    await draftOnly.owner.page.saveDraft({ businessId: draftOnly.id, draft: page() });
    const draftSlug = (await draftOnly.owner.page.get({ businessId: draftOnly.id })).slug;
    const sample = await project("Sample");
    await hz.db.execute(sql`update businesses set is_demo = true where id = ${sample.id}`);
    const old = await project("Old");
    await hz.db.execute(sql`update project_pages set published = published - 'followForm' where business_id = ${old.id}`);
    const down = await project("Down");
    await down.owner.page.unpublish({ businessId: down.id });
    for (const slug of [off.slug, draftSlug, sample.slug, old.slug, down.slug, "no-such-page", "x", "../etc"]) {
      expect(await refusal(follow({ slug, email: "maya@example.com", consent: true })), slug).toBe("NOT_FOUND:follow_closed");
    }
    for (const b of [off, draftOnly, sample, old, down]) expect(await consents(b.id)).toHaveLength(0);
    expect(asked).toEqual([]);
    expect((await anon().publicPage.bySlug({ slug: old.slug }))!.followForm).toBe(false);
    await old.owner.page.publish({ businessId: old.id, content: (await old.owner.page.get({ businessId: old.id })).draft });
    expect((await anon().publicPage.bySlug({ slug: old.slug }))!.followForm).toBe(true);
  });

  it("holds the page's caps and the ceiling", async () => {
    const b = await project("Busy");
    await fill(followLimitKeys.perPageHour(b.pageId), PAGE_FOLLOW_LIMITS.perPageHour);
    expect(await refusal(follow({ slug: b.slug, email: "late@example.com", consent: true }))).toBe("TOO_MANY_REQUESTS:rate_limited");
    expect(await leads(b.id)).toEqual([]);
    hz.limits.reset();
    await fill(followLimitKeys.all, PAGE_FOLLOW_LIMITS.all);
    expect(await refusal(follow({ slug: b.slug, email: "new@example.com", consent: true }))).toBe("TOO_MANY_REQUESTS:rate_limited");
    // A refusal by a page cap gave the address's confirmation back: once there is room it goes through.
    hz.limits.reset();
    expect(await follow({ slug: b.slug, email: "late@example.com", consent: true })).toEqual({ ok: true });
    expect(asked.map((a) => a.email)).toEqual(["late@example.com"]);
  });

  it("repeats of one address never spend the page's budget", async () => {
    const b = await project("Repeats");
    // One follow left on the page's hour.
    await fill(followLimitKeys.perPageHour(b.pageId), PAGE_FOLLOW_LIMITS.perPageHour, 1);
    for (let i = 0; i < 8; i++) expect(await follow({ slug: b.slug, email: "again@example.com", consent: true })).toEqual({ ok: true });
    expect(await consents(b.id)).toHaveLength(1);
    // The seven repeats stopped at the address's allowance, so the page has no room left only because of the first.
    expect(await refusal(follow({ slug: b.slug, email: "other@example.com", consent: true }))).toBe("TOO_MANY_REQUESTS:rate_limited");
    // Beyond one a day per page and address, even with the cross-project slot free, nothing is written.
    hz.limits.reset();
    await fill(followLimitKeys.perAddress(hz.deps.env, b.slug, "fresh@example.com"), PAGE_FOLLOW_LIMITS.perAddress);
    expect(await follow({ slug: b.slug, email: "fresh@example.com", consent: true })).toEqual({ ok: true });
    expect((await consents(b.id)).length).toBe(1);
  });

  it("unknown addresses never spend the page budget or the site-wide ceiling, only their own small ceiling", async () => {
    const b = await project("Real");
    // One follow left across every page.
    await fill(followLimitKeys.all, PAGE_FOLLOW_LIMITS.all, 1);
    for (let i = 0; i < PAGE_FOLLOW_LIMITS.closed.limit; i++) expect(await refusal(follow({ slug: `no-such-page-${i}`, email: `p${i}@example.com`, consent: true }))).toBe("NOT_FOUND:follow_closed");
    expect(await refusal(follow({ slug: "no-such-page-x", email: "px@example.com", consent: true }))).toBe("TOO_MANY_REQUESTS:rate_limited");
    // The real page still has the last follow, and the address that tried an unknown page first was not held back.
    expect(await follow({ slug: b.slug, email: "p0@example.com", consent: true })).toEqual({ ok: true });
    expect(await consents(b.id)).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("three confirmation emails per address across every project per day, and one per project per 30 days", async () => {
    const a = await project("First");
    const b = await project("Second");
    const c = await project("Third");
    const d = await project("Fourth");
    await follow({ slug: a.slug, email: "busy.person@example.com", consent: true });
    // The same day, two more projects: each gets its confirmation (a person may follow a few in one sitting).
    await follow({ slug: b.slug, email: "busy.person@example.com", consent: true });
    await follow({ slug: c.slug, email: "busy.person@example.com", consent: true });
    expect(await consents(b.id)).toHaveLength(1);
    expect(asked).toHaveLength(3);
    // A fourth the same day: nothing written and nothing sent (they can follow it tomorrow).
    expect(await follow({ slug: d.slug, email: "busy.person@example.com", consent: true })).toEqual({ ok: true });
    expect(await consents(d.id)).toHaveLength(0);
    expect(asked).toHaveLength(3);
    // A day later (the windows reset), the same project again: the record is pending, but 30 days have not passed.
    hz.limits.reset();
    await follow({ slug: a.slug, email: "busy.person@example.com", consent: true });
    expect(asked).toHaveLength(3);
    // ...and once they have, it is sent again with a new nonce (the old link stops working).
    await hz.db.update(contactConsents).set({ confirmationSentAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(contactConsents.businessId, a.id));
    hz.limits.reset();
    await follow({ slug: a.slug, email: "busy.person@example.com", consent: true });
    expect(asked).toHaveLength(4);
    expect(asked[3]!.nonce).not.toBe(asked[0]!.nonce);
    expect(await confirmFrom(a.id, asked[0]!)).toEqual({ status: "invalid" });
    expect(await confirmFrom(a.id, asked[3]!)).toMatchObject({ status: "confirmed" });
  });

  it("when the email is not sent the record stays pending and may be sent later; nothing claims it went out", async () => {
    const b = await project("Unsent");
    answer = async () => ({ sent: false, reason: "off" });
    await follow({ slug: b.slug, email: "wait@example.com", consent: true });
    let [row] = await consents(b.id);
    expect(row).toMatchObject({ confirmedAt: null, confirmationSentAt: null, confirmationTokenHash: null });
    // Not sent, so the day's confirmation for the address was given back: another project can send one.
    const other = await project("Other");
    answer = async () => ({ sent: true, simulated: true });
    await follow({ slug: other.slug, email: "wait@example.com", consent: true });
    expect(asked.map((a) => a.businessId)).toEqual([b.id, other.id]);
    // The gateway not answering at all: the record stays pending, and the visitor still gets the same answer.
    const third = await project("Third");
    answer = async () => {
      throw new Error("gateway unreachable");
    };
    hz.limits.reset();
    expect(await follow({ slug: third.slug, email: "down@example.com", consent: true })).toEqual({ ok: true });
    [row] = await consents(third.id);
    expect(row).toMatchObject({ confirmedAt: null, confirmationSentAt: null });
    expect((await third.member.page.get({ businessId: third.id })).followers).toBe(0);
  });

  it("limits each caller by the address the api sees, generously", async () => {
    const b = await project("Caller");
    const ctx = { ...hz.deps, clientAddress: "203.0.113.7" };
    await fill(followLimitKeys.caller(hz.deps.env, "203.0.113.7"), PAGE_FOLLOW_LIMITS.perCaller);
    expect(await followPage(ctx, { slug: b.slug, email: "c1@example.com", consent: true, turnstile: TOKEN }).then(() => "ok", (e: { code?: string }) => e.code)).toBe("rate_limited");
    expect(await followPage({ ...hz.deps, clientAddress: "203.0.113.8" }, { slug: b.slug, email: "c1@example.com", consent: true, turnstile: TOKEN })).toEqual({ ok: true });
    expect(PAGE_FOLLOW_LIMITS.perCaller.limit).toBeGreaterThanOrEqual(120);
  });

  it("keys the address limits by an HMAC of the address, never the address or its plain hash", () => {
    const keys = [followLimitKeys.perAddress(hz.deps.env, "some-page", "Maya@Example.com"), followLimitKeys.confirmAnyProject(hz.deps.env, "maya@example.com")];
    for (const key of keys) {
      expect(key).not.toContain("maya");
      expect(key).not.toContain(suppressionHash("email", "maya@example.com"));
    }
    expect(followAddressKey(hz.deps.env, "email", " MAYA@example.com")).toBe(followAddressKey(hz.deps.env, "email", "maya@example.com"));
    expect(followAddressKey({ SESSION_TOKEN_SECRET: "another-secret-0123456789" }, "email", "maya@example.com")).not.toBe(followAddressKey(hz.deps.env, "email", "maya@example.com"));
    expect(followAddressKey(hz.deps.env, "caller", "maya@example.com")).not.toBe(followAddressKey(hz.deps.env, "email", "maya@example.com"));
  });

  it("counts only confirmed followers the founder still works with", async () => {
    const b = await project("Counting");
    for (const email of ["c1@example.com", "c2@example.com", "c3@example.com", "c4@example.com", "c5@example.com"]) {
      hz.limits.reset();
      await follow({ slug: b.slug, email, consent: true });
    }
    for (const req of asked.slice(0, 4)) await confirmFrom(b.id, req);
    expect((await b.member.page.get({ businessId: b.id })).followers).toBe(4);
    const ids = new Map((await leads(b.id)).map((l) => [l.identifiers.email as string, l.id]));
    await repos.entities.archive(hz.db, b.id, ids.get("c1@example.com")!);
    await repos.followers.withdrawByEmailHash(hz.db, b.id, suppressionHash("email", "c2@example.com"));
    const keptId = ids.get("c3@example.com")!;
    await hz.db.update(entities).set({ mergedIntoId: keptId, archivedAt: new Date() }).where(eq(entities.id, ids.get("c4@example.com")!));
    // c3 stays; c5 never confirmed.
    expect((await b.member.page.get({ businessId: b.id })).followers).toBe(1);
  });

  it("a follower belongs to that project only", async () => {
    const a = await project("Alpha");
    const other = await project("Bravo");
    await follow({ slug: a.slug, email: "only-alpha@example.com", consent: true });
    await confirmFrom(a.id, asked[0]!);
    expect(await leads(other.id)).toEqual([]);
    expect((await other.member.page.get({ businessId: other.id })).followers).toBe(0);
    // A link for project A never confirms anything in project B.
    expect(await confirmFrom(other.id, asked[0]!)).toEqual({ status: "invalid" });
    expect(await refusal(other.member.crm.roles.byRole({ businessId: a.id, role: "lead" }))).toMatch(/^FORBIDDEN:/);
  });
});

describe("the Follow form only where a confirmation can be sent (WP-02 T7)", () => {
  it("staging without platform mail live: the public page has no form and following is refused as closed; live mail keeps it", async () => {
    const b = await project("MailOff");
    const off = { ...hz.deps.env, APP_ENV: "staging" as const, INTEGRATIONS_MODE: "mock" as const, LIVE_CONNECTORS: "", PLATFORM_MAIL_DOMAIN: "mail.foundmill.test" };
    const offPage = await publicPageBySlug({ ...hz.deps, env: off }, b.slug);
    expect(offPage!.followForm).toBe(false);
    expect(await followPage({ ...hz.deps, env: off }, { slug: b.slug, email: "off@example.com", consent: true, turnstile: TOKEN }).then(() => "ok", (e: { code?: string }) => e.code)).toBe("follow_closed");
    expect(asked).toHaveLength(0);
    const on = { ...off, LIVE_CONNECTORS: "sendgrid" };
    expect((await publicPageBySlug({ ...hz.deps, env: on }, b.slug))!.followForm).toBe(true);
    expect(await followPage({ ...hz.deps, env: on }, { slug: b.slug, email: "on@example.com", consent: true, turnstile: TOKEN })).toEqual({ ok: true });
    // The founders see why the switch is off (page.get's followAvailable).
    expect((await b.owner.page.get({ businessId: b.id })).followAvailable).toBe(true);
  });
});

