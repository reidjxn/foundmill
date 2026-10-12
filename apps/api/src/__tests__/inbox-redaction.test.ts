/** The Inbox's section-wall masking (services/inbox-redaction.ts; audit RUI-02), as pure functions. */
import { describe, expect, it } from "vitest";
import { maskCrm, maskFinance, redactInboxItem, redactValue, type RedactionSource } from "../services/inbox-redaction";
import type { InboxItem } from "@foundmill/db";

const PERSON = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const UNKNOWN = "44444444-4444-4444-8444-444444444444";

const source = (walls: { finance: boolean; crm: boolean }): RedactionSource => ({
  walls,
  crm: new Map([
    [PERSON, { id: PERSON, kind: "person", displayName: "Wren Garza", aliases: ["Wren"] }],
    [COMPANY, { id: COMPANY, kind: "organisation", displayName: "Acme Ltd", aliases: [] }],
  ]),
  keep: new Set([AGENT]),
});

describe("maskFinance", () => {
  it("hides amounts with a symbol or an ISO code on either side, and runway figures", () => {
    expect(maskFinance("Cash £263,345.71; burn $12k a month; MRR €1.2m")).toBe("Cash (amount hidden); burn (amount hidden) a month; MRR (amount hidden)");
    expect(maskFinance("cash stands at 263345.71 GBP, the deposit is SEK 1,200 and US$40 went on ads")).toBe("cash stands at (amount hidden), the deposit is (amount hidden) and (amount hidden) went on ads");
    expect(maskFinance("14 months of runway (Estimate); Runway 9.5 mo; runway of 3 months")).toBe("(hidden) of runway (Estimate); Runway (hidden); runway of (hidden)");
  });
  it("leaves counts, dates, SKUs and percentages alone", () => {
    const text = "3 SKUs, 2,000 units each, SKU 2000, VAT 20, due Oct 7, 2026, activation 35%, 4 weeks of cover";
    expect(maskFinance(text)).toBe(text);
  });
});

describe("maskCrm", () => {
  it("hides CRM mentions and the records' plain names, keeps agents and capitalises at a sentence start", () => {
    const s = source({ finance: false, crm: true });
    const records = [...s.crm.values()];
    const text = `[[ent:${PERSON}|Wren Garza]] ordered for Acme Ltd. Wren will renew. [[ent:${AGENT}|Pike]] helped; [[ent:${UNKNOWN}|Someone]] too.`;
    expect(maskCrm(text, s, records, true)).toBe(`A customer ordered for an organization. A customer will renew. [[ent:${AGENT}|Pike]] helped; a customer too.`);
    expect(maskCrm("New order from Wren Garza", s, records, false)).toBe("New order from a contact");
    // Whole words only.
    expect(maskCrm("Wrenfield and Acme Ltdx", s, records, false)).toBe("Wrenfield and Acme Ltdx");
  });
});

describe("redactInboxItem / redactValue", () => {
  const item = {
    id: "55555555-5555-4555-8555-555555555555",
    type: "decision",
    subject: "Approve batch 002 for Acme Ltd?",
    bodyMd: "Landed cost is £12.40 per unit (Estimate).",
    statusStrip: [{ metric: "Cash £263,345.71", source: "accounts" }, { metric: "Runway 14 mo (Estimate)", source: "forecasts" }, { metric: "Customers 1101", source: "conversions" }],
    exhibit: { kind: "table", spec_ref: "cash_position" },
    decision: { options: [{ id: "order_now", label: "Place the full order now", recommended: true, consequence: "Deposit of £18,600 leaves this week.", cost_minor: 3_720_000, reversible: false }], free_text: true, expires_at: "2026-10-17T00:00:00.000Z" },
    entityIds: [COMPANY],
  } as unknown as InboxItem;

  it("returns the note as is (redacted: []) when no wall applies", () => {
    expect(redactInboxItem(item, source({ finance: false, crm: false }))).toEqual({ ...item, redacted: [] });
  });

  it("behind a Finance wall drops finance metrics and exhibits, option costs and amounts", () => {
    const r = redactInboxItem(item, source({ finance: true, crm: false }));
    expect(r.subject).toBe("Approve batch 002 for Acme Ltd?");
    expect(r.bodyMd).toBe("Landed cost is (amount hidden) per unit (Estimate).");
    expect(r.statusStrip).toEqual([{ metric: "Customers 1101", source: "conversions" }]);
    expect(r.exhibit).toEqual({ kind: "none", spec_ref: null });
    expect((r.decision as { options: object[]; expires_at: string }).options[0]).toEqual({ id: "order_now", label: "Place the full order now", recommended: true, consequence: "Deposit of (amount hidden) leaves this week.", reversible: false });
    expect((r.decision as { expires_at: string }).expires_at).toBe("2026-10-17T00:00:00.000Z");
    expect(r.redacted).toEqual(["finance"]);
  });

  it("behind a CRM wall names no record, plain or marked up; plan params lose amounts behind a Finance wall", () => {
    const r = redactInboxItem(item, source({ finance: false, crm: true }));
    expect(r.subject).toBe("Approve batch 002 for an organization?");
    expect(r.redacted).toEqual(["crm"]);
    expect(redactValue({ channel: "paid_ads", amount_minor: 50_000, currency: "EUR", title: "Email Wren Garza" }, source({ finance: true, crm: true }), { ids: [PERSON] })).toEqual({ channel: "paid_ads", title: "Email a contact" });
    // Ids are never masked: an option is decided by its id, whatever the record is called.
    expect(redactValue({ options: [{ id: "wren", option_id: "wren", label: "Thank Wren" }] }, source({ finance: false, crm: true }), { ids: [PERSON] })).toEqual({ options: [{ id: "wren", option_id: "wren", label: "Thank a contact" }] });
  });
});
