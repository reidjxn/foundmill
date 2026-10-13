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
import { createChannelActivities, emptyChannelState, MOCK_CREATIVE_LABEL, mockLead } from "../activities/channel";
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

  it("mock leads are deterministic and use addresses that can never receive mail", () => {
    expect(mockLead("a")).toEqual(mockLead("a"));
    expect(mockLead("a").email).toMatch(/^[a-z0-9.]+@[a-z]+\.example$/);
  });
});
