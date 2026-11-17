/**
 * A project's Foundmill sending address through the gateway (package 1.5): Cedar first and unchanged (a first message to
 * someone outside the project asks), then the guards of platform-mail.ts in order, then the vendor; the sender and the
 * signed custom args come from the gateway, a send that went out writes `mail.sent`, and only sends that went out count
 * against the project's day and the deployment's ceiling. A commercial message carries the founders' postal address and
 * is refused without one (US CAN-SPAM); a proven reply or receipt is transactional and goes without it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformMailConnector, createPlatformMailMock, emailEntityId, platformMailCustomArgs, readPlatformUnsubscribeToken, routedFetch, suppressionHashOfEmail, verifyPlatformMailArgs } from "@foundmill/connectors";
import { repos, suppressionHash } from "@foundmill/db";
import { APP_NAME } from "@foundmill/config";
import { PLATFORM_MAIL_REFUSALS, POSTAL_ADDRESS_NOTE } from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, PLATFORM_MAIL_POLICY, platformMailConfig, type PlatformMailConfig } from "../platform-mail";
import { DAY_MS, RedisRateLimitStore, windowStart, type RedisCounter } from "../rate-limit";
import { setupGateway, type GatewayFixture } from "./harness";
import type { AllowResponse, AskResponse, CallResponse, DenyResponse } from "../types";

const DOMAIN = "mail.foundmill.test";
const POSTAL = "PO Box 1234, Springfield, IL 62701, USA";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", ...over });
const message = (to = "anna@example.com", over: Record<string, unknown> = {}) => ({ connector: "platform_mail", tool: "send_mail", args: { to: { email: to, name: "Anna" }, subject: "Thanks for joining", text: "Hi Anna, thanks for joining the list.", ...over } });

/** The addresses these tests mail, each given a basis to be mailed on (a confirmed follow; WP-08 T10). */
const MAILABLE = ["Payer@Example.com", "anna@example.com", "dev@example.com", "five@example.com", "four@example.com", "gone@example.com", "lead2@example.com", "lead@example.com", "memory@example.com", "named@example.com", "off.person@example.com", "one@example.com", "quit@example.com", "redis-down@example.com", "redis-up@example.com", "seven@example.com", "six@example.com", "staging@example.com", "stranger@example.com", "three@example.com", "two@example.com", "writer@example.com", "Payer@Example.com"];

