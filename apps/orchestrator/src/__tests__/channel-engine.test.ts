/**
 * Channel engine creative and leads on PGlite (audit GTM-12, GTM-02): the create step drafts the week's creative through
 * the models client (labeled mock drafts in mock mode) as pending assets; nothing launches without an approved asset;
 * a channel's first campaign asks in assisted mode and its approval approves the drafts; offline tracking gives the
 * founder a task with the materials; the lead channels' measured leads are CRM records with a lead role, as many as
 * the metrics count.
 */
import { repos } from "@foundmill/db";
import type { ModelClient } from "@foundmill/models";
import { CHANNEL_META, type ChannelKey } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApprovalActivities } from "../activities/approvals";
import { channelUnavailableNote, createChannelActivities, emptyChannelState, MOCK_CREATIVE_LABEL, mockLead, mockResultsAllowed } from "../activities/channel";
import type { ChannelEngineState, ChannelStep } from "../activities/types";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;
let acts: ReturnType<typeof createChannelActivities>;
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "engine" });
  acts = createChannelActivities(t.deps);
});
afterAll(async () => {
  await t?.close();
});

const channelFor = (key: ChannelKey, options: { kitMode?: boolean } = {}) => repos.channels.upsert(t.db, t.businessId, { channelKey: key, line: CHANNEL_META[key].line, enabled: true, kitMode: options.kitMode ?? false, budgetMinor: 10_000, currency: "EUR", ownerAgentId: t.workerId });

/** Runs steps in order from `state`, returning the last result. */
async function steps(channelId: string, key: ChannelKey, names: ChannelStep[], state: ChannelEngineState = emptyChannelState(), weekIndex = 0, activities = acts) {
  let last = null as Awaited<ReturnType<typeof acts.channelStep>> | null;
  for (const step of names) {
    last = await activities.channelStep({ businessId: t.businessId, channelId, channelKey: key, step, weekIndex, state });
    state = last.state;
  }
  return last!;
}

async function withMode<T>(mode: "assisted" | "automated" | "augmented", fn: () => Promise<T>): Promise<T> {
  await repos.businesses.setBusinessMode(t.db, t.businessId, mode);
  try {
    return await fn();
  } finally {
    await repos.businesses.setBusinessMode(t.db, t.businessId, "assisted");
  }
}

describe("create: the channel's agent drafts the week's creative", () => {
  it("stores labeled mock drafts as pending assets authored by the channel's agent, with the model cost attributed to it", async () => {
    const channel = await channelFor("social");
    const requests: { route: string; attribution?: { businessId?: string; agentId?: string; kind?: string } }[] = [];
    const spying = createChannelActivities({ ...t.deps, models: { ...t.deps.models, complete: (req: Parameters<ModelClient["complete"]>[0]) => (requests.push(req as never), t.deps.models.complete(req as never)) } as unknown as ModelClient });
    const created = await steps(channel.id, "social", ["plan", "create"], emptyChannelState(), 0, spying);
    expect(requests).toEqual([expect.objectContaining({ route: "worker", attribution: { businessId: t.businessId, agentId: t.workerId, kind: "channel_creative" } })]);
    expect(created.note).toMatch(/creative draft/);
    const assets = await repos.campaigns.listAssets(t.db, t.businessId, { campaignId: created.state.campaignId! });
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(a).toMatchObject({ kind: "post", approvalState: "pending", authoredByAgentId: t.workerId });
      expect(a.body?.startsWith(MOCK_CREATIVE_LABEL)).toBe(true);
      expect(a.title.length).toBeGreaterThan(0);
    }
  });

  it("a draft that fails leaves the campaign without creative, and it never goes live", async () => {
    const channel = await channelFor("seo");
    const failing = createChannelActivities({ ...t.deps, models: { ...t.deps.models, complete: async () => Promise.reject(new Error("model unavailable")) } as unknown as ModelClient });
    await withMode("automated", async () => {
      const created = await steps(channel.id, "seo", ["plan", "create"], emptyChannelState(), 0, failing);
      expect(created.note).toMatch(/without creative/);
      const approve = await steps(channel.id, "seo", ["approve"], created.state);
      expect(approve.note).toMatch(/No creative/);
      const launch = await steps(channel.id, "seo", ["launch"], approve.state);
      expect(launch.note).toMatch(/not approved/);
      expect((await repos.campaigns.get(t.db, t.businessId, created.state.campaignId!)).status).toBe("draft");
    });
  });
});

