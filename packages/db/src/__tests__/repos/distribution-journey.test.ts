/** channels (formation, metrics, suppression), campaigns + assets, journeys (visitors → touches → conversions → journey, journey_daily, milestones). */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { day, NIL, setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("dist");
});
afterAll(() => r?.close());

describe("channels", () => {
  it("upserts the formation, lists by line/enabled, moves and budgets", async () => {
    const rows = await repos.channels.upsertMany(r.db, r.A.businessId, [
      { channelKey: "paid_ads", line: "attack", fit: 16, potential: 72.5, recommended: true, whyMd: "Fast feedback" },
      { channelKey: "seo", line: "defence", fit: 12, recommended: true },
      { channelKey: "content", line: "midfield", fit: 9 },
    ]);
    expect(rows).toHaveLength(3);
    const again = await repos.channels.upsert(r.db, r.A.businessId, { channelKey: "paid_ads", line: "attack", enabled: true, budgetMinor: 50000 });
    expect(again.id).toBe(rows[0]!.id);
    expect(again.fit).toBe(16); // untouched fields keep their value
    expect(Number(again.potential)).toBeCloseTo(72.5);
    const enabled = await repos.channels.list(r.db, r.A.businessId, { enabled: true });
    expect(enabled.map((c) => c.channelKey).sort()).toEqual(["events", "paid_ads"]); // fixture channel + paid_ads
    const moved = await repos.channels.move(r.db, r.A.businessId, again.id, "wings");
    expect(moved.line).toBe("wings");
    await repos.channels.setBudget(r.db, r.A.businessId, again.id, 75000);
    expect((await repos.channels.enabledBudget(r.db, r.A.businessId)).budgetMinor).toBe(75000);
    expect(await repos.channels.getByKey(r.db, r.B.businessId, "paid_ads")).toBeNull();
    await expect(repos.channels.get(r.db, r.B.businessId, again.id)).rejects.toThrow(/not found/);
    await expect(repos.channels.upsert(r.db, r.A.businessId, { channelKey: "paid_ads", line: "attack", fit: 21 })).rejects.toThrow(/Invalid channel/);
  });

  it("daily metrics upsert by day and summarise with CPA over a range", async () => {
    const paid = (await repos.channels.getByKey(r.db, r.A.businessId, "paid_ads"))!;
    await repos.channels.upsertMetrics(r.db, r.A.businessId, [
      { channelId: paid.id, day: "2026-09-01", spendMinor: 10000, leads: 10, signups: 4, customers: 1 },
      { channelId: paid.id, day: "2026-09-02", spendMinor: 20000, leads: 15, signups: 6, customers: 3 },
      { channelId: paid.id, day: "2026-09-02", spendMinor: 30000, leads: 15, signups: 6, customers: 3 }, // replaces the day
      { channelId: r.A.channelId, day: "2026-09-02", spendMinor: 5000, customers: 0 },
      { channelId: paid.id, campaignId: r.A.campaignId, day: "2026-09-02", spendMinor: 1000, customers: 1 },
    ]);
    const range = await repos.channels.metricsRange(r.db, r.A.businessId, { channelId: paid.id, from: "2026-09-01", to: "2026-09-30" });
    expect(range).toHaveLength(3);
    expect(range.find((m) => m.day === "2026-09-02" && m.campaignId === null)?.spendMinor).toBe(30000);
    expect(range.find((m) => m.day === "2026-09-02" && m.campaignId === null)?.cpaMinor).toBe(10000);
    const summary = await repos.channels.metricsSummary(r.db, r.A.businessId, { from: "2026-09-01", to: "2026-09-30" });
    const paidRow = summary.channels.find((c) => c.channelId === paid.id)!;
    expect(paidRow.spendMinor).toBe(41000);
    expect(paidRow.customers).toBe(5);
    expect(paidRow.cpaMinor).toBe(8200);
    expect(summary.channels.find((c) => c.channelId === r.A.channelId)?.cpaMinor).toBeNull();
    expect(summary.blended.spendMinor).toBe(46000);
    expect(summary.blended.cpaMinor).toBe(9200);
    const outOfRange = await repos.channels.metricsSummary(r.db, r.A.businessId, { from: "2026-10-01" });
    expect(outOfRange.channels).toHaveLength(0);
    await expect(repos.channels.upsertMetric(r.db, r.B.businessId, { channelId: paid.id, day: "2026-09-01" })).rejects.toThrow(/not found/);
  });

  it("suppression list covers business and platform scope", async () => {
    const hash = "a".repeat(64);
    await repos.channels.addSuppression(r.db, r.A.businessId, { emailHash: hash, reason: "unsubscribed" });
    await repos.channels.addSuppression(r.db, r.A.businessId, { phoneHash: "b".repeat(64), reason: "complaint", scope: "platform" });
    expect(await repos.channels.isSuppressed(r.db, r.A.businessId, { emailHash: hash })).toBe(true);
    expect(await repos.channels.isSuppressed(r.db, r.B.businessId, { emailHash: hash })).toBe(false);
    expect(await repos.channels.isSuppressed(r.db, r.B.businessId, { phoneHash: "b".repeat(64) })).toBe(true);
    expect(await repos.channels.isSuppressed(r.db, r.A.businessId, {})).toBe(false);
    expect((await repos.channels.listSuppression(r.db, r.B.businessId, { includePlatform: true })).length).toBe(1);
    await expect(repos.channels.addSuppression(r.db, r.A.businessId, { reason: "none" })).rejects.toThrow(/Invalid suppression/);
  });
});

