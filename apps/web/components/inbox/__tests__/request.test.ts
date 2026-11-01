/** The one-sentence lead of an agent's request (UX plan B5): the business thing first, composed on the client. */
import { describe, expect, it } from "vitest";
import { connectorWords, describeRequest, keyWords, parseArgs, toolKeyOf, type RequestLike } from "../request";

const base: RequestLike = { agent: { name: "Priya" }, tool: "set_budget", connectorKey: "platform", action: "Ledgerly › set budget", args: null, argsHidden: false, amount: null, amountHidden: false };
const json = (o: Record<string, unknown>) => JSON.stringify(o);

describe("describeRequest", () => {
  it("set budget: the channel, the amount and the period in one sentence", () => {
    expect(describeRequest({ ...base, args: json({ channel: "linkedin_ads", amount_minor: 60_000, currency: "GBP", period: "week" }), amount: { amountMinor: 60_000, currency: "GBP" } })).toBe("Priya wants to set the LinkedIn Ads budget to £600.00 a week");
    expect(describeRequest({ ...base, args: json({ channel: "paid_ads", amount_minor: 50_000, currency: "EUR" }) })).toBe("Priya wants to set the paid ads budget to €500.00");
    // The seed's shape (channelKey, budgetMinor) reads the same way.
    expect(describeRequest({ ...base, args: json({ channelKey: "paid_ads", budgetMinor: 60_000, currency: "GBP" }), amount: { amountMinor: 60_000, currency: "GBP" } })).toBe("Priya wants to set the paid ads budget to £600.00");
    expect(describeRequest({ ...base, args: json({ department: "Distribution" }) })).toBe("Priya wants to set the Distribution budget");
    // An amount the reader's walls hide is left out, never a placeholder.
    expect(describeRequest({ ...base, args: json({ channel: "seo", amount_minor: 10_000, currency: "USD" }), amountHidden: true })).toBe("Priya wants to set the SEO budget");
    expect(describeRequest({ ...base, args: null, argsHidden: true })).toBe("Priya wants to set the budget");
  });

  it("send message, create task and approve spend read as what they do", () => {
    expect(describeRequest({ ...base, tool: "send_message", action: "Ledgerly › send message", args: json({ to: "Dana Whitfield", subject: "Pilot terms" }) })).toBe("Priya wants to send a message to Dana Whitfield about “Pilot terms”");
    expect(describeRequest({ ...base, tool: "send_email", connectorKey: "sendgrid", action: "SendGrid › send email", args: json({ to: "dana@example.com" }) })).toBe("Priya wants to send an email to dana@example.com");
    expect(describeRequest({ ...base, tool: "create_task", action: "Ledgerly › create task", args: json({ title: "Draft the onboarding email" }) })).toBe("Priya wants to create the task “Draft the onboarding email”");
    expect(describeRequest({ ...base, tool: "create_task", action: "Ledgerly › create task", args: "a summary line, not JSON" })).toBe("Priya wants to create a task");
    expect(describeRequest({ ...base, tool: "approve_spend", action: "Ledgerly › approve spend", args: json({ purpose: "samples and costing", amount_minor: 100_000, currency: "USD" }), amount: { amountMinor: 100_000, currency: "USD" } })).toBe("Priya wants to spend $1,000.00 on samples and costing");
    expect(describeRequest({ ...base, tool: "approve_spend", action: "Ledgerly › approve spend", args: json({ what: "a trade show stand" }), amountHidden: true })).toBe("Priya wants to approve a spend on a trade show stand");
  });

  it("falls back to '<Agent> wants to <tool label>', naming the service when there is one, and 'The team' without an agent", () => {
    expect(describeRequest({ ...base, tool: "run_migration", connectorKey: "github", action: "GitHub › run migration" })).toBe("Priya wants to run migration on GitHub");
    expect(describeRequest({ ...base, agent: null, tool: "create_payout", connectorKey: "stripe", action: "Stripe › create payout", amount: { amountMinor: 20_000, currency: "GBP" } })).toBe("The team wants to create payout on Stripe (£200.00)");
    expect(describeRequest({ ...base, tool: "merge_pr", connectorKey: "github", action: "GitHub › merge pr", args: json({ prNumber: 148 }) })).toBe("Priya wants to put a finished change live");
    expect(describeRequest({ ...base, tool: "merge_pull_request", connectorKey: "github", action: "GitHub › merge pull request", args: json({ number: 148 }) })).toBe("Priya wants to put a finished change live");
    expect(describeRequest({ ...base, tool: "enable_channel", action: "Ledgerly › enable channel", args: json({ channel: "tiktok" }) })).toBe("Priya wants to turn on TikTok");
    // An older approval without a tool key reads it from the action; no tool at all reads the action as the api named it.
    expect(toolKeyOf({ tool: null, action: "GitHub › run migration" })).toBe("run_migration");
    expect(describeRequest({ ...base, tool: null, action: "GitHub › run migration", connectorKey: "github" })).toBe("Priya wants to run migration on GitHub");
    expect(describeRequest({ ...base, tool: null, action: "Something odd" })).toBe("Priya wants to run Something odd");
  });

  it("reads the arguments only when they are JSON, and names channels and services plainly", () => {
    expect(parseArgs('{"channel":"seo"}')).toEqual({ channel: "seo" });
    expect(parseArgs("Purchase order for batch 007")).toEqual({});
    expect(parseArgs("{not json")).toEqual({});
    expect(parseArgs(null)).toEqual({});
    expect(keyWords("linkedin_ads")).toBe("LinkedIn Ads");
    expect(keyWords("google_ads")).toBe("Google Ads");
    expect(keyWords("paid_ads")).toBe("paid ads");
    expect(keyWords("email")).toBe("email");
    expect(connectorWords("platform")).toBeNull();
    expect(connectorWords("google_calendar")).toBe("Google Calendar");
    expect(connectorWords("some_new_service")).toBe("Some New Service");
  });

  it("never writes an exclamation mark or a system word into the sentence", () => {
    const sentences = [
      describeRequest({ ...base, args: json({ channel: "linkedin_ads", amount_minor: 60_000, currency: "GBP", period: "week" }) }),
      describeRequest({ ...base, tool: "run_migration", connectorKey: "github", action: "GitHub › run migration" }),
    ];
    for (const s of sentences) expect(s).not.toMatch(/!|request_human_action|\bargs\b|\{/);
  });
});
