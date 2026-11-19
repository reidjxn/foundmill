/**
 * Only channels that can really act (founder, 2026-11-11). On staging (and production) a person's own project gets
 * every channel's availability with its rows, cannot put on the board one that is not available unless it is in offline
 * tracking, is never recommended one, and never has one switched on or launched by a plan, a campaign or a commit. A
 * sample business, and every business in development and test, keeps all fifteen.
 *
 * Tap-to-post (founder, 2026-11-12): social is available there with no connector, because the founder posts each draft
 * with one press. It can be put on the board, and it is never a channel the team runs: no engine starts for it, nothing
 * is scheduled or launched on it, it is never a recommended starter, a default start or a route the Board offers.
 */
import { businesses, repos } from "@foundmill/db";
import { getArchetypeSeed } from "@foundmill/agents";
import { CHANNEL_BY_TAP_SENTENCE, CHANNEL_KEYS, type ChannelKey } from "@foundmill/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { normaliseRecommendation } from "../routers/distribution";
import { CHANNEL_NOT_AVAILABLE, FOUNDER_POSTS_CHANNEL, OPTIONS_LEFT_OUT_LINE, channelAnswer, offerableOptions, optionChannels } from "../services/channel-availability";
import { scoringTaskFor } from "../services/signoff";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "availability", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());

/** A caller whose api runs with these env values (the harness itself is `test` with mock integrations). */
const callerWith = (env: Partial<ApiDeps["env"]>, user: CallerUser) => createCaller({ ...hz.deps, env: { ...hz.deps.env, ...env } }, user);
const STAGING = { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" } as const;
const staging = (env: Partial<ApiDeps["env"]> = {}) => callerWith({ ...STAGING, ...env }, { userId: hz.A.ownerId });
const testEnv = () => hz.caller({ userId: hz.A.ownerId });
const rowOf = async (key: ChannelKey) => (await repos.channels.getByKey(hz.db, hz.A.businessId, key))!;
const ensure = (key: ChannelKey, over: { enabled?: boolean; kitMode?: boolean } = {}) => repos.channels.upsert(hz.db, hz.A.businessId, { channelKey: key, line: "midfield", enabled: over.enabled ?? false, kitMode: over.kitMode ?? false });

describe("distribution.channels.list carries each channel's availability", () => {
  it("a person's project on staging: email is not connected, content has no publisher, social is the founder's by tap, each with a plain sentence", async () => {
    await ensure("social");
    await ensure("email_automation");
    const listed = await staging().distribution.channels.list({ businessId: hz.A.businessId });
    expect(Object.keys(listed.availability).sort()).toEqual([...CHANNEL_KEYS].sort());
    expect(listed.availability.email_automation).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false, sentence: "Not available yet: SendGrid is not switched on for your project yet. Nothing is waiting on you." });
    expect(listed.availability.content).toEqual({ available: false, reason: "no_publisher", sentence: "Not available yet: the team cannot publish here yet." });
    // Tap-to-post: available with no connector, with the sentence that says what that means.
    expect(listed.availability.social).toEqual({ available: true, reason: "by_tap", byTap: true, sentence: "You post each one with one press: the text and link are filled in for you." });
    expect(listed.availability.social.sentence).toBe(CHANNEL_BY_TAP_SENTENCE);
    expect(listed.channels.find((c) => c.channelKey === "social")?.availability).toEqual(listed.availability.social);
    expect(listed.channels.find((c) => c.channelKey === "email_automation")?.availability.reason).toBe("not_connected");
    expect(CHANNEL_KEYS.filter((k) => listed.availability[k].available)).toEqual(["social"]);
    expect(listed.channels.every((c) => !c.recommended)).toBe(true);
    // The team can still run nothing: the sentence for that stays, and ends with what is ready.
    expect(listed.noChannel).toBe("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you. Social media is ready now: you post each one with one press.");
  });

  it("a connector that is live here is the founder's to connect; once connected the channel acts", async () => {
    const live = staging({ LIVE_CONNECTORS: "github,sendgrid" });
    const before = await live.distribution.channels.list({ businessId: hz.A.businessId });
    expect(before.availability.email_automation).toMatchObject({ available: false, reason: "not_connected", connectable: true, sentence: "Not available yet: connect SendGrid in Settings › Integrations and the team can run this." });
    expect(before.availability.seo).toMatchObject({ available: false, reason: "not_connected", connectorKey: "github", connectable: true });
    expect(before.noChannel).toBe("No channel can run on its own yet. Email automation opens first: connect SendGrid in Settings › Integrations and the team can run it. Nothing is wrong. Social media is ready now: you post each one with one press.");

    // An integration row with status `mock` (connected while the connector was simulated) does not count.
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "sendgrid", status: "mock", authKind: "api_key" });
    expect((await live.distribution.channels.list({ businessId: hz.A.businessId })).availability.email_automation.available).toBe(false);
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "github", status: "connected", authKind: "app" });
    const after = await live.distribution.channels.list({ businessId: hz.A.businessId });
    expect(after.availability.seo).toEqual({ available: true, reason: "acts", sentence: null });
    expect(after.availability.geo.available).toBe(true);
    expect(after.availability.email_automation.available).toBe(false);
    expect(after.noChannel).toBeNull();
    // GitHub is connected for the business but simulated on this deployment: nothing acts.
    expect((await staging().distribution.channels.list({ businessId: hz.A.businessId })).availability.seo).toMatchObject({ available: false, reason: "not_connected", connectable: false });
  });

  it("development and test keep all fifteen (simulated results are allowed)", async () => {
    const listed = await testEnv().distribution.channels.list({ businessId: hz.A.businessId });
    // Social runs simulated like the rest, and also says the founder can post it with one press (the share panel is real there).
    for (const key of CHANNEL_KEYS) expect(listed.availability[key], key).toEqual(key === "social" ? { available: true, reason: "simulated_allowed", byTap: true, sentence: CHANNEL_BY_TAP_SENTENCE } : { available: true, reason: "simulated_allowed", sentence: null });
    expect(listed.noChannel).toBeNull();
    expect((await callerWith({ APP_ENV: "development" }, { userId: hz.A.ownerId }).distribution.channels.list({ businessId: hz.A.businessId })).availability.social.available).toBe(true);
  });

  it("a sample business gets all fifteen on staging and production", async () => {
    await hz.db.update(businesses).set({ isDemo: true }).where(eq(businesses.id, hz.B.businessId));
    for (const APP_ENV of ["staging", "production"] as const) {
      const listed = await callerWith({ ...STAGING, APP_ENV }, { userId: hz.B.ownerId }).distribution.channels.list({ businessId: hz.B.businessId });
      expect(CHANNEL_KEYS.filter((k) => listed.availability[k].available), APP_ENV).toHaveLength(15);
      expect(listed.availability.social.reason).toBe("simulated_allowed");
    }
    // And it can put any of them on the board there.
    const enabled = await callerWith(STAGING, { userId: hz.B.ownerId }).distribution.channels.enable({ businessId: hz.B.businessId, channelKey: "social" });
    expect(enabled.channel.enabled).toBe(true);
  });
});

