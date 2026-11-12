/**
 * Resend: the email channel agent sends from the founder's own Resend account and domain (the alternative to the
 * founder's own SendGrid and to the project's Foundmill sending address). The founder's own key only; Resend bills
 * the founder. Every send is an outside message on behalf of the business, so it holds the same rules as `sendgrid`
 * and `platform_mail`: the sender's domain must be verified on the account, nobody on the project's suppression list
 * is written to, one recipient per call, an unsubscribe link (the gateway's own, from the tool context) in the headers and the footer, no attachments.
 *
 * Docs read Nov 12, 2026: https://resend.com/docs/api-reference/emails/send-email (POST /emails),
 * https://resend.com/docs/api-reference/domains/list-domains (GET /domains), https://resend.com/docs/api-reference/errors,
 * https://resend.com/docs/api-reference/api-keys/create-api-key (permissions), https://resend.com/docs/api-reference/rate-limit.
 */
import { z } from "zod";
import { AppError } from "@foundmill/shared";
import type { ConnectField } from "../../contract";
import { defineTool } from "../../define";
import { stableHash } from "../../mock-utils";
import { platformMailContentProblem } from "../platform_mail/tools";

export const RESEND_KEY = "resend";
export const RESEND_BASE_URL = "https://api.resend.com";

/**
 * What the founder enters in Settings › Integrations. Resend's "sending access" keys can only send: the docs' errors page
 * answers any other call with 401 `restricted_api_key` ("restricted to only send emails"), and listing domains is one of
 * those calls. The domain check before every send needs that list, so the key must have full access.
 */
export const RESEND_CONNECT_FIELDS: ConnectField[] = [
  {
    name: "apiKey",
    label: "API key",
    secret: true,
    required: true,
    placeholder: "re_…",
    hint: "A key from your own Resend account (resend.com › API Keys) with Full access. A key limited to sending cannot list your domains, so your sending domain could not be checked as verified. Sending is billed to your Resend account.",
  },
];

/**
 * Resend documents 10 requests per second per team (rate-limit page, Nov 12, 2026), shared by all of the team's keys.
 * A send makes two calls (domains, then the email). The day cap keeps a loop from running up a small account.
 */
export const RESEND_RATE_LIMITS = { perMinute: 10, perDay: 200 };

/**
 * Estimate, US cents, of one email on the founder's own account. Source: https://resend.com/pricing, read Nov 12, 2026:
 * the free plan sends 3,000 a month (100 a day) at no charge, Pro is $20 for 50,000 (about 0.04 cents each) and an
 * overage is $0.90 per 1,000 (0.09 cents each). Whether the account is inside its free allowance cannot be known here,
 * so this is the paid rate rounded up to 1 cent at most.
 */
export const RESEND_SEND_COST_MINOR = 1;

export const RESEND_TEXT_MAX = 20_000;
export const RESEND_HTML_MAX = 100_000;

/**
 * A display name is plain words. It refuses every character that could end the name and start a second address or a
 * look-alike sender ("Bob, eve@x.com"): , ; : @ ( ) [ ] \\ as well as line breaks, angle brackets and quotes.
 */
