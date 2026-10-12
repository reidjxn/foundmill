/**
 * Cross-tenant isolation of every stateful mock (staging runs INTEGRATIONS_MODE=mock for real founders' businesses):
 * what one business's agents write through a mock connector is never visible to, and never changes, another business's
 * world. Each mock is called exactly as the gateway calls it, with `ctx.businessId` naming the business.
 */
import { describe, expect, it } from "vitest";
import type { Connector, ToolResult } from "../contract";
import { mockIntegrationRecord, perBusiness, uuidFromSeed } from "../mock-utils";
import { isUntrusted } from "../quarantine";
import { makeToolContext } from "../testing/contract-suite";
import { CF_RECORDS, CF_ZONES } from "../connectors/cloudflare_dns/fixtures/zones";
import { createCloudflareMock } from "../connectors/cloudflare_dns/mock";
import { HS_REQUESTS } from "../connectors/dropbox_sign/fixtures/requests";
import { createDropboxSignMock } from "../connectors/dropbox_sign/mock";
import { createE2bMock } from "../connectors/e2b/mock";
import { createGmailMock } from "../connectors/gmail/mock";
import { createGoogleCalendarMock } from "../connectors/google_calendar/mock";
import { createGoogleDriveMock } from "../connectors/google_drive/mock";
import { NOTION_PAGE_BRAND } from "../connectors/notion/fixtures/workspace";
import { createNotionMock } from "../connectors/notion/mock";
import { createPlaidMock } from "../connectors/plaid/mock";
import { MOCK_SENDER_EMAIL } from "../connectors/sendgrid/fixtures/sendgrid";
import { createSendgridMock } from "../connectors/sendgrid/mock";
import { createShopifyMock } from "../connectors/shopify/mock";
import { createStripeMock } from "../connectors/stripe/mock";
import { createTinkMock } from "../connectors/tink/mock";

const A = uuidFromSeed("isolation", "business", "a");
const B = uuidFromSeed("isolation", "business", "b");

const ctxFor = (connector: Connector, businessId: string) => makeToolContext(connector, { businessId, integration: mockIntegrationRecord(connector.key, businessId) });
const call = (connector: Connector, businessId: string, tool: string, args: unknown) => connector.callTool(tool, args, ctxFor(connector, businessId));
/** The data of a result, unwrapped when the tool returns third-party content. */
const data = <T>(r: ToolResult): T => (isUntrusted(r.data) ? r.data.content : r.data) as T;
const ok = (r: ToolResult): ToolResult => {
  expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  return r;
};

describe("perBusiness", () => {
  it("creates a world per business from the fixtures and forgets the least recently used beyond the limit", () => {
    let created = 0;
    const world = perBusiness((businessId) => ({ businessId, n: ++created, items: [] as string[] }), 2);
    world("a").items.push("x");
    expect(world("b").items).toEqual([]);
    expect(world("a").items).toEqual(["x"]);
    world("c"); // "b" is now the least recently used and goes
    expect(world.size()).toBe(2);
    expect(world.peek("b")).toBeUndefined();
    expect(world("b").n).toBe(4);
    expect(world.peek("a")).toBeUndefined();
  });
});

