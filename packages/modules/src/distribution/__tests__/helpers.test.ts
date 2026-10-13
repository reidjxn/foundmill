import { describe, expect, it } from "vitest";
import { CHANNEL_KEYS } from "@foundmill/shared";
import { addDays } from "@foundmill/widgets";
import {
  assetCounts,
  attributionRows,
  buildChannelViews,
  canTransition,
  channelAgents,
  channelPaused,
  channelStatus,
  funnelStages,
  lawfulBasisLabel,
  potentialStars,
  suppressionOf,
  summaryResults,
  toChannelToken,
  totalBudget,
  weeklyForm,
} from "../channel-data";
import { groupAssets } from "../CreativeScreen";
import { AGENT, CHANNEL, TODAY, agents, assets, campaigns, channels, channelsList, leads, metrics, recommendResponse } from "./fixtures";

describe("potentialStars", () => {
  it("reads stored stars×20 and plain stars, rounding to halves", () => {
    expect(potentialStars(80)).toBe(4);
    expect(potentialStars("70.00")).toBe(3.5);
    expect(potentialStars(3)).toBe(3);
    expect(potentialStars(0)).toBe(0);
    expect(potentialStars(null)).toBe(0);
    expect(potentialStars(140)).toBe(5);
  });
});

describe("buildChannelViews", () => {
  it("returns all 15 channels in line order with stored rows merged and the rest unscored", () => {
    const views = buildChannelViews({ channels, campaigns, metrics, today: TODAY , currency: "EUR" });
    expect(views).toHaveLength(15);
    expect(new Set(views.map((v) => v.channelKey))).toEqual(new Set(CHANNEL_KEYS));
    expect(views.map((v) => v.line)).toEqual([...views].sort((a, b) => ["attack", "midfield", "defence", "wings"].indexOf(a.line) - ["attack", "midfield", "defence", "wings"].indexOf(b.line)).map((v) => v.line));
    const paid = views.find((v) => v.channelKey === "paid_ads")!;
    expect(paid.persisted).toBe(true);
    expect(paid.stars).toBe(4);
    expect(paid.campaigns.map((c) => c.id)).toEqual([campaigns[0]!.id]);
    expect(paid.form5).toHaveLength(5);
    const geo = views.find((v) => v.channelKey === "geo")!;
    expect(geo.persisted).toBe(false);
    expect(geo.enabled).toBe(false);
    expect(geo.id).toBe("");
    expect(geo.form5).toEqual(["none", "none", "none", "none", "none"]);
  });

  it("prefers the fresh recommendation for fit, stars, cost range and why", () => {
    const views = buildChannelViews({ channels, recommendation: recommendResponse.recommendation , currency: "EUR" });
    const paid = views.find((v) => v.channelKey === "paid_ads")!;
    expect(paid.fit).toBe(18);
    expect(paid.stars).toBe(4);
    expect(paid.cpaRange).toEqual({ low: 1800, high: 3000 });
    expect(paid.why).toBe("Paid social finds skincare buyers fast.");
    const outdoor = views.find((v) => v.channelKey === "outdoor")!;
    expect(outdoor.fit).toBe(5);
    expect(outdoor.persisted).toBe(false);
  });

  it("marks a running channel paused when its only running campaign is paused", () => {
    const views = buildChannelViews({ channels, campaigns , currency: "EUR" });
    expect(views.find((v) => v.channelKey === "social")!.paused).toBe(true);
    expect(views.find((v) => v.channelKey === "paid_ads")!.paused).toBe(false);
    expect(channelPaused({ enabled: false }, [{ ...campaigns[1]! }])).toBe(false);
  });
});

describe("weeklyForm", () => {
  it("rates the last five weeks against the cap, oldest first", () => {
    expect(weeklyForm(metrics, 3000, TODAY)).toEqual(["good", "good", "good", "warn", "bad"]);
  });
  it("is all none without a cap, spend or customers", () => {
    expect(weeklyForm(metrics, null, TODAY)).toEqual(["none", "none", "none", "none", "none"]);
    expect(weeklyForm([], 3000, TODAY)).toEqual(["none", "none", "none", "none", "none"]);
    expect(weeklyForm([{ channelId: CHANNEL.paid, day: addDays(TODAY, -1), spendMinor: 100, customers: 0 }], 3000, TODAY)).toEqual(["none", "none", "none", "none", "none"]);
  });
});