describe("turning on a channel that cannot run is refused", () => {
  it("content cannot be put on the board on staging: a typed, plainly worded refusal, and nothing changes", async () => {
    await ensure("content");
    const starts = temporal.starts.length;
    await expect(staging().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "content" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Content marketing is not available yet: the team cannot publish there yet.",
      cause: expect.objectContaining({ code: CHANNEL_NOT_AVAILABLE, details: { channelKey: "content", reason: "no_publisher" } }),
    });
    expect((await rowOf("content")).enabled).toBe(false);
    expect(temporal.starts.length).toBe(starts);
    await expect(staging().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "email_automation" })).rejects.toMatchObject({
      message: "Email automation is not available yet: SendGrid is not switched on for your project yet. Nothing is waiting on you.",
      cause: expect.objectContaining({ code: CHANNEL_NOT_AVAILABLE, details: { channelKey: "email_automation", reason: "not_connected", connectorKey: "sendgrid", connectable: false } }),
    });
    // A channel with no row yet is refused before one is created on the board.
    const before = await repos.channels.getByKey(hz.db, hz.A.businessId, "influencer");
    await expect(staging().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "influencer" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repos.channels.getByKey(hz.db, hz.A.businessId, "influencer"))?.enabled ?? false).toBe(before?.enabled ?? false);
  });

  it("print can be put on the board with offline tracking: the team prepares, the founder submits", async () => {
    await ensure("print", { kitMode: true });
    const enabled = await staging().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "print" });
    expect(enabled.channel).toMatchObject({ enabled: true, kitMode: true });
    const listed = await staging().distribution.channels.list({ businessId: hz.A.businessId });
    // Still not available (no publisher): it is on the board because of offline tracking alone.
    expect(listed.channels.find((c) => c.channelKey === "print")).toMatchObject({ enabled: true, kitMode: true, availability: { available: false, reason: "no_publisher" } });
    // Broadcast has no row yet and no longer starts in offline tracking (WP-08 T9): with no publisher it is refused.
    await expect(staging().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "broadcast" })).rejects.toThrow();
    // Taking any channel off the board is always allowed.
    expect((await staging().distribution.channels.disable({ businessId: hz.A.businessId, channelKey: "print" })).channel.enabled).toBe(false);
  });

  it("the same toggle works in test, where every channel is available", async () => {
    expect((await testEnv().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "social" })).channel.enabled).toBe(true);
    await testEnv().distribution.channels.disable({ businessId: hz.A.businessId, channelKey: "social" });
  });

  it("no campaign is scheduled or marked live on a channel that cannot run; one in offline tracking may be", async () => {
    const paid = await repos.channels.upsert(hz.db, hz.A.businessId, { channelKey: "paid_ads", line: "attack", enabled: true, kitMode: false, currency: "EUR" });
    const campaign = await testEnv().distribution.campaigns.create({ businessId: hz.A.businessId, channelId: paid.id, name: "Spring ads", budgetMinor: 5_000 });
    await repos.campaigns.createAsset(hz.db, hz.A.businessId, { campaignId: campaign.id, kind: "ad", title: "Ad", approvalState: "approved", authoredByAgentId: hz.A.agentId });
    for (const status of ["scheduled", "live"] as const) {
      await expect(staging().distribution.campaigns.setStatus({ businessId: hz.A.businessId, campaignId: campaign.id, status })).rejects.toMatchObject({ code: "CONFLICT", message: "Paid advertising is not available yet: the team cannot publish there yet." });
    }
    expect((await repos.campaigns.get(hz.db, hz.A.businessId, campaign.id)).status).toBe("draft");
    expect((await repos.events.list(hz.db, hz.A.businessId, { type: "campaign.launched", limit: 100 })).items.some((e) => (e.payload as { campaignId: string }).campaignId === campaign.id)).toBe(false);

    const outdoor = await repos.channels.upsert(hz.db, hz.A.businessId, { channelKey: "outdoor", line: "wings", enabled: true, kitMode: true, currency: "EUR" });
    const offline = await testEnv().distribution.campaigns.create({ businessId: hz.A.businessId, channelId: outdoor.id, name: "Posters", budgetMinor: 5_000 });
    await repos.campaigns.createAsset(hz.db, hz.A.businessId, { campaignId: offline.id, kind: "print", title: "Poster", approvalState: "approved", authoredByAgentId: hz.A.agentId });
    expect((await staging().distribution.campaigns.setStatus({ businessId: hz.A.businessId, campaignId: offline.id, status: "scheduled" })).status).toBe("scheduled");
    // Nothing is sent from here, so a real project never marks it live by hand (WP-02 T2, GTM-36): the founder submits the
    // materials and ends it. A sample or test project still can.
    await expect(staging().distribution.campaigns.setStatus({ businessId: hz.A.businessId, campaignId: offline.id, status: "live" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Nothing is sent from here, so the campaign stays as it is. Submit the materials yourself, then mark it ended.",
    });
    expect((await repos.campaigns.get(hz.db, hz.A.businessId, offline.id)).status).toBe("scheduled");
    expect((await testEnv().distribution.campaigns.setStatus({ businessId: hz.A.businessId, campaignId: offline.id, status: "live" })).status).toBe("live");
  });

  it("a plan never turns one on: the action is refused in the founder's words, the channel stays off and no engine starts", async () => {
    await ensure("affiliate");
    const starts = temporal.starts.length;
    const plan = await repos.plans.create(hz.db, hz.A.businessId, { origin: "free_text", summaryMd: "Start affiliate marketing", status: "pending_confirmation", actions: [{ type: "enable_channel", params: { channel: "affiliate" }, policyOutcome: "ask" }] });
    const confirmed = await staging().plan.confirm({ businessId: hz.A.businessId, planId: plan.id });
    expect(confirmed.exec.executed).toEqual([]);
    expect(confirmed.exec.denied).toEqual([plan.actions[0]!.id]);
    const action = (await repos.plans.get(hz.db, hz.A.businessId, plan.id)).actions[0]!;
    expect(action).toMatchObject({ status: "denied", result: { reason: "Affiliate is not available yet: the team cannot publish there yet.", code: CHANNEL_NOT_AVAILABLE } });
    expect((await rowOf("affiliate")).enabled).toBe(false);
    expect(temporal.starts.length).toBe(starts);
  });
});

