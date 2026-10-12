import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, makeEvent, mockHealth, mockIntegrationRecord, perBusiness, simulate, stableHash, uuidFromSeed } from "../../mock-utils";
import { makeWebhookRequest, ReplayGuard } from "../../webhooks";
import { MOCK_SENDER_EMAIL, MOCK_SENDGRID_INBOUND_TOKEN, MOCK_SENDGRID_PRIVATE_KEY_PEM, MOCK_SENDGRID_PUBLIC_KEY, SG_SINGLE_SENDS, SG_STATS, SG_SUPPRESSIONS, SG_VERIFIED_SENDERS } from "./fixtures/sendgrid";
import { allRecipients, assertNoneSuppressed, assertUnsubscribe, assertVerifiedSender, buildMailData, mapSingleSend, mapVerifiedSender, SENDGRID_KEY, SENDGRID_RATE_LIMITS, sendgridTools, summariseStats, type SgSingleSend } from "./tools";
import { createSendgridEventWebhook, createSendgridInboundWebhook, normaliseInboundMail, SG_SIGNATURE_HEADER, SG_TIMESTAMP_HEADER, type SgEvent } from "./webhooks";

export const MOCK_NOW_UNIX = Math.floor(MOCK_NOW.getTime() / 1000);

/** Sign an Event Webhook delivery the way SendGrid does (ECDSA P-256 over timestamp + body). */
export function signSendgridBody(body: string, timestamp: string, privateKeyPem = MOCK_SENDGRID_PRIVATE_KEY_PEM): string {
  return cryptoSign("sha256", Buffer.from(timestamp + body, "utf8"), { key: createPrivateKey(privateKeyPem), dsaEncoding: "der" }).toString("base64");
}

export function signedEventRequest(businessId: string, events: SgEvent[], opts: { privateKeyPem?: string; timestamp?: number; signature?: string } = {}): Request {
  const body = JSON.stringify(events);
  const timestamp = String(opts.timestamp ?? MOCK_NOW_UNIX);
  return makeWebhookRequest(`https://ingest.example/webhooks/${SENDGRID_KEY}/${businessId}`, body, { "content-type": "application/json", [SG_TIMESTAMP_HEADER]: timestamp, [SG_SIGNATURE_HEADER]: opts.signature ?? signSendgridBody(body, timestamp, opts.privateKeyPem) });
}

export function inboundParseRequest(businessId: string, fields: Record<string, string>, token: string | null = MOCK_SENDGRID_INBOUND_TOKEN): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`https://ingest.example/webhooks/${SENDGRID_KEY}-inbound/${businessId}${token ? `?token=${encodeURIComponent(token)}` : ""}`, { method: "POST", body: form });
}

export const sgEvent = (event: string, email: string, extra: Partial<SgEvent> = {}): SgEvent => ({ email, event, timestamp: MOCK_NOW_UNIX, sg_event_id: stableHash([event, email, extra], 22), sg_message_id: `msg_${stableHash([email, event], 12)}`, ...extra });

export const isMockSuppressed = (email: string): boolean => Boolean(SG_SUPPRESSIONS[email.toLowerCase()]);

/**
 * One SendGrid account per business (the fixtures are copied for each): campaigns, sends and suppressions are the
 * business's own, so one business's `add_suppression` never blocks another's mail and nobody schedules another's campaign.
 */