const Address = z.strictObject({ email: z.email().max(254), name: z.string().trim().min(1).max(120).regex(/^[^\r\n<>"@,;:()[\]\\]*$/, "a name on one line, without < > @ , ; : ( ) [ ] \\ or quotes").optional() });

/** An https address with no spaces, quotes or angle brackets (it goes into a header and a link). */
export const isSafeUnsubscribeUrl = (u: unknown): u is string => {
  if (typeof u !== "string" || u.length > 2_000 || !/^https:\/\/[^\s<>"'\\]+$/i.test(u)) return false;
  try {
    const p = new URL(u);
    return p.protocol === "https:" && !p.username && !p.password;
  } catch {
    return false;
  }
};

export const UNSUBSCRIBE_UNAVAILABLE = "unsubscribe_unavailable";

/** The link comes from the gateway (`ctx.unsubscribeUrl`), never from the agent. Refuses before any vendor call. */
export function requireUnsubscribeUrl(url: string | undefined): string {
  if (!isSafeUnsubscribeUrl(url)) throw new AppError(UNSUBSCRIBE_UNAVAILABLE, "Nothing was sent: this message needs an unsubscribe link, and one is not available here yet.", 409);
  return url;
}

/** One message to one person. No cc, bcc, attachments, scheduling, templates or batches: the schema refuses unknown fields. */
export const ResendSendMail = z.strictObject({
  from: Address.describe("must be on a verified domain of the account"),
  to: Address,
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(RESEND_TEXT_MAX),
  html: z.string().max(RESEND_HTML_MAX).optional(),
  replyTo: z.email().max(254).optional().describe("must also be on a verified domain of the account"),
});
export type ResendSendMailT = z.infer<typeof ResendSendMail>;

export const ResendSendResult = z.object({
  id: z.string(),
  to: z.string(),
  from: z.string(),
  subject: z.string(),
  /** Mock mode only: nothing was sent. */
  simulated: z.literal(true).optional(),
  notice: z.string().optional(),
});

export const ResendDomain = z.object({ id: z.string(), name: z.string(), status: z.string(), region: z.string().nullable() });
export type ResendDomainT = z.infer<typeof ResendDomain>;
export const ResendDomains = z.object({ items: z.array(ResendDomain), simulated: z.literal(true).optional(), notice: z.string().optional() });

export const resendTools = [
  defineTool({
    name: "list_domains",
    title: "List sending domains",
    description: "The sending domains on the founder's Resend account and whether each is verified. Only an address on a verified domain may be used as `from`.",
    input: z.strictObject({}),
    output: ResendDomains,
    hints: {},
    annotations: { readOnlyHint: true },
  }),
  defineTool({
    name: "send_mail",
    title: "Send an email",
    description:
      "Send one email to one person from the founder's own Resend account and domain. Plain text (required), optionally with simple HTML (paragraphs, line breaks, bold, italics, lists, headings, links); no attachments, cc, bcc, scheduling or templates. Foundmill adds this person's unsubscribe link to the headers and the footer; you do not supply one. Refused when the `from` or `replyTo` domain is not verified on the account or when the person is on the project's suppression list. Never claim to be a person.",
    input: ResendSendMail,
    output: ResendSendResult,
    hints: { contactsThirdParty: true, irreversible: true },
    costMinor: () => RESEND_SEND_COST_MINOR,
  }),
] as const;

/* ---- Pre-send checks shared by the live side and the mock ---- */

export const SENDER_DOMAIN_NOT_VERIFIED = "sender_domain_not_verified";
export const CONTENT_REFUSED = "content_refused";

export const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** A domain counts only when Resend says `verified` (and, when it reports capabilities, sending is enabled). */
export const isVerifiedDomain = (d: ResendDomainT & { sending?: boolean }): boolean => d.status === "verified" && d.sending !== false;

export function assertVerifiedFromDomain(fromEmail: string, domains: (ResendDomainT & { sending?: boolean })[]): void {
  const domain = domainOf(fromEmail);
  if (!domains.some((d) => d.name.toLowerCase() === domain && isVerifiedDomain(d))) {
    throw new AppError(SENDER_DOMAIN_NOT_VERIFIED, `Nothing was sent: ${domain} is not a verified sending domain on this Resend account. Verify it in Resend (Domains), or send from an address on a verified domain.`, 403, { domain });
  }
}

/** A reply-to address is held to the same rule as the sender: on a verified domain of the account. */
export function assertVerifiedReplyTo(replyTo: string | undefined, domains: (ResendDomainT & { sending?: boolean })[]): void {
  if (replyTo === undefined) return;
  const domain = domainOf(replyTo);
  if (!domains.some((d) => d.name.toLowerCase() === domain && isVerifiedDomain(d))) {
    throw new AppError(SENDER_DOMAIN_NOT_VERIFIED, `Nothing was sent: the reply-to address is on ${domain}, which is not a verified sending domain on this Resend account. Use a reply-to on a verified domain.`, 403, { domain });
  }
}

export function assertContent(mail: Pick<ResendSendMailT, "subject" | "text" | "html">): void {
  const problem = platformMailContentProblem(mail);
  if (problem) throw new AppError(CONTENT_REFUSED, `Nothing was sent: ${problem}`, 422);
}

const FOOTER_STOP_LINE = "To stop getting these emails";
const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "%22").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const unsubscribeFooter = (url: string): { text: string; html: string } => ({
  text: `\n\n--\n${FOOTER_STOP_LINE}: ${url}`,
  html: `<hr><p><a href="${escapeHtml(url)}">Unsubscribe</a></p>`,
});

export const formatAddress = (a: { email: string; name?: string | undefined }): string => (a.name ? `"${a.name}" <${a.email}>` : a.email);

/**
 * A stable key for the same message: a retried call (a timeout, a repeated tool call) carries the same key, and Resend
 * answers the first email's id instead of sending again (keys last 24 hours; at most 256 characters).
 */
export const idempotencyKeyFor = (businessId: string, mail: Pick<ResendSendMailT, "to" | "subject" | "text">): string => `fm-${stableHash([businessId, mail.to.email.toLowerCase(), mail.subject, mail.text], 48)}`;

/** The `POST /emails` body. Shared by the live side and the mock so both carry the same headers and footer. */
export function buildSendBody(mail: ResendSendMailT, unsubscribeUrl: string): Record<string, unknown> {
  const footer = unsubscribeFooter(unsubscribeUrl);
  return {
    from: formatAddress(mail.from),
    to: [formatAddress(mail.to)],
    subject: mail.subject,
    text: `${mail.text}${footer.text}`,
    ...(mail.html?.trim() ? { html: `${mail.html}${footer.html}` } : {}),
    ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/* ---- Vendor shapes (subset) ---- */
export interface ResendDomainRaw {
  id?: string;
  name?: string;
  status?: string;
  region?: string | null;
  capabilities?: { sending?: string; receiving?: string };
}

export const mapDomain = (d: ResendDomainRaw): (ResendDomainT & { sending?: boolean }) | null =>
  typeof d.id === "string" && typeof d.name === "string"
    ? { id: d.id, name: d.name, status: typeof d.status === "string" ? d.status : "unknown", region: typeof d.region === "string" ? d.region : null, ...(d.capabilities?.sending ? { sending: d.capabilities.sending === "enabled" } : {}) }
    : null;

/** What the agent sees of a domain (no internal flags). */
export const publicDomain = ({ id, name, status, region }: ResendDomainT): ResendDomainT => ({ id, name, status, region });
