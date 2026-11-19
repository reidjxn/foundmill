/** Gmail: read the connected mailbox (quarantined), draft and send on behalf of the business. */
import { z } from "zod";
import { defineTool } from "../../define";

export const GMAIL_KEY = "gmail";
export const GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
/** Launch scopes ("sensitive" at Google): sending and drafting only. */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose"];
/** "Restricted" at Google (yearly outside assessment): asked for only when the founder turns reading on (`connect` input `readMail: true`). */
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_READ_TOOLS: ReadonlySet<string> = new Set(["list_messages", "get_message"]);
export const GMAIL_READ_OFF = "Reading the mailbox is off. The founder turns it on in Settings › Integrations › Gmail, which asks Google for read access.";

export const MessageSummary = z.object({ id: z.string(), threadId: z.string(), from: z.string(), to: z.array(z.string()), subject: z.string(), date: z.string(), snippet: z.string(), labelIds: z.array(z.string()) });
export const Message = MessageSummary.extend({ cc: z.array(z.string()), text: z.string(), messageIdHeader: z.string().nullable(), inReplyTo: z.string().nullable() });
export type MessageT = z.infer<typeof Message>;

/** One RFC 5322 msg-id (`<local@domain>`): no whitespace or line breaks, so it can never start another header. */
export const MessageIdHeader = z.string().max(998).regex(/^<[^\s<>@]+@[^\s<>@]+>$/, "Use the message's Message-ID header, like <id@mail.example.com>");

const Compose = z.object({
  to: z.array(z.email()).min(1).max(50),
  cc: z.array(z.email()).max(50).default([]),
  bcc: z.array(z.email()).max(50).default([]),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(100_000),
  html: z.string().max(400_000).optional(),
  threadId: z.string().optional(),
  inReplyToMessageId: MessageIdHeader.optional(),
});

export const gmailTools = [
  defineTool({
    name: "list_messages",
    description: "Search the mailbox with Gmail query syntax (`from:x newer_than:7d label:inbox`). Returns summaries only; bodies via get_message.",
    input: z.object({ q: z.string().max(500).default("label:inbox newer_than:30d"), maxResults: z.number().int().min(1).max(100).default(25), pageToken: z.string().optional() }),
    output: z.object({ items: z.array(MessageSummary), nextPageToken: z.string().nullable() }),
    hints: {},
    untrusted: "email",
    untrustedRef: (a) => `q:${a.q}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "get_message", description: "One message with its plain-text body (HTML stripped when there is no text part).", input: z.object({ id: z.string().min(1).max(64) }), output: Message, hints: {}, untrusted: "email", untrustedRef: (a) => `message:${a.id}`, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "send_message",
    description: "Send an email from the connected mailbox on behalf of the business (BUILD §2.3: never claim to be human; the global suppression list is checked first). Use threadId + inReplyToMessageId to reply in-thread.",
    input: Compose,
    output: z.object({ id: z.string(), threadId: z.string(), to: z.array(z.string()) }),
    hints: { contactsThirdParty: true, irreversible: true },
  }),
  defineTool({ name: "create_draft", annotations: { readOnlyHint: false }, description: "Save a draft in the connected mailbox for the founder to review and send.", input: Compose, output: z.object({ draftId: z.string(), messageId: z.string() }), hints: {} }),
  defineTool({ name: "list_labels", description: "Labels of the mailbox.", input: z.object({}), output: z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })) }), hints: {}, annotations: { readOnlyHint: true } }),
] as const;

export const GMAIL_RATE_LIMITS = { perMinute: 60, perDay: 2_000 };

/* ---- Vendor shapes (subset) ---- */
export interface GmailHeader { name: string; value: string }
export interface GmailPart { mimeType?: string; body?: { data?: string; size?: number }; parts?: GmailPart[]; headers?: GmailHeader[] }
export interface GmailMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart }

const header = (m: GmailMessage, name: string): string => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
export const splitAddresses = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);

export function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return undefined;
}

export const stripHtml = (html: string): string => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();

export function messageText(m: GmailMessage): string {
  const text = findPart(m.payload, "text/plain");
  if (text?.body?.data) return Buffer.from(text.body.data, "base64url").toString("utf8");
  const html = findPart(m.payload, "text/html");
  if (html?.body?.data) return stripHtml(Buffer.from(html.body.data, "base64url").toString("utf8"));
  return m.snippet ?? "";
}

export const mapSummary = (m: GmailMessage): z.infer<typeof MessageSummary> => ({ id: m.id, threadId: m.threadId, from: header(m, "From"), to: splitAddresses(header(m, "To")), subject: header(m, "Subject"), date: header(m, "Date") || (m.internalDate ? new Date(Number(m.internalDate)).toUTCString() : ""), snippet: m.snippet ?? "", labelIds: m.labelIds ?? [] });
export const mapMessage = (m: GmailMessage): MessageT => ({ ...mapSummary(m), cc: splitAddresses(header(m, "Cc")), text: messageText(m), messageIdHeader: header(m, "Message-ID") || null, inReplyTo: header(m, "In-Reply-To") || null });
