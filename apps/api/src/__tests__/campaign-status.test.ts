/**
 * distribution.campaigns.setStatus: a first launch needs an approved asset (whatever path asks: row action, detail
 * button, API), a resume is neither checked nor announced as a launch, and a campaign paused while scheduled resumes
 * scheduled.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

describe("distribution.campaigns.setStatus", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "campaign-status" });
  }, 120_000);
  afterAll(() => hz.close());

  const launches = async (campaignId: string) => (await repos.events.list(hz.db, hz.A.businessId, { type: "campaign.launched", limit: 100 })).items.filter((e) => (e.payload as { campaignId: string }).campaignId === campaignId);

  it("refuses a first launch without an approved asset and launches (once) with one", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId, channelId } = hz.A;
    const c = await owner.distribution.campaigns.create({ businessId, channelId, name: "Guarded launch", budgetMinor: 5000 });
    await owner.distribution.campaigns.setStatus({ businessId, campaignId: c.id, status: "scheduled" });
    // No assets at all, then only a pending one: both refused, with the reason, and nothing changed.
    await expect(owner.distribution.campaigns.setStatus({ businessId, campaignId: c.id, status: "live" })).rejects.toThrow(/at least one approved asset/);
    const asset = await repos.campaigns.createAsset(hz.db, businessId, { campaignId: c.id, kind: "post", title: "Launch post", approvalState: "pending", authoredByAgentId: hz.A.agentId });
    await expect(owner.distribution.campaigns.setStatus({ businessId, campaignId: c.id, status: "live" })).rejects.toThrow(/at least one approved asset/);
    expect((await repos.campaigns.get(hz.db, businessId, c.id)).status).toBe("scheduled");
    expect(await launches(c.id)).toHaveLength(0);

    await repos.campaigns.setAssetApproval(hz.db, businessId, asset.id, "approved");
    expect((await owner.distribution.campaigns.setStatus({ businessId, campaignId: c.id, status: "live" })).status).toBe("live");
    const events = await launches(c.id);
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { assetIds: string[] }).assetIds).toEqual([asset.id]);
  });

  it("pause then resume is not a launch: no new campaign.launched, no asset check, and a scheduled campaign stays scheduled", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId, channelId } = hz.A;
    const c = await owner.distribution.campaigns.create({ businessId, channelId, name: "Pause and resume" });
    const asset = await repos.campaigns.createAsset(hz.db, businessId, { campaignId: c.id, kind: "post", title: "Post", approvalState: "approved", authoredByAgentId: hz.A.agentId });
    const set = (status: "scheduled" | "live" | "paused") => owner.distribution.campaigns.setStatus({ businessId, campaignId: c.id, status });

    // Paused while scheduled: resuming goes back to scheduled (it never went live), and nothing is announced.
    await set("scheduled");
    await set("paused");
    expect((await set("scheduled")).status).toBe("scheduled");
    expect(await launches(c.id)).toHaveLength(0);

    await set("live");
    expect(await launches(c.id)).toHaveLength(1);
    // The asset is withdrawn after the launch: resuming does not ask for one again, and announces nothing.
    await repos.campaigns.setAssetApproval(hz.db, businessId, asset.id, "rejected");
    await set("paused");
    expect((await set("live")).status).toBe("live");
    await set("paused");
    await set("live");
    expect(await launches(c.id)).toHaveLength(1);
    // Another business's member cannot touch it.
    await expect(hz.caller({ userId: hz.B.ownerId }).distribution.campaigns.setStatus({ businessId: hz.B.businessId, campaignId: c.id, status: "ended" })).rejects.toThrow();
  });
});
