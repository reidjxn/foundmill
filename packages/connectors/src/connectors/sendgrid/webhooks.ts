/**
 * SendGrid webhooks.
 *
 * Event Webhook (docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features):
 * signed with ECDSA P-256 / SHA-256 over `timestamp + rawBody`; headers `X-Twilio-Email-Event-Webhook-Signature`
 * (base64 DER signature) and `X-Twilio-Email-Event-Webhook-Timestamp`; the verification key is the base64 SPKI
 * public key shown in the SendGrid UI. Replays: the signature string is unique per delivery and is remembered.
 *
 * Inbound Parse has no signature scheme: the URL carries a shared `?token=` (platform or per-business) and the
 * body is multipart/form-data (`from`, `to`, `subject`, `text`, `html`, `envelope`, `dkim`, `SPF`, …).
 *
 * Normalisation: `unsubscribe` / `group_unsubscribe` / `spamreport` → `lead.replied` (unsubscribe / negative);
 * an inbound reply → `lead.replied` whose summary never carries the body (the quarantined reader does).
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { isUuid } from "@foundmill/shared";
import type { ConnectorWebhook, PlatformEvent } from "../../contract";
import { makeEvent, stableHash, uuidFromSeed } from "../../mock-utils";
import { DEFAULT_TOLERANCE_SECONDS, formFields, header, parseJsonBody, rawBody, type ReplayGuard, resolveBusinessId, safeEqual, webhookPath, withinTolerance, type BusinessResolver } from "../../webhooks";
import { SENDGRID_KEY } from "./tools";

export const SG_SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
export const SG_TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

export interface SgEvent {
  email: string;
  timestamp: number;
  event: string;
  sg_event_id?: string;
  sg_message_id?: string;
  reason?: string;
  status?: string;
  asm_group_id?: number;
  category?: string | string[];
  /** Custom args are flattened into the event object by SendGrid. */
  [customArg: string]: unknown;
}

/** Import SendGrid's base64 SPKI public key (or a PEM) into a KeyObject. */
export function importSendgridPublicKey(key: string): KeyObject {
  if (key.includes("-----BEGIN")) return createPublicKey(key);
  return createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
}

