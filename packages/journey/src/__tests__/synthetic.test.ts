/**
 * Synthetic journey data (BUILD §17.2, AC-11.2.1): deterministic, 730 days, non-negative, plausible shapes.
 * The full-size run uses b2b_saas (the lightest archetype); the shape checks use shorter windows.
 */
import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "@foundmill/shared";
import { OFFLINE_CHANNELS, parseTouchSource } from "../attribution";
import { buildJourney } from "../builder";
import { rollupDaily, sumDaily } from "../daily";
import { generateSyntheticConversionPath, generateSyntheticJourneyData, syntheticConversionGroups, type GenerateSyntheticJourneyDataOptions } from "../synthetic";
import { isoWeekdayUtc } from "../time";
import { Chapter, Conversion, Journey, JourneyDailyRow, Milestone, Touch } from "../types";
import { fid } from "./fixtures";

const DEPARTMENTS = [
  { id: fid("d", 1), name: "Engineering", moduleKeys: ["development" as const] },
  { id: fid("d", 2), name: "Growth", moduleKeys: ["distribution" as const] },
  { id: fid("d", 3), name: "Office", moduleKeys: ["product" as const, "finance" as const, "legal" as const, "team" as const] },
];

const opts = (over: Partial<GenerateSyntheticJourneyDataOptions> = {}): GenerateSyntheticJourneyDataOptions => ({
  seed: "northwind", startDate: "2024-01-01", days: 730, departments: DEPARTMENTS, archetype: "b2b_saas", kitColour: "#1D4ED8", businessId: fid("b", 1), ...over,
});

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

