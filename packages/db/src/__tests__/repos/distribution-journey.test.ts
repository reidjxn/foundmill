/** channels (formation, metrics, suppression), campaigns + assets, journeys (visitors → touches → conversions → journey, journey_daily, milestones). */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import * as s from "../../schema";
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

  it("paying customers are everyone who had paid by the window's end and had not churned before it, not the new ones", async () => {
    const june = { from: day("2026-06-01"), to: day("2026-07-01") };
    const b = r.A.businessId;
    expect(await repos.journeys.countPayingCustomers(r.db, b, june)).toBe(0);
    const customer = async (name: string, paidOn: string, role?: { stage: string; startedAt?: string; endedAt?: string; updatedAt?: string }) => {
      const entity = await repos.entities.create(r.db, b, { kind: "person", displayName: name });
      await repos.journeys.recordConversion(r.db, b, { entityId: entity.id, kind: "payment", amountMinor: 4900, occurredAt: day(paidOn) });
      if (role) await r.db.insert(s.entityRoles).values({ businessId: b, entityId: entity.id, role: "customer", stage: role.stage, startedAt: day(role.startedAt ?? paidOn), endedAt: role.endedAt ? day(role.endedAt) : null, ...(role.updatedAt ? { updatedAt: day(role.updatedAt) } : {}) });
      return entity.id;
    };
    // Won before the window and still paying: part of the base although they pay no new conversion in June (a
    // conversion is the win; renewals are not conversions everywhere).
    await customer("Since January", "2026-01-15", { stage: "customer" });
    await customer("No CRM role", "2026-02-10");
    // Churned before the window: out. Churned during it: still in (they paid for part of it).
    await customer("Ended in March", "2026-01-20", { stage: "churned", endedAt: "2026-03-01" });
    await customer("Marked churned in April", "2026-01-25", { stage: "churned", updatedAt: "2026-04-01" });
    await customer("Ended mid-June", "2026-02-01", { stage: "churned", endedAt: "2026-06-15" });
    const back = await customer("Churned, then back", "2026-01-05", { stage: "churned", endedAt: "2026-02-01" });
    await repos.entities.addRole(r.db, b, back, { role: "customer", stage: "customer", startedAt: day("2026-05-01") });
    // Churned, came back in April and left again mid-June: a customer for part of the window, so still in.
    const backAndGone = await customer("Back in April, gone mid-June", "2026-01-08", { stage: "churned", endedAt: "2026-02-01" });
    await r.db.insert(s.entityRoles).values({ businessId: b, entityId: backAndGone, role: "customer", stage: "churned", startedAt: day("2026-04-01"), endedAt: day("2026-06-15") });
    // The CRM says churned before the window, but they paid again in June: paying, so in.
    const paidAgain = await customer("Ended in March, paid in June", "2026-01-12", { stage: "churned", endedAt: "2026-03-01" });
    await repos.journeys.recordConversion(r.db, b, { entityId: paidAgain, kind: "payment", amountMinor: 4900, occurredAt: day("2026-06-09") });
    // An open customer role with no stage recorded is a customer.
    await r.db.insert(s.entityRoles).values({ businessId: b, entityId: await customer("Open role, no stage", "2026-02-20"), role: "customer", stage: null, startedAt: day("2026-02-20") });
    // Won in June, paying three times: one customer. A June payment with no linked customer counts once; one from May
    // without a customer cannot be told apart from a repeat, so it stays out. July is after the window.
    const fresh = await customer("Won in June", "2026-06-02", { stage: "customer" });
    for (const d of ["2026-06-12", "2026-06-22"]) await repos.journeys.recordConversion(r.db, b, { entityId: fresh, kind: "payment", amountMinor: 4900, occurredAt: day(d) });
    await repos.journeys.recordConversion(r.db, b, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: day("2026-06-06") });
    await repos.journeys.recordConversion(r.db, b, { entityId: null, kind: "payment", amountMinor: 4900, occurredAt: day("2026-05-06") });
    await customer("Won in July", "2026-07-03", { stage: "customer" });
    await repos.journeys.recordConversion(r.db, b, { entityId: r.A.entityId, kind: "signup", occurredAt: day("2026-06-07") });
    // Since January, No CRM role, Ended mid-June, Churned then back, Back in April and gone mid-June, Ended in March and
    // paid in June, Open role with no stage, Won in June, the June payment without a customer.
    expect(await repos.journeys.countPayingCustomers(r.db, b, june)).toBe(9);
    expect(await repos.journeys.countPayingCustomers(r.db, r.B.businessId, june)).toBe(0);
    // Under RLS a stranger counts nobody in A.
    expect(await r.as(r.B.ownerId, (tx) => repos.journeys.countPayingCustomers(tx, b, june))).toBe(0);
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

describe("first payments (0034)", () => {
  it("a repeat payment is revenue only: counts, nth of a kind, p75 and journey_daily count customers from first payments", async () => {
    const b = r.B.businessId;
    const before = await repos.journeys.countConversions(r.db, b);
    const first = await repos.journeys.recordConversion(r.db, b, { entityId: r.B.entityId, kind: "payment", amountMinor: 5_000, occurredAt: day("2026-08-01") });
    expect(first.firstPayment).toBe(true);
    expect(await repos.journeys.hasPaidBefore(r.db, b, r.B.entityId, day("2026-08-01"))).toBe(false);
    expect(await repos.journeys.hasPaidBefore(r.db, b, r.B.entityId, day("2026-08-02"))).toBe(true);
    const renewal = await repos.journeys.recordConversion(r.db, b, { entityId: r.B.entityId, kind: "payment", amountMinor: 900_000, occurredAt: day("2026-08-15"), firstPayment: false });
    const second = await repos.journeys.recordConversion(r.db, b, { entityId: r.B.entity2Id, kind: "payment", amountMinor: 7_000, occurredAt: day("2026-08-20") });
    // firstPayment only means something for payments: a signup is always counted.
    const signup = await repos.journeys.recordConversion(r.db, b, { kind: "signup", occurredAt: day("2026-08-20"), firstPayment: false });
    expect(signup.firstPayment).toBe(true);

    expect(await repos.journeys.countConversions(r.db, b)).toEqual({ ...before, payment: before.payment + 2, signup: before.signup + 1 });
    expect(await repos.journeys.nthOfKind(r.db, b, second.id)).toBe(2); // not 3: the renewal is not a customer
    expect(await repos.journeys.paymentPercentile75(r.db, b)).toBeLessThan(900_000);
    expect((await repos.journeys.listConversions(r.db, b, { kind: "payment", firstPayment: false })).items.map((c) => c.id)).toEqual([renewal.id]);
    expect((await repos.journeys.listConversions(r.db, b, { kind: "payment", firstPayment: true, from: day("2026-08-01"), to: day("2026-08-31") })).items.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());

    await repos.journeys.refreshDaily(r.db);
    const [aug15] = await repos.journeys.dailyTotals(r.db, b, { from: "2026-08-15", to: "2026-08-15" });
    expect(aug15).toMatchObject({ payments: 0 });
    expect(Number(aug15!.revenueMinor)).toBe(900_000);
  });

  it("journeys store the models the builder used; entities can be created at a caller-chosen id", async () => {
    const conversion = await repos.journeys.recordConversion(r.db, r.B.businessId, { kind: "activation", occurredAt: day("2026-08-21") });
    const j = await repos.journeys.create(r.db, r.B.businessId, { conversionId: conversion.id, matchdayLevel: "league", attributionModel: "data_driven_markov", xcModelSource: "trained" });
    expect(j).toMatchObject({ attributionModel: "data_driven_markov", xcModelSource: "trained" });
    const plain = await repos.journeys.create(r.db, r.B.businessId, { conversionId: conversion.id, matchdayLevel: "league" });
    expect(plain).toMatchObject({ id: j.id, attributionModel: null, xcModelSource: null });
    await expect(repos.journeys.create(r.db, r.B.businessId, { conversionId: conversion.id, matchdayLevel: "league", attributionModel: "guesswork" as never })).rejects.toThrow();

    const id = "5b1c0d6e-7f80-5a91-8b2c-3d4e5f607182";
    const person = await repos.entities.create(r.db, r.B.businessId, { id, kind: "person", displayName: "Chosen Id" });
    expect(person.id).toBe(id);
    await expect(repos.entities.create(r.db, r.A.businessId, { id, kind: "person", displayName: "Same id elsewhere" })).rejects.toThrow();
  });

  it("trainingPaths groups recent touches per visitor and marks the groups whose person converted", async () => {
    const paths = await repos.journeys.trainingPaths(r.db, r.A.businessId, { since: day("2026-08-01") });
    const stitched = paths.find((p) => p.touches.some((t) => t.channelKey === "seo"));
    expect(stitched?.converted).toBe(true); // entity2 signed up and paid in "conversions are recorded…"
    expect(stitched!.touches.map((t) => t.channelKey)).toEqual(["seo", "paid_ads"]);
    expect(await repos.journeys.trainingPaths(r.db, r.A.businessId, { since: day("2026-12-01") })).toEqual([]);
    expect((await repos.journeys.trainingPaths(r.db, r.B.businessId)).flatMap((p) => p.touches).every((t) => t.businessId === r.B.businessId)).toBe(true);
  });
});
