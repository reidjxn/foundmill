/**
 * SendGrid (Mail Send, Marketing Campaigns, Event Webhook, Inbound Parse — BUILD §11.7 email automation).
 * Every send is an external message on behalf of the business (BUILD §2.3): the sender must be a verified
 * identity, marketing mail must carry a one-click unsubscribe, and the global suppression list is checked
 * before any recipient is contacted. The connector enforces the structural checks; the pre-send checker
 * (packages/agents) judges the copy.
 */
import { z } from "zod";
import { AppError } from "@foundmill/shared";
import type { ConnectField } from "../../contract";
import { defineTool } from "../../define";

export const SENDGRID_KEY = "sendgrid";

/** What the founder enters in Settings › Integrations to connect SendGrid live: their own account's key. */
export const SENDGRID_CONNECT_FIELDS: ConnectField[] = [
  { name: "apiKey", label: "API key", secret: true, required: true, placeholder: "SG.…", hint: "A key from your SendGrid account with Mail Send, Suppressions, Marketing and Stats access. Sending is billed to your SendGrid account." },
];
export const SENDGRID_BASE_URL = "https://api.sendgrid.com";
/** Substitution SendGrid replaces with the recipient's unsubscribe link when an ASM group is set. */
export const UNSUBSCRIBE_TAG = "<%asm_group_unsubscribe_raw_url%>";
export const UNSUBSCRIBE_PLACEHOLDER = "{{{unsubscribe}}}";

export const EmailAddress = z.object({ email: z.email(), name: z.string().max(200).optional() });

export const MailKind = z.enum(["transactional", "marketing"]);

const SendMail = z.object({
  kind: MailKind.describe("marketing mail must carry an unsubscribe (group id or {{{unsubscribe}}} in the body)"),
  from: EmailAddress,
  replyTo: EmailAddress.optional(),
  to: z.array(EmailAddress).min(1).max(100),
  cc: z.array(EmailAddress).max(50).default([]),
  bcc: z.array(EmailAddress).max(50).default([]),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(200_000),
  html: z.string().max(800_000).optional(),
  unsubscribeGroupId: z.number().int().positive().optional(),
  /** `List-Unsubscribe` URL for one-click unsubscribe (RFC 8058); required for marketing when no group id is set. */
  unsubscribeUrl: z.url().optional(),
  categories: z.array(z.string().min(1).max(255)).max(10).default([]),
  /** Attribution keys (campaignId, entityId, sequenceStep…) echoed back by the Event Webhook. */
  customArgs: z.record(z.string().max(40), z.string().max(200)).default({}),
  sendAt: z.iso.datetime({ offset: true }).optional(),
});
export type SendMailT = z.infer<typeof SendMail>;

export const SendResult = z.object({ messageId: z.string(), accepted: z.array(z.string()), rejected: z.array(z.object({ email: z.string(), reason: z.string() })), scheduledFor: z.string().nullable() });

export const VerifiedSender = z.object({ id: z.number().int(), fromEmail: z.string(), fromName: z.string().nullable(), replyTo: z.string().nullable(), verified: z.boolean(), locked: z.boolean() });

export const SUPPRESSION_KINDS = ["global_unsubscribe", "group_unsubscribe", "bounce", "spam_report", "block", "invalid_email"] as const;
export const SuppressionKind = z.enum(SUPPRESSION_KINDS);

export const Campaign = z.object({ id: z.string(), name: z.string(), status: z.enum(["draft", "scheduled", "triggered"]), sendAt: z.string().nullable(), listIds: z.array(z.string()), subject: z.string().nullable(), senderId: z.number().int().nullable(), suppressionGroupId: z.number().int().nullable(), createdAt: z.string(), updatedAt: z.string() });
export type CampaignT = z.infer<typeof Campaign>;

export const StatsRow = z.object({ date: z.string(), requests: z.number().int(), delivered: z.number().int(), opens: z.number().int(), uniqueOpens: z.number().int(), clicks: z.number().int(), bounces: z.number().int(), spamReports: z.number().int(), unsubscribes: z.number().int() });