describe("the Distribution Strategist recommends only channels that can run", () => {
  const row = (channel: ChannelKey, fit: number, recommended = false) => ({ channel, fit, potential: 3, recommended, cpa_range_minor: { low: 100, high: 200 }, why: `${channel} why` });
  const answer = { channels: CHANNEL_KEYS.map((k, i) => row(k, 20 - i, i < 5)) };

  it("normaliseRecommendation holds the Strategist's answer to the available channels", () => {
    // All fifteen available: the answer stands (five starters).
    expect(normaliseRecommendation(answer).filter((r) => r.recommended)).toHaveLength(5);
    // Two available: only those two, though three is the usual minimum.
    const two = normaliseRecommendation(answer, new Set<ChannelKey>(["seo", "geo"]));
    expect(two).toHaveLength(15);
    expect(two.filter((r) => r.recommended).map((r) => r.channel)).toEqual(["seo", "geo"]);
    // Eight available: at most six starters, never one that cannot run.
    const eight = new Set<ChannelKey>(CHANNEL_KEYS.slice(0, 8));
    const many = normaliseRecommendation({ channels: CHANNEL_KEYS.map((k, i) => row(k, 20 - i, true)) }, eight);
    expect(many.filter((r) => r.recommended)).toHaveLength(6);
    expect(many.filter((r) => r.recommended).every((r) => eight.has(r.channel))).toBe(true);
    // None available: nothing is recommended.
    expect(normaliseRecommendation(answer, new Set()).some((r) => r.recommended)).toBe(false);
  });

  it("with no channel available it recommends none and says why in one sentence, without a model call", async () => {
    const usage = async () => (await repos.usage.totals(hz.db, hz.A.businessId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) }));
    const before = JSON.stringify(await usage());
    const out = await staging().distribution.recommend({ businessId: hz.A.businessId });
    expect(out.recommendation).toEqual([]);
    // Social is available by tap, and that is not a channel the team can run: still no model call, and the note says what is ready.
    expect(out.note).toBe("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you. Social media is ready now: you post each one with one press.");
    expect(out.channels.some((c) => c.recommended)).toBe(false);
    expect(JSON.stringify(await usage())).toBe(before);
  });

  it("with GitHub live and connected only SEO and GEO are ever starters; in test the usual 3 to 6", async () => {
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "github", status: "connected", authKind: "app" });
    const out = await staging({ LIVE_CONNECTORS: "github" }).distribution.recommend({ businessId: hz.A.businessId });
    expect(out.note).toBeNull();
    const starters = out.recommendation.filter((r) => r.recommended).map((r) => r.channel);
    expect(starters.length).toBeGreaterThan(0);
    expect(starters.every((c) => c === "seo" || c === "geo")).toBe(true);
    const listed = await staging({ LIVE_CONNECTORS: "github" }).distribution.channels.list({ businessId: hz.A.businessId });
    expect(listed.channels.filter((c) => c.recommended).every((c) => c.channelKey === "seo" || c.channelKey === "geo")).toBe(true);

    const usual = await testEnv().distribution.recommend({ businessId: hz.A.businessId });
    const n = usual.recommendation.filter((r) => r.recommended).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
  });
});

