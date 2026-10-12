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
    expect(input.until).toEqual({ kind: "date", date: new Date("2026-11-01") });
    expect(input.authority).toEqual(["spend_above_threshold", "publish_content"]);
    expect(input.budgetCeilingMinor).toBe(50000);
    expect(input.currency).toBe("GBP");
    expect(input.wakeEvents).toEqual(["credential.expiring", "runway.threshold_crossed", "customer.converted"]);
  });

  it("handles conditions, 'until I return' and no ceiling (then the business's own currency, never EUR)", () => {
    expect(toStartHolidayInput({ until: { kind: "condition", condition: "MRR > 10k" }, authority: [], budgetCeiling: null, wakeEvents: [] }, "GBP")).toMatchObject({ until: { kind: "condition", condition: "MRR > 10k" }, budgetCeilingMinor: null, currency: "GBP", wakeEvents: [] });
    expect(toStartHolidayInput({ until: { kind: "return" }, authority: [], budgetCeiling: null, wakeEvents: ["legal_deadline"] }, "USD").until).toEqual({ kind: "return" });
  });
});
