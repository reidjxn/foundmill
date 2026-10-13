/**
 * Distribution scores and campaigns (BUILD §11.7): a committed business starts with every channel unscored; the
 * Strategist's re-score writes only scores (the founder's Board line and offline tracking stay) with sane cost ranges;
 * campaigns are born as drafts in their channel's currency, dates are checked on edit, nothing launches on a channel
 * that is off the board, and taking a channel off the board ends its campaigns.
 */
import { repos } from "@foundmill/db";
import { CHANNEL_KEYS } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CPA_RANGE_MAX_MINOR, normaliseRecommendation } from "../routers/distribution";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "distribution" });
}, 120_000);
afterAll(() => hz.close());

const owner = () => hz.caller({ userId: hz.A.ownerId });

describe("distribution scores", () => {
  it("a new business's channels are unscored until the Strategist scores them (audit #162)", async () => {
    const userId = await hz.h.createUser("scores@test.local");
    const caller = hz.caller({ userId, email: "scores@test.local" });
    await caller.founder.profile.update({ displayName: "Sam", experience: "first-time", skills: { engineering: 10, sales: 10 }, targetMarkets: ["EU"], riskAppetite: "medium" });
    const idea = (await caller.idea.generate({ prompt: "booking software for dog groomers" })).ideas[0]!;
    const { business } = await caller.idea.commit({ ideaId: idea.id, name: "Groom Ledger", archetype: "b2b_saas", gameMode: "personal" });
    const before = await caller.distribution.channels.list({ businessId: business.id });
    expect(before.channels).toHaveLength(CHANNEL_KEYS.length);
    expect(before.channels.every((c) => c.scoredAt === null)).toBe(true);

    await caller.distribution.recommend({ businessId: business.id });
    const after = await caller.distribution.channels.list({ businessId: business.id });
    expect(after.channels.filter((c) => c.scoredAt !== null).length).toBeGreaterThan(0);
    for (const c of after.channels.filter((x) => x.scoredAt !== null)) expect(c.whyMd.length).toBeGreaterThan(0);
  });

  it("a re-score keeps the founder's Board line and offline tracking, and every cost range is low ≤ high within bounds (audit #338, #339)", async () => {
    const businessId = hz.A.businessId;
    await owner().distribution.recommend({ businessId });
    const listed = await owner().distribution.channels.list({ businessId });
    const seo = listed.channels.find((c) => c.channelKey === "seo")!;
    const outdoor = listed.channels.find((c) => c.channelKey === "outdoor")!;
    await owner().distribution.channels.move({ businessId, channelId: seo.id, line: "attack" });
    await repos.channels.setKitMode(hz.db, businessId, outdoor.id, true);
    await repos.channels.setBudget(hz.db, businessId, seo.id, 123_400);

    const again = await owner().distribution.recommend({ businessId });
    const rows = await owner().distribution.channels.list({ businessId });
    expect(rows.channels.find((c) => c.channelKey === "seo")).toMatchObject({ line: "attack", budgetMinor: 123_400 });
    expect(rows.channels.find((c) => c.channelKey === "outdoor")?.kitMode).toBe(true);
    for (const r of again.recommendation) {
      if (r.cpa_range_minor === null) continue;
      expect(r.cpa_range_minor.low).toBeLessThanOrEqual(r.cpa_range_minor.high);
      expect(r.cpa_range_minor.high).toBeGreaterThan(0);
      expect(r.cpa_range_minor.high).toBeLessThanOrEqual(CPA_RANGE_MAX_MINOR);
    }
    const starters = rows.channels.filter((c) => c.recommended).length;
    expect(starters).toBeGreaterThanOrEqual(3);
    expect(starters).toBeLessThanOrEqual(6);
  });

  it("normalises the Strategist's answer: inverted ranges swap, empty ranges are null, unscored channels are left out", () => {
    const row = (channel: (typeof CHANNEL_KEYS)[number], fit: number, low: number, high: number, recommended = false) => ({ channel, fit, potential: 3, recommended, cpa_range_minor: { low, high }, why: `${channel} why` });
    const out = normaliseRecommendation({ channels: [row("seo", 15, 9_000, 3_000), row("pr", 12, 0, 0), row("seo", 16, 2_000, 4_000), row("geo", 9, 100, 200), ...Array.from({ length: 11 }, () => row("print", 2, 50, 60))] });
    expect(out.map((r) => r.channel)).toEqual(["seo", "geo", "print", "pr"].sort((a, b) => CHANNEL_KEYS.indexOf(a as never) - CHANNEL_KEYS.indexOf(b as never)));
    expect(out.find((r) => r.channel === "seo")).toMatchObject({ fit: 16, cpa_range_minor: { low: 2_000, high: 4_000 } });
    expect(out.find((r) => r.channel === "pr")?.cpa_range_minor).toBeNull();
    expect(normaliseRecommendation({ channels: [row("geo", 9, 700, 300), ...Array.from({ length: 14 }, () => row("geo", 9, 700, 300))] })[0]?.cpa_range_minor).toEqual({ low: 300, high: 700 });
    // 3 to 6 starters among the scored channels only.
    expect(out.filter((r) => r.recommended).length).toBe(3);
  });
});

