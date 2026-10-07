/**
 * Live SendGrid connector. Mail is composed and validated by `@sendgrid/mail`'s MailService (8.1) and sent
 * through a fetch-based client so the transport is injectable; every other endpoint (verified senders,
 * suppressions, Marketing single sends, stats) is plain v3 REST with a Bearer key. Key precedence: the
 * business's own (subuser) key in `ctx.credential.secret` → platform SENDGRID_API_KEY.
 */
import { MailService } from "@sendgrid/mail";
import { uuid } from "@founder-manager/shared";
import { ConfigError, VendorError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp, type FetchLike, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { sendgridMock } from "./mock";
import { allRecipients, assertNoneSuppressed, assertUnsubscribe, assertVerifiedSender, buildMailData, mapSingleSend, mapVerifiedSender, SENDGRID_BASE_URL, SENDGRID_KEY, SENDGRID_RATE_LIMITS, sendgridTools, summariseStats, type SgSingleSend, type SgStatsDay, type SgVerifiedSender } from "./tools";
import { createSendgridEventWebhook, createSendgridInboundWebhook } from "./webhooks";

type SgClient = Parameters<MailService["setClient"]>[0];
interface SgRequest { method?: string; url?: string; headers?: Record<string, string>; body?: unknown; qs?: Record<string, unknown> }

/** The subset of `@sendgrid/client` MailService uses, over fetch (the SDK's own client is axios-based). */
export function createSendgridTransport(fetchImpl: FetchLike, apiKey: string): SgClient {
  const http = createHttp({ connectorKey: SENDGRID_KEY, baseUrl: SENDGRID_BASE_URL, fetch: fetchImpl, headers: { authorization: bearer(apiKey) } });
  const client = {
    async request(data: SgRequest, cb?: (err: unknown, response: [unknown, unknown]) => void) {
      try {
        const res = await http.raw(data.method ?? "GET", data.url ?? "/", { body: data.body, headers: data.headers, query: data.qs as Record<string, string> | undefined });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          /* non-JSON body (202 Accepted has none) */
        }
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => (headers[k] = v));
        const result: [unknown, unknown] = [{ statusCode: res.status, body, headers }, body];
        cb?.(null, result);
        return result;
      } catch (e) {
        if (cb) cb(e, [undefined, undefined]);
        throw e;
      }
    },
  };
  return client as unknown as SgClient;
}

