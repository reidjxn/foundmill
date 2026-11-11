/**
 * `platform_mail`: a project's Foundmill sending address (docs/THESIS_REVIEW.md package 1.5). One agent tool,
 * `send_mail`, that sends one message to one person from `<local part>@<PLATFORM_MAIL_DOMAIN>` on the platform's own
 * SendGrid account.
 *
 * Why a connector of its own and not a second path inside `sendgrid`: the platform key must never reach the account-wide
 * SendGrid tools (campaigns, stats, the global suppression list, verified senders), which on the platform's account
 * would read and change every project's mail at once; the sender is not an argument (the gateway sets it in
 * `ToolContext.platformMail` after its guards, so an agent cannot send as anyone else); and the founder's own SendGrid
 * stays exactly as it was. It runs live exactly where `sendgrid` is live (`modeKeyOf`).
 *
 * Content is plain text plus, optionally, simple HTML (a short list of tags, links over http(s) or mailto only), with no
 * attachments: `platformMailContentProblem` is the one check, run by the gateway before any vendor call and again by
 * both sides of the connector.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { AppError } from "@foundmill/shared";
import { defineTool } from "../../define";
import { safeEqual } from "../../webhooks";

export const PLATFORM_MAIL_KEY = "platform_mail";
export const PLATFORM_MAIL_RATE_LIMITS = { perMinute: 30 };

export const PLATFORM_MAIL_TEXT_MAX = 20_000;
export const PLATFORM_MAIL_HTML_MAX = 100_000;

const Recipient = z.strictObject({ email: z.email().max(254), name: z.string().trim().min(1).max(120).regex(/^[^\r\n<>"]*$/, "a name on one line, without < > or quotes").optional() });

/** One message to one person: the daily cap, the approval for outside contact and the unsubscribe are all per recipient. */
export const PlatformSendMail = z.strictObject({
  to: Recipient,
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(PLATFORM_MAIL_TEXT_MAX),
  html: z.string().max(PLATFORM_MAIL_HTML_MAX).optional(),
});
export type PlatformSendMailT = z.infer<typeof PlatformSendMail>;

export const PlatformSendResult = z.object({ messageId: z.string(), messageRef: z.string(), from: z.string(), to: z.string() });

export const platformMailTools = [
  defineTool({
    name: "send_mail",
    description:
      "Send one email to one person from the project's own address (replies come back to the project). Plain text, optionally with simple HTML (paragraphs, line breaks, bold, italics, lists, headings, links); no attachments. An unsubscribe link is added to every message. A first message to someone outside the project waits for the founder's OK unless they said otherwise; refused when the person unsubscribed or bounced, or when the project's daily limit is reached. Never claim to be a person.",
    input: PlatformSendMail,
    output: PlatformSendResult,
    hints: { contactsThirdParty: true, irreversible: true },
  }),
] as const;

/* ---- Content ---- */

/** Tags simple HTML may use; any other tag, a comment or a doctype is refused. `a` may carry `href` only; the rest nothing. */
export const PLATFORM_MAIL_HTML_TAGS: ReadonlySet<string> = new Set(["p", "br", "a", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "span", "div", "hr"]);

/** Why this message cannot be sent from a Foundmill address, in plain words; null when it may. */
export function platformMailContentProblem(mail: { subject: string; text: string; html?: string | undefined }): string | null {
  if (/[\r\n]/.test(mail.subject)) return "the subject must be one line.";
  if (!mail.text.trim()) return "the message needs a plain-text body.";
  const html = mail.html;
  if (html === undefined || html.trim() === "") return null;
  if (/<!--|<!\[CDATA\[|<!doctype|<\?/i.test(html)) return "the HTML may use simple tags only (no comments or document headers).";
  const tag = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    const name = m[2]!.toLowerCase();
    const attrs = (m[3] ?? "").replace(/\/\s*$/, "").trim();
    if (!PLATFORM_MAIL_HTML_TAGS.has(name)) return `the HTML may use simple tags only (<${name}> is not one).`;
    if (m[1]) continue;
    if (!attrs) continue;
    if (name !== "a") return `the HTML may not set attributes on <${name}>.`;
    const href = /^href\s*=\s*(?:"([^"]*)"|'([^']*)')$/i.exec(attrs);
    if (!href) return "a link may carry its address (href) and nothing else.";
    const url = (href[1] ?? href[2] ?? "").trim();
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return "links must be web addresses (https) or email addresses.";
  }
  // Anything that looks like a tag but did not parse (an unclosed `<script`, `< img`) is refused too.
  if (/<\s*[a-zA-Z!/?]/.test(html.replace(tag, ""))) return "the HTML may use simple tags only.";
  return null;
}

export const PLATFORM_MAIL_CONTENT_REFUSED = "content_refused";
export const PLATFORM_MAIL_SUPPRESSED = "recipient_suppressed";