describe("campaigns and assets", () => {
  it("creates, transitions and lists campaigns; approves assets", async () => {
    const c = await repos.campaigns.create(r.db, r.A.businessId, { channelId: r.A.channelId, name: "Autumn launch", budgetMinor: 20000, startsAt: day("2026-10-01"), endsAt: day("2026-10-31") });
    expect(c.status).toBe("draft");
    await expect(repos.campaigns.create(r.db, r.A.businessId, { channelId: r.B.channelId, name: "Sneaky" })).rejects.toThrow(/not a channel of this business/);
    await expect(repos.campaigns.create(r.db, r.A.businessId, { channelId: r.A.channelId, name: "Bad dates", startsAt: day("2026-10-31"), endsAt: day("2026-10-01") })).rejects.toThrow(/before startsAt/);
    await expect(repos.campaigns.setStatus(r.db, r.A.businessId, c.id, "paused")).rejects.toThrow(/cannot move/);
    await repos.campaigns.setStatus(r.db, r.A.businessId, c.id, "pending_approval");
    const live = await repos.campaigns.setStatus(r.db, r.A.businessId, c.id, "live");
    expect(live.status).toBe("live");
    expect((await repos.campaigns.active(r.db, r.A.businessId)).map((x) => x.id)).toContain(c.id);
    expect((await repos.campaigns.budgetByChannel(r.db, r.A.businessId))[r.A.channelId]).toBe(20000);
    const page = await repos.campaigns.list(r.db, r.A.businessId, { status: ["live"], channelId: r.A.channelId });
    expect(page.items.map((x) => x.id).sort()).toEqual([c.id, r.A.campaignId].sort());

    const asset = await repos.campaigns.createAsset(r.db, r.A.businessId, { campaignId: c.id, kind: "email", title: "Launch email", approvalState: "pending", authoredByAgentId: r.A.agentId });
    expect(await repos.campaigns.countPendingAssets(r.db, r.A.businessId)).toBe(1);
    const approved = await repos.campaigns.setAssetApproval(r.db, r.A.businessId, asset.id, "approved");
    expect(approved.approvalState).toBe("approved");
    expect((await repos.campaigns.listAssets(r.db, r.A.businessId, { approvalState: "approved" })).map((a) => a.id)).toEqual([asset.id]);
    await expect(repos.campaigns.createAsset(r.db, r.B.businessId, { campaignId: c.id, kind: "post" })).rejects.toThrow(/not found/);
    const ended = await repos.campaigns.setStatus(r.db, r.A.businessId, c.id, "ended");
    expect(ended.endsAt).toBeInstanceOf(Date);
  });
});