export function createSendgridMock() {
  const world = perBusiness(() => ({
    singleSends: new Map<string, SgSingleSend>(SG_SINGLE_SENDS.map((s) => [s.id, structuredClone(s)])),
    suppressions: new Map<string, (typeof SG_SUPPRESSIONS)[string]>(Object.entries(SG_SUPPRESSIONS).map(([k, v]) => [k, [...v]])),
    sent: [] as { messageId: string; to: string[]; subject: string; kind: string; body: Record<string, unknown> }[],
  }));
  const eventWebhook = createSendgridEventWebhook({ publicKeyFor: async () => MOCK_SENDGRID_PUBLIC_KEY, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });
  const inboundWebhook = createSendgridInboundWebhook({ tokenFor: async () => MOCK_SENDGRID_INBOUND_TOKEN, replay: new ReplayGuard({ now: () => MOCK_NOW.getTime() }), now: () => MOCK_NOW });

  const connector = buildMockConnector({
    key: SENDGRID_KEY,
    displayName: "SendGrid",
    phase: 2,
    auth: { kind: "api_key" },
    tools: sendgridTools,
    rateLimits: SENDGRID_RATE_LIMITS,
    now: () => MOCK_NOW,
    webhooks: [eventWebhook, inboundWebhook],
    handlers: {
      list_verified_senders: async () => ({ items: SG_VERIFIED_SENDERS.map(mapVerifiedSender) }),
      check_suppression: async ({ emails }, ctx) => {
        const { suppressions } = world(ctx.businessId);
        const suppressed = emails.filter((e) => suppressions.has(e.toLowerCase())).map((e) => ({ email: e, kinds: [...suppressions.get(e.toLowerCase())!] }));
        return { suppressed, clear: emails.filter((e) => !suppressions.has(e.toLowerCase())) };
      },
      add_suppression: async ({ emails }, ctx) => {
        const { suppressions } = world(ctx.businessId);
        for (const e of emails) {
          const kinds = suppressions.get(e.toLowerCase()) ?? [];
          if (!kinds.includes("global_unsubscribe")) suppressions.set(e.toLowerCase(), [...kinds, "global_unsubscribe"]);
        }
        return { added: emails.map((e) => e.toLowerCase()) };
      },
      send_mail: async (mail, ctx) => {
        const { suppressions, sent } = world(ctx.businessId);
        assertVerifiedSender(mail.from, SG_VERIFIED_SENDERS.map(mapVerifiedSender));
        assertUnsubscribe(mail);
        await assertNoneSuppressed(allRecipients(mail), (e) => suppressions.has(e));
        const body = buildMailData(mail);
        const messageId = `${stableHash([mail.subject, mail.to, mail.text], 22)}.filterdrecv-mock`;
        sent.push({ messageId, to: mail.to.map((t) => t.email), subject: mail.subject, kind: mail.kind, body });
        return { messageId, accepted: allRecipients(mail), rejected: [], scheduledFor: mail.sendAt ?? null };
      },
      list_campaigns: async ({ pageSize }, ctx) => ({ items: [...world(ctx.businessId).singleSends.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, pageSize).map(mapSingleSend) }),
      create_campaign: async ({ name, subject, html, text, senderId, listIds, suppressionGroupId, customUnsubscribeUrl }, ctx) => {
        const { singleSends } = world(ctx.businessId);
        if (!SG_VERIFIED_SENDERS.some((s) => s.id === senderId && s.verified)) throw Object.assign(new Error(`sender ${senderId} is not a verified sender`), { status: 400 });
        const id = `ss_${stableHash(["ss", name, subject, listIds], 16)}`;
        const existing = singleSends.get(id);
        if (existing) return mapSingleSend(existing);
        const s: SgSingleSend = { id, name, status: "draft", send_at: null, send_to: { list_ids: listIds }, email_config: { subject, html_content: html, plain_content: text, sender_id: senderId, suppression_group_id: suppressionGroupId, custom_unsubscribe_url: customUnsubscribeUrl ?? null }, created_at: MOCK_NOW.toISOString(), updated_at: MOCK_NOW.toISOString() };
        singleSends.set(id, s);
        return mapSingleSend(s);
      },
      schedule_campaign: async ({ campaignId, sendAt }, ctx) => {
        const s = world(ctx.businessId).singleSends.get(campaignId);
        if (!s) throw Object.assign(new Error(`single send ${campaignId} not found`), { status: 404 });
        if (s.status === "triggered") throw Object.assign(new Error(`single send ${campaignId} was already sent`), { status: 400 });
        s.status = sendAt === "now" ? "triggered" : "scheduled";
        s.send_at = sendAt === "now" ? MOCK_NOW.toISOString() : sendAt;
        s.updated_at = MOCK_NOW.toISOString();
        return mapSingleSend(s);
      },
      get_stats: async ({ startDate, endDate }) => summariseStats(SG_STATS.filter((d) => d.date >= startDate && (!endDate || d.date <= endDate))),
    },
    connect: async (businessId) => mockIntegrationRecord(SENDGRID_KEY, businessId, { accountLabel: "Northwind Skincare (SendGrid, mock)", config: { verifiedSenders: SG_VERIFIED_SENDERS.filter((s) => s.verified).map((s) => s.from_email), inboundDomain: "reply.northwindskincare.com" } }),
    healthcheck: async (integration) => mockHealth(SENDGRID_KEY, { verifiedSenders: SG_VERIFIED_SENDERS.filter((s) => s.verified).length, sent: world(integration.businessId).sent.length }),
    simulations: {
      "lead.replied": (params) => {
        const email = typeof params.email === "string" ? params.email : "maja@sensitiveskinclub.se";
        const sentiment = typeof params.sentiment === "string" ? params.sentiment : "positive";
        if (sentiment === "positive") return simulate("lead.replied", { ...params, email, sentiment });
        const text = sentiment === "unsubscribe" ? "Please unsubscribe me from these emails." : sentiment === "out_of_office" ? "Automatic reply: I am out of office until Monday." : "Thanks, we'll come back to you.";
        return normaliseInboundMail({ from: email, to: MOCK_SENDER_EMAIL, subject: "Re: Your autumn routine", text, html: "", envelope: null, attachments: 0, dkim: "{@example.com : pass}", spf: "pass", spamScore: 0.1, messageIdHeader: `<sim-${stableHash([params.businessId, params.seed ?? "default"], 16)}@example.com>` }, params.businessId, () => params.occurredAt ?? MOCK_NOW);
      },
      "spam.spike": (params) => [
        makeEvent("channel.threshold_breached", {
          businessId: params.businessId,
          occurredAt: params.occurredAt ?? MOCK_NOW,
          seed: String(params.seed ?? "default"),
          payload: { channelId: uuidFromSeed("sim", params.businessId, "channel", "email_automation"), channelKey: "email_automation", campaignId: uuidFromSeed("sim", params.businessId, "campaign", "email_automation", String(params.seed ?? "default")), metric: "spam_rate", value: typeof params.value === "number" ? params.value : 0.74, threshold: 0.3, direction: "above", windowHours: 24, action: "paused" },
        }),
      ],
      "credential.expiry": (params) => simulate("credential.expiry", { ...params, connectorKey: SENDGRID_KEY }),
    },
  });
  /** `sentFor(businessId)` / `suppressionsFor(businessId)`: that business's sends and suppression list (tests). */
  return Object.assign(connector, { sentFor: (businessId: string) => world(businessId).sent, suppressionsFor: (businessId: string) => world(businessId).suppressions });
}

export const sendgridMock = createSendgridMock();
