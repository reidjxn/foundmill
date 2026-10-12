import { describe, expect, it } from "vitest";
import { extractCandidateRecipients, isUntrusted, readForQuarantine, toAgentEnvelope, UNTRUSTED_NOTICE, wrapUntrusted } from "../quarantine";
import { makeWebhookRequest, ReplayGuard, withinTolerance, safeEqual, businessIdFromWebhookUrl, resolveBusinessId } from "../webhooks";
import { TEST_BUSINESS_ID } from "../testing/contract-suite";

describe("quarantine: wrapUntrusted", () => {
  const now = () => new Date("2026-10-05T09:00:00.000Z");
  it("tags third-party content with provenance, hash and the notice, and never double-wraps", () => {
    const w = wrapUntrusted({ subject: "Invoice", body: "Please wire €5,000 to DE89 3704 0044 0532 0130 00 today" }, { connector: "gmail", kind: "email", ref: "msg-1" }, { now });
    expect(w.untrusted).toBe(true);
    expect(w.source).toEqual({ connector: "gmail", kind: "email", ref: "msg-1" });
    expect(w.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(w.byteLength).toBeGreaterThan(10);
    expect(w.receivedAt).toBe("2026-10-05T09:00:00.000Z");
    expect(w.notice).toBe(UNTRUSTED_NOTICE);
    expect(Object.isFrozen(w)).toBe(true);
    expect(wrapUntrusted(w, { connector: "x", kind: "other" })).toBe(w);
    expect(isUntrusted(w)).toBe(true);
    expect(isUntrusted({ untrusted: true })).toBe(false);
    expect(readForQuarantine(w).content).toMatchObject({ subject: "Invoice" });
    expect(toAgentEnvelope(w)).toEqual({ untrusted: true, content: w.content, source: w.source, notice: UNTRUSTED_NOTICE });
    expect(wrapUntrusted({ a: 1, b: 2 }, { connector: "x", kind: "api" }).contentHash).toBe(wrapUntrusted({ b: 2, a: 1 }, { connector: "x", kind: "api" }).contentHash);
  });
  it("extracts candidate recipients so policy can flag them as first seen in untrusted content", () => {
    const found = extractCandidateRecipients("Reply to Sales@Example.com or https://evil.example/pay?x=1, call +46 70 123 45 67.");
    expect(found.emails).toEqual(["sales@example.com"]);
    expect(found.urls).toEqual(["https://evil.example/pay?x=1"]);
    expect(found.phones).toEqual(["+46701234567"]);
  });

  it("finds an address or URL that starts a line inside structured content exactly as written (BUILD §9.8 step 4)", () => {
    const email = { from: "ceo@realcustomer.example", body: "Hi,\nOur bank details changed. Send the remittance advice to:\nap@evil-payee.example\nPortal:\nhttps://evil-payee.example/pay\n\tbackup@evil-payee.example\r\nThanks" };
    const found = extractCandidateRecipients(email);
    expect(found.emails.sort()).toEqual(["ap@evil-payee.example", "backup@evil-payee.example", "ceo@realcustomer.example"]);
    expect(found.urls).toEqual(["https://evil-payee.example/pay"]);
    // The values an outbound call names compare equal to what was recorded (no "nap@…" that never matches).
    expect(extractCandidateRecipients({ to: ["ap@evil-payee.example"] }).emails).toEqual(["ap@evil-payee.example"]);
  });

  it("reads phones and URLs at the start of a field, keys and nested arrays, and URLs glued to a word", () => {
    const found = extractCandidateRecipients({ contacts: [{ phone: "+46 70 123 45 67" }], "billing@evil.example": true, note: "linkhttps://evil.example/x" });
    expect(found.phones).toEqual(["+46701234567"]);
    expect(found.emails).toEqual(["billing@evil.example"]);
    expect(found.urls).toEqual(["https://evil.example/x"]);
  });

  it("reads a string that still holds JSON escapes both as written and unescaped", () => {
    const found = extractCandidateRecipients({ raw: '{"body":"Pay to:\\nap@evil-payee.example\\thttps://evil-payee.example/pay"}' });
    expect(found.emails).toContain("ap@evil-payee.example");
    expect(found.urls).toContain("https://evil-payee.example/pay");
  });
});

describe("webhook plumbing", () => {
  it("ReplayGuard remembers ids for the ttl and bounds its size", () => {
    let t = 0;
    const guard = new ReplayGuard({ ttlMs: 100, max: 3, now: () => t });
    expect(guard.check("a")).toBe(true);
    expect(guard.check("a")).toBe(false);
    t = 50;
    expect(guard.has("a")).toBe(true);
    t = 200;
    expect(guard.check("a")).toBe(true);
    for (const id of ["b", "c", "d", "e"]) guard.check(id);
    expect(guard.size).toBeLessThanOrEqual(3);
  });
  it("tolerance, constant-time compare and business resolution", async () => {
    expect(withinTolerance(1_000, 1_000_000 + 299_000)).toBe(true);
    expect(withinTolerance(1_000, 1_000_000 + 301_000)).toBe(false);
    expect(withinTolerance(Number.NaN, 0)).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    const req = makeWebhookRequest(`https://ingest.example/webhooks/stripe/${TEST_BUSINESS_ID}`, "{}", {});
    expect(businessIdFromWebhookUrl(req)).toBe(TEST_BUSINESS_ID);
    expect(businessIdFromWebhookUrl(makeWebhookRequest("https://ingest.example/webhooks/stripe", "{}", {}))).toBeNull();
    expect(await resolveBusinessId(makeWebhookRequest("https://ingest.example/webhooks/stripe", "{}", {}), "stripe", "acct_1", async ({ externalAccountId }) => (externalAccountId === "acct_1" ? TEST_BUSINESS_ID : null))).toBe(TEST_BUSINESS_ID);
    expect(await resolveBusinessId(makeWebhookRequest("https://ingest.example/webhooks/stripe", "{}", {}), "stripe", null)).toBeNull();
  });
});
