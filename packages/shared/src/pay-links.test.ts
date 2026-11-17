import { describe, expect, it } from "vitest";
import { payLinkKeyFrom, payLinkKeyProblem, payLinkUrlProblem } from "./pay-links";

describe("payLinkUrlProblem", () => {
  it("accepts a Stripe payment link", () => {
    expect(payLinkUrlProblem("https://buy.stripe.com/test_9AQ7tL0ab")).toBeNull();
    expect(payLinkUrlProblem("  https://buy.stripe.com/14k5lG2xY  ")).toBeNull();
  });
  it.each([
    ["", /Paste/],
    ["not a link", /not a link/],
    ["http://buy.stripe.com/abc", /https/],
    ["https://user:pw@buy.stripe.com/abc", /sign-in/],
    ["https://buy.stripe.com@evil.example/abc", /sign-in/],
    ["https://evil.example/abc", /Only Stripe/],
    ["https://buy.stripe.com.evil.example/abc", /Only Stripe/],
    ["https://checkout.stripe.com/abc", /Only Stripe/],
    ["https://buy.stripe.com:8443/abc", /Only Stripe/],
    ["https://buy.stripe.com/abc?next=https://evil.example", /without anything/],
    ["https://buy.stripe.com/", /without anything/],
    [`https://buy.stripe.com/${"a".repeat(500)}`, /too long/],
    ["https://BUY.STRIPE.COM/abc", /as Stripe shows it/],
    ["https://buy.stripe.com\\abc", /as Stripe shows it/],
    ["https://buy.stripe.com/a/../b", /as Stripe shows it/],
    ["https://buy.stripe.com/a\tb", /as Stripe shows it/],
  ])("refuses %s", (url, problem) => {
    expect(payLinkUrlProblem(url)).toMatch(problem);
  });
});

describe("pay link keys", () => {
  it("checks the shape", () => {
    expect(payLinkKeyProblem("starter-kit")).toBeNull();
    expect(payLinkKeyProblem("A")).not.toBeNull();
    expect(payLinkKeyProblem("bad key")).not.toBeNull();
  });
  it("derives a key from a label", () => {
    expect(payLinkKeyFrom("Starter kit")).toBe("starter-kit");
    expect(payLinkKeyFrom("Café crème — 2 cups!")).toBe("cafe-creme-2-cups");
    expect(payLinkKeyFrom("!")).toBe("pay");
    expect(payLinkKeyProblem(payLinkKeyFrom("x".repeat(80)))).toBeNull();
  });
});
