/**
 * What the founder reads when Anthropic refuses to bill a call (audit BILL-06, CML-07): who has to act, never the
 * provider's text, and never "the model was busy" for the tier's spend cap (a 429 too).
 */
import { APP_NAME } from "@foundmill/config";
import { ModelBillingError, ModelRateLimitError } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { describeFoundationsFailure } from "../foundations";
import { modelBillingFacts, modelBillingMessage } from "../model-billing";

describe("model billing copy", () => {
  it("reads the facts from the error, also after serialization", () => {
    expect(modelBillingFacts(new ModelBillingError("x", "spend_limit", "byok", 429))).toEqual({ reason: "spend_limit", billedTo: "byok" });
    expect(modelBillingFacts({ name: "ModelBillingError", reason: "credit_balance", billedTo: "credits" })).toEqual({ reason: "credit_balance", billedTo: "credits" });
    expect(modelBillingFacts(new ModelRateLimitError("slow down", "s"))).toBeNull();
    expect(modelBillingFacts(null)).toBeNull();
  });

  it("the platform's account: the team is alerted and nothing is charged; the business's own: the founder adds credit", () => {
    expect(modelBillingMessage({ reason: "credit_balance", billedTo: "credits" }, "This reply")).toBe(`This reply could not run: the model account that runs ${APP_NAME} is out of credit. Our team has been alerted, and nothing was charged to your credits. Try again later.`);
    expect(modelBillingMessage({ reason: "credit_balance", billedTo: "byok" })).toBe("This could not run: your Anthropic account is out of credit. Add credit in the Anthropic Console, then try again; your key stays as it is.");
    expect(modelBillingMessage({ reason: "spend_limit", billedTo: "byok" })).toMatch(/has reached its spend limit\. Raise the limit in the Anthropic Console/);
  });

  it("a drafting attempt stopped by the spend cap does not say the model was busy", () => {
    const capped = describeFoundationsFailure(new ModelBillingError("refused", "spend_limit", "credits", 429, "rate_limit_error"));
    expect(capped).toMatch(/^The drafting could not run: the model account that runs .+ has reached its spend limit/);
    expect(capped).not.toMatch(/busy/);
    expect(describeFoundationsFailure(new ModelRateLimitError("slow down", "s"))).toBe("The model was busy. Try again in a minute.");
  });
});