describe("mock connectors keep one world per business", () => {
  it("gmail: a draft or a send of one business is not in another's mailbox", async () => {
    const gmail = createGmailMock();
    const draft = ok(await call(gmail, A, "create_draft", { to: ["supplier@bakery.example"], subject: "Confidential pricing m1", text: "Our margin floor is 38%." }));
    ok(await call(gmail, A, "send_message", { to: ["buyer@bakery.example"], subject: "Order m1", text: "Thanks." }));
    expect(data<{ items: unknown[] }>(ok(await call(gmail, A, "list_messages", { q: "m1" }))).items).toHaveLength(2);
    expect(data<{ items: unknown[] }>(ok(await call(gmail, B, "list_messages", { q: "m1" }))).items).toHaveLength(0);
    expect((await call(gmail, B, "get_message", { id: (draft.data as { messageId: string }).messageId })).error?.code).toBe("not_found");
    expect(gmail.sentFor(A)).toHaveLength(1);
    expect(gmail.sentFor(B)).toHaveLength(0);
  });

  it("stripe: customers and invoices one business creates are not another's", async () => {
    const stripe = createStripeMock();
    const customer = ok(await call(stripe, A, "create_customer", { email: "vip-m2@bakery.example", name: "VIP Bakery Customer" })).data as { id: string };
    const invoice = ok(await call(stripe, A, "create_invoice", { customerId: customer.id, currency: "GBP", lines: [{ description: "Cake", amountMinor: 1200, quantity: 1 }] })).data as { id: string };
    ok(await call(stripe, A, "send_invoice", { invoiceId: invoice.id }));
    expect(data<{ items: unknown[] }>(ok(await call(stripe, A, "list_customers", { email: "vip-m2@bakery.example" }))).items).toHaveLength(1);
    expect(data<{ items: unknown[] }>(ok(await call(stripe, B, "list_customers", { email: "vip-m2@bakery.example" }))).items).toHaveLength(0);
    expect((await call(stripe, B, "get_customer", { customerId: customer.id })).error?.code).toBe("not_found");
    expect((await call(stripe, B, "get_invoice", { invoiceId: invoice.id })).error?.code).toBe("not_found");
    expect(stripe.sentInvoicesFor(A)).toEqual([invoice.id]);
    expect(stripe.sentInvoicesFor(B)).toEqual([]);
  });

  it("notion: a page one business writes is not in another's workspace", async () => {
    const notion = createNotionMock();
    const page = ok(await call(notion, A, "create_page", { parentPageId: NOTION_PAGE_BRAND, title: "Pricing floor m3", paragraphs: ["Never below 38%."] })).data as { id: string };
    ok(await call(notion, A, "append_paragraphs", { blockId: NOTION_PAGE_BRAND, paragraphs: ["Internal: m3"] }));
    expect(data<{ items: unknown[] }>(ok(await call(notion, A, "search", { query: "Pricing floor m3" }))).items).toHaveLength(1);
    expect(data<{ items: unknown[] }>(ok(await call(notion, B, "search", { query: "Pricing floor m3" }))).items).toHaveLength(0);
    expect((await call(notion, B, "get_page", { pageId: page.id })).error?.code).toBe("not_found");
    const content = (businessId: string) => call(notion, businessId, "get_page_content", { blockId: NOTION_PAGE_BRAND, pageSize: 100 }).then((r) => JSON.stringify(data(ok(r))));
    expect(await content(A)).toContain("Internal: m3");
    expect(await content(B)).not.toContain("Internal: m3");
  });

  it("google drive: a document one business writes is not in another's Drive", async () => {
    const drive = createGoogleDriveMock();
    const doc = ok(await call(drive, A, "create_doc", { title: "Board memo m4", text: "Runway is 7 months." })).data as { documentId: string };
    expect(data<{ items: unknown[] }>(ok(await call(drive, A, "search_files", { q: "Board memo m4" }))).items).toHaveLength(1);
    expect(data<{ items: unknown[] }>(ok(await call(drive, B, "search_files", { q: "Board memo m4" }))).items).toHaveLength(0);
    expect((await call(drive, B, "read_doc", { documentId: doc.documentId })).error?.code).toBe("not_found");
    expect((await call(drive, B, "append_to_doc", { documentId: doc.documentId, text: "x" })).error?.code).toBe("not_found");
  });

  it("google calendar: events one business creates or deletes do not change another's calendar", async () => {
    const calendar = createGoogleCalendarMock();
    const window = { timeMin: "2026-10-01T00:00:00Z", timeMax: "2026-10-31T00:00:00Z" };
    const created = ok(await call(calendar, A, "create_event", { summary: "Secret supplier visit m5", start: "2026-10-08T13:00:00Z", end: "2026-10-08T13:30:00Z" })).data as { id: string };
    ok(await call(calendar, A, "delete_event", { eventId: "evt_standup_1006" }));
    const ids = async (businessId: string) => data<{ items: { id: string }[] }>(ok(await call(calendar, businessId, "list_events", window))).items.map((e) => e.id);
    expect(await ids(A)).toContain(created.id);
    expect(await ids(A)).not.toContain("evt_standup_1006");
    expect(await ids(B)).not.toContain(created.id);
    expect(await ids(B)).toContain("evt_standup_1006");
    expect((await call(calendar, B, "delete_event", { eventId: created.id })).error?.code).toBe("not_found");
  });

  it("sendgrid: one business's suppression never blocks another's mail, and campaigns are its own", async () => {
    const sendgrid = createSendgridMock();
    const mail = { from: { email: MOCK_SENDER_EMAIL }, to: [{ email: "lead-m6@example.com" }], subject: "Hello", text: "Hi.", kind: "transactional" };
    ok(await call(sendgrid, A, "add_suppression", { emails: ["lead-m6@example.com"] }));
    expect((await call(sendgrid, A, "send_mail", mail)).error?.code).toBe("recipient_suppressed");
    ok(await call(sendgrid, B, "send_mail", mail));
    expect(sendgrid.suppressionsFor(B).has("lead-m6@example.com")).toBe(false);
    ok(await call(sendgrid, A, "schedule_campaign", { campaignId: "ss_mock_autumn_draft" }));
    const status = async (businessId: string) => data<{ items: { id: string; status: string }[] }>(ok(await call(sendgrid, businessId, "list_campaigns", {}))).items.find((c) => c.id === "ss_mock_autumn_draft")?.status;
    expect(await status(A)).toBe("triggered");
    expect(await status(B)).toBe("draft");
    expect(sendgrid.sentFor(A)).toHaveLength(0);
    expect(sendgrid.sentFor(B)).toHaveLength(1);
  });

  it("cloudflare dns: records one business creates or deletes do not change another's zones", async () => {
    const cloudflare = createCloudflareMock();
    const zoneId = CF_ZONES[1]!.id;
    const created = ok(await call(cloudflare, A, "create_record", { zoneId, type: "TXT", name: "m7.ledgerly.app", content: "verify-m7" })).data as { id: string };
    const fixture = CF_RECORDS.find((r) => r.zoneId === CF_ZONES[0]!.id)!;
    ok(await call(cloudflare, A, "delete_record", { zoneId: fixture.zoneId, recordId: fixture.id }));
    const ids = async (businessId: string, zone: string) => (ok(await call(cloudflare, businessId, "list_records", { zoneId: zone })).data as { items: { id: string }[] }).items.map((r) => r.id);
    expect(await ids(A, zoneId)).toContain(created.id);
    expect(await ids(B, zoneId)).not.toContain(created.id);
    expect(await ids(A, fixture.zoneId)).not.toContain(fixture.id);
    expect(await ids(B, fixture.zoneId)).toContain(fixture.id);
  });

  it("dropbox sign: requests one business sends or cancels are not another's", async () => {
    const sign = createDropboxSignMock();
    const sent = ok(await call(sign, A, "send_signature_request", { title: "NDA m8", signers: [{ email: "sara@nordlicht.se", name: "Sara" }], fileUrls: ["https://files.example/nda.pdf"] })).data as { signatureRequestId: string };
    const open = HS_REQUESTS.find((r) => !r.is_complete)!.signature_request_id;
    ok(await call(sign, A, "cancel_signature_request", { signatureRequestId: open }));
    expect((await call(sign, B, "get_signature_request", { signatureRequestId: sent.signatureRequestId })).error?.code).toBe("not_found");
    ok(await call(sign, B, "get_signature_request", { signatureRequestId: open }));
    expect((await call(sign, A, "get_signature_request", { signatureRequestId: open })).error?.code).toBe("not_found");
  });

  it("e2b: one business can neither list nor kill another's sandboxes", async () => {
    const e2b = createE2bMock();
    const sb = ok(await call(e2b, A, "create_sandbox", { metadata: { taskId: "m9" } })).data as { sandboxId: string };
    expect((ok(await call(e2b, A, "list_sandboxes", {})).data as { items: unknown[] }).items).toHaveLength(1);
    expect((ok(await call(e2b, B, "list_sandboxes", {})).data as { items: unknown[] }).items).toHaveLength(0);
    expect((await call(e2b, B, "kill_sandbox", { sandboxId: sb.sandboxId })).error?.code).toBe("not_found");
    expect((ok(await call(e2b, A, "get_sandbox", { sandboxId: sb.sandboxId })).data as { state: string }).state).toBe("running");
  });

  it("shopify: an order one business cancels and a draft it creates are not another's", async () => {
    const shopify = createShopifyMock();
    ok(await call(shopify, A, "cancel_order", { orderId: "5500000031" }));
    ok(await call(shopify, A, "create_draft_order", { email: "maja@sensitiveskinclub.se", lineItems: [{ variantId: "44003" }], tags: [] }));
    const cancelled = async (businessId: string) => (data<{ cancelledAt: string | null }>(ok(await call(shopify, businessId, "get_order", { orderId: "5500000031" })))).cancelledAt;
    expect(await cancelled(A)).not.toBeNull();
    expect(await cancelled(B)).toBeNull();
    expect(shopify.draftsFor(A).size).toBe(1);
    expect(shopify.draftsFor(B).size).toBe(0);
  });

  it("tink and plaid: each business gets its own bank history, the one its bank.sync simulation reports", async () => {
    for (const bank of [createTinkMock(), createPlaidMock()]) {
      const accounts = async (businessId: string) => (ok(await call(bank, businessId, "list_accounts", {})).data as { items: { id: string; booked: { amountMinor: number } }[] }).items;
      const [a, b] = [await accounts(A), await accounts(B)];
      expect(a.map((x) => x.id)).not.toEqual(b.map((x) => x.id));
      for (const [businessId, list] of [[A, a], [B, b]] as const) {
        const [event] = await bank.simulate("bank.sync", { businessId });
        const payload = event!.payload as { accountId: string; balance: { amountMinor: number } };
        expect(list[0]!.id).toBe(payload.accountId);
        expect(list[0]!.booked.amountMinor).toBe(payload.balance.amountMinor);
      }
    }
  });
});
