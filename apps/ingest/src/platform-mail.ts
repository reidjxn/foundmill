/**
 * What comes back to a project's Foundmill sending address (docs/THESIS_REVIEW.md package 1.5; SECURITY_REVIEW N2).
 * Three platform endpoints, none with a business in its URL:
 *
 *   POST /mail/inbound      SendGrid Inbound Parse for the whole sending domain (its MX). The delivery carries the
 *                           platform's own token (`?token=`, PLATFORM_MAIL_INBOUND_TOKEN, compared in constant time;
 *                           never the businesses' SENDGRID_INBOUND_TOKEN). The project is found from the local part the
 *                           message was delivered to (`project_mail`), never from anything else the sender wrote; an
 *                           unknown local part writes nothing. The `From` address counts only when SendGrid's checks
 *                           tie it to the sender (SPF passed for an aligned envelope sender, or DKIM passed for the From
 *                           domain; `inboundSenderVerified`): a message without that is acknowledged and dropped, so a
 *                           forged From never suppresses anyone, never reaches a lead and never counts as a reply. Each
 *                           project it reached gets the CRM's reply event (`lead.replied`) with typed signals only: the
 *                           sender and the body are untrusted content and the body never enters the event. A reply whose
 *                           own words (quoted text and the footer's unsubscribe link left out) ask to stop suppresses
 *                           its sender.
 *   POST /mail/events       The platform account's Event Webhook, ECDSA-signed by SendGrid (PLATFORM_MAIL_EVENT_PUBLIC_KEY)
 *                           within the replay window. Each event is bound to the project by the custom args the gateway
 *                           signed into its message (PLATFORM_MAIL_SIGNING_SECRET); an event whose args do not verify is
 *                           ignored. Bounces, drops, spam reports and unsubscribes add the address to that project's
 *                           suppression list; unsubscribes and spam reports also write `lead.replied`.
 *   GET|POST /mail/unsubscribe?t=   The link in every message (RFC 8058 one-click POST, or a confirmation page for a
 *                           person who opens it): the token names the project and the address hash, signed by the
 *                           gateway; a valid one adds the hash to that project's suppression list.
 *   GET|POST /mail/confirm?t=  The link in a follow confirmation email (package 1.6, double opt-in): the same pattern,
 *                           a page with a button on GET (link scanners open links) and the confirmation on POST. The
 *                           token (`followConfirmToken`, signed by the gateway under its own label, seven days) names
 *                           the project, the consent record, the address hash and a nonce the record keeps the hash of.
 *                           A valid one confirms the record, gives the contact the lawful basis `consent` when it had
 *                           none, and writes `page.followed` (the real outcome) through the outbox, once.
 *   GET|POST /mail/notify/off?t=  The link in Foundmill's own email to a person (packages 1.5 and 5.1): the same
 *                           pattern; the token (`notifyOffToken`) names the person by id and the kind of email, and a
 *                           valid one turns that kind off in their preferences.
 *
 * Whatever suppresses an address for a project here (an unsubscribe link, one-click, a reply asking to stop, a bounce, a
 * drop, a spam report) also withdraws the project's consent records for that address (`withdrawn_at`), so the person no
 * longer counts as a follower.
 *
 * With PLATFORM_MAIL_DOMAIN unset every route answers 404, as if it did not exist. Bodies are capped before they are read
 * (app.ts: PLATFORM_MAIL_EVENTS_MAX_BYTES, PLATFORM_MAIL_INBOUND_MAX_BYTES).
 */
import { DEV_PLATFORM_MAIL_SECRET, PLATFORM_NOTIFY_OFF_PATH, readNotifyOffToken, followConfirmNonceHash, platformMailSenderName, readFollowConfirmToken, inboundSenderVerified, normaliseInboundMail, normalisePlatformMailEvents, PLATFORM_MAIL_FOOTER_MARKERS, platformInboundLocalParts, readInboundMail, readPlatformUnsubscribeToken, safeEqual, stableHash, suppressionHashOfEmail, verifySendgridSignature, withinTolerance, type SgEvent } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { FOLLOW_CONFIRM_PAGE, NOTIFY_OFF_PAGE, notifyOffBody, PLATFORM_MAIL_SECRET_MIN_LENGTH, UNSUBSCRIBE_CONFIRM_BODY, UNSUBSCRIBE_CONFIRM_BUTTON, UNSUBSCRIBE_CONFIRM_TITLE, UNSUBSCRIBE_DONE_BODY, UNSUBSCRIBE_INVALID_BODY } from "@foundmill/shared";
import { ingestPlatformEvents, writeEventRow } from "./ingest";
import { nonceKey } from "./nonce-store";
import type { IngestDeps } from "./types";