export function verifySendgridSignature(publicKey: string | KeyObject, body: string, timestamp: string, signatureB64: string): boolean {
  try {
    const key = typeof publicKey === "string" ? importSendgridPublicKey(publicKey) : publicKey;
    return cryptoVerify("sha256", Buffer.from(timestamp + body, "utf8"), { key, dsaEncoding: "der" }, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export interface SendgridWebhookDeps {
  publicKeyFor(businessId: string | null): Promise<string | null>;
  resolveBusinessId?: BusinessResolver;
  replay?: ReplayGuard;
  now?: () => Date;
  toleranceSeconds?: number;
}

export function createSendgridEventWebhook(deps: SendgridWebhookDeps): ConnectorWebhook {
  // No guard of its own unless one is passed (the mocks pass one): `apps/ingest` holds the replay record and releases it
  // when a delivery is not stored, so a vendor's retry after a refusal or a failed write is accepted (SEC-11).
  const replay = deps.replay ?? null;
  const now = deps.now ?? (() => new Date());
  return {
    path: webhookPath(SENDGRID_KEY),
    async verify(req) {
      const signature = header(req, SG_SIGNATURE_HEADER);
      const timestamp = header(req, SG_TIMESTAMP_HEADER);
      if (!signature || !timestamp) return false;
      if (!withinTolerance(Number.parseInt(timestamp, 10), now().getTime(), deps.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return false;
      const businessId = await resolveBusinessId(req, SENDGRID_KEY, null, deps.resolveBusinessId);
      const publicKey = await deps.publicKeyFor(businessId);
      if (!publicKey) return false;
      const body = await rawBody(req);
      if (!verifySendgridSignature(publicKey, body, timestamp, signature)) return false;
      return replay ? replay.check(`sig:${signature}`) : true;
    },
    async normalise(req) {
      const events = parseJsonBody<SgEvent[]>(await rawBody(req));
      if (!Array.isArray(events)) return [];
      const businessId = await resolveBusinessId(req, SENDGRID_KEY, null, deps.resolveBusinessId);
      if (!businessId) return [];
      return normaliseSendgridEvents(events, businessId);
    },
  };
}

export const emailEntityId = (email: string): string => uuidFromSeed("entity", "email", email.trim().toLowerCase());

const campaignIdOf = (e: Record<string, unknown>): string | null => {
  const v = e.campaignId ?? e.campaign_id;
  return typeof v === "string" && isUuid(v) ? v : null;
};

export function normaliseSendgridEvents(events: SgEvent[], businessId: string): PlatformEvent[] {
  const out: PlatformEvent[] = [];
  for (const e of events) {
    if (!e || typeof e.email !== "string" || !e.email) continue;
    const kind = e.event === "unsubscribe" || e.event === "group_unsubscribe" ? "unsubscribe" : e.event === "spamreport" ? "negative" : null;
    if (!kind) continue;
    const entityId = emailEntityId(e.email);
    const eventId = e.sg_event_id ?? stableHash([e.email, e.event, e.timestamp, e.sg_message_id], 24);
    out.push(
      makeEvent("lead.replied", {
        businessId,
        occurredAt: new Date((e.timestamp || 0) * 1000),
        actor: { kind: "webhook", id: SENDGRID_KEY },
        entityIds: [entityId],
        seed: eventId,
        payload: {
          entityId,
          channelKey: "email_automation",
          campaignId: campaignIdOf(e),
          interactionId: uuidFromSeed("interaction", SENDGRID_KEY, eventId),
          sentiment: kind,
          summary: kind === "unsubscribe" ? `${e.email} unsubscribed${e.asm_group_id ? ` from group ${e.asm_group_id}` : ""}; added to suppression, never to be emailed again.` : `${e.email} reported the email as spam; suppressed and counted towards the spam-rate guardrail.`,
          requestsMeeting: false,
        },
      }),
    );
  }
  return out;
}

/* ---- Inbound Parse ---- */

export interface InboundParseDeps {
  tokenFor(businessId: string | null): Promise<string | null>;
  resolveBusinessId?: BusinessResolver;
  replay?: ReplayGuard;
  now?: () => Date;
}

export interface InboundMail { from: string; to: string; subject: string; text: string; html: string; envelope: { from?: string; to?: string[] } | null; attachments: number; dkim: string | null; spf: string | null; spamScore: number | null; messageIdHeader: string | null }

const addressOf = (s: string): string => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

export async function readInboundMail(req: Request): Promise<InboundMail | null> {
  const contentType = req.headers.get("content-type") ?? "";
  let f: Record<string, string>;
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) f = await formFields(req);
  else {
    const json = parseJsonBody<Record<string, string>>(await rawBody(req));
    if (!json) return null;
    f = json;
  }
  if (!f.from || !f.to) return null;
  const messageIdHeader = f.headers?.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim() ?? null;
  return { from: f.from, to: f.to, subject: f.subject ?? "", text: f.text ?? "", html: f.html ?? "", envelope: parseJsonBody<{ from?: string; to?: string[] }>(f.envelope ?? ""), attachments: Number.parseInt(f.attachments ?? "0", 10) || 0, dkim: f.dkim ?? null, spf: f.SPF ?? f.spf ?? null, spamScore: f.spam_score ? Number.parseFloat(f.spam_score) : null, messageIdHeader };
}

export function createSendgridInboundWebhook(deps: InboundParseDeps): ConnectorWebhook {
  // No guard of its own unless one is passed (the mocks pass one): `apps/ingest` holds the replay record and releases it
  // when a delivery is not stored, so a vendor's retry after a refusal or a failed write is accepted (SEC-11).
  const replay = deps.replay ?? null;
  return {
    path: webhookPath(SENDGRID_KEY, "inbound"),
    async verify(req) {
      const url = new URL(req.url);
      const presented = url.searchParams.get("token");
      if (!presented) return false;
      const businessId = await resolveBusinessId(req, SENDGRID_KEY, null, deps.resolveBusinessId);
      const expected = await deps.tokenFor(businessId);
      if (!expected || !safeEqual(presented, expected)) return false;
      const mail = await readInboundMail(req);
      if (!mail) return false;
      return replay ? replay.check(`inbound:${mail.messageIdHeader ?? stableHash([mail.from, mail.to, mail.subject, mail.text], 32)}`) : true;
    },
    async normalise(req) {
      const mail = await readInboundMail(req);
      if (!mail) return [];
      const businessId = await resolveBusinessId(req, SENDGRID_KEY, null, deps.resolveBusinessId);
      if (!businessId) return [];
      return normaliseInboundMail(mail, businessId, deps.now);
    },
  };
}

const UNSUB_RE = /\b(unsubscribe|remove me|stop emailing|opt[- ]?out|take me off)\b/i;
const OOO_RE = /\b(out of (the )?office|on (annual |parental )?leave|auto[- ]?reply|automatic reply|away until)\b/i;
const MEETING_RE = /\b(call|meeting|demo|chat|schedule|book|calendar|zoom|teams)\b/i;

/** How much of a reply is read to classify it: its own words come first, and the regexes stay bounded on a large body. */
const CLASSIFY_MAX_CHARS = 100_000;

/**
 * Where the quoted original starts in a reply: "On <date>, <name> wrote:" (also wrapped over two lines), Outlook's
 * "-----Original Message-----" and its "From: … Sent:/Date: …" header block, a line of underscores, forwarded-message
 * separators. Everything from the first one on is the message being answered, not the reply.
 */
const QUOTE_STARTS: readonly RegExp[] = [
  /^[ \t]*On\b[^\n]{0,300}(?:\n[^\n]{0,300})?\bwrote:[ \t]*$/im,
  /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/im,
  /^[ \t]*-{2,}[ \t]*Forwarded message[ \t]*-{2,}/im,
  /^[ \t]*Begin forwarded message:/im,
  /^[ \t]*_{8,}[ \t]*$/m,
  /^[ \t]*From:[^\n]*\n(?:[^\n]*\n){0,3}?[ \t]*(?:Sent|Date):/im,
];

/**
 * The reply's own words, for classifying it: quoted lines (`>`), everything from the quoted original on (QUOTE_STARTS),
 * and any line holding one of `ownMarkers` (the sender's own footer, its unsubscribe link) are left out. Every message
 * carries an unsubscribe link and a reply quotes it, so without this every reply would read as "unsubscribe".
 */
export function replyOwnText(text: string, ownMarkers: readonly string[] = []): string {
  let cut = text.slice(0, CLASSIFY_MAX_CHARS).replace(/\r\n?/g, "\n");
  for (const re of QUOTE_STARTS) {
    const m = re.exec(cut);
    if (m) cut = cut.slice(0, m.index);
  }
  const markers = ownMarkers.map((m) => m.toLowerCase()).filter(Boolean);
  return cut
    .split("\n")
    .filter((line) => !/^\s*>/.test(line) && !markers.some((m) => line.toLowerCase().includes(m)))
    .join("\n")
    .trim();
}

/** An HTML-only reply as text: quoted blocks (`<blockquote>`, Gmail's `gmail_quote`) dropped, links as their address, tags as breaks. */
const htmlReplyText = (html: string): string =>
  html
    .slice(0, CLASSIFY_MAX_CHARS)
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "\n")
    .replace(/<div[^>]*class="[^"]*gmail_quote[\s\S]*$/i, "\n")
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<(br|\/p|\/div|\/li|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

export interface InboundMailOptions {
  /** Lines holding any of these (case-insensitive) are not the reply's words: the sender's own footer and unsubscribe link. */
  ownMarkers?: readonly string[];
}

/**
 * Typed signals only (regex over the reply's own words, `replyOwnText`): sentiment class, meeting request, size. The
 * body itself never enters the event — it goes to the interaction row and the quarantined reader (BUILD §9.8).
 */
export function normaliseInboundMail(mail: InboundMail, businessId: string, now: () => Date = () => new Date(), options: InboundMailOptions = {}): PlatformEvent[] {
  const from = addressOf(mail.from);
  const text = mail.text || mail.html.replace(/<[^>]+>/g, " ");
  const own = replyOwnText(mail.text || htmlReplyText(mail.html), options.ownMarkers);
  const sentiment = UNSUB_RE.test(own) ? "unsubscribe" : OOO_RE.test(`${mail.subject}\n${own}`) ? "out_of_office" : "neutral";
  const words = text.split(/\s+/).filter(Boolean).length;
  const entityId = emailEntityId(from);
  const key = mail.messageIdHeader ?? stableHash([from, mail.to, mail.subject, text], 32);
  return [
    makeEvent("lead.replied", {
      businessId,
      occurredAt: now(),
      actor: { kind: "webhook", id: SENDGRID_KEY },
      entityIds: [entityId],
      seed: key,
      payload: {
        entityId,
        channelKey: "email_automation",
        campaignId: null,
        interactionId: uuidFromSeed("interaction", SENDGRID_KEY, "inbound", key),
        sentiment,
        summary: `Email reply from ${from} (${words} words, ${mail.attachments} attachment${mail.attachments === 1 ? "" : "s"}${mail.dkim?.includes("pass") ? ", DKIM pass" : ""}); body quarantined for the reader.`,
        requestsMeeting: sentiment === "neutral" && MEETING_RE.test(own),
      },
    }),
  ];
}
