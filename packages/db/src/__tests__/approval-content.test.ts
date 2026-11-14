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

  it("a code change and its release carry the task's design check; an empty request stays empty (item 13)", () => {
    const designCheck = {
      status: "reviewed" as const,
      reason: null,
      pages: ["/pricing"],
      fixes: [{ rank: 1, page: "/pricing", viewport: "phone" as const, element: "the plan table", problem: "The page scrolls sideways at 390 px.", fix: "Stack the plans in one column.", principle: "responsive" as const, severity: "high" as const }],
      unreadable: [],
      before: [{ id: "before-1-phone", page: "/pricing", viewport: "phone" as const, width: 390, height: 844, cut: false, sha256: "a".repeat(64) }],
      after: [{ id: "after-1-phone", page: "/pricing", viewport: "phone" as const, width: 390, height: 844, cut: false, sha256: "b".repeat(64) }],
      fixesAsked: true,
    };
    const release = approvalWhatExactly(call("merge_pr", { title: "Pricing page", branch: "agent/t1" }, { connectorKey: "github" }), { designCheck });
    expect(release.rows.map((r) => r.label)).toEqual(["Branch", "Change", "Design check", "Design fixes", "Screenshots"]);
    expect(release.rows[2]!.value).toBe("A reviewer looked at screenshots of 1 page at desktop and 390 px and suggested 1 fix; the agent was asked to apply them once.");
    expect(release.rows[3]!.value).toBe("1. /pricing at 390 px, the plan table: The page scrolls sideways at 390 px. Fix: Stack the plans in one column.");
    expect(release.rows[4]!.value).toBe("1 screenshot before, 1 screenshot after the fixes, kept with the task's saved code.");
    const notSeen = approvalWhatExactly(call("merge_pr", { title: "Pricing page" }, { connectorKey: "github" }), { designCheck: { ...designCheck, status: "not_seen", reason: "the sandbox has no browser", fixes: [], before: [], after: [], fixesAsked: false } });
    expect(notSeen.rows.find((r) => r.label === "Design check")!.value).toBe("Design check not done: the pages could not be shown in the sandbox (the sandbox has no browser), so there are no screenshots and nothing was reviewed.");
    expect(notSeen.rows.some((r) => r.label === "Screenshots")).toBe(false);
    expect(approvalWhatExactly(call("open_pr", {}, { connectorKey: "github" }), { designCheck })).toMatchObject({ empty: true, rows: [] });
  });

  it("a release shows the second read of its change after the change's own rows, and says when it was practice mode", () => {
    const merge = call("merge_pr", { owner: "acme", repo: "shop", prNumber: 7, mergeMethod: "squash", commitTitle: "Deploy contract (#7)" }, { connectorKey: "github" });
    const plain = approvalWhatExactly(merge);
    const review = { reviewerName: "Review Agent", verdict: "request_changes", summary: "One secret is logged.", simulated: true, findings: [{ severity: "critical", file: "api.ts", line: 4, title: "Secret may be logged", suggestion: "Log the key's name only" }] };
    const w = approvalWhatExactly(merge, { review });
    expect(w.kind).toBe("release");
    expect(w.headline).toBe(plain.headline);
    expect(w.rows.slice(0, plain.rows.length)).toEqual(plain.rows);
    expect(w.rows.slice(plain.rows.length)).toEqual([
      { label: "Second read", value: "Review Agent read the change and suggests changes first (practice mode: a sample review, not a real check). One secret is logged." },
      { label: "Important", value: "api.ts:4: Secret may be logged. Fix: Log the key's name only" },
    ]);
    expect(approvalWhatExactly(merge, { review: { ...review, verdict: "approve", simulated: false, findings: [] } }).rows.at(-1)).toEqual({ label: "Second read", value: "Review Agent read the change and found nothing that should stop it. One secret is logged." });
  });

  it("a second read that left part of the change unread, or read an older version, never says it found nothing to stop it (M3, M4)", () => {
    const merge = call("merge_pr", { owner: "acme", repo: "shop", prNumber: 7, mergeMethod: "squash", commitTitle: "Deploy contract (#7)", headSha: "abcdef0123456789abcdef0123456789abcdef01" }, { connectorKey: "github" });
    const review = { reviewerName: "Review Agent", verdict: "approve", summary: "Looks right.", simulated: false, findings: [] };
    const partial = approvalWhatExactly(merge, { review: { ...review, truncated: true, filesReviewed: 3, filesTotal: 5 } }).rows;
    expect(partial).toContainEqual({ label: "Reviewed version", value: "abcdef0", mono: true });
    expect(partial).toContainEqual({ label: "Second read", value: "Review Agent read 3 of 5 files of the change and found nothing in what it read. Looks right." });
    expect(partial.some((r) => r.label === "Not read")).toBe(true);
    expect(JSON.stringify(partial)).not.toContain("found nothing that should stop it");
    const stale = approvalWhatExactly(merge, { review: { ...review, truncated: false, stale: true } }).rows;
    expect(stale).toContainEqual({ label: "Changed since", value: "The branch changed since the review, so what goes live is not exactly what was read." });
    expect(JSON.stringify(stale)).not.toContain("found nothing that should stop it");
    expect(approvalWhatExactly(merge, { review: { ...review, truncated: false, stale: false } }).rows).toContainEqual({ label: "Second read", value: "Review Agent read the change and found nothing that should stop it. Looks right." });
  });

  it("a release with both a second read and a design check: the change's rows, then the second read, then the design check", () => {
    const merge = call("merge_pr", { owner: "acme", repo: "shop", prNumber: 7, mergeMethod: "squash", commitTitle: "Pricing page (#7)", headSha: "abcdef0123456789abcdef0123456789abcdef01" }, { connectorKey: "github" });
    const review = { reviewerName: "Review Agent", verdict: "approve", summary: "Looks right.", simulated: false, findings: [], truncated: false, stale: true };
    const designCheck = {
      status: "reviewed" as const,
      reason: null,
      pages: ["/pricing"],
      fixes: [{ rank: 1, page: "/pricing", viewport: "phone" as const, element: "the plan table", problem: "The page scrolls sideways at 390 px.", fix: "Stack the plans in one column.", principle: "responsive" as const, severity: "high" as const }],
      unreadable: [],
      before: [{ id: "before-1-phone", page: "/pricing", viewport: "phone" as const, width: 390, height: 844, cut: false, sha256: "a".repeat(64) }],
      after: [],
      fixesAsked: true,
    };
    const own = approvalWhatExactly(merge).rows;
    const reviewOnly = approvalWhatExactly(merge, { review }).rows;
    const both = approvalWhatExactly(merge, { review, designCheck });
    expect(both.kind).toBe("release");
    // The change's own rows (the reviewed version among them) first, unchanged.
    expect(own).toContainEqual({ label: "Reviewed version", value: "abcdef0", mono: true });
    expect(both.rows.slice(0, own.length)).toEqual(own);
    // Then the whole second read, as it shows alone ("Changed since" included).
    expect(reviewOnly.slice(own.length).map((r) => r.label)).toContain("Changed since");
    expect(both.rows.slice(own.length, reviewOnly.length)).toEqual(reviewOnly.slice(own.length));
    // Then the design check.
    expect(both.rows.slice(reviewOnly.length).map((r) => r.label)).toEqual(["Design check", "Design fixes", "Screenshots"]);
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