export const sendgridTools = [
  defineTool({ name: "list_verified_senders", description: "Sender identities verified on the account; only these may appear in `from`.", input: z.object({}), output: z.object({ items: z.array(VerifiedSender) }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "check_suppression",
    description: "Which of these addresses SendGrid will not deliver to (global/group unsubscribes, bounces, spam reports, blocks, invalid). Run before planning a sequence; send_mail runs it again.",
    input: z.object({ emails: z.array(z.email()).min(1).max(100) }),
    output: z.object({ suppressed: z.array(z.object({ email: z.string(), kinds: z.array(SuppressionKind) })), clear: z.array(z.string()) }),
    hints: {},
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "add_suppression", description: "Add an address to the global unsubscribe list (honors an opt-out received elsewhere).", input: z.object({ emails: z.array(z.email()).min(1).max(100) }), output: z.object({ added: z.array(z.string()) }), hints: {}, annotations: { readOnlyHint: false, idempotentHint: true } }),
  defineTool({
    name: "send_mail",
    description: "Send an email on behalf of the business (never claiming to be human — BUILD §2.3). Refused when the sender is not verified, when marketing mail has no unsubscribe, or when any recipient is on the suppression list.",
    input: SendMail,
    output: SendResult,
    hints: { contactsThirdParty: true, irreversible: true },
    costMinor: (a) => Math.ceil((a.to.length + a.cc.length + a.bcc.length) * 0.1),
  }),
  defineTool({ name: "list_campaigns", description: "Marketing single sends (drafts, scheduled and sent), newest first.", input: z.object({ pageSize: z.number().int().min(1).max(100).default(25) }), output: z.object({ items: z.array(Campaign) }), hints: {}, untrusted: "api", untrustedRef: () => "singlesends", annotations: { readOnlyHint: true } }),
  defineTool({
    name: "create_campaign", annotations: { readOnlyHint: false },
    description: "Create a draft marketing single send (name, subject, HTML + plain text, sender, lists, suppression group). Nothing is sent until schedule_campaign.",
    input: z.object({ name: z.string().min(1).max(100), subject: z.string().min(1).max(300), html: z.string().min(1).max(800_000), text: z.string().min(1).max(200_000), senderId: z.number().int().positive(), listIds: z.array(z.string().min(1)).min(1).max(50), suppressionGroupId: z.number().int().positive(), customUnsubscribeUrl: z.url().optional() }),
    output: Campaign,
    hints: {},
  }),
  defineTool({
    name: "schedule_campaign",
    description: "Schedule (or send now) a draft single send to its lists. External, irreversible once triggered.",
    input: z.object({ campaignId: z.string().min(1), sendAt: z.union([z.literal("now"), z.iso.datetime({ offset: true })]).default("now") }),
    output: Campaign,
    hints: { contactsThirdParty: true, irreversible: true },
  }),
  defineTool({ name: "get_stats", description: "Daily global stats (requests, delivered, opens, clicks, bounces, spam reports, unsubscribes) for a date range; feeds the spam-rate auto-pause (AC-11.7.4).", input: z.object({ startDate: z.iso.date(), endDate: z.iso.date().optional() }), output: z.object({ rows: z.array(StatsRow), spamRatePercent: z.number(), bounceRatePercent: z.number() }), hints: {}, annotations: { readOnlyHint: true } }),
] as const;

export const SENDGRID_RATE_LIMITS = { perMinute: 600, perDay: 100_000 };

/* ---- Pre-send checks shared by mock and live ---- */

export const SENDER_NOT_VERIFIED = "sender_not_verified";
export const UNSUBSCRIBE_MISSING = "unsubscribe_missing";
export const RECIPIENT_SUPPRESSED = "recipient_suppressed";

export function assertVerifiedSender(from: { email: string }, verified: { fromEmail: string; verified: boolean }[]): void {
  const ok = verified.some((v) => v.verified && v.fromEmail.toLowerCase() === from.email.toLowerCase());
  if (!ok) throw new AppError(SENDER_NOT_VERIFIED, `${from.email} is not a verified sender identity on this SendGrid account (BUILD §2.3 sender identity)`, 403, { from: from.email });
}

export function assertUnsubscribe(mail: Pick<SendMailT, "kind" | "unsubscribeGroupId" | "unsubscribeUrl" | "text" | "html">): void {
  if (mail.kind !== "marketing") return;
  const inBody = mail.text.includes(UNSUBSCRIBE_PLACEHOLDER) || (mail.html?.includes(UNSUBSCRIBE_PLACEHOLDER) ?? false) || mail.text.includes(UNSUBSCRIBE_TAG) || (mail.html?.includes(UNSUBSCRIBE_TAG) ?? false);
  if (!mail.unsubscribeGroupId && !mail.unsubscribeUrl && !inBody) throw new AppError(UNSUBSCRIBE_MISSING, "marketing email needs a one-click unsubscribe: set unsubscribeGroupId, unsubscribeUrl or include {{{unsubscribe}}} in the body (BUILD §2.3)", 422);
}

export async function assertNoneSuppressed(recipients: string[], check: (email: string) => Promise<boolean> | boolean): Promise<void> {
  for (const r of recipients) {
    if (await check(r)) throw new AppError(RECIPIENT_SUPPRESSED, `${r} is on the suppression list; no message may be sent to this address (BUILD §2.3)`, 403, { recipient: r });
  }
}

export const allRecipients = (m: Pick<SendMailT, "to" | "cc" | "bcc">): string[] => [...m.to, ...m.cc, ...m.bcc].map((a) => a.email.toLowerCase());

/** The v3 `mail/send` payload. Kept here so mock and live produce the same body (the SDK validates it). */
export function buildMailData(m: SendMailT): Record<string, unknown> {
  const headers: Record<string, string> = {};
  if (m.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${m.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const html = m.html?.replaceAll(UNSUBSCRIBE_PLACEHOLDER, m.unsubscribeUrl ?? UNSUBSCRIBE_TAG);
  const text = m.text.replaceAll(UNSUBSCRIBE_PLACEHOLDER, m.unsubscribeUrl ?? UNSUBSCRIBE_TAG);
  return {
    from: m.from,
    replyTo: m.replyTo,
    personalizations: [{ to: m.to, cc: m.cc.length ? m.cc : undefined, bcc: m.bcc.length ? m.bcc : undefined, customArgs: Object.keys(m.customArgs).length ? m.customArgs : undefined, sendAt: m.sendAt ? Math.floor(Date.parse(m.sendAt) / 1000) : undefined }],
    subject: m.subject,
    text,
    html,
    categories: m.categories.length ? m.categories : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    asm: m.unsubscribeGroupId ? { groupId: m.unsubscribeGroupId } : undefined,
    customArgs: { fm_kind: m.kind },
    mailSettings: { bypassListManagement: { enable: false } },
    trackingSettings: { subscriptionTracking: { enable: m.kind === "marketing" } },
  };
}

/* ---- Vendor shapes ---- */
export interface SgVerifiedSender { id: number; from_email: string; from_name?: string | null; reply_to?: string | null; verified?: boolean; locked?: boolean }
export interface SgSingleSend { id: string; name: string; status: "draft" | "scheduled" | "triggered"; send_at?: string | null; send_to?: { list_ids?: string[] }; email_config?: { subject?: string | null; sender_id?: number | null; suppression_group_id?: number | null; html_content?: string; plain_content?: string; custom_unsubscribe_url?: string | null }; created_at: string; updated_at: string }
export interface SgStatsDay { date: string; stats: { metrics: { requests?: number; delivered?: number; opens?: number; unique_opens?: number; clicks?: number; bounces?: number; spam_reports?: number; unsubscribes?: number } }[] }

export const mapVerifiedSender = (s: SgVerifiedSender) => ({ id: s.id, fromEmail: s.from_email, fromName: s.from_name ?? null, replyTo: s.reply_to ?? null, verified: s.verified ?? false, locked: s.locked ?? false });
export const mapSingleSend = (s: SgSingleSend): CampaignT => ({ id: s.id, name: s.name, status: s.status, sendAt: s.send_at ?? null, listIds: s.send_to?.list_ids ?? [], subject: s.email_config?.subject ?? null, senderId: s.email_config?.sender_id ?? null, suppressionGroupId: s.email_config?.suppression_group_id ?? null, createdAt: s.created_at, updatedAt: s.updated_at });

export function summariseStats(days: SgStatsDay[]) {
  const rows = days.map((d) => {
    const m = d.stats.reduce((acc, s) => {
      for (const [k, v] of Object.entries(s.metrics)) acc[k] = (acc[k] ?? 0) + (v ?? 0);
      return acc;
    }, {} as Record<string, number>);
    return { date: d.date, requests: m.requests ?? 0, delivered: m.delivered ?? 0, opens: m.opens ?? 0, uniqueOpens: m.unique_opens ?? 0, clicks: m.clicks ?? 0, bounces: m.bounces ?? 0, spamReports: m.spam_reports ?? 0, unsubscribes: m.unsubscribes ?? 0 };
  });
  const delivered = rows.reduce((a, r) => a + r.delivered, 0);
  const requests = rows.reduce((a, r) => a + r.requests, 0);
  const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(3)) : 0);
  return { rows, spamRatePercent: pct(rows.reduce((a, r) => a + r.spamReports, 0), delivered), bounceRatePercent: pct(rows.reduce((a, r) => a + r.bounces, 0), requests) };
}
