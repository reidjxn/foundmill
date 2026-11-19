/** Live Gmail connector over the REST API with per-business OAuth; sends as RFC 5322 raw messages. */
import { uuid } from "@foundmill/shared";
import type { Connector, ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { googleAccessToken, googleHeaders, googleOAuthConnect } from "../_shared/google-auth";
import { buildMimeMessage, toBase64Url } from "../_shared/mime";
import { assertNotSuppressed, gmailMock } from "./mock";
import { GMAIL_BASE_URL, GMAIL_KEY, GMAIL_RATE_LIMITS, GMAIL_READ_OFF, GMAIL_READ_SCOPE, GMAIL_SCOPES, gmailTools, mapMessage, mapSummary, type GmailMessage } from "./tools";

export function createGmailConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, isSuppressed } = resolveLiveOptions(options);
  const deps = { connectorKey: GMAIL_KEY, secrets, fetch, now };
  const client = async (ctx: ToolContext): Promise<HttpClient> => createHttp({ connectorKey: GMAIL_KEY, baseUrl: GMAIL_BASE_URL, fetch, headers: googleHeaders((await googleAccessToken(ctx, deps)).accessToken) });
  // The token holds gmail.readonly only after the founder turned reading on; without it Google would answer 403 anyway.
  const readable = (ctx: ToolContext): void => {
    if (!ctx.integration.scopes.includes(GMAIL_READ_SCOPE)) throw Object.assign(new Error(GMAIL_READ_OFF), { status: 403, code: "mail_read_off" });
  };
  const senderOf = (ctx: ToolContext): string => (typeof ctx.integration.config.email === "string" && ctx.integration.config.email) || ctx.integration.accountLabel || "me";
  const raw = (ctx: ToolContext, a: { to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; html?: string | undefined; inReplyToMessageId?: string | undefined }) =>
    toBase64Url(buildMimeMessage({ from: senderOf(ctx), to: a.to, cc: a.cc, bcc: a.bcc, subject: a.subject, text: a.text, html: a.html, inReplyTo: a.inReplyToMessageId, references: a.inReplyToMessageId ? [a.inReplyToMessageId] : undefined, date: now() }));

  return buildLiveConnector(
    {
      key: GMAIL_KEY,
      displayName: "Gmail",
      phase: 1,
      auth: { kind: "oauth", scopes: GMAIL_SCOPES, authorizationCode: true },
      tools: gmailTools,
      rateLimits: GMAIL_RATE_LIMITS,
      now,
      handlers: {
        list_messages: async ({ q, maxResults, pageToken }, ctx) => {
          readable(ctx);
          const http = await client(ctx);
          const list = await http.json<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("GET", "/users/me/messages", { query: { q, maxResults, pageToken } });
          const items = await Promise.all((list.messages ?? []).map((m) => http.json<GmailMessage>("GET", `/users/me/messages/${m.id}`, { query: { format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] } })));
          return { items: items.map(mapSummary), nextPageToken: list.nextPageToken ?? null };
        },
        get_message: async ({ id }, ctx) => (readable(ctx), mapMessage(await (await client(ctx)).json<GmailMessage>("GET", `/users/me/messages/${id}`, { query: { format: "full" } }))),
        send_message: async (args, ctx) => {
          await assertNotSuppressed([...args.to, ...args.cc, ...args.bcc], (email) => (isSuppressed ? isSuppressed(ctx.businessId, email) : false));
          const res = await (await client(ctx)).json<{ id: string; threadId: string }>("POST", "/users/me/messages/send", { body: { raw: raw(ctx, args), threadId: args.threadId } });
          return { id: res.id, threadId: res.threadId, to: args.to };
        },
        create_draft: async (args, ctx) => {
          const res = await (await client(ctx)).json<{ id: string; message: { id: string } }>("POST", "/users/me/drafts", { body: { message: { raw: raw(ctx, args), threadId: args.threadId } } });
          return { draftId: res.id, messageId: res.message.id };
        },
        list_labels: async (_a, ctx) => ({ items: ((await (await client(ctx)).json<{ labels?: { id: string; name: string; type: string }[] }>("GET", "/users/me/labels")).labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type })) }),
      },
      connect: (businessId, input) => googleOAuthConnect(input, deps, { businessId, scopes: (input as { readMail?: unknown } | null)?.readMail === true ? [...GMAIL_SCOPES, GMAIL_READ_SCOPE] : GMAIL_SCOPES, label: "Gmail", newId: uuid }),
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        if (!secrets.googleClientId || !secrets.googleClientSecret) return healthResult("disconnected", startedAt, { now, message: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured" });
        return healthResult(integration.status === "mock" ? "connected" : integration.status, startedAt, { now });
      },
    },
    gmailMock,
  );
}

export { gmailMock, createGmailMock, assertNotSuppressed, SUPPRESSED_CODE } from "./mock";
export { gmailTools, GMAIL_KEY } from "./tools";
