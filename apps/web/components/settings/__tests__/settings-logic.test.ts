import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { consequenceText } from "@foundmill/dugout";
import { BUSINESS_MODES } from "@foundmill/shared/constants";
import { SETTINGS_TABS } from "@/lib/search";
import { BUSINESS_MODE_CARDS } from "@/components/new/commit/naming";
import { AUTOPILOT_CONTINUE_NOTE, AUTOPILOT_HELP } from "../AutopilotSection";
import { checkoutNotice, costPerOutcomeLine, includedCreditsFact, periodLabel, teamBudgetLine, tierAddsLine, tierFacts, tierPriceLabel } from "../BillingTab";
import { timeZoneOptions } from "../BusinessTab";
import { glossaryRows, rowsToGlossary } from "../GlossaryTab";
import { connectorDetail, formatSimulateResult, MANAGED_ON_KEYS_TAB, simulateInput, simulateRefusalMessage, SIMULATIONS } from "../IntegrationsTab";
import { REVOKE_CONSEQUENCE } from "../KeysTab";
import { KEY_STATUS_WORDS, keyStatus } from "../key-status";
import { GAME_MODE_CONSEQUENCE, GAME_MODE_REVIEW } from "../PersonalOrLiveSection";
import { businessModeExample, VACATION_CONSEQUENCE } from "../TeamCanDoTab";
import { AGENT_LIMIT_MINOR, amountField, answerHandler, answerState, hasOwnAnswer, parseSpendLineDraft, spendLineDraftOf, spendLineSavedTitle } from "../team-can-do-logic";