export const PLATFORM_MAIL_SOURCE = "platform_mail";
/** SpamAssassin's usual threshold, as Inbound Parse reports it in `spam_score` (when spam checking is on for the domain). */
export const SPAM_SCORE_DROP = 5;
/** Delivery events: SendGrid batches them, well under this. */
export const PLATFORM_MAIL_EVENTS_MAX_BYTES = 1024 * 1024;
/** Inbound Parse: SendGrid accepts messages up to 30 MB, attachments included. */
export const PLATFORM_MAIL_INBOUND_MAX_BYTES = 30 * 1024 * 1024;
/** An ordinary address of at most 254 characters, no spaces, quotes or angle brackets. */
const SENDER_RE = /^(?=.{3,254}$)[^\s@<>"'[\]|]+@[a-z0-9.-]+\.[a-z]{2,63}$/i;
const SG_SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
const SG_TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

export interface IngestPlatformMailConfig {
  /** PLATFORM_MAIL_DOMAIN; null = off (every route 404). */
  domain: string | null;
  /** PLATFORM_MAIL_SIGNING_SECRET (the gateway signs with the same); the development secret stands in on development and test only. */
  signingSecret: string | null;
  /** PLATFORM_MAIL_INBOUND_TOKEN. */
  inboundToken: string | null;
  /** PLATFORM_MAIL_EVENT_PUBLIC_KEY (base64 SPKI or PEM). */
  eventPublicKey: string | null;
}

type Deps = Pick<IngestDeps, "db" | "log" | "now" | "nonces" | "nonceTtlMs" | "replayWindowSeconds" | "env" | "followups"> & { platformMail?: IngestPlatformMailConfig };

export type MailRouteResult = { status: 200 | 400 | 401 | 404 | 409 | 503; body: Record<string, unknown> };

const fail = (status: MailRouteResult["status"], error: string, message: string): MailRouteResult => ({ status, body: { ok: false, error, message } });
const OFF = fail(404, "not_found", "No route for this address");

/** The secret custom args and unsubscribe links verify with, or null when none may be used here. */
function signingSecretFor(deps: Deps): string | null {
  const configured = deps.platformMail?.signingSecret?.trim();
  if (configured && configured.length >= PLATFORM_MAIL_SECRET_MIN_LENGTH) return configured;
  return deps.env.APP_ENV === "development" || deps.env.APP_ENV === "test" ? DEV_PLATFORM_MAIL_SECRET : null;
}

/**
 * Adds the address hash to the business's suppression list once (false when it was already there), and withdraws the
 * business's consent records for that address either way (a follower who unsubscribed no longer follows).
 */
async function suppress(deps: Deps, businessId: string, emailHash: string, reason: string): Promise<boolean> {
  const already = await repos.channels.isSuppressed(deps.db, businessId, { emailHash });
  if (!already) await repos.channels.addSuppression(deps.db, businessId, { emailHash, reason: reason.slice(0, 200), scope: "business", source: PLATFORM_MAIL_SOURCE });
  await repos.followers.withdrawByEmailHash(deps.db, businessId, emailHash, deps.now());
  return !already;
}

export async function handlePlatformInbound(deps: Deps, req: Request): Promise<MailRouteResult> {
  const config = deps.platformMail;
  if (!config?.domain) return OFF;
  if (!config.inboundToken) return fail(503, "inbound_unconfigured", "PLATFORM_MAIL_INBOUND_TOKEN is not set on ingest; no reply is accepted");
  const presented = new URL(req.url).searchParams.get("token");
  if (!presented || !safeEqual(presented, config.inboundToken)) {
    deps.log.warn({ path: "/mail/inbound" }, "platform inbound mail refused: wrong or missing token");
    return fail(401, "invalid_token", "Token verification failed");
  }
  const mail = await readInboundMail(req);
  if (!mail) return fail(400, "invalid_payload", "Body must be an Inbound Parse delivery");
  const id = mail.messageIdHeader ?? stableHash([mail.from, mail.to, mail.subject, mail.text], 32);
  const nonce = nonceKey("platform-mail-inbound", id);
  if (!(await deps.nonces.claim(nonce, deps.nonceTtlMs))) return fail(409, "replayed", "This delivery was already accepted");

  try {
    // Anyone can write to a project's address. What SendGrid's filter scores as spam is acknowledged and dropped.
    if (mail.spamScore !== null && Number.isFinite(mail.spamScore) && mail.spamScore >= SPAM_SCORE_DROP) {
      deps.log.info({ path: "/mail/inbound", spamScore: mail.spamScore }, "platform inbound mail scored as spam; nothing written");
      return { status: 200, body: { ok: true, written: 0, projects: 0, spam: true } };
    }
    // The sender is untrusted: only an ordinary address is read at all (it ends up, as text, in the reply's summary).
    const sender = (mail.from.match(/<([^>]+)>/)?.[1] ?? mail.from).trim();
    if (!SENDER_RE.test(sender)) {
      deps.log.info({ path: "/mail/inbound" }, "platform inbound mail without an ordinary sender address; nothing written");
      return { status: 200, body: { ok: true, written: 0, projects: 0 } };
    }
    // Anyone can write any From: it is read as the sender only when SendGrid's SPF or DKIM check ties it to them.
    const check = inboundSenderVerified(mail);
    if (!check.verified) {
      deps.log.info({ path: "/mail/inbound", reason: check.reason }, "platform inbound mail whose sender could not be verified (SPF or DKIM); nothing written");
      return { status: 200, body: { ok: true, written: 0, projects: 0, unverified: true } };
    }
    const businessIds: string[] = [];
    for (const localPart of platformInboundLocalParts(mail, config.domain)) {
      const project = await repos.projectMail.resolve.byLocalPart(deps.db, localPart);
      if (project && !businessIds.includes(project.businessId)) businessIds.push(project.businessId);
    }
    if (businessIds.length === 0) {
      // Not an address any project holds: acknowledged so SendGrid does not retry, and nothing is written.
      deps.log.info({ path: "/mail/inbound" }, "platform inbound mail for no project; nothing written");
      return { status: 200, body: { ok: true, written: 0, projects: 0 } };
    }
    let written = 0;
    const eventIds: string[] = [];
    for (const businessId of businessIds) {
      // The footer of the message being answered (its unsubscribe link) is never read as the reply's own words.
      const events = normaliseInboundMail(mail, businessId, deps.now, { ownMarkers: PLATFORM_MAIL_FOOTER_MARKERS });
      const result = await ingestPlatformEvents(deps.db, events, { source: PLATFORM_MAIL_SOURCE, actor: { kind: "webhook", id: PLATFORM_MAIL_SOURCE }, log: deps.log });
      written += result.written;
      eventIds.push(...result.eventIds);
      deps.followups.dispatch(result);
      // A reply that asks to stop: the sender is not written to again by this project.
      if (events.some((e) => e.type === "lead.replied" && (e.payload as { sentiment?: string }).sentiment === "unsubscribe")) {
        await suppress(deps, businessId, suppressionHashOfEmail(sender), "asked to be removed in a reply");
      }
    }
    return { status: 200, body: { ok: true, written, projects: businessIds.length, eventIds } };
  } catch (e) {
    await deps.nonces.release(nonce);
    throw e;
  }
}

export async function handlePlatformMailEvents(deps: Deps, req: Request): Promise<MailRouteResult> {
  const config = deps.platformMail;
  if (!config?.domain) return OFF;
  const secret = signingSecretFor(deps);
  if (!config.eventPublicKey || !secret) return fail(503, "events_unconfigured", "PLATFORM_MAIL_EVENT_PUBLIC_KEY and PLATFORM_MAIL_SIGNING_SECRET must be set on ingest; no delivery event is accepted");
  const signature = req.headers.get(SG_SIGNATURE_HEADER);
  const timestamp = req.headers.get(SG_TIMESTAMP_HEADER);
  const body = await req.text();
  if (!signature || !timestamp || !withinTolerance(Number.parseInt(timestamp, 10), deps.now().getTime(), deps.replayWindowSeconds) || !verifySendgridSignature(config.eventPublicKey, body, timestamp, signature)) {
    deps.log.warn({ path: "/mail/events" }, "platform mail events refused: signature verification failed");
    return fail(401, "invalid_signature", "Signature verification failed");
  }
  let events: SgEvent[];
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    events = parsed as SgEvent[];
  } catch {
    return fail(400, "invalid_payload", "Body must be an array of SendGrid events");
  }
  const nonce = nonceKey("platform-mail-events", signature);
  if (!(await deps.nonces.claim(nonce, deps.nonceTtlMs))) return fail(409, "replayed", "This delivery was already accepted");
  try {
    const { batches, ignored } = normalisePlatformMailEvents(events, secret);
    if (ignored > 0) deps.log.warn({ ignored }, "platform mail events whose project could not be verified were ignored");
    let written = 0;
    let suppressed = 0;
    for (const batch of batches) {
      // A business that no longer exists (deleted since the message was sent) is skipped, never an error for SendGrid.
      const exists = await repos.businesses.get(deps.db, batch.businessId, { includeArchived: true }).then(() => true).catch(() => false);
      if (!exists) continue;
      for (const s of batch.suppress) if (await suppress(deps, batch.businessId, s.emailHash, s.reason)) suppressed += 1;
      if (batch.events.length) {
        const result = await ingestPlatformEvents(deps.db, batch.events, { source: PLATFORM_MAIL_SOURCE, actor: { kind: "webhook", id: PLATFORM_MAIL_SOURCE }, log: deps.log });
        written += result.written;
        deps.followups.dispatch(result);
      }
    }
    return { status: 200, body: { ok: true, accepted: events.length - ignored, ignored, written, suppressed } };
  } catch (e) {
    await deps.nonces.release(nonce);
    throw e;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A small page in plain words (the person who clicked the link is not a Foundmill user). */
export function unsubscribePage(body: string, form?: { token: string }): string {
  return mailPage(UNSUBSCRIBE_CONFIRM_TITLE, body, form ? { action: `/mail/unsubscribe?t=${encodeURIComponent(form.token)}`, button: UNSUBSCRIBE_CONFIRM_BUTTON } : undefined);
}

/** The follow confirmation's page (the same look as the unsubscribe page). */
export function followConfirmPage(body: string, form?: { token: string }): string {
  return mailPage(FOLLOW_CONFIRM_PAGE.title, body, form ? { action: `/mail/confirm?t=${encodeURIComponent(form.token)}`, button: FOLLOW_CONFIRM_PAGE.button } : undefined);
}

function mailPage(title: string, body: string, form?: { action: string; button: string }): string {
  const button = form ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit">${escapeHtml(form.button)}</button></form>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1b1b1b}button{font:inherit;padding:.5rem 1rem;border-radius:6px;border:1px solid #1b1b1b;background:#1b1b1b;color:#fff;cursor:pointer}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${button}</body></html>`;
}

export type UnsubscribeResult = { status: 200 | 400 | 404; html: string };

export async function handlePlatformUnsubscribe(deps: Deps, req: Request): Promise<UnsubscribeResult> {
  if (!deps.platformMail?.domain) return { status: 404, html: unsubscribePage(UNSUBSCRIBE_INVALID_BODY) };
  const secret = signingSecretFor(deps);
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const named = secret ? readPlatformUnsubscribeToken(secret, token) : null;
  if (!named) return { status: 400, html: unsubscribePage(UNSUBSCRIBE_INVALID_BODY) };
  // Opening the link shows a button (link scanners open links); the one-click POST of RFC 8058 and the button act.
  if (req.method === "GET") return { status: 200, html: unsubscribePage(UNSUBSCRIBE_CONFIRM_BODY, { token }) };
  const exists = await repos.businesses.get(deps.db, named.businessId, { includeArchived: true }).then(() => true).catch(() => false);
  if (exists && (await suppress(deps, named.businessId, named.emailHash, "unsubscribed from a link"))) {
    await repos.audit.append(deps.db, named.businessId, { actorKind: "webhook", actorId: null, action: "mail.unsubscribed", target: { kind: "suppression" }, details: { source: PLATFORM_MAIL_SOURCE, emailHashPrefix: named.emailHash.slice(0, 12) } }).catch((e: unknown) => deps.log.warn({ err: (e as Error).message }, "unsubscribe audit not written"));
  }
  return { status: 200, html: unsubscribePage(UNSUBSCRIBE_DONE_BODY) };
}

/** The page behind the link in Foundmill's own email to a person (the same look as the unsubscribe page). */
export function notifyOffPage(body: string, form?: { token: string }): string {
  return mailPage(NOTIFY_OFF_PAGE.title, body, form ? { action: `${PLATFORM_NOTIFY_OFF_PATH}?t=${encodeURIComponent(form.token)}`, button: NOTIFY_OFF_PAGE.button } : undefined);
}

/**
 * `GET|POST /mail/notify/off?t=` (packages 1.5 and 5.1): the link in the footer of Foundmill's own email to a person, and
 * its one-click POST (RFC 8058). The token (`notifyOffToken`, signed by the gateway under its own label) names the
 * person by id and the kind of email; a valid one turns that kind off in their own preferences
 * (`account_preferences.notifications.email`), so no later pass emails them about it. GET shows a button (link scanners
 * open links); only the POST changes anything. Idempotent; an account that no longer exists changes nothing. Nothing
 * here knows or logs the address.
 */
export async function handleNotifyOff(deps: Deps, req: Request): Promise<UnsubscribeResult> {
  if (!deps.platformMail?.domain) return { status: 404, html: notifyOffPage(NOTIFY_OFF_PAGE.invalid) };
  const secret = signingSecretFor(deps);
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const named = secret ? readNotifyOffToken(secret, token) : null;
  if (!named) return { status: 400, html: notifyOffPage(NOTIFY_OFF_PAGE.invalid) };
  if (req.method === "GET") return { status: 200, html: notifyOffPage(notifyOffBody(named.kind), { token }) };
  try {
    await repos.preferences.update(deps.db, named.userId, { email: { [named.kind]: false } });
    deps.log.info({ kind: named.kind }, "notify email turned off from its link");
  } catch (e) {
    // The account no longer exists (its preferences row cannot be written): there is nothing left to email.
    deps.log.warn({ kind: named.kind, err: (e as Error).name }, "notify email not turned off");
  }
  return { status: 200, html: notifyOffPage(NOTIFY_OFF_PAGE.done) };
}

/** The project's name as the confirmation email showed it (never one that reads as Foundmill's own). */
async function projectNameFor(deps: Deps, businessId: string, name: string): Promise<string> {
  const row = await repos.projectMail.get(deps.db, businessId).catch(() => null);
  return platformMailSenderName(name, row?.localPart ?? "this project").projectName;
}

export async function handleFollowConfirm(deps: Deps, req: Request): Promise<UnsubscribeResult> {
  const invalid = (status: 400 | 404) => ({ status, html: followConfirmPage(FOLLOW_CONFIRM_PAGE.invalid) });
  if (!deps.platformMail?.domain) return invalid(404);
  const secret = signingSecretFor(deps);
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const claims = secret ? readFollowConfirmToken(secret, token, deps.now().getTime()) : null;
  if (!claims) return invalid(400);
  // A business that is gone or archived takes no confirmation.
  const business = await repos.businesses.get(deps.db, claims.businessId).catch(() => null);
  if (!business) return invalid(400);
  const name = await projectNameFor(deps, business.id, business.name);
  // Opening the link shows a button (link scanners open links); only the button confirms.
  if (req.method === "GET") return { status: 200, html: followConfirmPage(FOLLOW_CONFIRM_PAGE.body(name), { token }) };
  // Asked not to be emailed since (an unsubscribe from the confirmation's own footer, a deletion request): nothing changes.
  if (await repos.channels.isSuppressed(deps.db, business.id, { emailHash: claims.emailHash })) return invalid(400);
  const at = deps.now();
  const outcome = await deps.db.transaction(async (tx) => {
    const result = await repos.followers.confirm(tx, { businessId: business.id, consentId: claims.consentId, emailHash: claims.emailHash, tokenHash: followConfirmNonceHash(claims.nonce), at });
    if (result.status !== "confirmed") return result.status;
    // The real outcome (the north star counts it): written once, when the person confirmed, never at the signup.
    await writeEventRow(tx, {
      businessId: business.id,
      type: "page.followed",
      actor: { kind: "system", id: "public-page" },
      payload: { pageId: result.pageId, entityId: result.entityId, consentId: result.consentId },
      entityIds: [result.entityId],
      occurredAt: at,
      idempotencyKey: `page.followed:${result.consentId}`,
    });
    await repos.audit.append(tx, business.id, { actorKind: "system", actorId: null, action: "page.followed", target: { kind: "entity", id: result.entityId }, details: { consentId: result.consentId, pageId: result.pageId, lawfulBasisSet: result.lawfulBasisSet } });
    return "confirmed" as const;
  });
  if (outcome === "invalid") return invalid(400);
  return { status: 200, html: followConfirmPage(FOLLOW_CONFIRM_PAGE.done(name)) };
}
