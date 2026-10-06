import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { HS_REQUESTS, MOCK_DROPBOX_SIGN_API_KEY } from "./fixtures/requests";
import { createDropboxSignConnector } from "./index";
import { dropboxSignMock, signedCallbackRequest } from "./mock";

const DONE = HS_REQUESTS[0]!.signature_request_id;
const PENDING = HS_REQUESTS[1]!.signature_request_id;

const webhookCases = [
  {
    name: "signature_request_all_signed",
    valid: () => signedCallbackRequest(TEST_BUSINESS_ID, { eventType: "signature_request_all_signed", signature_request: HS_REQUESTS[0] }),
    tampered: () => signedCallbackRequest(TEST_BUSINESS_ID, { eventType: "signature_request_all_signed", signature_request: HS_REQUESTS[0] }, "wrong-api-key"),
    replay: true,
    expectEvents: 1,
    expectTypes: ["contract.signed" as const],
  },
  { name: "signature_request_sent (no platform event)", valid: () => signedCallbackRequest(TEST_BUSINESS_ID, { eventType: "signature_request_sent", signature_request: HS_REQUESTS[1], eventTime: 1759500001 }), expectEvents: 0 },
];

describeConnectorContract("dropbox_sign (mock)", {
  connector: dropboxSignMock,
  mode: "mock",
  calls: [
    { tool: "list_signature_requests", args: {}, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(2) },
    { tool: "get_signature_request", args: { signatureRequestId: DONE }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ isComplete: true, signatures: [{ status: "signed" }, { status: "signed" }] }) },
    { tool: "send_signature_request", args: { title: "NDA — Nordlicht AB", signers: [{ email: "sara@nordlicht.se", name: "Sara Lindqvist" }], fileUrls: ["https://files.example/nda.pdf"] }, check: (r) => expect(r.data).toMatchObject({ testMode: true, isComplete: false, signatures: [{ signerEmail: "sara@nordlicht.se", status: "awaiting_signature" }] }) },
    { tool: "cancel_signature_request", args: { signatureRequestId: DONE }, expectOk: false, check: (r) => expect(r.error?.status).toBe(409) },
  ],
  webhooks: webhookCases,
});

describe("dropbox_sign hard gate and simulation", () => {
  it("never signs: sign_as_founder returns a human-action descriptor with the signing location", async () => {
    const r = await dropboxSignMock.callTool("sign_as_founder", { signatureRequestId: PENDING, reason: "Influencer agreement ready" }, makeToolContext(dropboxSignMock));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("hard_gate");
    expect(r.data).toMatchObject({ tool: "sign_as_founder", url: expect.stringContaining("hellosign.com"), instructions: expect.stringContaining("Agents cannot sign") });
  });
  it("normalises an all-signed callback into contract.signed with value and counterparty", async () => {
    const events = await dropboxSignMock.simulate("contract.signed", { businessId: TEST_BUSINESS_ID, seed: "x" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("contract.signed");
    expect(events[0]!.payload).toMatchObject({ provider: "dropbox_sign", kind: "supplier_agreement", value: { amountMinor: 6_800_000, currency: "EUR" }, title: "Supplier agreement — Hallbergs Hud AB" });
    expect(events[0]!.entityIds).toHaveLength(1);
  });
});

describe("dropbox_sign live (canned + webhook crypto)", () => {
  it("sends form-encoded signature requests with Basic auth and verifies callbacks with the per-business key", async () => {
    const connector = createDropboxSignConnector({
      secrets: { dropboxSignApiKey: "platform-key" },
      getBusinessSecret: async (_b, name) => (name === "dropbox_sign_api_key" ? MOCK_DROPBOX_SIGN_API_KEY : null),
      fetch: routedFetch({
        "POST https://api.hellosign.com/v3/signature_request/send": async (req) => {
          expect(req.headers.get("authorization")).toBe(`Basic ${Buffer.from("platform-key:").toString("base64")}`);
          const body = await req.text();
          expect(body).toContain("signers%5B0%5D%5Bemail_address%5D=sara%40nordlicht.se");
          expect(body).toContain("test_mode=1");
          return jsonResponse({ signature_request: HS_REQUESTS[1] });
        },
      }),
    });
    const r = await connector.callTool("send_signature_request", { title: "NDA", signers: [{ email: "sara@nordlicht.se", name: "Sara" }], fileUrls: ["https://files.example/nda.pdf"] }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    const webhook = connector.webhooks![0]!;
    expect(await webhook.verify(signedCallbackRequest(TEST_BUSINESS_ID, { eventType: "signature_request_all_signed", signature_request: HS_REQUESTS[0] }))).toBe(true);
    expect(await webhook.verify(signedCallbackRequest(TEST_BUSINESS_ID, { eventType: "signature_request_all_signed", signature_request: HS_REQUESTS[0], eventTime: 5 }, "platform-key"))).toBe(false);
  });
  it("throws ConfigError without any key", async () => {
    const c = createDropboxSignConnector({ secrets: {} });
    await expect(c.callTool("list_signature_requests", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});