describe("approve and launch", () => {
  it("assisted mode asks for a channel's first campaign; the approval approves its drafts and the launch carries them", async () => {
    const channel = await channelFor("paid_ads");
    const created = await steps(channel.id, "paid_ads", ["plan", "create"]);
    const approve = await steps(channel.id, "paid_ads", ["approve"], created.state);
    expect(approve.awaitingApprovalId).toBeTruthy();
    expect((await repos.approvals.get(t.db, t.businessId, approve.awaitingApprovalId!)).reasons).toContain("assisted mode: a new campaign needs your approval");
    const approved = await acts.channelStep({ businessId: t.businessId, channelId: channel.id, channelKey: "paid_ads", step: "approve", weekIndex: 0, state: approve.state, approvedApprovalId: approve.awaitingApprovalId });
    const assets = await repos.campaigns.listAssets(t.db, t.businessId, { campaignId: created.state.campaignId! });
    expect(assets.every((a) => a.approvalState === "approved")).toBe(true);
    const launch = await steps(channel.id, "paid_ads", ["launch"], approved.state);
    expect(launch.note).toMatch(/^Live with/);
    const launched = (await repos.events.list(t.db, t.businessId, { type: "campaign.launched", limit: 20 })).items.find((e) => (e.payload as { campaignId: string }).campaignId === created.state.campaignId);
    expect((launched?.payload as { assetIds: string[] }).assetIds.sort()).toEqual(assets.map((a) => a.id).sort());

    // The next week's campaign of a channel that launched before is routine work: approved with the launch, no ask.
    const week2 = await steps(channel.id, "paid_ads", ["report", "plan", "create", "approve"], launch.state, 1);
    expect(week2.awaitingApprovalId).toBeNull();
    expect(week2.note).toMatch(/Inside policy/);
  });

  it("automated mode approves the drafts with the launch; augmented mode always asks", async () => {
    const auto = await channelFor("affiliate");
    await withMode("automated", async () => {
      const r = await steps(auto.id, "affiliate", ["plan", "create", "approve"]);
      expect(r.awaitingApprovalId).toBeNull();
      expect((await repos.campaigns.get(t.db, t.businessId, r.state.campaignId!)).status).toBe("scheduled");
    });
    const aug = await channelFor("influencer");
    await withMode("augmented", async () => {
      expect((await steps(aug.id, "influencer", ["plan", "create", "approve"])).awaitingApprovalId).toBeTruthy();
    });
  });

  it("never goes live when every draft was rejected", async () => {
    const channel = await channelFor("geo");
    await withMode("automated", async () => {
      const created = await steps(channel.id, "geo", ["plan", "create"]);
      for (const a of await repos.campaigns.listAssets(t.db, t.businessId, { campaignId: created.state.campaignId! })) await repos.campaigns.setAssetApproval(t.db, t.businessId, a.id, "rejected");
      const approve = await steps(channel.id, "geo", ["approve"], created.state);
      expect(approve.note).toMatch(/No creative/);
      await steps(channel.id, "geo", ["launch"], approve.state);
      expect((await repos.campaigns.get(t.db, t.businessId, created.state.campaignId!)).status).not.toBe("live");
    });
  });

  it("offline tracking gives the founder a task with every material attached", async () => {
    const channel = await channelFor("print", { kitMode: true });
    const created = await steps(channel.id, "print", ["plan", "create"]);
    const approve = await steps(channel.id, "print", ["approve"], created.state);
    const approved = await acts.channelStep({ businessId: t.businessId, channelId: channel.id, channelKey: "print", step: "approve", weekIndex: 0, state: approve.state, approvedApprovalId: approve.awaitingApprovalId });
    await steps(channel.id, "print", ["launch"], approved.state);
    const tasks = await repos.tasks.list(t.db, t.businessId, { status: "ready", limit: 200 });
    const founder = tasks.items.find((x) => x.title.startsWith("Founder action: submit the print materials"));
    expect(founder).toMatchObject({ assigneeAgentId: null });
    const assets = await repos.campaigns.listAssets(t.db, t.businessId, { campaignId: created.state.campaignId! });
    for (const a of assets) expect(founder!.goalMd).toContain(a.title);
    expect(founder!.goalMd).toContain("Nothing has been booked");
  });
});