describe("settings logic", () => {
  it("every plan reads 'Free while in early access' while sign-up is invite-only, and its price from the day it opens (WP-14 T14)", () => {
    for (const tier of ["free", "pro", "scale"] as const) expect(tierPriceLabel(tier)).toBe("Free while in early access");
    expect(tierPriceLabel("free", "open")).toBe("$5 / month");
    expect(tierPriceLabel("pro", "open")).toMatch(/^\$(15|25) \/ month$/);
  });

  it("states each plan's projects, agents, people, credits and models; a plan limits projects, never people", () => {
    expect(tierFacts("free")).toEqual(["1 project", "4 agents at once", "As many people as you like", "$5.00 of credits a month", "Opus and Sonnet on your own Anthropic key"]);
    expect(tierFacts("pro")).toEqual(["Up to 5 projects", "4 agents at once", "As many people as you like", "$10.00 of credits a month", "Opus and Sonnet included"]);
    expect(tierFacts("scale")).toEqual(["Any number of projects", "64 agents at once", "As many people as you like", "$50.00 of credits a month", "Opus and Sonnet included"]);
    // From the day sign-up opens a credit pack of $20 or more is Try's other way to Opus and Sonnet; the own key stays.
    expect(tierFacts("free", "open")[4]).toBe("Opus and Sonnet with a credit pack of $20 or more, or your own Anthropic key");
    expect(includedCreditsFact("pro")).toBe("$10.00 of credits a month");
    for (const tier of ["free", "pro", "scale"] as const) expect(tierFacts(tier).join(" ")).not.toMatch(/seat|to be announced|TBD/i);
  });

  it("Billing's first line is the team budget in outcomes where there is a pace to read, and the label alone where there is none (WP-14 T3)", () => {
    expect(teamBudgetLine({ outcomes: 4, costPerOutcomeMinor: 30, enoughFor: 12 })).toBe("This month's team budget: enough for about 12 more outcomes at your current pace");
    expect(teamBudgetLine({ outcomes: 1, costPerOutcomeMinor: 300, enoughFor: 1 })).toBe("This month's team budget: enough for about 1 more outcome at your current pace");
    expect(teamBudgetLine({ outcomes: 3, costPerOutcomeMinor: 160, enoughFor: 0 })).toBe("This month's team budget: less than one more outcome at your current pace");
    // No outcomes yet: no N is invented.
    expect(teamBudgetLine(null)).toBe("This month's team budget");
    expect(/[0-9]/.test(teamBudgetLine(null))).toBe(false);
    expect(costPerOutcomeLine({ outcomes: 4, costPerOutcomeMinor: 30, enoughFor: 12 }, (m) => "$" + (m / 100).toFixed(2)).startsWith("About $0.30 an outcome so far this month (4 outcomes).")).toBe(true);
  });

  it("lists what each plan adds from the one table in config", () => {
    expect(tierAddsLine("free")).toBeNull();
    expect(tierAddsLine("pro")).toBe("Everything in Try, and: Vacation mode, Card sharing, Named agents, The phone Inbox");
    expect(tierAddsLine("scale")).toBe("Everything in Founder, and: More agents at once");
  });

  it("says where a credit checkout stands, in dollars, and labels a simulated one", () => {
    const live = { status: "open" as const, mode: "live" as const, amountMinor: 5000, currency: "USD", failure: null };
    expect(checkoutNotice(live)).toEqual({ tone: "info", word: "Confirming", text: "Confirming your payment of $50.00 with Stripe…" });
    expect(checkoutNotice(live, { waitedLong: true })).toMatchObject({ tone: "warn", text: expect.stringMatching(/^Stripe has not confirmed the payment of \$50\.00 yet/) });
    expect(checkoutNotice(live, { canceled: true })).toMatchObject({ word: "Canceled", text: expect.stringMatching(/nothing was charged/) });
    expect(checkoutNotice({ ...live, status: "paid" })).toMatchObject({ tone: "good", text: "$50.00 in credits added. Stripe sends the receipt to your email." });
    expect(checkoutNotice({ ...live, mode: "mock" })).toMatchObject({ word: "Mock checkout", text: expect.stringMatching(/no money moves/) });
    expect(checkoutNotice({ ...live, mode: "mock", status: "paid" }).text).toBe("$50.00 in credits added. Mock top-up: no money moved.");
    expect(checkoutNotice({ ...live, status: "failed", failure: "Payments are not set up on this server yet." })).toMatchObject({ tone: "bad", word: "Not paid", text: "Payments are not set up on this server yet." });
    expect(checkoutNotice({ ...live, status: "expired" }).text).toMatch(/expired before it was paid/);
  });

  it("says what a credit pack carries and what the entry plan's checkout did (WP-09 T16)", () => {
    const live = { status: "open" as const, mode: "live" as const, amountMinor: 2000, currency: "USD", failure: null };
    expect(checkoutNotice({ ...live, status: "paid", creditsMinor: 2200 }).text).toBe("$22.00 in credits added for $20.00. Stripe sends the receipt to your email.");
    const plan = { ...live, amountMinor: 500, kind: "subscription" as const };
    expect(checkoutNotice(plan)).toMatchObject({ word: "Confirming", text: "Confirming your subscription with Stripe…" });
    expect(checkoutNotice({ ...plan, status: "paid" })).toMatchObject({ tone: "good", word: "Subscribed", text: expect.stringMatching(/plan is on and your team can start/) });
    expect(checkoutNotice({ ...plan, mode: "mock" }).text).toMatch(/\$5\.00 a month\. This server simulates payments: no money moves\./);
    expect(checkoutNotice({ ...plan, status: "open" }, { canceled: true }).text).toMatch(/Subscribe whenever you like/);
  });

  it("dates billing periods and connector checks in the person's own format (Settings › Preferences)", () => {
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(periodLabel("2026-10", { date: "day_first", time: "24h" })).toBe("October 2026");
    expect(periodLabel("2026-10", { date: "iso", time: "24h" })).toBe("2026-10");
    expect(periodLabel("this month")).toBe("this month");
    const integ = { accountLabel: "acct_1", scopes: ["read"], lastHealthAt: "2026-10-07T15:45:00Z" };
    expect(connectorDetail({ tools: [1, 2] }, integ)).toBe("acct_1 · 2 agent actions · 1 permission · checked Oct 7, 3:45 PM UTC");
    expect(connectorDetail({ tools: [1, 2] }, integ, { date: "iso", time: "24h" })).toBe("acct_1 · 2 agent actions · 1 permission · checked 10-07 15:45 UTC");
    expect(connectorDetail({ tools: [1, 2] }, integ, { date: "day_first", time: "24h" })).toBe("acct_1 · 2 agent actions · 1 permission · checked 7 Oct, 15:45 UTC");
  });

  it("the Anthropic key is managed on the Keys tab, never connected or disconnected as a generic connector", () => {
    expect(MANAGED_ON_KEYS_TAB.has("anthropic")).toBe(true);
    expect(MANAGED_ON_KEYS_TAB.has("stripe")).toBe(false);
  });

  it("round-trips the glossary and drops blank rows", () => {
    const rows = glossaryRows({ customer: "client", lead: "patient" });
    expect(rows.map((r) => r.term)).toEqual(["customer", "lead"]);
    expect(rowsToGlossary([...rows, { id: 9, term: "  Order ", replacement: " booking " }, { id: 10, term: "x", replacement: "" }])).toEqual({ customer: "client", lead: "patient", order: "booking" });
  });

  it("builds the dev.simulate input (no credential of its own) and renders the API's answer verbatim", () => {
    expect(simulateInput("b1", "payment.received", "stripe")).toEqual({ businessId: "b1", eventName: "payment.received", connector: "stripe" });
    expect(simulateInput("b1", "payment.received", "")).toEqual({ businessId: "b1", eventName: "payment.received" });
    expect(formatSimulateResult("payment.received", { ok: true, status: 200, body: { written: 1 } })).toBe('payment.received → 200\n{\n  "written": 1\n}');
    expect(formatSimulateResult("x", { ok: false, status: 404, body: "Not found" })).toBe("x → 404\nNot found");
    expect(simulateRefusalMessage({ ok: false, status: 400, body: { error: "unknown_simulation" } })).toBe('400: {"error":"unknown_simulation"}');
    expect(SIMULATIONS.map((s) => s.name)).toContain("payment.received");
  });

  it("the game-mode review lists what changes both ways", () => {
    expect(GAME_MODE_REVIEW.live.length).toBeGreaterThan(2);
    expect(GAME_MODE_REVIEW.personal.join(" ")).toMatch(/15 minutes/);
  });

  it("the Settings list calls the glossary tab Your words and keeps its slug (§7.17)", () => {
    expect(SETTINGS_TABS.find((t) => t.slug === "glossary")?.label).toBe("Your words");
    expect(SETTINGS_TABS.map((t): string => t.label)).not.toContain("Glossary");
  });

  it("the Settings list calls the mode tab What the team can do and keeps its slug (founder, 2026-11-07)", () => {
    expect(SETTINGS_TABS.find((t) => t.slug === "mode")?.label).toBe("What the team can do");
    expect(SETTINGS_TABS.map((t): string => t.label)).not.toContain("Mode");
  });

  it("the Keys entry's chip reads the business row: connected on its own key, revoked while stopped for a revoked key, else none", () => {
    expect(keyStatus({ modelBilling: "byok", agentsStoppedAt: null, agentsStoppedReason: null })).toBe("connected");
    expect(keyStatus({ modelBilling: "credits", agentsStoppedAt: null, agentsStoppedReason: null })).toBe("none");
    expect(keyStatus({ modelBilling: "credits", agentsStoppedAt: "2026-10-20T15:45:00Z", agentsStoppedReason: "key_revoked" })).toBe("revoked");
    // Stopped for another reason (Stop all agents, used-up credits): the key itself is still on file.
    expect(keyStatus({ modelBilling: "byok", agentsStoppedAt: "2026-10-20T15:45:00Z", agentsStoppedReason: "kill_switch" })).toBe("connected");
    expect(keyStatus({})).toBe("none");
    expect(KEY_STATUS_WORDS).toEqual({ connected: { word: "Connected", tone: "good" }, none: { word: "None", tone: "neutral" }, revoked: { word: "Revoked", tone: "bad" } });
  });

  it("each business mode card carries the example line Commit shows, and Autopilot's help says what it never does (§7.17)", () => {
    for (const mode of BUSINESS_MODES) {
      const example = businessModeExample(mode);
      expect(example, mode).toBe(BUSINESS_MODE_CARDS.find((c) => c.value === mode)?.example);
      expect(example, mode).toMatch(/^Example: /);
      expect(example, mode).not.toMatch(/counterpart/i);
    }
    expect(AUTOPILOT_HELP).toBe("Autopilot presses Continue for you on a schedule. It never answers notes for you.");
    // Continue runs until done and shares the daily limits (Nov 7, 2026).
    expect(AUTOPILOT_CONTINUE_NOTE).toBe("Continue keeps the team working, one round of work after another, until nothing is left to do. The daily limits below apply to those rounds too.");
  });

  it("What the team can do: the spend line's draft and parsing follow the currency's own minor unit", () => {
    expect(AGENT_LIMIT_MINOR).toBe(LIMITS.approvalThresholdMinorDefault);
    expect(spendLineDraftOf(null, "GBP", 25_000)).toEqual({ kind: "agent", amount: "250" });
    expect(spendLineDraftOf(0, "GBP", 25_000)).toEqual({ kind: "always", amount: "250" });
    expect(spendLineDraftOf(5_050, "GBP", 25_000)).toEqual({ kind: "amount", amount: "50.50" });
    expect(amountField(5_000, "JPY")).toBe("5000");
    expect(parseSpendLineDraft({ kind: "amount", amount: "5,000" }, "JPY")).toEqual({ ok: true, minor: 5_000 });
    expect(parseSpendLineDraft({ kind: "amount", amount: "50" }, "GBP")).toEqual({ ok: true, minor: 5_000 });
    expect(parseSpendLineDraft({ kind: "amount", amount: "" }, "GBP")).toEqual({ ok: false, error: "Enter an amount, like 250." });
    expect(parseSpendLineDraft({ kind: "amount", amount: "lots" }, "GBP")).toEqual({ ok: false, error: "Use a number, like 250." });
    expect(parseSpendLineDraft({ kind: "amount", amount: "0" }, "GBP")).toEqual({ ok: false, error: "Use an amount above 0, or choose Always ask." });
    expect(parseSpendLineDraft({ kind: "always", amount: "lots" }, "GBP")).toEqual({ ok: true, minor: 0 });
    expect(parseSpendLineDraft({ kind: "agent", amount: "" }, "GBP")).toEqual({ ok: true, minor: null });
    expect([spendLineSavedTitle(null), spendLineSavedTitle(0), spendLineSavedTitle(5_000)]).toEqual(["Each agent's own limit applies", "Every purchase asks you now", "Amount saved"]);
  });

  it("What the team can do: who answers reads the matrix, and an agent's own setting is one the policies would apply", () => {
    const rows = [
      { decisionType: "publish_content" as const, handler: { kind: "agent" as const, id: "chief" }, uniform: true },
      { decisionType: "message_customers" as const, handler: { kind: "user" as const, id: "u1" }, uniform: true },
      { decisionType: "hire_agents" as const, handler: { kind: "founder" as const, id: null }, uniform: false },
    ];
    expect(answerState(rows, "publish_content", "chief")).toEqual({ kind: "choice", value: "chief" });
    expect(answerState(rows, "publish_content", "another")).toEqual({ kind: "elsewhere", reason: "someone_else" });
    expect(answerState(rows, "message_customers", "chief")).toEqual({ kind: "elsewhere", reason: "someone_else" });
    expect(answerState(rows, "hire_agents", "chief")).toEqual({ kind: "elsewhere", reason: "differs" });
    expect(answerState(undefined, "publish_content", null)).toEqual({ kind: "choice", value: "founder" });
    expect(answerHandler("chief", "c1")).toEqual({ kind: "agent", id: "c1" });
    expect(answerHandler("founder", "c1")).toEqual({ kind: "founder", id: null });
    expect(hasOwnAnswer({ mode: "inherit", approvalThresholdMinor: LIMITS.approvalThresholdMinorDefault }, "assisted")).toBe(false);
    expect(hasOwnAnswer({ mode: "higher" }, "assisted")).toBe(true);
    // One step higher than Automated is Automated: no setting of its own.
    expect(hasOwnAnswer({ mode: "higher" }, "automated")).toBe(false);
    expect(hasOwnAnswer({ mode: "lower" }, "augmented")).toBe(false);
    expect(hasOwnAnswer({ mode: "inherit", approvalThresholdMinor: 0 }, "assisted")).toBe(true);
    expect(hasOwnAnswer(null, "assisted")).toBe(false);
  });

  it("going live, going on vacation and revoking the key each carry a consequence line that can be undone", () => {
    expect(consequenceText(GAME_MODE_CONSEQUENCE.live)).toMatch(/visible on the network.* · Reversible$/);
    expect(consequenceText(GAME_MODE_CONSEQUENCE.personal)).toMatch(/nothing is deleted\. · Reversible$/);
    expect(consequenceText(VACATION_CONSEQUENCE)).toMatch(/what always comes to you still waits.* · Reversible$/);
    expect(consequenceText(REVOKE_CONSEQUENCE)).toBe("Every agent stops until a new key is stored. · No cost · Reversible");
  });

  it("offers UTC first and every known zone for the business time zone, keeping a saved zone the browser does not list (audit #196)", () => {
    const options = timeZoneOptions(null);
    expect(options[0]).toEqual({ value: "UTC", label: "UTC" });
    expect(options).toContainEqual({ value: "America/New_York", label: "America/New York" });
    // An alias such as US/Eastern is valid but not in the browser's canonical list: it stays on top so the field shows it.
    expect(timeZoneOptions("US/Eastern")[0]).toEqual({ value: "US/Eastern", label: "US/Eastern" });
    expect(timeZoneOptions("America/New_York")).toHaveLength(options.length);
  });
});
