/**
 * Payment powers (founder, Nov 16, 2026): a tool that creates an immutable or customer-visible record that brings money
 * in (a finalized invoice, a payment page) asks first in augmented and assisted mode. In automated mode, and so while
 * the founder is on vacation, it asks unless the founder gave agents the inbound power. There is no outbound power:
 * paying out, refunding and transferring stay hard gates in every mode.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_MODES, type BusinessMode } from "@foundmill/shared";
import { evaluate, type AgentCtxInput, type ToolCtxInput } from "../index";

const agent: AgentCtxInput = { id: "agent-1", department: "d", type: "finance_lead", modelKey: "sonnet", approvalThresholdMinor: 25_000, spendCapMinor: 100_000 };
const createInvoice: ToolCtxInput = { connector: "stripe", name: "create_invoice", irreversible: true, paymentRecord: true };
const payout: ToolCtxInput = { connector: "stripe", name: "create_payout", spendsMoney: true, hardGate: true, irreversible: true };
const run = (mode: BusinessMode, t: ToolCtxInput, opts: { holiday?: boolean; powers?: ("inbound")[] } = {}) =>
  evaluate({ principal: agent, tool: t, business: { id: "biz-1", businessMode: mode, holidayActive: opts.holiday ?? false, paymentPowers: opts.powers ?? [] } }).outcome;

describe("payment powers", () => {
  for (const mode of ["augmented", "assisted"] as const) {
    it(`${mode}: creating an invoice asks, with the inbound power on or off`, () => {
      expect(run(mode, createInvoice)).toBe("ask");
      expect(run(mode, createInvoice, { powers: ["inbound"] })).toBe("ask");
    });
  }

  it("automated: asks without the inbound power, runs with it", () => {
    expect(run("automated", createInvoice)).toBe("ask");
    expect(run("automated", createInvoice, { powers: ["inbound"] })).toBe("allow");
  });

  it("on vacation (automated whatever the mode): asks without the power, runs with it", () => {
    for (const mode of BUSINESS_MODES) {
      expect(run(mode, createInvoice, { holiday: true }), mode).toBe("ask");
      expect(run(mode, createInvoice, { holiday: true, powers: ["inbound"] }), mode).toBe("allow");
    }
  });

  it("no power ever lets money out: a payout stays a hard gate in every mode", () => {
    for (const mode of BUSINESS_MODES) for (const holiday of [false, true]) expect(run(mode, payout, { holiday, powers: ["inbound"] }), mode).toBe("deny");
  });

  it("a tool that is not a payment record is unchanged by the power", () => {
    const note: ToolCtxInput = { connector: "notion", name: "write_page" };
    expect(run("automated", note)).toBe(run("automated", note, { powers: ["inbound"] }));
  });
});