export function assertPlatformMailContent(mail: { subject: string; text: string; html?: string | undefined }): void {
  const problem = platformMailContentProblem(mail);
  if (problem) throw new AppError(PLATFORM_MAIL_CONTENT_REFUSED, `Nothing was sent: ${problem}`, 422);
}

/* ---- What every message carries ---- */

/** The footer appended to every message: who sent it, and the way out. */
export function platformMailFooter(projectName: string, unsubscribeUrl: string): { text: string; html: string } {
  const name = projectName.trim() || "This project";
  const escaped = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    text: `\n\n--\nSent by ${name} with ${APP_NAME}. To stop getting these emails: ${unsubscribeUrl}`,
    html: `<hr><p>Sent by ${escaped} with ${APP_NAME}. <a href="${unsubscribeUrl.replace(/"/g, "%22")}">Unsubscribe</a></p>`,
  };
}

/** The v3 `mail/send` body (camelCase; `@sendgrid/mail` converts it). Shared by the live side and the mock. */
export function buildPlatformMailData(mail: PlatformSendMailT, envelope: { from: { email: string; name: string }; unsubscribeUrl: string; customArgs: Record<string, string> }): Record<string, unknown> {
  const footer = platformMailFooter(envelope.from.name, envelope.unsubscribeUrl);
  return {
    from: envelope.from,
    replyTo: envelope.from,
    personalizations: [{ to: [{ email: mail.to.email, ...(mail.to.name ? { name: mail.to.name } : {}) }], customArgs: envelope.customArgs }],
    subject: mail.subject,
    text: `${mail.text}${footer.text}`,
    ...(mail.html?.trim() ? { html: `${mail.html}${footer.html}` } : {}),
    headers: { "List-Unsubscribe": `<${envelope.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    categories: ["foundmill-project"],
    mailSettings: { bypassListManagement: { enable: false } },
    // Our own unsubscribe link, never SendGrid's; no open or click tracking that rewrites the project's links.
    trackingSettings: { subscriptionTracking: { enable: false }, clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
  };
}

/* ---- Signatures that bind events and unsubscribes to the project ---- */

const mac = (secret: string, label: string, ...parts: string[]): string => createHmac("sha256", secret).update([label, ...parts].join("\u0000"), "utf8").digest("base64url");

/** Custom args every message carries; SendGrid echoes them in each delivery event (flattened into the event object). */
export function platformMailCustomArgs(secret: string, businessId: string, messageRef: string): Record<string, string> {
  return { fm_b: businessId, fm_m: messageRef, fm_s: mac(secret, "fm-mail-event", businessId, messageRef) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The business a delivery event belongs to, when its custom args verify; null for anything else (missing, forged, altered). */
export function verifyPlatformMailArgs(secret: string, event: Record<string, unknown>): { businessId: string; messageRef: string } | null {
  const b = event.fm_b;
  const m = event.fm_m;
  const sig = event.fm_s;
  if (typeof b !== "string" || typeof m !== "string" || typeof sig !== "string" || !UUID_RE.test(b) || !UUID_RE.test(m)) return null;
  return safeEqual(sig, mac(secret, "fm-mail-event", b, m)) ? { businessId: b.toLowerCase(), messageRef: m.toLowerCase() } : null;
}

/** The unsubscribe token: the business, the recipient's address hash (never the address) and their signature. */
export function platformUnsubscribeToken(secret: string, businessId: string, emailHash: string): string {
  return `${businessId}.${emailHash}.${mac(secret, "fm-mail-unsubscribe", businessId, emailHash)}`;
}

export function readPlatformUnsubscribeToken(secret: string, token: string): { businessId: string; emailHash: string } | null {
  const [b, h, sig, ...rest] = token.split(".");
  if (rest.length || !b || !h || !sig || !UUID_RE.test(b) || !/^[0-9a-f]{64}$/.test(h)) return null;
  return safeEqual(sig, mac(secret, "fm-mail-unsubscribe", b, h)) ? { businessId: b.toLowerCase(), emailHash: h } : null;
}

export const PLATFORM_MAIL_UNSUBSCRIBE_PATH = "/mail/unsubscribe";
export const PLATFORM_MAIL_INBOUND_PATH = "/mail/inbound";
export const PLATFORM_MAIL_EVENTS_PATH = "/mail/events";

export const platformUnsubscribeUrl = (base: string, token: string): string => `${base.replace(/\/+$/, "")}${PLATFORM_MAIL_UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`;

/**
 * Signs mock sends in development and test while PLATFORM_MAIL_SIGNING_SECRET is unset (the gateway and ingest use the
 * same one there). Public, so neither service accepts it anywhere else: staging and production need the real secret.
 */
export const DEV_PLATFORM_MAIL_SECRET = "foundmill-dev-platform-mail-secret-not-for-production";
