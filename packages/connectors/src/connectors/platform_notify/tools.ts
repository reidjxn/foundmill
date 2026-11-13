/**
 * `platform_notify`: Foundmill's own email to its users (docs/THESIS_REVIEW.md packages 1.5 and 5.1), "a decision is
 * waiting" first. One tool, `send_notification`: one message to one person from Foundmill's own address on the platform
 * domain (`<PLATFORM_NOTIFY_LOCAL_PART>@<PLATFORM_MAIL_DOMAIN>`, under the name APP_NAME), on the platform's SendGrid key.
 *
 * A service-only connector (`SERVICE_ONLY_CONNECTORS`): only the gateway's `POST /v1/notify/email` calls it, after it
 * resolved the address from `auth.users`, checked the person may see the note and still wants the email, counted the day
 * and built the words. No agent session can reach it, whatever a token says. It runs live exactly where `sendgrid` does
 * (`CONNECTOR_MODE_KEYS`), like `platform_mail`.
 *
 * Unlike a project's message it carries no custom args (a delivery event about it binds to no project, so ingest's
 * `/mail/events` ignores it and nothing is suppressed for any project), no Reply-To (Inbound Parse drops replies to the
 * reserved local part) and the person's own one-click link that turns this kind of email off.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { EMAIL_NOTIFICATION_KINDS, type EmailNotificationKind } from "@foundmill/shared";
import { defineTool } from "../../define";
import { safeEqual } from "../../webhooks";

export const PLATFORM_NOTIFY_KEY = "platform_notify";
export const PLATFORM_NOTIFY_RATE_LIMITS = { perMinute: 120 };

export const PlatformSendNotification = z.strictObject({
  /** The sender the gateway resolved: Foundmill's own address on the platform domain. */
  from: z.strictObject({ email: z.email().max(254), name: z.string().trim().min(1).max(100).regex(/^[^\r\n<>"]*$/) }),
  to: z.strictObject({ email: z.email().max(254) }),
  subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]*$/),
  text: z.string().min(1).max(10_000),
  html: z.string().min(1).max(40_000),
  /**
   * The person's signed link that turns this kind off (one-click, RFC 8058). Absent only for the one-off messages to an
   * address the person or their inviter asked for (`ADDRESS_EMAIL_KINDS`: no account holds a preference to turn off).
   */
  unsubscribeUrl: z.url().max(2_000).optional(),
});
export type PlatformSendNotificationT = z.infer<typeof PlatformSendNotification>;

export const PlatformNotificationResult = z.object({ messageId: z.string() });

export const platformNotifyTools = [
  defineTool({
    name: "send_notification",
    description: `Platform only: one email from ${APP_NAME} to one of its users about their own project. Never available to agents.`,
    input: PlatformSendNotification,
    output: PlatformNotificationResult,
    hints: { contactsThirdParty: false, irreversible: true },
  }),
] as const;

/** The v3 `mail/send` body (camelCase; `@sendgrid/mail` converts it). Shared by the live side and the mock. */
export function buildNotificationData(mail: PlatformSendNotificationT): Record<string, unknown> {
  return {
    from: mail.from,
    personalizations: [{ to: [{ email: mail.to.email }] }],
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(mail.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${mail.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    categories: ["foundmill-notify"],
    mailSettings: { bypassListManagement: { enable: false } },
    trackingSettings: { subscriptionTracking: { enable: false }, clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
  };
}

/* ---- The link that turns a kind of email off ---- */

const LABEL = "fm-notify-off";
const VERSION = "n1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PLATFORM_NOTIFY_OFF_PATH = "/mail/notify/off";

const mac = (secret: string, parts: readonly string[]): string => createHmac("sha256", secret).update([LABEL, ...parts].join("\u0000"), "utf8").digest("base64url");

/**
 * `n1.<user id>.<kind>.<signature>`, signed with PLATFORM_MAIL_SIGNING_SECRET under its own label, so it can never pass
 * for a project's unsubscribe token, a follow confirmation or a message's custom args, and the other way round. It names
 * the person by id only (never the address) and does not expire: a link in an old email still turns the email off.
 */
export function notifyOffToken(secret: string, userId: string, kind: EmailNotificationKind): string {
  const parts = [VERSION, userId.toLowerCase(), kind];
  return `${parts.join(".")}.${mac(secret, parts)}`;
}

export function readNotifyOffToken(secret: string, token: string): { userId: string; kind: EmailNotificationKind } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [v, u, k, sig] = parts as [string, string, string, string];
  if (v !== VERSION || !UUID_RE.test(u) || !(EMAIL_NOTIFICATION_KINDS as readonly string[]).includes(k)) return null;
  return safeEqual(sig, mac(secret, [v, u, k])) ? { userId: u.toLowerCase(), kind: k as EmailNotificationKind } : null;
}

export const notifyOffUrl = (base: string, token: string): string => `${base.replace(/\/+$/, "")}${PLATFORM_NOTIFY_OFF_PATH}?t=${encodeURIComponent(token)}`;