/** A Redis that answers (or not, while `down`): counts shared by every replica, as on staging and production. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const state = { down: false };
  const fail = () => {
    if (state.down) throw new Error("ECONNREFUSED");
  };
  const redis: RedisCounter = {
    incr: async (k) => (fail(), counts.set(k, (counts.get(k) ?? 0) + 1), counts.get(k)!),
    pexpire: async () => (fail(), 1),
    decr: async (k) => (fail(), counts.set(k, (counts.get(k) ?? 0) - 1), counts.get(k)!),
  };
  return { redis, state, peek: (key: string) => counts.get(`${key}:${windowStart(Date.now(), DAY_MS)}`) ?? 0 };
}

const asDeny = (r: CallResponse): DenyResponse => {
  expect(r.outcome).toBe("deny");
  return r as DenyResponse;
};
const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome, JSON.stringify(r)).toBe("allow");
  return r as AllowResponse;
};

describe("platform_mail through the gateway (mock)", () => {
  let g: GatewayFixture;
  const mock = createPlatformMailMock();
  let token: string;
  const sentEvents = async (businessId = g.businessId) => (await repos.events.list(g.db, businessId, { type: "mail.sent" })).items;

  beforeAll(async () => {
    g = await setupGateway({ businessMode: "automated", connectors: [mock] });
    g.deps.appEnv = "test";
    for (const e of MAILABLE) await g.mailable(e);
    await repos.postalAddress.set(g.db, g.businessId, { address: POSTAL, userId: null });
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(async () => {
    // A fresh session per test: an identical send already done in the same session is replayed, not sent again (WP-05 T14).
    token = await g.token({ allowedTools: ["platform_mail:*"], sessionId: await g.newSession() });
    g.deps.platformMail = config();
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
  });

  it("is off without a domain: refused before anything runs, nothing counted", async () => {
    g.deps.platformMail = config({ domain: null });
    const r = asDeny(await g.client.call(token, message()));
    expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.off]);
    expect(r.reasons).toEqual([PLATFORM_MAIL_REFUSALS.off]);
    expect(mock.sentFor(g.businessId)).toHaveLength(0);
  });

  it("off → no approval row: a first message to someone new in assisted mode is refused, not asked (WP-02 T3)", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "assisted");
    g.deps.platformMail = config({ domain: null });
    const approvals = async () => (await g.h.pg.query<{ n: number }>("select count(*)::int as n from approvals where business_id = $1", [g.businessId])).rows[0]!.n;
    const before = await approvals();
    const r = asDeny(await g.client.call(token, message("off.person@example.com")));
    expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.off]);
    expect(r.reasons).toEqual([PLATFORM_MAIL_REFUSALS.off]);
    expect(await approvals()).toBe(before);
    expect(g.rateLimits.peek(`pm:${g.businessId}:day`, Date.now())).toBe(0);
  });

  it("a first message to someone the founder added asks the founder, in every mode; someone new is refused (WP-08 T10)", async () => {
    await g.mailable("new.person@example.com", "recorded");
    for (const mode of ["assisted", "automated"] as const) {
      await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
      const r = (await g.client.call(token, message("new.person@example.com"))) as AskResponse;
      expect(r.outcome, mode).toBe("ask");
      expect(r.approvalId).toBeTruthy();
      expect(r.policyIds).toContain("mail-recorded-basis-asks");
    }
    expect(mock.sentFor(g.businessId).some((m) => m.to === "new.person@example.com")).toBe(false);
    expect(g.rateLimits.peek(`pm:${g.businessId}:day`, Date.now())).toBe(0);
    // Nobody at this address agreed, wrote or paid, and the founder did not add them: refused, with no approval to ask.
    const approvals = async () => (await g.h.pg.query<{ n: number }>("select count(*)::int as n from approvals where business_id = $1", [g.businessId])).rows[0]!.n;
    const before = await approvals();
    for (const mode of ["augmented", "assisted", "automated"] as const) {
      await repos.businesses.setBusinessMode(g.db, g.businessId, mode);
      const r = asDeny(await g.client.call(token, message("other.person@example.com")));
      expect(r.policyIds, mode).toEqual(["mail-needs-basis"]);
    }
    expect(await approvals()).toBe(before);
    expect(mock.sentFor(g.businessId).some((m) => m.to === "other.person@example.com")).toBe(false);
  });

  it("sends from the project's own address with signed custom args, marks it simulated and writes mail.sent", async () => {
    const r = asAllow(await g.client.call(token, message()));
    expect(r.result.ok).toBe(true);
    expect(r.result.simulated).toBe(true);
    const row = await repos.projectMail.get(g.db, g.businessId);
    expect(row?.localPart).toBeTruthy();
    const from = `${row!.localPart}@${DOMAIN}`;
    expect(r.result.data).toMatchObject({ from, to: "anna@example.com" });
    const sent = mock.sentFor(g.businessId).at(-1)!;
    const body = sent.body as { from: { email: string; name: string }; replyTo: { email: string }; personalizations: { customArgs: Record<string, string> }[]; headers: Record<string, string> };
    // Never as the project alone: "<project name> via <APP_NAME>", so it cannot pass for anyone the name imitates.
    expect(body.from).toEqual({ email: from, name: `Gateway Test Club via ${APP_NAME}` });
    expect(body.replyTo.email).toBe(from);
    // Signed with the development secret on a test stack, for this recipient; ingest verifies the same way.
    expect(verifyPlatformMailArgs(DEV_PLATFORM_MAIL_SECRET, { ...body.personalizations[0]!.customArgs, email: "anna@example.com" })).toEqual({ businessId: g.businessId, messageRef: sent.messageRef });
    expect(verifyPlatformMailArgs(DEV_PLATFORM_MAIL_SECRET, { ...body.personalizations[0]!.customArgs, email: "someone.else@example.com" })).toBeNull();
    // A marketing message: the founders' postal address is in the footer (US CAN-SPAM).
    expect((sent.body as { text: string }).text).toContain(`Postal address: ${POSTAL}.`);
    const unsubscribe = new URL(body.headers["List-Unsubscribe"]!.slice(1, -1));
    expect(unsubscribe.origin + unsubscribe.pathname).toBe("http://localhost:4005/mail/unsubscribe");
    expect(readPlatformUnsubscribeToken(DEV_PLATFORM_MAIL_SECRET, unsubscribe.searchParams.get("t")!)).toEqual({ businessId: g.businessId, emailHash: suppressionHashOfEmail("anna@example.com") });
    const [event] = await sentEvents();
    expect(event?.payload).toMatchObject({ messageRef: sent.messageRef, messageId: sent.messageId, recipientHash: suppressionHash("email", "anna@example.com"), fromLocalPart: row!.localPart, simulated: true, agentId: g.agentId });
    expect(JSON.stringify(event?.payload)).not.toContain("anna@example.com");
  });

  it(`a project whose name contains ${APP_NAME} never sends under it`, async () => {
    const original = (await repos.businesses.get(g.db, g.businessId)).name;
    await g.h.pg.query(`update businesses set name = $1 where id = $2`, [`${APP_NAME} Security Team`, g.businessId]);
    try {
      asAllow(await g.client.call(token, message("named@example.com")));
      const row = await repos.projectMail.get(g.db, g.businessId);
      const body = mock.sentFor(g.businessId).at(-1)!.body as { from: { name: string }; text: string };
      expect(body.from.name).toBe(`${row!.localPart} via ${APP_NAME}`);
      expect(body.text).toContain(`Sent by ${row!.localPart} with ${APP_NAME}.`);
    } finally {
      await g.h.pg.query(`update businesses set name = $1 where id = $2`, [original, g.businessId]);
    }
  });

  it("an agent cannot choose the sender, the custom args or an attachment", async () => {
    const before = mock.sentFor(g.businessId).length;
    for (const extra of [{ from: { email: "ceo@bank.example" } }, { customArgs: platformMailCustomArgs("x".repeat(20), g.businessId, g.agentId, "h") }, { attachments: [{ filename: "invoice.pdf", content: "x" }] }]) {
      const r = asDeny(await g.client.call(token, message("anna@example.com", extra)));
      expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.content]);
    }
    expect(mock.sentFor(g.businessId)).toHaveLength(before);
  });

  it("refuses unsafe HTML in plain words", async () => {
    const r = asDeny(await g.client.call(token, message("anna@example.com", { html: '<p>Hi</p><img src="https://track.example/p.png">' })));
    expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.content]);
    expect(r.reasons[0]).toMatch(/^Nothing was sent: the HTML may use simple tags only/);
  });

  it("a suppressed recipient is refused by the policy, before the guards", async () => {
    await repos.channels.addSuppression(g.db, g.businessId, { emailHash: suppressionHash("email", "gone@example.com"), reason: "unsubscribed" });
    const r = asDeny(await g.client.call(token, message("gone@example.com")));
    expect(r.policyIds).toContain("suppressed-recipient");
  });

  it("the founder's own SendGrid wins: the team is told to send from it", async () => {
    const own = await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "sendgrid", status: "connected", authKind: "api_key", accountLabel: "own" });
    try {
      const r = asDeny(await g.client.call(token, message()));
      expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.own_sender]);
    } finally {
      await repos.integrations.upsert(g.db, g.businessId, { connectorKey: "sendgrid", status: "disconnected", authKind: "api_key", accountLabel: own.accountLabel });
    }
  });

  it("a project Foundmill paused sends nothing", async () => {
    await repos.projectMail.ensure(g.db, g.businessId);
    await repos.projectMail.setStatus(g.db, g.businessId, "paused");
    try {
      expect(asDeny(await g.client.call(token, message())).policyIds).toEqual([PLATFORM_MAIL_POLICY.paused]);
    } finally {
      await repos.projectMail.setStatus(g.db, g.businessId, "active");
    }
  });

  it("the daily cap: refused in plain words once reached; the operator's override applies; refused sends do not count", async () => {
    const day = `pm:${g.businessId}:day`;
    const already = g.rateLimits.peek(day, Date.now());
    await repos.projectMail.setDailyCap(g.db, g.businessId, already + 2);
    try {
      asAllow(await g.client.call(token, message("one@example.com")));
      asAllow(await g.client.call(token, message("two@example.com")));
      const r = asDeny(await g.client.call(token, message("three@example.com")));
      expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.daily_cap]);
      expect(r.reasons).toEqual([PLATFORM_MAIL_REFUSALS.daily_cap(already + 2)]);
      expect(g.rateLimits.peek(day, Date.now())).toBe(already + 2);
    } finally {
      await repos.projectMail.setDailyCap(g.db, g.businessId, null);
    }
  });

  it("the deployment's ceiling stops every project and gives the project's count back", async () => {
    const day = `pm:${g.businessId}:day`;
    const before = g.rateLimits.peek(day, Date.now());
    g.deps.platformMail = config({ ceiling: g.rateLimits.peek("pm:all:day", Date.now()) });
    const r = asDeny(await g.client.call(token, message("four@example.com")));
    expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.ceiling]);
    expect(g.rateLimits.peek(day, Date.now())).toBe(before);
  });

  it("on staging the signing secret is required, even for the mock", async () => {
    g.deps.appEnv = "staging";
    try {
      expect(asDeny(await g.client.call(token, message())).policyIds).toEqual([PLATFORM_MAIL_POLICY.unconfigured]);
    } finally {
      g.deps.appEnv = "test";
    for (const e of MAILABLE) await g.mailable(e);
    }
  });

  it("on staging a mock send for a person's project is refused as not switched on (never reported as sent); a sample business still gets it", async () => {
    g.deps.appEnv = "staging";
    g.deps.platformMail = config({ signingSecret: "staging-platform-mail-signing-secret-0123", unsubscribeBase: "https://ingest.foundmill.test" });
    const before = mock.sentFor(g.businessId).length;
    try {
      const r = asDeny(await g.client.call(token, message("staging@example.com")));
      expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.simulated]);
      expect(r.reasons).toEqual([PLATFORM_MAIL_REFUSALS.off]);
      expect(mock.sentFor(g.businessId)).toHaveLength(before);
      expect((await repos.audit.get(g.db, g.businessId, r.auditId)).details).toMatchObject({ outcome: "deny", policyIds: [PLATFORM_MAIL_POLICY.simulated] });
    } finally {
      g.deps.appEnv = "test";
    for (const e of MAILABLE) await g.mailable(e);
    }
  });

  it("outside development and test, a daily count that is not shared refuses the send in plain words, audited", async () => {
    const memory = g.rateLimits;
    const day = `pm:${g.businessId}:day`;
    g.deps.platformMail = config({ signingSecret: "staging-platform-mail-signing-secret-0123", unsubscribeBase: "https://ingest.foundmill.test" });
    // A sample business, so the mock may answer on staging and the count is the guard that decides.
    await g.h.pg.query(`update businesses set is_demo = true where id = $1`, [g.businessId]);
    g.deps.appEnv = "staging";
    const before = mock.sentFor(g.businessId).length;
    try {
      // No Redis at all (a per-process memory store): refused, and nothing stays counted.
      const counted = memory.peek(day, Date.now());
      const r = asDeny(await g.client.call(token, message("memory@example.com")));
      expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.store]);
      expect(r.reasons).toEqual(["Sending is paused for a moment, so nothing was sent. Try again later."]);
      expect(r.reasons).toEqual([PLATFORM_MAIL_REFUSALS.store_unavailable]);
      expect(memory.peek(day, Date.now())).toBe(counted);
      expect((await repos.audit.get(g.db, g.businessId, r.auditId)).details).toMatchObject({ outcome: "deny", policyIds: [PLATFORM_MAIL_POLICY.store] });
      // A Redis store while Redis is down (it counts in memory meanwhile): refused too.
      const redis = fakeRedis();
      g.deps.rateLimits = new RedisRateLimitStore(redis.redis, { retryAfterMs: 0 });
      redis.state.down = true;
      expect(asDeny(await g.client.call(token, message("redis-down@example.com"))).policyIds).toEqual([PLATFORM_MAIL_POLICY.store]);
      expect(mock.sentFor(g.businessId)).toHaveLength(before);
      // Redis answering again: it sends, counted in Redis.
      redis.state.down = false;
      asAllow(await g.client.call(token, message("redis-up@example.com")));
      expect(redis.peek(day)).toBe(1);
      expect(mock.sentFor(g.businessId)).toHaveLength(before + 1);
    } finally {
      g.deps.rateLimits = memory;
      g.deps.appEnv = "test";
    for (const e of MAILABLE) await g.mailable(e);
      await g.h.pg.query(`update businesses set is_demo = false where id = $1`, [g.businessId]);
    }
  });

  it("in development the in-memory count is enough", async () => {
    g.deps.appEnv = "development";
    try {
      asAllow(await g.client.call(token, message("dev@example.com")));
    } finally {
      g.deps.appEnv = "test";
    for (const e of MAILABLE) await g.mailable(e);
    }
  });

  it("reads its configuration from the shared env, and refuses to boot outside development and test without a real secret", () => {
    const env = { APP_ENV: "production" as const, PLATFORM_MAIL_DOMAIN: "mail.foundmill.com", PLATFORM_MAIL_DAILY_CAP: 50, PLATFORM_MAIL_DAILY_CEILING: 2000, INGEST_PUBLIC_URL: "https://ingest.foundmill.com/", INGEST_URL: "http://localhost:4005" };
    const secret = "s".repeat(32);
    expect(platformMailConfig({ ...env, PLATFORM_MAIL_SIGNING_SECRET: ` ${secret} ` })).toEqual({ domain: "mail.foundmill.com", dailyCap: 50, ceiling: 2000, signingSecret: secret, unsubscribeBase: "https://ingest.foundmill.com", notifyLocalPart: "hello", notifyCeiling: 1000 });
    expect(platformMailConfig({ ...env, PLATFORM_MAIL_SIGNING_SECRET: secret, PLATFORM_NOTIFY_DAILY_CEILING: 300 }).notifyCeiling).toBe(300);
    // Foundmill's own email to its users (notify-email.ts): its local part and where its link points.
    expect(platformMailConfig({ ...env, PLATFORM_MAIL_SIGNING_SECRET: secret, PLATFORM_NOTIFY_LOCAL_PART: "notifications", APP_URL: "https://foundmill.com/" })).toMatchObject({ notifyLocalPart: "notifications", appUrl: "https://foundmill.com" });
    expect(() => platformMailConfig(env)).toThrow(/PLATFORM_MAIL_SIGNING_SECRET/);
    expect(() => platformMailConfig({ ...env, APP_ENV: "staging", PLATFORM_MAIL_SIGNING_SECRET: "short" })).toThrow(/at least 32/);
    expect(platformMailConfig({ ...env, APP_ENV: "development" }).signingSecret).toBeNull();
    expect(platformMailConfig({ ...env, APP_ENV: "test" }).signingSecret).toBeNull();
  });
});

describe("platform_mail through the gateway (live: SendGrid on the platform key)", () => {
  const SECRET = "live-platform-mail-signing-secret-0123456789";
  const posted: { auth: string | null; body: Record<string, unknown> }[] = [];
  let vendorStatus = 202;
  let timeout = false;
  let g: GatewayFixture;
  let token: string;

  // Production counts in Redis; a stand-in that answers.
  const counter = fakeRedis();
  const peek = counter.peek;

  beforeAll(async () => {
    const live = createPlatformMailConnector({
      secrets: { sendgridApiKey: "SG.platform-key-test" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          if (timeout) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
          posted.push({ auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> });
          return vendorStatus < 300 ? new Response(null, { status: vendorStatus, headers: { "x-message-id": `sg-${posted.length}` } }) : new Response(JSON.stringify({ errors: [{ message: "bad" }] }), { status: vendorStatus, headers: { "content-type": "application/json" } });
        },
      }),
    });
    g = await setupGateway({ businessMode: "automated", connectors: [live], liveConnectors: ["sendgrid"] });
    g.deps.appEnv = "production";
    for (const e of MAILABLE) await g.mailable(e);
    g.deps.rateLimits = new RedisRateLimitStore(counter.redis);
    token = await g.token({ allowedTools: ["platform_mail:*"] });
    await repos.postalAddress.set(g.db, g.businessId, { address: POSTAL, userId: null });
  }, 120_000);
  afterAll(async () => g.close());

  it("live needs the signing secret and an https unsubscribe address", async () => {
    g.deps.platformMail = config({ signingSecret: null, unsubscribeBase: "https://ingest.foundmill.test" });
    expect(asDeny(await g.client.call(token, message())).policyIds).toEqual([PLATFORM_MAIL_POLICY.unconfigured]);
    g.deps.platformMail = config({ signingSecret: SECRET, unsubscribeBase: "http://ingest.internal:4005" });
    expect(asDeny(await g.client.call(token, message())).policyIds).toEqual([PLATFORM_MAIL_POLICY.unconfigured]);
    expect(posted).toHaveLength(0);
  });

  it("sends on the platform key, not simulated, and mail.sent says so; a refused send does not count", async () => {
    g.deps.platformMail = config({ signingSecret: SECRET, unsubscribeBase: "https://ingest.foundmill.test" });
    const r = asAllow(await g.client.call(token, message()));
    expect(r.result.ok).toBe(true);
    expect(r.result.simulated).toBeUndefined();
    expect(posted[0]!.auth).toBe("Bearer SG.platform-key-test");
    const p = (posted[0]!.body.personalizations as { custom_args: Record<string, string> }[])[0]!;
    expect(verifyPlatformMailArgs(SECRET, { ...p.custom_args, email: "anna@example.com" })?.businessId).toBe(g.businessId);
    expect((posted[0]!.body.from as { name: string }).name).toBe(`Gateway Test Club via ${APP_NAME}`);
    expect(posted[0]!.body.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text/plain", value: expect.stringContaining(`Postal address: ${POSTAL}.`) })]));
    const [event] = (await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items;
    expect(event?.payload).toMatchObject({ messageId: "sg-1", simulated: false });

    const day = `pm:${g.businessId}:day`;
    const before = peek(day);
    expect(before).toBe(1);
    vendorStatus = 400;
    const refused = asAllow(await g.client.call(token, message("two@example.com")));
    expect(refused.result.ok).toBe(false);
    expect(peek(day)).toBe(before);
    expect(peek("pm:all:day")).toBe(before);
    expect((await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items).toHaveLength(1);
    vendorStatus = 202;
  });

  it("an ambiguous failure (a 5xx, a timeout) keeps the count: the message may have gone out", async () => {
    g.deps.platformMail = config({ signingSecret: SECRET, unsubscribeBase: "https://ingest.foundmill.test" });
    const day = `pm:${g.businessId}:day`;
    for (const [status, to] of [[500, "five@example.com"], [503, "six@example.com"]] as const) {
      const before = peek(day);
      const ceilingBefore = peek("pm:all:day");
      vendorStatus = status;
      const r = asAllow(await g.client.call(token, message(to)));
      expect(r.result.ok).toBe(false);
      expect(peek(day), String(status)).toBe(before + 1);
      expect(peek("pm:all:day"), String(status)).toBe(ceilingBefore + 1);
    }
    vendorStatus = 202;
    // A timeout: the vendor never answers in time.
    timeout = true;
    try {
      const before = peek(day);
      const r = asAllow(await g.client.call(token, message("seven@example.com")));
      expect(r.result.ok).toBe(false);
      expect(peek(day)).toBe(before + 1);
    } finally {
      timeout = false;
    }
    expect((await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items).toHaveLength(1);
  });
});

describe("platform_mail and the founders' postal address (US CAN-SPAM)", () => {
  let g: GatewayFixture;
  const mock = createPlatformMailMock();
  let token: string;
  const notes = async () => (await repos.inbox.list(g.db, g.businessId, { tab: "all", limit: 50 })).items.filter((i) => (i.decision as { key?: string } | null)?.key === POSTAL_ADDRESS_NOTE.key);

  beforeAll(async () => {
    g = await setupGateway({ businessMode: "automated", connectors: [mock] });
    g.deps.appEnv = "test";
    for (const e of MAILABLE) await g.mailable(e);
    g.deps.platformMail = config();
    token = await g.token({ allowedTools: ["platform_mail:*"] });
  }, 120_000);
  afterAll(async () => g.close());

  it("refuses a marketing message without the address, in plain words the agent reports, counting nothing", async () => {
    const r = asDeny(await g.client.call(token, message("lead@example.com")));
    expect(r.policyIds).toEqual([PLATFORM_MAIL_POLICY.no_postal_address]);
    expect(r.reasons).toEqual([PLATFORM_MAIL_REFUSALS.no_postal_address]);
    expect(r.reasons[0]).toMatch(/^Not sent: the founder has not added a postal address yet\./);
    expect(mock.sentFor(g.businessId)).toHaveLength(0);
    expect(g.rateLimits.peek(`pm:${g.businessId}:day`, Date.now())).toBe(0);
    expect((await repos.audit.get(g.db, g.businessId, r.auditId)).details).toMatchObject({ outcome: "deny", policyIds: [PLATFORM_MAIL_POLICY.no_postal_address] });
    // A purpose the gateway cannot prove is marketing too.
    expect(asDeny(await g.client.call(token, message("stranger@example.com", { purpose: "reply" }))).policyIds).toEqual([PLATFORM_MAIL_POLICY.no_postal_address]);
    expect(asDeny(await g.client.call(token, message("stranger@example.com", { purpose: "receipt" }))).policyIds).toEqual([PLATFORM_MAIL_POLICY.no_postal_address]);
  });

  it("raises one note to the founders, in Needs you, and no other while it is open", async () => {
    const open = await notes();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ type: "decision", subject: POSTAL_ADDRESS_NOTE.subject, blocksContinue: false });
    const created = (await repos.events.list(g.db, g.businessId, { type: "inbox.item_created" })).items.filter((e) => (e.payload as { inboxItemId?: string }).inboxItemId === open[0]!.id);
    expect(created).toHaveLength(1);
    const respond = (await repos.inbox.list(g.db, g.businessId, { tab: "respond", limit: 50 })).items.map((i) => i.id);
    expect(respond).toContain(open[0]!.id);
    asDeny(await g.client.call(token, message("lead2@example.com")));
    expect(await notes()).toHaveLength(1);
  });

  it("a reply to a person who wrote first goes out without the address; a reply to someone who never wrote does not", async () => {
    const replier = "writer@example.com";
    await writeGatewayEventForTest(g, "lead.replied", replier);
    const r = asAllow(await g.client.call(token, message(replier, { purpose: "reply", subject: "Re: your question", text: "Yes, the class is on Tuesday at 5 PM." })));
    expect(r.result.ok).toBe(true);
    const sent = mock.sentFor(g.businessId).at(-1)!;
    expect(sent.to).toBe(replier);
    const text = (sent.body as { text: string }).text;
    expect(text).not.toContain("Postal address");
    expect(text).toContain("To stop getting these emails:");
    // Their reply does not make a marketing message to them transactional.
    expect(asDeny(await g.client.call(token, message(replier))).policyIds).toEqual([PLATFORM_MAIL_POLICY.no_postal_address]);
  });

  it("a reply asking to stop is no relationship to answer", async () => {
    const quitter = "quit@example.com";
    await writeGatewayEventForTest(g, "lead.replied", quitter, { sentiment: "unsubscribe" });
    expect(asDeny(await g.client.call(token, message(quitter, { purpose: "reply" }))).policyIds).toEqual([PLATFORM_MAIL_POLICY.no_postal_address]);
  });

  it("a receipt for a payment from that address goes out without it", async () => {
    const payer = "Payer@Example.com";
    await writeGatewayEventForTest(g, "payment.received", payer);
    const r = asAllow(await g.client.call(token, message(payer, { purpose: "receipt", subject: "Your receipt", text: "Thanks for your payment of $20 for the March class." })));
    expect(r.result.ok).toBe(true);
    expect((mock.sentFor(g.businessId).at(-1)!.body as { text: string }).text).not.toContain("Postal address");
  });

  it("once the founders add it, marketing goes out with it in the footer", async () => {
    await repos.postalAddress.set(g.db, g.businessId, { address: POSTAL, userId: null });
    try {
      asAllow(await g.client.call(token, message("lead@example.com")));
      const body = mock.sentFor(g.businessId).at(-1)!.body as { text: string; html?: string };
      expect(body.text).toContain(`Postal address: ${POSTAL}.`);
    } finally {
      await repos.postalAddress.clear(g.db, g.businessId);
    }
  });
});

/** A verified reply from `email` (as ingest writes it) or a payment from it, in this business's event log. */
async function writeGatewayEventForTest(g: GatewayFixture, type: "lead.replied" | "payment.received", email: string, over: Record<string, unknown> = {}): Promise<void> {
  const entityId = emailEntityId(email);
  const payload =
    type === "lead.replied"
      ? { entityId, channelKey: "email_automation", campaignId: null, interactionId: crypto.randomUUID(), sentiment: "neutral", summary: "Email reply (12 words); body quarantined for the reader.", requestsMeeting: false, ...over }
      : { entityId, conversionId: crypto.randomUUID(), amount: { amountMinor: 2000, currency: "USD" }, provider: "stripe", externalId: `in_${crypto.randomUUID()}`, firstPayment: true, recurring: false, productRef: null, fee: null, customer: { externalId: null, email, name: null }, source: null, ...over };
  await repos.events.write(g.db, g.businessId, { id: crypto.randomUUID(), type, actor: { kind: "webhook", id: "test" }, entityIds: [entityId], payload, occurredAt: new Date() });
}