describe("journeys", () => {
  let visitorId: string;
  let conversionId: string;
  let journeyId: string;

  it("visitors are upserted by anon id and stitched to an entity", async () => {
    const v1 = await repos.journeys.upsertVisitor(r.db, r.A.businessId, { anonId: "anon-1", seenAt: day("2026-09-01") });
    const v2 = await repos.journeys.upsertVisitor(r.db, r.A.businessId, { anonId: "anon-1", seenAt: day("2026-09-03"), consentState: "granted" });
    expect(v2.id).toBe(v1.id);
    expect(v2.lastSeen.toISOString()).toBe(day("2026-09-03").toISOString());
    expect(v2.consentState).toBe("granted");
    visitorId = v1.id;
    await repos.journeys.recordTouches(r.db, r.A.businessId, [
      { visitorId, occurredAt: day("2026-09-01"), channelKey: "seo", source: { referrer: "google" } },
      { visitorId, occurredAt: day("2026-09-02"), channelKey: "paid_ads", source: { gclid: "x" } },
    ]);
    await expect(repos.journeys.identifyVisitor(r.db, r.A.businessId, visitorId, r.B.entityId)).rejects.toThrow(/not an entity of this business/);
    await repos.journeys.identifyVisitor(r.db, r.A.businessId, visitorId, r.A.entity2Id);
    const path = await repos.journeys.pathForEntity(r.db, r.A.businessId, r.A.entity2Id);
    expect(path.map((t) => t.channelKey)).toEqual(["seo", "paid_ads"]);
    expect(path.every((t) => t.entityId === r.A.entity2Id)).toBe(true);
  });

  it("conversions are recorded, counted and ranked; journeys are built once per conversion", async () => {
    await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: r.A.entity2Id, kind: "signup", occurredAt: day("2026-09-02") });
    const payment = await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: r.A.entity2Id, kind: "payment", amountMinor: 9900, occurredAt: day("2026-09-03"), sourceEventId: r.A.eventIds[5] });
    conversionId = payment.id;
    const counts = await repos.journeys.countConversions(r.db, r.A.businessId);
    expect(counts.payment).toBe(3); // 2 from the fixture + this one
    // The fixture's payments happened "now"; this one is dated 2026-09-03, so it is the first payment by time.
    expect(await repos.journeys.nthOfKind(r.db, r.A.businessId, payment.id)).toBe(1);
    // The two fixture payments share one insert timestamp, so their order is decided by id: together they are 2nd and 3rd.
    const fixtureRanks = [await repos.journeys.nthOfKind(r.db, r.A.businessId, r.A.conversionIds[2]!), await repos.journeys.nthOfKind(r.db, r.A.businessId, r.A.conversionIds[5]!)];
    expect(fixtureRanks.sort()).toEqual([2, 3]);
    expect(await repos.journeys.paymentPercentile75(r.db, r.A.businessId)).toBeGreaterThan(0);
    const inRange = await repos.journeys.listConversions(r.db, r.A.businessId, { kind: "payment", from: day("2026-09-01"), to: day("2026-09-30") });
    expect(inRange.items.map((c) => c.id)).toEqual([payment.id]);

    const touches = await repos.journeys.pathForEntity(r.db, r.A.businessId, r.A.entity2Id);
    const j = await repos.journeys.create(r.db, r.A.businessId, { conversionId: payment.id, touchIds: touches.map((t) => t.id), weights: { seo: 0.4, paid_ads: 0.6 }, matchdayLevel: "league" });
    journeyId = j.id;
    const rebuilt = await repos.journeys.create(r.db, r.A.businessId, { conversionId: payment.id, touchIds: touches.map((t) => t.id), weights: { seo: 0.5, paid_ads: 0.5 }, matchdayLevel: "cup" });
    expect(rebuilt.id).toBe(j.id);
    expect(rebuilt.matchdayLevel).toBe("cup");
    await expect(repos.journeys.create(r.db, r.B.businessId, { conversionId: payment.id, matchdayLevel: "friendly" })).rejects.toThrow(/not found/);
    await expect(repos.journeys.create(r.db, r.A.businessId, { conversionId: r.A.conversionIds[0]!, touchIds: [touches[0]!.id, r.B.visitorId], matchdayLevel: "friendly" })).rejects.toThrow(/touches of this business/);
  });

  it("paying customers count distinct paying entities in the window, not payments or new customers", async () => {
    const june = { from: day("2026-06-01"), to: day("2026-07-01") };
    expect(await repos.journeys.countPayingCustomers(r.db, r.A.businessId, june)).toBe(0);
    // One customer paying three months running is one paying customer; a payment without a linked entity counts once.
    for (const d of ["2026-06-02", "2026-06-12", "2026-06-22"]) await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: r.A.entity2Id, kind: "payment", amountMinor: 4900, occurredAt: day(d) });
    await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: r.A.entityId, kind: "payment", amountMinor: 4900, occurredAt: day("2026-06-05") });
    await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: day("2026-06-06") });
    await repos.journeys.recordConversion(r.db, r.A.businessId, { entityId: r.A.entityId, kind: "signup", occurredAt: day("2026-06-07") });
    expect(await repos.journeys.countPayingCustomers(r.db, r.A.businessId, june)).toBe(3);
    expect(await repos.journeys.countPayingCustomers(r.db, r.B.businessId, june)).toBe(0);
  });

  it("get/list/markViewed/commentary", async () => {
    const detail = await repos.journeys.get(r.db, r.A.businessId, journeyId);
    expect(detail.conversion.amountMinor).toBe(9900);
    expect(detail.touches).toHaveLength(2);
    expect(detail.entity?.id).toBe(r.A.entity2Id);
    const list = await repos.journeys.list(r.db, r.A.businessId, { kind: "payment", unviewedOnly: true });
    expect(list.items.map((j) => j.id)).toEqual([journeyId]);
    expect(await repos.journeys.countUnviewed(r.db, r.A.businessId)).toBe(1);
    const viewed = await repos.journeys.markViewed(r.db, r.A.businessId, journeyId);
    expect(viewed.viewedAt).toBeInstanceOf(Date);
    expect((await repos.journeys.markViewed(r.db, r.A.businessId, journeyId)).viewedAt?.getTime()).toBe(viewed.viewedAt?.getTime());
    await repos.journeys.setCommentary(r.db, r.A.businessId, journeyId, [{ minute: 1, text: "Kick-off" }]);
    expect((await repos.journeys.get(r.db, r.A.businessId, journeyId)).commentary).toHaveLength(1);
    expect((await r.svc((tx) => repos.journeys.list(tx, r.B.businessId))).items.map((j) => j.id)).not.toContain(journeyId);
    expect((await repos.journeys.forConversion(r.db, r.A.businessId, conversionId))?.id).toBe(journeyId);
  });

  it("dailyRange reads journey_daily (matview for the service role, barrier view for members)", async () => {
    await repos.journeys.refreshDaily(r.db);
    const svcRows = await r.svc((tx) => repos.journeys.dailyRange(tx, r.A.businessId, { from: "2026-09-01", to: "2026-09-30" }));
    const sept3 = svcRows.find((x) => x.day === "2026-09-03" && x.departmentId === NIL);
    expect(sept3?.payments).toBe(1);
    expect(Number(sept3?.revenueMinor)).toBe(9900);
    expect(svcRows.every((x) => x.businessId === r.A.businessId)).toBe(true);
    const memberRows = await r.as(r.A.memberId, (tx) => repos.journeys.dailyRange(tx, r.A.businessId, { from: "2026-09-01", to: "2026-09-30" }));
    expect(memberRows.map((x) => `${x.day}:${x.departmentId}`).sort()).toEqual(svcRows.map((x) => `${x.day}:${x.departmentId}`).sort());
    expect(await r.as(r.A.memberId, (tx) => repos.journeys.dailyRange(tx, r.B.businessId))).toHaveLength(0);
    const totals = await repos.journeys.dailyTotals(r.db, r.A.businessId, { from: "2026-09-01", to: "2026-09-30" });
    expect(totals.find((t) => t.day === "2026-09-03")?.payments).toBe(1);
    // The service role really reads the matview (membership-free), not the barrier view.
    const viaView = await r.svc((tx) => tx.execute(sql`select count(*)::int as n from journey_daily where business_id = ${r.A.businessId}::uuid`));
    expect(Number((viaView as unknown as { rows: { n: number }[] }).rows[0]?.n)).toBe(0);
  });

  it("milestones", async () => {
    await repos.journeys.createMilestone(r.db, r.A.businessId, { kind: "customer", label: "First customer", achievedAt: day("2026-09-03"), ref: { conversionId } });
    await repos.journeys.createMilestone(r.db, r.A.businessId, { kind: "launch", label: "Site live", achievedAt: day("2026-08-01") });
    const all = await repos.journeys.listMilestones(r.db, r.A.businessId);
    expect(all.map((m) => m.kind)).toEqual(["customer", "launch"]);
    expect(await repos.journeys.listMilestones(r.db, r.A.businessId, { kind: "launch", from: day("2026-09-01") })).toHaveLength(0);
    expect(await repos.journeys.listMilestones(r.db, r.B.businessId)).toHaveLength(0);
  });
});
