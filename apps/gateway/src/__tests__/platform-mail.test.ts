/**
 * A project's Foundmill sending address through the gateway (package 1.5): Cedar first and unchanged (a first message to
 * someone outside the project asks), then the guards of platform-mail.ts in order, then the vendor; the sender and the
 * signed custom args come from the gateway, a send that went out writes `mail.sent`, and only sends that went out count
 * against the project's day and the deployment's ceiling.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPlatformMailConnector, createPlatformMailMock, platformMailCustomArgs, readPlatformUnsubscribeToken, routedFetch, suppressionHashOfEmail, verifyPlatformMailArgs } from "@foundmill/connectors";
import { repos, suppressionHash } from "@foundmill/db";
import { PLATFORM_MAIL_REFUSALS } from "@foundmill/shared";
import { DEV_PLATFORM_MAIL_SECRET, PLATFORM_MAIL_POLICY, platformMailConfig, type PlatformMailConfig } from "../platform-mail";
import { setupGateway, type GatewayFixture } from "./harness";
import type { AllowResponse, AskResponse, CallResponse, DenyResponse } from "../types";

const DOMAIN = "mail.foundmill.test";
const config = (over: Partial<PlatformMailConfig> = {}): PlatformMailConfig => ({ domain: DOMAIN, dailyCap: 50, ceiling: 2_000, signingSecret: null, unsubscribeBase: "http://localhost:4005", ...over });
const message = (to = "anna@example.com", over: Record<string, unknown> = {}) => ({ connector: "platform_mail", tool: "send_mail", args: { to: { email: to, name: "Anna" }, subject: "Thanks for joining", text: "Hi Anna, thanks for joining the list.", ...over } });

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
    token = await g.token({ allowedTools: ["platform_mail:*"] });
  }, 120_000);
  afterAll(async () => g.close());
  beforeEach(async () => {
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

  it("a first message to someone new asks the founder in assisted mode, and nothing is sent or counted", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "assisted");
    const r = (await g.client.call(token, message("new.person@example.com"))) as AskResponse;
    expect(r.outcome).toBe("ask");
    expect(r.approvalId).toBeTruthy();
    expect(r.reasons.join(" ")).toMatch(/irreversible/i);
    expect(mock.sentFor(g.businessId).some((m) => m.to === "new.person@example.com")).toBe(false);
    expect(g.rateLimits.peek(`pm:${g.businessId}:day`, Date.now())).toBe(0);
    await repos.businesses.setBusinessMode(g.db, g.businessId, "augmented");
    expect((await g.client.call(token, message("other.person@example.com"))).outcome).toBe("ask");
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
    expect(body.from).toEqual({ email: from, name: "Gateway Test Club" });
    expect(body.replyTo.email).toBe(from);
    // Signed with the development secret on a test stack; ingest verifies the same way.
    expect(verifyPlatformMailArgs(DEV_PLATFORM_MAIL_SECRET, body.personalizations[0]!.customArgs)).toEqual({ businessId: g.businessId, messageRef: sent.messageRef });
    const unsubscribe = new URL(body.headers["List-Unsubscribe"]!.slice(1, -1));
    expect(unsubscribe.origin + unsubscribe.pathname).toBe("http://localhost:4005/mail/unsubscribe");
    expect(readPlatformUnsubscribeToken(DEV_PLATFORM_MAIL_SECRET, unsubscribe.searchParams.get("t")!)).toEqual({ businessId: g.businessId, emailHash: suppressionHashOfEmail("anna@example.com") });
    const [event] = await sentEvents();
    expect(event?.payload).toMatchObject({ messageRef: sent.messageRef, messageId: sent.messageId, recipientHash: suppressionHash("email", "anna@example.com"), fromLocalPart: row!.localPart, simulated: true, agentId: g.agentId });
    expect(JSON.stringify(event?.payload)).not.toContain("anna@example.com");
  });

  it("an agent cannot choose the sender, the custom args or an attachment", async () => {
    const before = mock.sentFor(g.businessId).length;
    for (const extra of [{ from: { email: "ceo@bank.example" } }, { customArgs: platformMailCustomArgs("x".repeat(20), g.businessId, g.agentId) }, { attachments: [{ filename: "invoice.pdf", content: "x" }] }]) {
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
    }
  });

  it("reads its configuration from the shared env", () => {
    const c = platformMailConfig({ PLATFORM_MAIL_DOMAIN: "mail.foundmill.com", PLATFORM_MAIL_DAILY_CAP: 50, PLATFORM_MAIL_DAILY_CEILING: 2000, PLATFORM_MAIL_SIGNING_SECRET: " s ", INGEST_PUBLIC_URL: "https://ingest.foundmill.com/", INGEST_URL: "http://localhost:4005" });
    expect(c).toEqual({ domain: "mail.foundmill.com", dailyCap: 50, ceiling: 2000, signingSecret: "s", unsubscribeBase: "https://ingest.foundmill.com" });
  });
});

describe("platform_mail through the gateway (live: SendGrid on the platform key)", () => {
  const SECRET = "live-platform-mail-signing-secret-0123456789";
  const posted: { auth: string | null; body: Record<string, unknown> }[] = [];
  let vendorStatus = 202;
  let g: GatewayFixture;
  let token: string;

  beforeAll(async () => {
    const live = createPlatformMailConnector({
      secrets: { sendgridApiKey: "SG.platform-key-test" },
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/mail/send": async (req) => {
          posted.push({ auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> });
          return vendorStatus < 300 ? new Response(null, { status: vendorStatus, headers: { "x-message-id": `sg-${posted.length}` } }) : new Response(JSON.stringify({ errors: [{ message: "bad" }] }), { status: vendorStatus, headers: { "content-type": "application/json" } });
        },
      }),
    });
    g = await setupGateway({ businessMode: "automated", connectors: [live], liveConnectors: ["sendgrid"] });
    g.deps.appEnv = "production";
    token = await g.token({ allowedTools: ["platform_mail:*"] });
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
    expect(verifyPlatformMailArgs(SECRET, p.custom_args)?.businessId).toBe(g.businessId);
    const [event] = (await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items;
    expect(event?.payload).toMatchObject({ messageId: "sg-1", simulated: false });

    const day = `pm:${g.businessId}:day`;
    const before = g.rateLimits.peek(day, Date.now());
    vendorStatus = 400;
    const refused = asAllow(await g.client.call(token, message("two@example.com")));
    expect(refused.result.ok).toBe(false);
    expect(g.rateLimits.peek(day, Date.now())).toBe(before);
    expect((await repos.events.list(g.db, g.businessId, { type: "mail.sent" })).items).toHaveLength(1);
    vendorStatus = 202;
  });
});
