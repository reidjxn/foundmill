import { describe, expect, it } from "vitest";
import { toStartHolidayInput } from "../holiday";

describe("toStartHolidayInput", () => {
  it("maps dialog settings to the API input, dropping sign_contracts and the kill-switch pseudo event", () => {
    const input = toStartHolidayInput({
      until: { kind: "date", date: "2026-11-01" },
      authority: ["spend_above_threshold", "sign_contracts", "publish_content"],
      budgetCeiling: { amountMinor: 50000, currency: "GBP" },
      wakeEvents: ["kill_switch", "credential_failure", "runway_warning", "customer_won", "customer_won"],
    }, "USD");
    // The end of Nov 1 in the founder's own zone (audit OL-06), not midnight UTC, which is the evening of Oct 31 in the US.
    expect(input.until).toEqual({ kind: "date", date: new Date(2026, 10, 1, 23, 59, 59, 999) });
    expect(input.authority).toEqual(["spend_above_threshold", "publish_content"]);
    expect(input.budgetCeilingMinor).toBe(50000);
    expect(input.currency).toBe("GBP");
    expect(input.wakeEvents).toEqual(["credential.expiring", "runway.threshold_crossed", "customer.converted"]);
  });

  it("keeps the picked day in the founder's zone for the caption (audit OL-06)", () => {
    const input = toStartHolidayInput({ until: { kind: "date", date: "2026-10-14" }, authority: [], budgetCeiling: null, wakeEvents: [] }, "USD");
    if (input.until.kind !== "date") throw new Error("expected a date");
    expect([input.until.date.getFullYear(), input.until.date.getMonth(), input.until.date.getDate(), input.until.date.getHours()]).toEqual([2026, 9, 14, 23]);
  });

  it("handles conditions, 'until I return' and no ceiling (then the business's own currency, never EUR)", () => {
    expect(toStartHolidayInput({ until: { kind: "condition", condition: "MRR > 10k" }, authority: [], budgetCeiling: null, wakeEvents: [] }, "GBP")).toMatchObject({ until: { kind: "condition", condition: "MRR > 10k" }, budgetCeilingMinor: null, currency: "GBP", wakeEvents: [] });
    expect(toStartHolidayInput({ until: { kind: "return" }, authority: [], budgetCeiling: null, wakeEvents: ["legal_deadline"] }, "USD").until).toEqual({ kind: "return" });
  });

  it("carries the payment powers chosen in the dialog, and leaves them alone when the dialog says nothing", () => {
    const base = { until: { kind: "return" as const }, authority: [], budgetCeiling: null, wakeEvents: [] };
    expect(toStartHolidayInput({ ...base, inboundPayments: true }, "GBP").paymentPowers).toEqual(["inbound"]);
    expect(toStartHolidayInput({ ...base, inboundPayments: false }, "GBP").paymentPowers).toEqual([]);
    expect(toStartHolidayInput(base, "GBP")).not.toHaveProperty("paymentPowers");
  });
});