describe("generateSyntheticJourneyData — two years", () => {
  const data = generateSyntheticJourneyData(opts());
  const business = data.daily.filter((r) => r.departmentId === null);

  it("is deterministic for a seed and different across seeds", () => {
    const again = generateSyntheticJourneyData(opts());
    expect(JSON.stringify(again)).toBe(JSON.stringify(data));
    const other = generateSyntheticJourneyData(opts({ seed: "ledgerly", days: 60 }));
    expect(other.daily[5]).not.toEqual(data.daily[5]);
    expect(other.conversions[0]?.id).not.toBe(data.conversions[0]?.id);
  });

  it("produces 730 days × (departments + business row), every day present, every field non-negative", () => {
    expect(data.meta).toMatchObject({ seed: "northwind", label: "Synthetic", archetype: "b2b_saas", startDate: "2024-01-01", endDate: "2025-12-30", days: 730, currency: "EUR", kitColour: "#1D4ED8", businessId: fid("b", 1), recurring: true });
    expect(data.meta.departmentIds).toEqual(DEPARTMENTS.map((d) => d.id));
    expect(data.daily).toHaveLength(730 * 4);
    expect(business).toHaveLength(730);
    const days = new Set(business.map((r) => r.day));
    expect(days.size).toBe(730);
    expect(business[0]!.day).toBe("2024-01-01");
    expect(business.at(-1)!.day).toBe("2025-12-30");
    for (const r of data.daily) {
      expect(JourneyDailyRow.parse(r)).toEqual(r);
      expect(r.businessId).toBe(fid("b", 1));
      for (const k of ["agentHours", "tasksDone", "spendMinor", "revenueMinor", "signups", "activations", "payments", "decisions"] as const) expect(r[k]).toBeGreaterThanOrEqual(0);
    }
    expect(data.daily.filter((r) => r.departmentId === fid("d", 1))).toHaveLength(730);
    // Agent work lives on department rows; conversions, revenue and channel spend on the business row.
    expect(business.every((r) => r.agentHours === 0 && r.tasksDone === 0)).toBe(true);
    expect(data.daily.filter((r) => r.departmentId !== null).every((r) => r.signups === 0 && r.revenueMinor === 0)).toBe(true);
  });

  it("has plausible totals for a B2B SaaS over two years", () => {
    const t = sumDaily(rollupDaily(data.daily));
    expect(t.days).toBe(730);
    expect(t.signups).toBeGreaterThan(2_000);
    expect(t.signups).toBeLessThan(40_000);
    expect(t.activations).toBeLessThan(t.signups);
    expect(t.activations).toBeGreaterThan(t.signups * 0.3);
    expect(t.payments).toBeLessThan(t.activations);
    expect(t.payments).toBeGreaterThan(300);
    expect(t.revenueMinor).toBeGreaterThan(t.payments * 4_000);
    expect(t.agentHours).toBeGreaterThan(5_000);
    expect(t.agentHours).toBeLessThan(200_000);
    expect(t.tasksDone).toBeGreaterThan(1_000);
    expect(t.spendMinor).toBeGreaterThan(0);
    expect(t.decisions).toBeGreaterThan(50);
    // The daily rows agree with the conversion list.
    expect(t.signups).toBe(data.conversions.filter((c) => c.kind === "signup").length);
    expect(t.activations).toBe(data.conversions.filter((c) => c.kind === "activation").length);
    expect(t.payments).toBe(data.conversions.filter((c) => c.kind === "payment").length);
    expect(data.series.customersByDay.at(-1)).toBe(t.payments);
    expect(data.series.mrrMinorByDay).toHaveLength(730);
    expect(data.series.mrrMinorByDay.every((v) => v >= 0)).toBe(true);
    expect(data.series.mrrMinorByDay.at(-1)!).toBeGreaterThan(data.series.mrrMinorByDay[100]!);
  });

  it("has a weekly rhythm (weekends quieter) and growth (year two busier than year one)", () => {
    const dept = data.daily.filter((r) => r.departmentId === fid("d", 1));
    const weekday = dept.filter((r) => isoWeekdayUtc(r.day) <= 5).map((r) => r.agentHours);
    const weekend = dept.filter((r) => isoWeekdayUtc(r.day) >= 6).map((r) => r.agentHours);
    expect(mean(weekend)).toBeLessThan(mean(weekday) * 0.5);
    const year1 = dept.slice(0, 365).map((r) => r.agentHours);
    const year2 = dept.slice(365).map((r) => r.agentHours);
    expect(mean(year2)).toBeGreaterThan(mean(year1) * 1.2);
    const s1 = business.slice(0, 365).map((r) => r.signups);
    const s2 = business.slice(365).map((r) => r.signups);
    expect(mean(s2)).toBeGreaterThan(mean(s1) * 1.3);
    // Engineering (development module) works more hours than the office departments.
    expect(mean(dept.map((r) => r.agentHours))).toBeGreaterThan(mean(data.daily.filter((r) => r.departmentId === fid("d", 3)).map((r) => r.agentHours)));
  });

  it("ramps up at the start, steps up at the launch and dips mid-way", () => {
    const hours = data.daily.filter((r) => r.departmentId === fid("d", 1)).map((r) => r.agentHours);
    expect(mean(hours.slice(0, 14))).toBeLessThan(mean(hours.slice(120, 134)));
    const signups = business.map((r) => r.signups);
    const launch = Math.round(0.06 * 730);
    expect(mean(signups.slice(launch, launch + 28))).toBeGreaterThan(mean(signups.slice(launch - 28, launch)) * 1.4);
    const dipFrom = Math.round(0.57 * 730);
    const dipTo = Math.round(0.615 * 730);
    const inDip = mean(signups.slice(dipFrom, dipTo + 1));
    const around = mean([...signups.slice(dipFrom - 30, dipFrom), ...signups.slice(dipTo + 1, dipTo + 31)]);
    expect(inDip).toBeLessThan(around * 0.8);
    expect(data.milestones.some((m) => m.kind === "launch" && m.label === "Public launch")).toBe(true);
  });

  it("fires the trophies in order and scripts incorporation, launches, decisions, funding and releases", () => {
    for (const m of data.milestones) expect(Milestone.parse(m)).toEqual(m);
    const trophies = data.milestones.filter((m) => m.trophyKey).map((m) => m.trophyKey);
    expect(trophies[0]).toBe("customer_1");
    expect(trophies).toContain("customer_1");
    expect(trophies).toContain("customer_10");
    expect(trophies).toContain("customer_100");
    expect(trophies).toContain("mrr_1k");
    expect(trophies).toContain("mrr_10k");
    expect(new Set(trophies).size).toBe(trophies.length);
    const order = (k: string) => data.milestones.findIndex((m) => m.trophyKey === k);
    expect(order("customer_1")).toBeLessThan(order("customer_10"));
    expect(order("customer_10")).toBeLessThan(order("customer_100"));
    expect(order("mrr_1k")).toBeLessThan(order("mrr_10k"));
    const kinds = new Set(data.milestones.map((m) => m.kind));
    for (const k of ["incorporation", "launch", "decision", "funding", "release", "customer", "revenue"]) expect(kinds.has(k as "launch")).toBe(true);
    // The first-customer trophy sits on the first payment.
    const firstPayment = data.conversions.find((c) => c.kind === "payment")!;
    const firstCustomer = data.milestones.find((m) => m.trophyKey === "customer_1")!;
    expect(firstCustomer.achievedAt).toBe(firstPayment.occurredAt);
    expect(firstCustomer.ref).toMatchObject({ conversionId: firstPayment.id, entityId: firstPayment.entityId });
    // Milestones are sorted and inside the window.
    for (let i = 1; i < data.milestones.length; i++) expect(Date.parse(data.milestones[i]!.achievedAt)).toBeGreaterThanOrEqual(Date.parse(data.milestones[i - 1]!.achievedAt));
    expect(data.milestones.every((m) => m.achievedAt >= "2024-01-01" && m.achievedAt < "2025-12-31")).toBe(true);
  });

  it("builds one chapter per quarter with summaries that match the daily rows", () => {
    expect(data.chapters.map((c) => c.id)).toEqual(["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]);
    expect(data.chapters.at(-3)!.status).toBe("current");
    for (const c of data.chapters) expect(Chapter.parse(c)).toEqual(c);
    const q1 = sumDaily(data.daily.filter((r) => r.day < "2024-04-01"));
    expect(data.chapters[0]!.summary).toMatchObject({ signups: q1.signups, payments: q1.payments, revenueMinor: q1.revenueMinor, tasksDone: q1.tasksDone });
    expect(data.chapters[0]!.summary.agentHours).toBeCloseTo(q1.agentHours, 2);
    expect(data.chapters[0]!.summary.milestoneLabels).toContain("Incorporated");
  });

  it("conversions and touches validate, are sorted, and each customer's path precedes its conversions", () => {
    for (const c of data.conversions.slice(0, 500)) expect(Conversion.parse(c)).toEqual(c);
    for (const t of data.touches.slice(0, 2000)) expect(Touch.parse(t)).toEqual(t);
    for (let i = 1; i < data.conversions.length; i++) expect(data.conversions[i]!.occurredAt >= data.conversions[i - 1]!.occurredAt).toBe(true);
    for (let i = 1; i < data.touches.length; i++) expect(Date.parse(data.touches[i]!.occurredAt)).toBeGreaterThanOrEqual(Date.parse(data.touches[i - 1]!.occurredAt));
    const signupAt = new Map(data.conversions.filter((c) => c.kind === "signup").map((c) => [c.entityId!, Date.parse(c.occurredAt)]));
    const visitorToEntity = new Map(data.visitors.filter((v) => v.entityId).map((v) => [v.id, v.entityId!]));
    let anonymous = 0;
    for (const t of data.touches) {
      if (t.entityId) continue;
      const entity = visitorToEntity.get(t.visitorId!);
      if (!entity) continue;
      anonymous += 1;
      expect(Date.parse(t.occurredAt)).toBeLessThanOrEqual(signupAt.get(entity)!);
    }
    expect(anonymous).toBeGreaterThan(1_000);
    expect(data.conversions.every((c) => c.currency === "EUR")).toBe(true);
    expect(data.conversions.filter((c) => c.kind === "payment").every((c) => c.amountMinor > 0)).toBe(true);
    expect(data.conversions.filter((c) => c.kind !== "payment").every((c) => c.amountMinor === 0)).toBe(true);
    // Activation follows signup, payment follows activation, per customer.
    for (const cu of data.customers.slice(0, 500)) {
      if (cu.activatedAt) expect(cu.activatedAt > cu.signupAt).toBe(true);
      if (cu.paidAt) expect(cu.paidAt > cu.activatedAt!).toBe(true);
    }
    expect(data.customers.length).toBe(signupAt.size);
    expect(data.visitors.filter((v) => !v.converted).length).toBeGreaterThan(data.customers.length * 0.3);
  });

  it("touch sources agree with parseTouchSource on the channel (the Attribution tab re-derives them)", () => {
    let agree = 0;
    const sample = data.touches.filter((_, i) => i % 7 === 0);
    for (const t of sample) {
      const p = parseTouchSource({
        url: t.source.landingUrl, referrer: t.source.referrer, utm: t.source.utm, clickIds: t.source.clickIds, code: t.source.code,
        trackingNumber: t.source.codeKind === "tracking_number" ? t.source.offlineKey : null, provider: t.source.provider, registry: data.registry,
      });
      if (p.channelKey === t.channelKey) agree += 1;
    }
    expect(agree / sample.length).toBeGreaterThan(0.98);
  });

  it("names agents per department from the module roles and gives channels to the distribution squad", () => {
    expect(data.agents.filter((a) => a.departmentId === fid("d", 2)).length).toBe(7);
    expect(data.agents.some((a) => a.role === "Chief of Staff" && a.departmentId === fid("d", 3))).toBe(true);
    expect(data.agents.some((a) => a.channelKeys?.includes("email_automation"))).toBe(true);
    const lifecycle = data.agents.find((a) => a.channelKeys?.includes("email_automation"))!;
    expect(data.touches.some((t) => t.source.agentId === lifecycle.agentId)).toBe(true);
    expect(data.campaigns.length).toBeGreaterThan(10);
    expect(Object.keys(data.registry.codes!)).toContain("MAIL-SPRING");
    expect(data.registry.ownHosts).toEqual(["northwind.example"]);
  });
});

describe("generateSyntheticJourneyData — other shapes", () => {
  it("a DTC business produces offline touches that attribute through codes, vanity URLs and tracking numbers (AC-11.4.4)", () => {
    const data = generateSyntheticJourneyData(opts({ seed: "skincare", archetype: "dtc_physical", days: 180 }));
    expect(data.meta.recurring).toBe(false);
    const offline = data.touches.filter((t) => t.channelKey && OFFLINE_CHANNELS.has(t.channelKey));
    expect(offline.length).toBeGreaterThan(50);
    expect(new Set(offline.map((t) => t.channelKey))).toEqual(new Set(["direct_mail", "print", "broadcast", "outdoor"]));
    expect(new Set(offline.map((t) => t.source.codeKind))).toEqual(new Set(["promo", "qr", "vanity_url", "tracking_number"]));
    for (const t of offline.slice(0, 200)) {
      const p = parseTouchSource({ url: t.source.landingUrl, code: t.source.code, trackingNumber: t.source.codeKind === "tracking_number" ? t.source.offlineKey : null, registry: data.registry });
      expect(p.channelKey).toBe(t.channelKey);
      expect(p.offline).toBe(true);
      expect(p.campaignId).toBe(t.campaignId);
    }
    // Trailing-30-day revenue stands in for MRR and is labelled by the consumer.
    expect(data.series.mrrMinorByDay[60]).toBeGreaterThan(0);
  });

  it("every archetype generates a short window without error and with its own customer kind", () => {
    for (const a of ARCHETYPES) {
      const data = generateSyntheticJourneyData(opts({ seed: `a:${a}`, archetype: a, days: 45 }));
      expect(data.daily).toHaveLength(45 * 4);
      expect(data.conversions.length).toBeGreaterThan(0);
      expect(data.customers.every((c) => c.kind === data.customers[0]!.kind)).toBe(true);
      expect(data.chapters.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("scales volume, accepts Date start dates, defaults departments and validates days", () => {
    const base = generateSyntheticJourneyData(opts({ seed: "scale", days: 90 }));
    const big = generateSyntheticJourneyData(opts({ seed: "scale", days: 90, volumeScale: 3 }));
    expect(sumDaily(rollupDaily(big.daily)).signups).toBeGreaterThan(sumDaily(rollupDaily(base.daily)).signups * 2);
    const dated = generateSyntheticJourneyData(opts({ startDate: new Date("2024-06-15T13:00:00Z"), days: 10, departments: [] }));
    expect(dated.meta.startDate).toBe("2024-06-15");
    expect(dated.meta.departmentIds).toHaveLength(1);
    expect(dated.daily).toHaveLength(20);
    expect(() => generateSyntheticJourneyData(opts({ days: 0 }))).toThrow(RangeError);
    expect(() => generateSyntheticJourneyData(opts({ days: 1.5 }))).toThrow(RangeError);
    const noBusiness = generateSyntheticJourneyData(opts({ days: 3, businessId: undefined }));
    expect(noBusiness.meta.businessId).toBeNull();
    expect("businessId" in noBusiness.daily[0]!).toBe(false);
  });

  it("syntheticConversionGroups yields one labelled path per visitor for the data-driven models", () => {
    const data = generateSyntheticJourneyData(opts({ seed: "groups", days: 60 }));
    const groups = syntheticConversionGroups(data);
    expect(groups.length).toBe(data.visitors.length);
    expect(groups.filter((g) => g.converted).length).toBe(data.customers.length);
    for (const g of groups) {
      expect(g.touches.length).toBeGreaterThan(0);
      for (let i = 1; i < g.touches.length; i++) expect(Date.parse(g.touches[i]!.occurredAt)).toBeGreaterThanOrEqual(Date.parse(g.touches[i - 1]!.occurredAt));
    }
  });
});

describe("generateSyntheticConversionPath — Match Day replays", () => {
  it("is deterministic and builds a valid journey", () => {
    const a = generateSyntheticConversionPath("replay-1");
    const b = generateSyntheticConversionPath("replay-1");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.conversion.kind).toBe("payment");
    expect(a.touches.length).toBeGreaterThanOrEqual(2);
    expect(a.touches.every((t) => Date.parse(t.occurredAt) < Date.parse(a.conversion.occurredAt))).toBe(true);
    expect(a.agents.length).toBe(7);
    expect(a.visitorIds).toEqual([a.customer.visitorId]);
    expect(a.costs?.cpaByChannelMinor?.paid_ads).toBeGreaterThan(0);
    const j = buildJourney(a);
    expect(Journey.parse(j)).toEqual(j);
    expect(j.touchIds).toHaveLength(a.touches.length);
    expect(j.matchdayLevel).toBe("cup");
    expect(j.captain).not.toBeNull();
    expect(j.agents.length).toBeGreaterThan(0);
    expect(j.xcSeries.at(-1)!.cumulative).toBe(1);
    expect(j.stats.acquisitionCostMinor).toBeGreaterThan(0);
    expect(JSON.stringify(buildJourney(b))).toBe(JSON.stringify(j));
  });

  it("honours kind, time, consent, counts and touch count options", () => {
    const signup = generateSyntheticConversionPath("s", { kind: "signup", at: "2025-02-03T04:05:06Z", consent: "denied", touchCount: 3, counts: { conversions: 250, nthOfKind: 120 } });
    expect(signup.conversion.kind).toBe("signup");
    expect(signup.conversion.amountMinor).toBe(0);
    expect(signup.conversion.occurredAt).toBe("2025-02-03T04:05:06.000Z");
    expect(signup.touches).toHaveLength(3);
    expect(signup.consent).toBe("denied");
    expect(signup.counts).toMatchObject({ conversions: 250, nthOfKind: 120 });
    const j = buildJourney(signup);
    expect(j.matchdayLevel).toBe("friendly");
    expect(j.partialJourney).toBe(true);
    expect(j.fullMatchDay).toBe(false);
    const activation = generateSyntheticConversionPath("a", { kind: "activation", archetype: "consumer_app" });
    expect(activation.conversion.kind).toBe("activation");
    expect(activation.customer.activatedAt).toBe(activation.conversion.occurredAt);
    expect(activation.customer.kind).toBe("person");
    expect(buildJourney(activation).matchdayLevel).toBe("league");
  });

  it("differs across seeds", () => {
    expect(generateSyntheticConversionPath("x").conversion.id).not.toBe(generateSyntheticConversionPath("y").conversion.id);
  });
});