describe("measure: leads are CRM records the Leads tab lists", () => {
  it("lead generation records one lead per lead it counts, with source, lawful basis and owner; a retried step adds none", async () => {
    const channel = await channelFor("lead_generation");
    const live = await withMode("automated", () => steps(channel.id, "lead_generation", ["plan", "create", "approve", "launch"]));
    const before = (await repos.entities.listByRole(t.db, t.businessId, "lead", { limit: 500 })).items.length;
    const measured = await steps(channel.id, "lead_generation", ["measure"], live.state);
    const counted = Number(/(\d+) leads/.exec(measured.note)?.[1]);
    expect(counted).toBeGreaterThan(0);
    const leads = (await repos.entities.listByRole(t.db, t.businessId, "lead", { limit: 500 })).items;
    expect(leads.length - before).toBe(counted);
    const mine = leads.filter((l) => l.source === "lead_generation");
    expect(mine.length).toBe(counted);
    for (const l of mine) {
      expect(l).toMatchObject({ lawfulBasis: "legitimate_interest", role: { stage: "new", ownerRef: { kind: "agent", id: t.workerId } } });
      expect(String((l.identifiers as { email: string }).email)).toMatch(/\.example$/);
    }
    const summary = await repos.channels.metricsSummary(t.db, t.businessId, {});
    expect(summary.channels.find((c) => c.channelId === channel.id)?.leads).toBe(counted);
    const events = (await repos.events.list(t.db, t.businessId, { type: "lead.created", limit: 200 })).items.filter((e) => (e.payload as { channelKey: string }).channelKey === "lead_generation");
    expect(events.length).toBe(counted);

    // A retried measure step: the same records, the same count, no new events.
    const again = await steps(channel.id, "lead_generation", ["measure"], live.state);
    expect(again.note).toBe(measured.note);
    expect((await repos.entities.listByRole(t.db, t.businessId, "lead", { limit: 500 })).items.length).toBe(leads.length);
    expect((await repos.events.list(t.db, t.businessId, { type: "lead.created", limit: 200 })).items.filter((e) => (e.payload as { channelKey: string }).channelKey === "lead_generation").length).toBe(counted);
  });

  it("other channels count no leads (they have no records to show)", async () => {
    const channel = await channelFor("broadcast");
    const live = await withMode("automated", () => steps(channel.id, "broadcast", ["plan", "create", "approve", "launch"]));
    const measured = await steps(channel.id, "broadcast", ["measure"], live.state);
    expect(measured.note).toMatch(/ 0 leads/);
  });

  it("a person's own business on staging or production gets no invented results: no metric row, no lead, a plain note", async () => {
    expect(mockResultsAllowed("staging", false)).toBe(false);
    expect(mockResultsAllowed("production", false)).toBe(false);
    expect(mockResultsAllowed("production", true)).toBe(true);
    expect(mockResultsAllowed("test", false)).toBe(true);
    // Offline tracking runs on a real project (the agent prepares, the founder submits), and nothing it measures is
    // invented: the connectors are mock here, so nothing reports results.
    const channel = await channelFor("email_automation", { kitMode: true });
    const asked = await steps(channel.id, "email_automation", ["plan", "create", "approve"]);
    expect(asked.awaitingApprovalId).toBeTruthy();
    const approved = await acts.channelStep({ businessId: t.businessId, channelId: channel.id, channelKey: "email_automation", step: "approve", weekIndex: 0, state: asked.state, approvedApprovalId: asked.awaitingApprovalId! });
    const live = await steps(channel.id, "email_automation", ["launch"], approved.state);
    const staging = createChannelActivities({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging", LIVE_CONNECTORS: "sendgrid" } });
    const leadsBefore = (await repos.entities.listByRole(t.db, t.businessId, "lead", { limit: 500 })).items.length;
    const measured = await steps(channel.id, "email_automation", ["measure"], live.state, 0, staging);
    expect(measured.stop).toBe(false);
    expect(measured.note).toMatch(/^Nothing measured/);
    expect(measured.note).not.toMatch(/impressions|mock/);
    const summary = await repos.channels.metricsSummary(t.db, t.businessId, {});
    const mine = summary.channels.find((c) => c.channelId === channel.id);
    expect(mine?.impressions ?? 0).toBe(0);
    expect(mine?.leads ?? 0).toBe(0);
    expect((await repos.entities.listByRole(t.db, t.businessId, "lead", { limit: 500 })).items.length).toBe(leadsBefore);
  });

  it("mock leads are deterministic and use addresses that can never receive mail", () => {
    expect(mockLead("a")).toEqual(mockLead("a"));
    expect(mockLead("a").email).toMatch(/^[a-z0-9.]+@[a-z]+\.example$/);
  });
});

describe("only a channel that can really act runs (founder, 2026-11-11)", () => {
  const stagingActs = (env: Partial<OrchestratorTestHarness["deps"]["env"]> = {}) => createChannelActivities({ ...t.deps, env: { ...t.deps.env, APP_ENV: "staging", LIVE_CONNECTORS: "", ...env } });

  it("a channel with no publisher stops at the first step on staging: nothing planned, no campaign, a clear note", async () => {
    const channel = await channelFor("content");
    const before = (await repos.campaigns.list(t.db, t.businessId, { channelId: channel.id, limit: 200 })).items.length;
    const out = await steps(channel.id, "content", ["plan"], emptyChannelState(), 0, stagingActs());
    expect(out.stop).toBe(true);
    expect(out.note).toBe(channelUnavailableNote("Content marketing", { available: false, reason: "no_publisher" }));
    expect(out.note).toMatch(/not available yet \(no tool publishes to it yet\).*engine stopping/);
    const created = await stagingActs().channelStep({ businessId: t.businessId, channelId: channel.id, channelKey: "content", step: "create", weekIndex: 0, state: emptyChannelState() });
    expect(created.stop).toBe(true);
    expect(created.state.campaignId).toBeNull();
    expect((await repos.campaigns.list(t.db, t.businessId, { channelId: channel.id, limit: 200 })).items.length).toBe(before);
  });

  it("tap-to-post: social is available to the founder and never a channel an agent launches or measures; every step stops and says who posts", async () => {
    const channel = await channelFor("social");
    const before = (await repos.campaigns.list(t.db, t.businessId, { channelId: channel.id, limit: 200 })).items.length;
    const metricsBefore = (await repos.channels.metricsSummary(t.db, t.businessId, {})).channels.find((c) => c.channelId === channel.id) ?? null;
    const byTap = { available: true, reason: "by_tap", byTap: true } as const;
    const note = channelUnavailableNote("Social media", byTap);
    expect(note).toBe("Social media is posted by the founder, one press at a time (tap-to-post): no agent can publish there, so the engine is stopping; nothing planned, launched or measured");
    // The agent-facing text says the founder posts it, and never that anything was posted or that it is "not available".
    expect(note).not.toMatch(/not available|was posted|published it/);
    for (const step of ["plan", "create", "approve", "launch", "measure", "learn", "report"] as const) {
      const out = await stagingActs().channelStep({ businessId: t.businessId, channelId: channel.id, channelKey: "social", step, weekIndex: 0, state: emptyChannelState() });
      expect(out.stop, step).toBe(true);
      expect(out.note, step).toBe(note);
      expect(out.state.campaignId, step).toBeNull();
      expect(out.awaitingApprovalId, step).toBeNull();
    }
    // Nothing drafted, nothing launched, no number invented.
    expect((await repos.campaigns.list(t.db, t.businessId, { channelId: channel.id, limit: 200 })).items.length).toBe(before);
    expect((await repos.channels.metricsSummary(t.db, t.businessId, {})).channels.find((c) => c.channelId === channel.id) ?? null).toEqual(metricsBefore);

    // A campaign the engine scheduled before (in test, where every channel runs) is ended at launch, never marked live.
    const scheduled = await withMode("automated", () => steps(channel.id, "social", ["plan", "create", "approve"]));
    expect((await repos.campaigns.get(t.db, t.businessId, scheduled.state.campaignId!)).status).toBe("scheduled");
    const launched = await steps(channel.id, "social", ["launch"], scheduled.state, 0, stagingActs());
    expect(launched.stop).toBe(true);
    expect(launched.note).toBe(note);
    expect((await repos.campaigns.get(t.db, t.businessId, scheduled.state.campaignId!)).status).toBe("ended");
    const events = (await repos.events.list(t.db, t.businessId, { type: "campaign.launched", limit: 200 })).items.filter((e) => (e.payload as { campaignId: string }).campaignId === scheduled.state.campaignId);
    expect(events).toHaveLength(0);
    // Whatever else is connected changes nothing: no tool publishes to social.
    await repos.integrations.upsert(t.db, t.businessId, { connectorKey: "github", status: "connected", authKind: "app" });
    expect((await steps(channel.id, "social", ["plan"], emptyChannelState(), 0, stagingActs({ LIVE_CONNECTORS: "github,sendgrid" }))).note).toBe(note);
    // In offline tracking (the founder's own choice) it runs like any offline channel: the agent prepares, the founder submits.
    const offline = await channelFor("social", { kitMode: true });
    const planned = await steps(offline.id, "social", ["plan"], emptyChannelState(), 0, stagingActs());
    expect(planned.stop).toBe(false);
    expect(planned.note).toMatch(/^Plan for Social media/);
    await channelFor("social", { kitMode: false });
  });

  it("a campaign the engine had scheduled is never marked live: the launch step ends it and stops", async () => {
    const channel = await channelFor("paid_ads");
    const scheduled = await withMode("automated", () => steps(channel.id, "paid_ads", ["plan", "create", "approve"]));
    expect((await repos.campaigns.get(t.db, t.businessId, scheduled.state.campaignId!)).status).toBe("scheduled");
    const launched = await steps(channel.id, "paid_ads", ["launch"], scheduled.state, 0, stagingActs());
    expect(launched.stop).toBe(true);
    expect((await repos.campaigns.get(t.db, t.businessId, scheduled.state.campaignId!)).status).toBe("ended");
    const events = (await repos.events.list(t.db, t.businessId, { type: "campaign.launched", limit: 200 })).items.filter((e) => (e.payload as { campaignId: string }).campaignId === scheduled.state.campaignId);
    expect(events).toHaveLength(0);
  });

  it("a channel whose connector is mock here, or not connected for the business, stops too", async () => {
    await repos.integrations.upsert(t.db, t.businessId, { connectorKey: "sendgrid", status: "mock", authKind: "api_key" });
    const channel = await channelFor("email_automation");
    const mockHere = await steps(channel.id, "email_automation", ["plan"], emptyChannelState(), 0, stagingActs());
    expect(mockHere.stop).toBe(true);
    expect(mockHere.note).toMatch(/sendgrid is not live on this deployment/);
    const notConnected = await steps(channel.id, "email_automation", ["plan"], emptyChannelState(), 0, stagingActs({ LIVE_CONNECTORS: "sendgrid" }));
    expect(notConnected.stop).toBe(true);
    expect(notConnected.note).toMatch(/sendgrid is not connected for this business/);
    // Connected and live: its agents can act, through tasks and sessions. The weekly engine has nothing it can send for
    // it yet, so it stops too, ends what it had open and says so; nothing is ever claimed as launched (WP-02 T2).
    await repos.integrations.upsert(t.db, t.businessId, { connectorKey: "sendgrid", status: "connected", authKind: "api_key" });
    const campaign = await repos.campaigns.create(t.db, t.businessId, { channelId: channel.id, name: "Email automation — week 1", status: "pending_approval" });
    const approval = await repos.approvals.create(t.db, t.businessId, { agentId: t.workerId, connectorKey: "platform", tool: "launch_campaign", args: { campaignId: campaign.id, channelKey: "email_automation" } });
    const acts2 = await steps(channel.id, "email_automation", ["plan"], emptyChannelState(), 0, stagingActs({ LIVE_CONNECTORS: "sendgrid" }));
    expect(acts2.stop).toBe(true);
    expect(acts2.note).toMatch(/nothing the weekly engine can send yet; the team works on it through tasks/);
    expect((await repos.campaigns.get(t.db, t.businessId, campaign.id)).status).toBe("ended");
    expect((await repos.approvals.get(t.db, t.businessId, approval.id)).outcome).toBe("expired");
    const resolved = (await repos.events.list(t.db, t.businessId, { type: "approval.resolved", limit: 200 })).items.filter((e) => (e.payload as { approvalId: string }).approvalId === approval.id);
    expect(resolved.map((e) => (e.payload as { outcome: string }).outcome)).toEqual(["expired"]);
  });

  it("offline tracking on a real project asks once: an expired ask is not repeated until the founder approves the materials (WP-02 T2)", async () => {
    const channel = await channelFor("direct_mail", { kitMode: true });
    const real = stagingActs();
    const asks = async () => (await repos.events.list(t.db, t.businessId, { type: "approval.requested", limit: 500 })).items.filter((e) => (e.payload as { tool: string; approvalId: string }).tool === "launch_campaign").length;
    const before = await asks();
    // Week 1 asks; nobody answers and the wait expires it.
    const week1 = await steps(channel.id, "direct_mail", ["plan", "create", "approve"], emptyChannelState(), 0, real);
    expect(week1.awaitingApprovalId).toBeTruthy();
    const requested = (await repos.events.list(t.db, t.businessId, { type: "approval.requested", limit: 500 })).items.find((e) => (e.payload as { approvalId: string }).approvalId === week1.awaitingApprovalId);
    expect((requested!.payload as { summary: string }).summary).toMatch(/has Direct mail materials ready for you to check$/);
    await createApprovalActivities(t.deps).expireApproval({ businessId: t.businessId, approvalId: week1.awaitingApprovalId! });
    // Weeks 2 to 4: nothing new is drafted and nothing is asked; the note says where the materials wait.
    let state: ChannelEngineState = { ...week1.state, approvalId: null };
    for (let week = 1; week <= 3; week++) {
      const created = await steps(channel.id, "direct_mail", ["plan", "create"], state, week, real);
      expect(created.note).toBe("Waiting for you: the materials are on Creative.");
      const approve = await steps(channel.id, "direct_mail", ["approve"], created.state, week, real);
      expect(approve.note).toBe("Waiting for you: the materials are on Creative.");
      expect(approve.awaitingApprovalId).toBeNull();
      state = approve.state;
    }
    expect((await asks()) - before).toBe(1);
    // The founder approves the materials on Creative: the next week asks as before.
    await repos.campaigns.approveCampaignAssets(t.db, t.businessId, week1.state.campaignId!);
    const week5 = await steps(channel.id, "direct_mail", ["plan", "create", "approve"], state, 4, real);
    expect(week5.awaitingApprovalId).toBeTruthy();
  });

  it("offline tracking runs whatever the connectors are: the agent prepares, the founder submits", async () => {
    const channel = await channelFor("print", { kitMode: true });
    const out = await steps(channel.id, "print", ["plan"], emptyChannelState(), 0, stagingActs());
    expect(out.stop).toBe(false);
    expect(out.note).toMatch(/^Plan for Print/);
  });

  it("a sample business keeps every channel on staging and production, and so does any business in test", async () => {
    const sample = await repos.businesses.create(t.db, { name: "Sample Co", isDemo: true, createdBy: t.fixture.ownerId });
    await repos.businesses.startDistribution(t.db, sample.id);
    const channel = await repos.channels.upsert(t.db, sample.id, { channelKey: "social", line: CHANNEL_META.social.line, enabled: true, kitMode: false, budgetMinor: 10_000, currency: "EUR" });
    for (const APP_ENV of ["staging", "production"] as const) {
      const out = await stagingActs({ APP_ENV }).channelStep({ businessId: sample.id, channelId: channel.id, channelKey: "social", step: "plan", weekIndex: 0, state: emptyChannelState() });
      expect(out.stop, APP_ENV).toBe(false);
      expect(out.note, APP_ENV).toMatch(/^Plan for Social media/);
    }
    const mine = await channelFor("influencer");
    expect((await steps(mine.id, "influencer", ["plan"])).stop).toBe(false);
  });
});