describe("tap-to-post: social is available with no connector, and the team never runs it", () => {
  const starters = () => temporal.starts.filter((s) => s.type === "channelEngine").length;

  it("the answer keeps the two questions apart: available to the founder, and what the team can run", () => {
    const staged = channelAnswer({ liveConnectors: [], connectedConnectors: [], mockResultsAllowed: false });
    expect(staged.available).toEqual(["social"]);
    expect(staged.teamRuns).toEqual([]);
    expect(staged.noneSentence).toBe("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you. Social media is ready now: you post each one with one press.");
    const withGithub = channelAnswer({ liveConnectors: ["github"], connectedConnectors: ["github"], mockResultsAllowed: false });
    expect(withGithub.available).toEqual(["seo", "geo", "social"]);
    expect(withGithub.teamRuns).toEqual(["seo", "geo"]);
    expect(withGithub.noneSentence).toBeNull();
    // Where simulated results are allowed the team runs all fifteen, social included.
    const simulated = channelAnswer({ liveConnectors: [], connectedConnectors: [], mockResultsAllowed: true });
    expect(simulated.teamRuns).toHaveLength(15);
  });

  it("goes on the board on staging with one press, and no engine starts for it", async () => {
    await ensure("social");
    await repos.businesses.startDistribution(hz.db, hz.A.businessId);
    const before = starters();
    const from = temporal.starts.length;
    const enabled = await staging().distribution.channels.enable({ businessId: hz.A.businessId, channelKey: "social" });
    expect(enabled.channel).toMatchObject({ enabled: true, kitMode: false, engineWorkflowId: null });
    expect(enabled.workflow).toMatchObject({ queued: false, reason: FOUNDER_POSTS_CHANNEL });
    expect(starters()).toBe(before);
    expect((await rowOf("social")).engineWorkflowId).toBeNull();
    const listed = await staging().distribution.channels.list({ businessId: hz.A.businessId });
    expect(listed.channels.find((c) => c.channelKey === "social")).toMatchObject({ enabled: true, recommended: false, availability: { available: true, reason: "by_tap", sentence: CHANNEL_BY_TAP_SENTENCE } });
    // Resuming the team starts engines for the channels it runs, never for this one.
    const { restartEngines } = await import("../services/killswitch");
    const restarted = await restartEngines({ db: hz.db, businessId: hz.A.businessId, temporal: hz.deps.temporal, env: { ...hz.deps.env, ...STAGING }, business: { isDemo: false } } as never);
    expect(restarted.some((r) => r.workflowId === `engine:${enabled.channel.id}`)).toBe(false);
    // The channels in offline tracking restart as before; nothing was ever started for social.
    expect(temporal.starts.slice(from).some((s) => s.workflowId === `engine:${enabled.channel.id}`)).toBe(false);
    expect((await rowOf("social")).engineWorkflowId).toBeNull();
  });

  it("nothing is scheduled or launched on it: the refusal says the founder posts it, and nothing is recorded as launched", async () => {
    const social = await rowOf("social");
    const campaign = await testEnv().distribution.campaigns.create({ businessId: hz.A.businessId, channelId: social.id, name: "Spring posts", budgetMinor: 0 });
    await repos.campaigns.createAsset(hz.db, hz.A.businessId, { campaignId: campaign.id, kind: "post", title: "Post", body: "Fresh batch out today.", approvalState: "approved", authoredByAgentId: hz.A.agentId });
    for (const status of ["scheduled", "live"] as const) {
      await expect(staging().distribution.campaigns.setStatus({ businessId: hz.A.businessId, campaignId: campaign.id, status })).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Social media is yours to post, one press at a time: the team cannot publish there, so nothing is launched. Open a drafted post and press Share.",
        cause: expect.objectContaining({ code: CHANNEL_NOT_AVAILABLE, details: { channelKey: "social", reason: "by_tap" } }),
      });
    }
    expect((await repos.campaigns.get(hz.db, hz.A.businessId, campaign.id)).status).toBe("draft");
    expect((await repos.events.list(hz.db, hz.A.businessId, { type: "campaign.launched", limit: 100 })).items.some((e) => (e.payload as { campaignId: string }).campaignId === campaign.id)).toBe(false);
    // In offline tracking (the founder's own choice) it launches as any offline channel does.
    await repos.channels.upsert(hz.db, hz.A.businessId, { channelKey: "social", line: "midfield", enabled: true, kitMode: true });
    expect((await staging().distribution.campaigns.setStatus({ businessId: hz.A.businessId, campaignId: campaign.id, status: "scheduled" })).status).toBe("scheduled");
    await repos.channels.upsert(hz.db, hz.A.businessId, { channelKey: "social", line: "midfield", enabled: true, kitMode: false });
  });

  it("a plan may put it on the board, and its engine does not follow; a budget never puts it there", async () => {
    await staging().distribution.channels.disable({ businessId: hz.A.businessId, channelKey: "social" });
    const before = starters();
    const plan = await repos.plans.create(hz.db, hz.A.businessId, { origin: "free_text", summaryMd: "Put social on the board", status: "pending_confirmation", actions: [{ type: "enable_channel", params: { channel: "social" }, policyOutcome: "ask" }] });
    const confirmed = await staging().plan.confirm({ businessId: hz.A.businessId, planId: plan.id });
    expect(confirmed.exec.denied).toEqual([]);
    expect(confirmed.exec.executed).toEqual([plan.actions[0]!.id]);
    expect((await rowOf("social")).enabled).toBe(true);
    expect((await rowOf("social")).engineWorkflowId).toBeNull();
    expect(starters()).toBe(before);
  });

  it("the Strategist is told which channels the founder posts, and never picks one as a starter", async () => {
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "github", status: "connected", authKind: "app" });
    const out = await staging({ LIVE_CONNECTORS: "github" }).distribution.recommend({ businessId: hz.A.businessId });
    const picked = out.recommendation.filter((r) => r.recommended).map((r) => r.channel);
    expect(picked).not.toContain("social");
    expect(picked.every((c) => c === "seo" || c === "geo")).toBe(true);
    // Whatever a model answered, a channel the founder posts is held out of the starters.
    const forced = normaliseRecommendation({ channels: CHANNEL_KEYS.map((k, i) => ({ channel: k, fit: 20 - i, potential: 3, recommended: true, cpa_range_minor: { low: 100, high: 200 }, why: `${k} why` })) }, new Set<ChannelKey>(["seo", "geo"]));
    expect(forced.find((r) => r.channel === "social")?.recommended).toBe(false);
  });
});