export function createSendgridConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, getBusinessSecret, resolveBusinessId, isSuppressed } = resolveLiveOptions(options);

  const keyFor = (ctx?: ToolContext): string => {
    const key = ctx?.credential?.secret ?? secrets.sendgridApiKey;
    if (!key) throw new ConfigError(SENDGRID_KEY, "SENDGRID_API_KEY or a per-business key", "create a restricted API key (Mail Send, Suppressions, Marketing, Stats) in SendGrid");
    return key;
  };
  const http = (ctx?: ToolContext): HttpClient => createHttp({ connectorKey: SENDGRID_KEY, baseUrl: SENDGRID_BASE_URL, fetch, headers: { authorization: bearer(keyFor(ctx)) } });
  const mailer = (ctx: ToolContext): MailService => {
    const m = new MailService();
    m.setClient(createSendgridTransport(fetch, keyFor(ctx)));
    return m;
  };

  const verifiedSenders = async (h: HttpClient) => ((await h.json<{ results?: SgVerifiedSender[] }>("GET", "/v3/verified_senders")).results ?? []).map(mapVerifiedSender);

  /** SendGrid-side suppression kinds for one address (404 / empty array = not suppressed). */
  const suppressionKinds = async (h: HttpClient, email: string) => {
    const kinds: ("global_unsubscribe" | "bounce" | "spam_report" | "block" | "invalid_email")[] = [];
    const e = encodeURIComponent(email);
    const probe = async (path: string, kind: (typeof kinds)[number]) => {
      const body = await h.json<unknown>("GET", path, { okStatuses: [404] });
      const hit = Array.isArray(body) ? body.length > 0 : Boolean(body && typeof body === "object" && "recipient_email" in body);
      if (hit) kinds.push(kind);
    };
    await probe(`/v3/asm/suppressions/global/${e}`, "global_unsubscribe");
    await probe(`/v3/suppression/bounces/${e}`, "bounce");
    await probe(`/v3/suppression/spam_reports/${e}`, "spam_report");
    await probe(`/v3/suppression/blocks/${e}`, "block");
    await probe(`/v3/suppression/invalid_emails/${e}`, "invalid_email");
    return kinds;
  };

  const eventWebhook = createSendgridEventWebhook({
    publicKeyFor: async (businessId) => (businessId && getBusinessSecret ? await getBusinessSecret(businessId, "sendgrid_webhook_public_key") : null) ?? secrets.sendgridWebhookPublicKey ?? null,
    resolveBusinessId,
    now,
  });
  const inboundWebhook = createSendgridInboundWebhook({
    tokenFor: async (businessId) => (businessId && getBusinessSecret ? await getBusinessSecret(businessId, "sendgrid_inbound_token") : null) ?? secrets.sendgridInboundToken ?? null,
    resolveBusinessId,
    now,
  });

  return buildLiveConnector(
    {
      key: SENDGRID_KEY,
      displayName: "SendGrid",
      phase: 2,
      auth: { kind: "api_key" },
      tools: sendgridTools,
      rateLimits: SENDGRID_RATE_LIMITS,
      now,
      webhooks: [eventWebhook, inboundWebhook],
      handlers: {
        list_verified_senders: async (_a, ctx) => ({ items: await verifiedSenders(http(ctx)) }),
        check_suppression: async ({ emails }, ctx) => {
          const h = http(ctx);
          const suppressed: { email: string; kinds: Awaited<ReturnType<typeof suppressionKinds>> }[] = [];
          const clear: string[] = [];
          for (const email of emails) {
            const kinds = await suppressionKinds(h, email);
            if (kinds.length) suppressed.push({ email, kinds });
            else clear.push(email);
          }
          return { suppressed, clear };
        },
        add_suppression: async ({ emails }, ctx) => {
          await http(ctx).json("POST", "/v3/asm/suppressions/global", { body: { recipient_emails: emails } });
          return { added: emails.map((e) => e.toLowerCase()) };
        },
        send_mail: async (mail, ctx) => {
          const h = http(ctx);
          assertVerifiedSender(mail.from, await verifiedSenders(h));
          assertUnsubscribe(mail);
          const recipients = allRecipients(mail);
          await assertNoneSuppressed(recipients, async (email) => (isSuppressed ? await isSuppressed(ctx.businessId, email) : false) || (await suppressionKinds(h, email)).length > 0);
          const [res] = await mailer(ctx).send(buildMailData(mail) as unknown as Parameters<MailService["send"]>[0]);
          const response = res as unknown as { statusCode: number; headers: Record<string, string> };
          if (response.statusCode >= 300) throw new VendorError(SENDGRID_KEY, response.statusCode, "mail/send refused");
          return { messageId: response.headers["x-message-id"] ?? `unknown-${now().getTime()}`, accepted: recipients, rejected: [], scheduledFor: mail.sendAt ?? null };
        },
        list_campaigns: async ({ pageSize }, ctx) => ({ items: ((await http(ctx).json<{ result?: SgSingleSend[] }>("GET", "/v3/marketing/singlesends", { query: { page_size: pageSize } })).result ?? []).map(mapSingleSend) }),
        create_campaign: async ({ name, subject, html, text, senderId, listIds, suppressionGroupId, customUnsubscribeUrl }, ctx) =>
          mapSingleSend(await http(ctx).json<SgSingleSend>("POST", "/v3/marketing/singlesends", { body: { name, send_to: { list_ids: listIds }, email_config: { subject, html_content: html, plain_content: text, sender_id: senderId, suppression_group_id: suppressionGroupId, custom_unsubscribe_url: customUnsubscribeUrl } } })),
        schedule_campaign: async ({ campaignId, sendAt }, ctx) => {
          const h = http(ctx);
          await h.json("PUT", `/v3/marketing/singlesends/${encodeURIComponent(campaignId)}/schedule`, { body: { send_at: sendAt } });
          return mapSingleSend(await h.json<SgSingleSend>("GET", `/v3/marketing/singlesends/${encodeURIComponent(campaignId)}`));
        },
        get_stats: async ({ startDate, endDate }, ctx) => summariseStats(await http(ctx).json<SgStatsDay[]>("GET", "/v3/stats", { query: { start_date: startDate, end_date: endDate, aggregated_by: "day" } })),
      },
      connect: async (businessId, input) => {
        const apiKey = typeof input === "object" && input && typeof (input as { apiKey?: unknown }).apiKey === "string" ? (input as { apiKey: string }).apiKey : undefined;
        const h = createHttp({ connectorKey: SENDGRID_KEY, baseUrl: SENDGRID_BASE_URL, fetch, headers: { authorization: bearer(apiKey ?? keyFor()) } });
        const senders = await verifiedSenders(h);
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: SENDGRID_KEY, status: senders.some((s) => s.verified) ? "connected" : "degraded", scopes: ["mail.send", "suppressions", "marketing", "stats"], accountLabel: senders.find((s) => s.verified)?.fromEmail ?? "SendGrid", externalAccountId: null,
          config: { verifiedSenders: senders.filter((s) => s.verified).map((s) => s.fromEmail) }, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          ...(apiKey ? { credentialToStore: { kind: "api_key" as const, secret: apiKey } } : {}),
        };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          const senders = await verifiedSenders(http());
          return healthResult(senders.some((s) => s.verified) ? "connected" : "degraded", startedAt, { now, details: { verifiedSenders: senders.filter((s) => s.verified).length }, ...(senders.some((s) => s.verified) ? {} : { message: "no verified sender identity" }) });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    sendgridMock,
  );
}

export { sendgridMock, createSendgridMock, signedEventRequest, inboundParseRequest, sgEvent, signSendgridBody } from "./mock";
export { sendgridTools, SENDGRID_KEY, assertUnsubscribe, assertVerifiedSender, assertNoneSuppressed, buildMailData } from "./tools";
export { createSendgridEventWebhook, createSendgridInboundWebhook, normaliseSendgridEvents, normaliseInboundMail, verifySendgridSignature } from "./webhooks";
