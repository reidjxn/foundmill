/**
 * What exactly an approval would run (first-time founder report, Nov 8, 2026): the rows a founder reads before deciding,
 * per kind of call, and `empty` when the agent said nothing about what it would run.
 */
import { describe, expect, it } from "vitest";
import { ASK_FOR_DETAILS_NOTE, approvalWhatExactly, argLabel, channelWords } from "../approval-content";

const call = (tool: string, args: Record<string, unknown>, over: { connectorKey?: string | null; amountMinor?: number | null; currency?: string | null } = {}) => ({ connectorKey: over.connectorKey ?? "platform", tool, args, amountMinor: over.amountMinor ?? null, currency: over.currency ?? null });

describe("approvalWhatExactly", () => {
  it("a code change names its files, branch and change; a migration says what it is in the founder's words", () => {
    const w = approvalWhatExactly(call("commit_files", { files: ["src/app.ts", { path: "src/db.ts" }], branch: "agent/task-1", message: "Add the usage index", additions: 12, deletions: 3 }, { connectorKey: "github" }));
    expect(w.kind).toBe("code");
    expect(w.headline).toBe("Add the usage index");
    expect(w.rows).toEqual([
      { label: "Files", value: "src/app.ts, src/db.ts", mono: true },
      { label: "Branch", value: "agent/task-1", mono: true },
      { label: "Change", value: "Add the usage index", mono: false },
      { label: "Lines", value: "12 added, 3 removed", mono: false },
    ]);
    expect(w.empty).toBe(false);
    const m = approvalWhatExactly(call("run_migration", { file: "0019_idx.sql", concurrently: true }, { connectorKey: "github" }));
    expect(m.headline).toBe("A change to how the business's data is stored: 0019_idx.sql");
    expect(m.rows).toEqual([
      { label: "Files", value: "0019_idx.sql", mono: true },
      { label: "Concurrently", value: "true" },
    ]);
  });

  it("a session's one-line summary is the headline when the arguments carry nothing else", () => {
    const w = approvalWhatExactly(call("run_migration", { summary: "0019_usage_events_customer_period_idx.sql: create index concurrently on usage_events" }, { connectorKey: "github" }));
    expect(w.headline).toBe("A change to how the business's data is stored");
    expect(w.rows).toEqual([{ label: "What exactly", value: "0019_usage_events_customer_period_idx.sql: create index concurrently on usage_events", mono: false }]);
    expect(w.empty).toBe(false);
    const s = approvalWhatExactly(call("lookup", { summary: "Look up Acme Ltd in the company register" }, { connectorKey: "opencorporates" }));
    expect(s).toMatchObject({ kind: "other", headline: "Look up Acme Ltd in the company register", rows: [], empty: false });
  });

  it("a campaign launch shows the channel, the campaign, its goal, budget and every draft's copy", () => {
    const w = approvalWhatExactly(call("launch_campaign", { campaignId: "c1", channelKey: "paid_ads", assetIds: ["a1", "a2"] }, { amountMinor: 60_000, currency: "GBP" }), {
      campaign: { name: "Spring launch", goal: "First 20 paying venues", budgetMinor: 60_000, currency: "GBP" },
      assets: [
        { kind: "ad_copy", title: "Headline A", body: "Fill last-minute shifts with verified students." },
        { kind: "landing_page", title: "Landing page", body: null },
      ],
    });
    expect(w.kind).toBe("campaign");
    expect(w.headline).toBe("Launch “Spring launch” on Paid advertising with £600.00");
    expect(w.rows.map((r) => r.label)).toEqual(["Channel", "Campaign", "Goal", "Budget", "Ad copy draft", "Landing page draft"]);
    expect(w.rows[4]!.value).toBe("Headline A — Fill last-minute shifts with verified students.");
    // Ids never reach the founder.
    expect(JSON.stringify(w)).not.toMatch(/c1|a1|assetIds|campaignId/);
  });

  it("a message shows who gets it and what it says; a spend its purpose, amount and period", () => {
    const m = approvalWhatExactly(call("send_email", { to: "maria@venue.example", subject: "Shifts this weekend", body: "Hi Maria, we have three verified students free on Saturday." }, { connectorKey: "sendgrid" }));
    expect(m.headline).toBe("A message to maria@venue.example about “Shifts this weekend”");
    expect(m.rows.map((r) => `${r.label}: ${r.value}`)).toEqual(["To: maria@venue.example", "Subject: Shifts this weekend", "Message: Hi Maria, we have three verified students free on Saturday."]);
    const s = approvalWhatExactly(call("set_budget", { channelKey: "paid_ads", budgetMinor: 60_000, currency: "GBP", period: "week" }));
    expect(s.headline).toBe("£600.00 for Paid advertising");
    expect(s.rows).toEqual([
      { label: "What", value: "Paid advertising", mono: false },
      { label: "Amount", value: "£600.00", mono: false },
      { label: "Period", value: "week", mono: false },
    ]);
  });

  it("nothing said is empty; an unknown tool with arguments lists them in words, long values clipped, ids left out", () => {
    expect(approvalWhatExactly(call("run_migration", {}, { connectorKey: "github" }))).toMatchObject({ kind: "none", headline: null, rows: [], empty: true });
    expect(approvalWhatExactly(call("do_thing", { summary: "   " }))).toMatchObject({ empty: true });
    const o = approvalWhatExactly(call("create_coupon_code", { code: "ANNUAL20", percent_off: 20, customerId: "cus_1", note: "x".repeat(400) }, { connectorKey: "stripe" }));
    expect(o.kind).toBe("other");
    expect(o.rows.map((r) => r.label)).toEqual(["Code", "Percent off", "Note"]);
    expect(o.rows[2]!.value.length).toBeLessThanOrEqual(280);
    expect(o.empty).toBe(false);
  });

  it("labels and channel words", () => {
    expect(argLabel("channel_key")).toBe("Channel key");
    expect(argLabel("campaignId")).toBe("Campaign id");
    expect(channelWords("paid_ads")).toBe("Paid advertising");
    expect(channelWords("linkedin_ads")).toBe("linkedin ads");
    expect(ASK_FOR_DETAILS_NOTE).toMatch(/^Describe exactly what you would run/);
  });
});