describe("a new project", () => {
  const commitOn = async (env: Partial<ApiDeps["env"]>, email: string, name: string) => {
    const userId = await hz.h.createUser(email);
    // The founder profile and the idea come from the test stack; the commit and what follows run with `env`.
    const setup = hz.caller({ userId, email });
    await setup.founder.profile.update({ confirmAdult: true, displayName: "Sam", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 10, sales: 10 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const idea = (await setup.idea.generate({ prompt: `${name}: booking software for dog groomers` })).ideas[0]!;
    const caller = callerWith(env, { userId, email });
    const { business } = await caller.idea.commit({ ideaId: idea.id, name, archetype: "b2b_saas", gameMode: "personal" });
    return { caller, businessId: business.id };
  };

  it("committed on staging starts with no channel on the board and none recommended; the preview names none (social waits, available, for the founder to put on)", async () => {
    const { caller, businessId } = await commitOn(STAGING, "new-staging@test.local", "Groom Staging");
    const listed = await caller.distribution.channels.list({ businessId });
    expect(listed.channels).toHaveLength(15);
    expect(listed.availability.social).toMatchObject({ available: true, reason: "by_tap" });
    expect(listed.channels.filter((c) => c.enabled)).toEqual([]);
    expect(listed.channels.filter((c) => c.recommended)).toEqual([]);
    expect((await repos.channels.list(hz.db, businessId)).some((c) => c.enabled || c.recommended)).toBe(false);
    expect((await caller.idea.preview({ archetype: "b2b_saas" })).defaultChannels).toEqual([]);
  });

  it("committed in test starts with the archetype's starters, as before", async () => {
    const { caller, businessId } = await commitOn({}, "new-test@test.local", "Groom Test");
    const starters = getArchetypeSeed("b2b_saas").defaultChannels;
    const listed = await caller.distribution.channels.list({ businessId });
    expect(listed.channels.filter((c) => c.enabled).map((c) => c.channelKey).sort()).toEqual([...starters].sort());
    expect(listed.channels.filter((c) => c.recommended).map((c) => c.channelKey).sort()).toEqual([...starters].sort());
    expect((await caller.idea.preview({ archetype: "b2b_saas" })).defaultChannels).toEqual(starters);
  });

  it("starting distribution on staging with nothing able to run is a handled state: no engine, no scoring task, a note that says what opens first", async () => {
    const { caller, businessId } = await commitOn(STAGING, "start-staging@test.local", "Groom Start");
    const starts = temporal.starts.length;
    const started = await caller.business.startDistribution({ businessId });
    expect(started.started).toBe(true);
    expect(started.engines).toEqual([]);
    expect(started.scoringTaskId).toBeNull();
    expect(temporal.starts.filter((s) => s.type === "channelEngine").length).toBe(temporal.starts.slice(0, starts).filter((s) => s.type === "channelEngine").length);
    const note = started.followUpId ? await repos.inbox.get(hz.db, businessId, started.followUpId) : null;
    expect(note?.bodyMd).toContain("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project.");
    expect(note?.bodyMd).not.toMatch(/scores the|engines start/);
    // Two of this archetype's three routes need channels that cannot run, and one option is not a choice: the Board asks
    // nothing (never a one-option question, never a crash), and the note does not promise it.
    expect(started.boardItemId).toBeNull();
    expect(note?.bodyMd).not.toMatch(/Board asks/);
    // A second start changes nothing.
    expect((await caller.business.startDistribution({ businessId })).started).toBe(false);
  });

  it("an archetype whose routes need no channel still gets the Board's question on staging, whole", async () => {
    const userId = await hz.h.createUser("services-staging@test.local");
    const setup = hz.caller({ userId, email: "services-staging@test.local" });
    await setup.founder.profile.update({ confirmAdult: true, displayName: "Sam", timeCommitment: "full_time", residence: "United States", experience: "first-time", skills: { engineering: 10, sales: 10 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const idea = (await setup.idea.generate({ prompt: "bookkeeping for dog groomers, done for them" })).ideas[0]!;
    const caller = callerWith(STAGING, { userId, email: "services-staging@test.local" });
    const { business } = await caller.idea.commit({ ideaId: idea.id, name: "Groom Books", archetype: "services", gameMode: "personal" });
    const started = await caller.business.startDistribution({ businessId: business.id });
    expect(started.boardItemId).not.toBeNull();
    const board = await repos.inbox.get(hz.db, business.id, started.boardItemId!);
    const options = (board.decision as { options: { id: string; recommended?: boolean; actions?: { type: string; params?: Record<string, unknown> }[] }[] }).options;
    expect(options.map((o) => o.id)).toEqual(getArchetypeSeed("services").boardDecision.options.map((o) => o.id));
    expect(options.flatMap(optionChannels)).toEqual([]);
    expect(options.filter((o) => o.recommended)).toHaveLength(1);
    expect(board.bodyMd).not.toContain(OPTIONS_LEFT_OUT_LINE);
    const note = await repos.inbox.get(hz.db, business.id, started.followUpId!);
    expect(note.bodyMd).toContain("No channel can run on its own yet.");
    expect(note.bodyMd).toContain("The Board asks which route to the first customer comes first.");
  });
});

describe("what a decision may offer", () => {
  const enable = (channel: ChannelKey) => ({ type: "enable_channel", params: { channel } });
  const options = [
    { id: "outbound", recommended: true, because: "fastest", actions: [enable("lead_generation"), { type: "set_budget", params: { channel: "lead_generation", amount_minor: 100 } }, enable("email_automation")] },
    { id: "inbound", recommended: false, actions: [enable("seo"), { type: "create_task", params: { kind: "channel", channel: "seo", title: "t" } }] },
    { id: "partners", recommended: false, actions: [{ type: "create_task", params: { kind: "ops", title: "t" } }] },
  ];

  it("reads the channels an option turns on, funds or gives work to", () => {
    expect(optionChannels(options[0]!)).toEqual(["lead_generation", "email_automation"]);
    expect(optionChannels(options[2]!)).toEqual([]);
    expect(optionChannels({ actions: [{ type: "disable_channel", params: { channel: "seo" } }] })).toEqual([]);
  });

  it("leaves out an option that needs a channel that cannot run, and keeps exactly one recommended", () => {
    const all = offerableOptions(options, () => true);
    expect(all).toEqual({ options, dropped: 0 });
    const seoOnly = offerableOptions(options, (c) => c === "seo");
    expect(seoOnly.options.map((o) => o.id)).toEqual(["inbound", "partners"]);
    expect(seoOnly.dropped).toBe(1);
    expect(seoOnly.options.map((o) => o.recommended)).toEqual([true, false]);
    const none = offerableOptions(options, () => false);
    expect(none.options.map((o) => o.id)).toEqual(["partners"]);
    expect(none.options[0]!.recommended).toBe(true);
    expect(offerableOptions(options.slice(0, 2), () => false)).toEqual({ options: [], dropped: 2 });
  });

  it("the scoring task names the channels the starters may come from", () => {
    const task = scoringTaskFor(["seo", "geo"]);
    expect(task.title).toBe("Score the channels and pick which to start with");
    expect(task.goal).toContain("only from those that can run now (SEO, GEO)");
    expect(task.acceptance[1]).toContain("(SEO, GEO)");
  });
});