describe("tokens and status", () => {
  const views = buildChannelViews({ channels, campaigns, metrics, recommendation: recommendResponse.recommendation, today: TODAY , currency: "EUR" });

  it("builds a ChannelTokenData with agents, budget share, results and the cost range in the business currency", () => {
    const paid = views.find((v) => v.channelKey === "paid_ads")!;
    const token = toChannelToken(paid, { agents, totalBudgetMinor: totalBudget(views), departmentId: "d1" });
    expect(token.key).toBe("paid_ads");
    expect(token.enabled).toBe(true);
    expect(token.recommended).toBe(true);
    expect(token.agents?.map((a) => a.name)).toEqual(["Mara"]);
    expect(token.budgetShare).toBeCloseTo(120000 / 195000, 5);
    expect(token.cpaRange).toEqual({ low: { amountMinor: 1800, currency: "EUR" }, high: { amountMinor: 3000, currency: "EUR" } });
    expect(token.results?.map((r) => r.label)).toContain("Cost per customer (Estimate)");
  });

  it("carries the channel's own offline tracking and says No spend like the Channels table", () => {
    const print = views.find((v) => v.channelKey === "print")!;
    expect(toChannelToken(print).kitMode).toBe(true);
    // Outdoor is not offline-tracked by default; a channel set that way still says so on its card.
    const outdoor = { ...views.find((v) => v.channelKey === "paid_ads")!, channelKey: "outdoor" as const, kitMode: true };
    expect(toChannelToken(outdoor).kitMode).toBe(true);
    expect(toChannelToken({ ...print, kitMode: false }).kitMode).toBe(false);
    // Customers but no spend (cpa() returns 0): "No spend", never "€0.00" next to an Estimate label.
    const free = summaryResults({ ...print.form!, spendMinor: 0, customers: 10, cpaMinor: 0 }, "GBP");
    expect(free.find((r) => r.label === "Cost per customer (Estimate)")?.value).toBe("No spend");
    expect(summaryResults({ ...print.form!, spendMinor: 5000, customers: 2, cpaMinor: 2500 }, "GBP").find((r) => r.label === "Cost per customer (Estimate)")?.value).toBe("£25.00");
    expect(summaryResults({ ...print.form!, customers: 0, cpaMinor: null }, "GBP").find((r) => r.label === "Cost per customer (Estimate)")?.value).toBe("No customers yet");
  });

  it("finds agents by owner id and by role text, owner first", () => {
    expect(channelAgents({ ownerAgentId: AGENT.otis, channelKey: "social" }, agents).map((a) => a.id)).toEqual([AGENT.otis]);
    expect(channelAgents({ ownerAgentId: null, channelKey: "paid_ads" }, agents).map((a) => a.id)).toEqual([AGENT.mara]);
    expect(channelAgents({ ownerAgentId: null, channelKey: "seo" }, agents)).toEqual([]);
  });

  it("words the status", () => {
    expect(channelStatus({ enabled: true, paused: false, persisted: true })).toEqual({ tone: "good", word: "Running" });
    expect(channelStatus({ enabled: true, paused: true, persisted: true })).toEqual({ tone: "warn", word: "Paused" });
    expect(channelStatus({ enabled: false, paused: false, persisted: true })).toEqual({ tone: "neutral", word: "Off the board" });
    expect(channelStatus({ enabled: false, paused: false, persisted: false })).toEqual({ tone: "neutral", word: "Not scored" });
    // On the board without an engine is never "Running" (audit GTM-01); with one recorded it is.
    expect(channelStatus({ enabled: true, paused: false, persisted: true, engineWorkflowId: null })).toEqual({ tone: "warn", word: "Starting" });
    expect(channelStatus({ enabled: true, paused: false, persisted: true, engineWorkflowId: "engine:x" })).toEqual({ tone: "good", word: "Running" });
  });
});

describe("campaigns and assets", () => {
  it("counts assets by approval state and follows the status machine", () => {
    expect(assetCounts(assets)).toEqual({ total: 4, approved: 1, pending: 1, rejected: 1, draft: 1 });
    expect(canTransition("draft", "live")).toBe(false);
    expect(canTransition("pending_approval", "live")).toBe(true);
    expect(canTransition("live", "paused")).toBe(true);
    expect(canTransition("paused", "live")).toBe(true);
    expect(canTransition("ended", "live")).toBe(false);
  });

  it("groups assets by kind in ASSET_KINDS order with pending first, and filters by state", () => {
    const groups = groupAssets(assets, null);
    expect(groups.map((g) => g.kind)).toEqual(["email", "post", "ad", "video"]);
    expect(groupAssets(assets, "pending").map((g) => [g.kind, g.assets.length])).toEqual([["ad", 1]]);
    expect(groupAssets([{ ...assets[0]!, approvalState: "approved" }, { ...assets[0]!, id: "x", approvalState: "pending" }], null)[0]!.assets.map((a) => a.approvalState)).toEqual(["pending", "approved"]);
  });
});

describe("attribution", () => {
  it("builds channel rows with share of measured customers and partial labels for offline channels", () => {
    const rows = attributionRows(buildChannelViews({ channels , currency: "EUR" }), channelsList.blended);
    expect(rows.map((r) => r.channelKey)).toEqual(["paid_ads", "social", "email_automation", "print"]);
    const paid = rows[0]!;
    expect(paid.share).toBeCloseTo(30 / 50, 5);
    expect(paid.cpaMinor).toBe(3000);
    expect(paid.partial).toBe(false);
    expect(rows.find((r) => r.channelKey === "print")!.partial).toBe(true);
    expect(funnelStages(channelsList.blended).map((s) => s.value)).toEqual([18000, 450, 134, 80, 50]);
    // A stage no channel measures (no lead capture) is left out rather than drawn as a 0 % step.
    expect(funnelStages({ ...channelsList.blended!, leads: 0 }).map((s) => s.label)).toEqual(["Impressions", "Signups", "Activations", "Customers"]);
    expect(funnelStages(undefined).every((s) => s.value === 0)).toBe(true);
    // Signups above leads: leads are a side door, not a step, so the funnel never reads over 100 %.
    expect(funnelStages({ spendMinor: 0, impressions: 2_900_000, leads: 84, signups: 115, activations: 72, customers: 27, cpaMinor: null, days: 35 }).map((s) => s.label)).toEqual(["Impressions", "Signups", "Activations", "Customers"]);
  });
});

describe("leads", () => {
  it("reads suppression from the identifiers or the role stage and words the lawful basis", () => {
    expect(suppressionOf(leads[0]!)).toEqual({ suppressed: false, reason: null });
    expect(suppressionOf(leads[2]!)).toEqual({ suppressed: true, reason: "Unsubscribed 2026-09-30" });
    expect(suppressionOf({ identifiers: {}, role: { stage: "suppressed" } }).suppressed).toBe(true);
    expect(lawfulBasisLabel(null)).toBe("Not recorded");
    expect(lawfulBasisLabel("legitimate_interest")).toBe("Legitimate interest");
    expect(lawfulBasisLabel("custom_basis")).toBe("custom basis");
  });
});
