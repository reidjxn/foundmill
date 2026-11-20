import { AppError } from "@foundmill/shared";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, simulate, stableHash } from "../../mock-utils";
import { GMAIL_LABELS, GMAIL_MESSAGES, isMockSuppressed, MOCK_MAILBOX_ADDRESS } from "./fixtures/mailbox";
import { GMAIL_KEY, GMAIL_RATE_LIMITS, GMAIL_SCOPES, gmailTools, mapMessage, mapSummary, type GmailMessage } from "./tools";

export const SUPPRESSED_CODE = "recipient_suppressed";

/** Shared pre-send guard (mock and live): refuse any recipient on the suppression list. */
export async function assertNotSuppressed(recipients: string[], isSuppressed: (email: string) => Promise<boolean> | boolean): Promise<void> {
  for (const r of recipients) {
    if (await isSuppressed(r)) throw new AppError(SUPPRESSED_CODE, `${r} is on the suppression list; no message may be sent to this address (BUILD §2.3)`, 403, { recipient: r });
  }
}

/** Parse a tiny subset of Gmail query syntax for the mock: `from:`, `subject:`, `label:`, `is:unread`, free words. */
export function matchesQuery(m: ReturnType<typeof mapSummary>, q: string): boolean {
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (term.startsWith("newer_than:") || term.startsWith("older_than:")) continue;
    if (term.startsWith("from:")) { if (!m.from.toLowerCase().includes(term.slice(5))) return false; continue; }
    if (term.startsWith("subject:")) { if (!m.subject.toLowerCase().includes(term.slice(8))) return false; continue; }
    if (term.startsWith("label:")) { if (!m.labelIds.map((l) => l.toLowerCase()).includes(term.slice(6))) return false; continue; }
    if (term === "is:unread") { if (!m.labelIds.includes("UNREAD")) return false; continue; }
    if (!`${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(term)) return false;
  }
  return true;
}

/** One mailbox per business (the fixtures are copied for each): what one business's agents draft or send, no other business sees. */
export function createGmailMock() {
  const world = perBusiness(() => ({ messages: new Map<string, GmailMessage>(GMAIL_MESSAGES.map((m) => [m.id, structuredClone(m)])), sent: [] as { id: string; to: string[]; subject: string }[] }));
  const outbound = (businessId: string, args: { to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; threadId?: string | undefined }, label: "SENT" | "DRAFT"): GmailMessage => {
    const id = `${label === "SENT" ? "s" : "d"}${stableHash([label, args.to, args.subject, args.text], 15)}`;
    const m: GmailMessage = { id, threadId: args.threadId ?? `t-${id}`, labelIds: [label], snippet: args.text.slice(0, 90), internalDate: String(MOCK_NOW.getTime()), payload: { mimeType: "text/plain", headers: [{ name: "From", value: MOCK_MAILBOX_ADDRESS }, { name: "To", value: args.to.join(", ") }, { name: "Cc", value: args.cc.join(", ") }, { name: "Subject", value: args.subject }, { name: "Date", value: MOCK_NOW.toUTCString() }, { name: "Message-ID", value: `<${id}@northwindskincare.com>` }], body: { data: Buffer.from(args.text).toString("base64url") } } };
    world(businessId).messages.set(id, m);
    return m;
  };

  const connector = buildMockConnector({
    key: GMAIL_KEY,
    displayName: "Gmail",
    phase: 1,
    auth: { kind: "oauth", scopes: GMAIL_SCOPES },
    tools: gmailTools,
    rateLimits: GMAIL_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      list_messages: async ({ q, maxResults }, ctx) => ({ items: [...world(ctx.businessId).messages.values()].map(mapSummary).filter((m) => matchesQuery(m, q)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, maxResults), nextPageToken: null }),
      get_message: async ({ id }, ctx) => {
        const m = world(ctx.businessId).messages.get(id);
        if (!m) throw Object.assign(new Error(`message ${id} not found`), { status: 404 });
        return mapMessage(m);
      },
      send_message: async (args, ctx) => {
        await assertNotSuppressed([...args.to, ...args.cc, ...args.bcc], isMockSuppressed);
        const m = outbound(ctx.businessId, args, "SENT");
        world(ctx.businessId).sent.push({ id: m.id, to: args.to, subject: args.subject });
        return { id: m.id, threadId: m.threadId, to: args.to };
      },
      create_draft: async (args, ctx) => {
        const m = outbound(ctx.businessId, args, "DRAFT");
        return { draftId: `r${m.id}`, messageId: m.id };
      },
      list_drafts: async ({ q, maxResults }, ctx) => ({ items: [...world(ctx.businessId).messages.values()].filter((m) => m.labelIds?.includes("DRAFT")).map((m) => ({ draftId: `r${m.id}`, ...mapSummary(m) })).filter((m) => !q || matchesQuery(m, q)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, maxResults) }),
      get_draft: async ({ draftId }, ctx) => {
        const m = world(ctx.businessId).messages.get(draftId.replace(/^r/, ""));
        if (!m || !m.labelIds?.includes("DRAFT")) throw Object.assign(new Error(`draft ${draftId} not found`), { status: 404 });
        return { draftId, ...mapMessage(m) };
      },
      list_labels: async () => ({ items: GMAIL_LABELS }),
    },
    connect: async (businessId) => mockIntegrationRecord(GMAIL_KEY, businessId, { accountLabel: `${MOCK_MAILBOX_ADDRESS} (mock)`, scopes: GMAIL_SCOPES, config: { email: MOCK_MAILBOX_ADDRESS } }),
    healthcheck: async (integration) => mockHealth(GMAIL_KEY, { messages: world(integration.businessId).messages.size }),
    simulations: {
      "lead.replied": (params) => simulate("lead.replied", { email: "maja@sensitiveskinclub.se", ...params }),
    },
  });
  /** `sentFor(businessId)`: what that business's agents sent (tests). */
  return Object.assign(connector, { sentFor: (businessId: string) => world(businessId).sent });
}

export const gmailMock = createGmailMock();