describe("distribution campaigns", () => {
  it("creates drafts only, in the channel's currency, checks dates on edit and launches nothing off the board (audit #345)", async () => {
    const businessId = hz.A.businessId;
    const channel = await repos.channels.upsert(hz.db, businessId, { channelKey: "affiliate", line: "attack", enabled: false, currency: "GBP" });
    const created = await owner().distribution.campaigns.create({ businessId, channelId: channel.id, name: "Spring partners", budgetMinor: 5_000, status: "live" } as never);
    expect(created).toMatchObject({ status: "draft", currency: "GBP" });
    await expect(owner().distribution.campaigns.create({ businessId, channelId: channel.id, name: "Yen", budgetMinor: 999_999, currency: "JPY" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await repos.events.list(hz.db, businessId, { type: "campaign.launched", limit: 50 })).items.filter((e) => (e.payload as { campaignId: string }).campaignId === created.id)).toEqual([]);

    await owner().distribution.campaigns.update({ businessId, campaignId: created.id, patch: { startsAt: "2026-12-01T00:00:00.000Z" } });
    await expect(owner().distribution.campaigns.update({ businessId, campaignId: created.id, patch: { endsAt: "2026-01-01T00:00:00.000Z" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner().distribution.campaigns.update({ businessId, campaignId: created.id, patch: { startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // The currency cannot be switched to a foreign one by an edit either.
    await expect(owner().distribution.campaigns.update({ businessId, campaignId: created.id, patch: { currency: "JPY" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner().distribution.campaigns.update({ businessId, campaignId: created.id, patch: { currency: "GBP", budgetMinor: 6_000 } });

    await expect(owner().distribution.campaigns.setStatus({ businessId, campaignId: created.id, status: "scheduled" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/on the board/) });
    await repos.channels.setEnabled(hz.db, businessId, channel.id, true);
    await owner().distribution.campaigns.setStatus({ businessId, campaignId: created.id, status: "scheduled" });
    // The first launch needs approved creative (audit GTM-12).
    await repos.campaigns.createAsset(hz.db, businessId, { campaignId: created.id, kind: "post", title: "Partner post", approvalState: "approved", authoredByAgentId: hz.A.agentId });
    await owner().distribution.campaigns.setStatus({ businessId, campaignId: created.id, status: "live" });
    expect((await repos.events.list(hz.db, businessId, { type: "campaign.launched", limit: 50 })).items.some((e) => (e.payload as { campaignId: string }).campaignId === created.id)).toBe(true);

    // Off the board is the full stop: the live campaign ends with the channel (audit #164).
    await owner().distribution.channels.disable({ businessId, channelKey: "affiliate" });
    expect((await owner().distribution.campaigns.get({ businessId, campaignId: created.id })).campaign.status).toBe("ended");
  });
});
