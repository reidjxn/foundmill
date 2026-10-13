/**
 * Named queries (AC-11.3.6): every exhibit resolves to a registry entry backed by a repository call; the model never
 * writes chart numbers; an exhibit outside the registry is downgraded to none. Plus the pure insight and decision rules.
 */
import { repos } from "@foundmill/db";
import { MOCK_ROUTES, type MockGenerator } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextBestDecision } from "../decisions";
import { NAMED_QUERIES, NAMED_QUERY_IDS, namedQueryCatalogue, runNamedQuery, sanitizeExhibit } from "../exhibits";
import { computeInsights } from "../insights";
import { loadMetricsSnapshot, statusMetrics, type MetricsSnapshot } from "../metrics";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("exhibits");
}, 120_000);
afterAll(() => hz?.close());

describe("named query registry", () => {
  it("every registry entry runs against repositories and returns chart-ready data with provenance", async () => {
    for (const id of NAMED_QUERY_IDS) {
      const data = await runNamedQuery(hz.db, hz.A.businessId, id);
      expect(data, id).not.toBeNull();
      expect(data!.id).toBe(id);
      expect(data!.kind).toBe(NAMED_QUERIES[id].kind);
      expect(data!.source.length).toBeGreaterThan(0);
      if (data!.kind === "table") expect(Array.isArray(data!.rows)).toBe(true);
      if (data!.kind === "chart") expect(Array.isArray(data!.series)).toBe(true);
    }
    expect(await runNamedQuery(hz.db, hz.A.businessId, "made_up")).toBeNull();
  });

  it("the catalogue handed to the model carries no data, only ids, titles, kinds and descriptions", () => {
    for (const q of namedQueryCatalogue()) {
      expect(Object.keys(q).sort()).toEqual(["description", "id", "kind", "title"]);
      expect(q.description).not.toMatch(/\d/);
    }
  });

  it("tasks_by_status and cash_position reflect the rows in the database", async () => {
    const tasks = await runNamedQuery(hz.db, hz.A.businessId, "tasks_by_status");
    const counts = await repos.tasks.countByStatus(hz.db, hz.A.businessId);
    const total = tasks!.rows!.reduce((n, r) => n + Number(r.count), 0);
    expect(total).toBe(Object.values(counts).reduce((n, c) => n + c, 0));
    await repos.finance.upsertAccount(hz.db, hz.A.businessId, { provider: "mock_bank", externalId: "x1", name: "Main", currency: "EUR", balanceMinor: 1_234_500 });
    const cash = await runNamedQuery(hz.db, hz.A.businessId, "cash_position");
    expect(cash!.label).toBe("Estimate");
    expect(cash!.rows![0]).toMatchObject({ currency: "EUR", balance_minor: 1_234_500 });
  });

  it("sanitizeExhibit downgrades anything outside the registry to none and corrects the kind", () => {
    expect(sanitizeExhibit({ kind: "chart", spec_ref: "made_up" })).toEqual({ kind: "none", spec_ref: null });
    expect(sanitizeExhibit({ kind: "chart", spec_ref: null })).toEqual({ kind: "none", spec_ref: null });
    expect(sanitizeExhibit({ kind: "diagram", spec_ref: "tasks_by_status" })).toEqual({ kind: "table", spec_ref: "tasks_by_status" });
    expect(sanitizeExhibit({ kind: "chart", spec_ref: "channel_cpa" })).toEqual({ kind: "chart", spec_ref: "channel_cpa" });
  });

  it("a model that references a query outside the registry gets its exhibit set to none", async () => {
    const base = MOCK_ROUTES.inboxComposer.generate;
    const rogue: MockGenerator = (ctx) => ({ ...(base(ctx) as object), exhibit: { kind: "chart", spec_ref: "secret_numbers" } });
    const service = hz.service({}, { inboxComposer: rogue });
    const event = await hz.writeEvent(hz.A.businessId, "task.completed", { title: "Exhibit test" });
    const r = await service.narrate(hz.A.businessId, [event.id]);
    expect(r.item.exhibit).toEqual({ kind: "none", spec_ref: null });
  });

  it("status strip metrics only name sources the composer computed", async () => {
    const snapshot = await loadMetricsSnapshot(hz.db, hz.A.businessId);
    const strip = statusMetrics(snapshot);
    expect(strip.length).toBeLessThanOrEqual(4);
    for (const m of strip) expect(NAMED_QUERY_IDS as readonly string[]).toContain(m.source);
    expect(strip.find((m) => m.metric === "cash")?.label).toBe("Estimate");
  });
});

const snapshot = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  asOf: "2026-10-07T00:00:00.000Z",
  currency: "EUR",
  cashMinor: 1_000_000,
  cashAccounts: 1,
  netBurnMonthlyMinor: 0,
  grossBurnMonthlyMinor: 0,
  runwayMonths: null,
  runwayBelow: [],
  customersWeek: 0,
  signupsWeek: 0,
  activationsWeek: 0,
  customers30d: 0,
  signups30d: 0,
  tasks: { planned: 2, ready: 0, running: 1, paused: 0, blocked: 0, review: 0, merging: 0, done: 3, failed: 0, stopped: 0 },
  channelsEnabled: 1,
  channels: [],
  roadmapOpen: 1,
  roadmapSlips: [],
  ...over,
});

describe("money in the status strip is formatted as the founder reads it everywhere (audit VGTM-X3)", () => {
  it("cash reads with the currency's narrow symbol and grouping, labeled Estimate, never as a raw number and code", () => {
    const cash = (over: Partial<MetricsSnapshot>) => statusMetrics(snapshot({ cashMinor: 26_334_571, runwayMonths: 14, ...over })).find((m) => m.metric === "cash")!;
    expect(cash({ currency: "GBP" })).toMatchObject({ value: "£263,345.71", label: "Estimate" });
    expect(cash({ currency: "USD" }).value).toBe("$263,345.71");
    expect(cash({ currency: "EUR" }).value).toBe("€263,345.71");
    expect(cash({ currency: "GBP" }).value).not.toMatch(/\d{5,}\.\d{2} [A-Z]{3}/);
  });

  it("the note quotes it that way, with the Estimate label", async () => {
    const generate = MOCK_ROUTES.inboxComposer.generate;
    const seen: string[] = [];
    const spy: MockGenerator = (ctx) => {
      const out = generate(ctx);
      seen.push(JSON.stringify(out));
      return out;
    };
    await repos.finance.upsertAccount(hz.db, hz.A.businessId, { provider: "mock_bank", externalId: "gbp1", name: "GBP main", currency: "GBP", balanceMinor: 26_334_571 });
    const service = hz.service({}, { inboxComposer: spy });
    const r = await service.refresh(hz.A.businessId);
    await service.drain(hz.A.businessId);
    expect(r.item.bodyMd).not.toMatch(/\d{5,}\.\d{2} [A-Z]{3}/);
    expect(seen.join(" ")).not.toMatch(/\d{5,}\.\d{2} [A-Z]{3}/);
  });
});

describe("insight thresholds (computed, never invented)", () => {
  it("CPA moved ≥ 20 % fires; 19 % does not; runway < 3 months blocks; roadmap slip reports the worst item", () => {
    const moved = computeInsights(snapshot({ channels: [{ channelId: "c", channelKey: "events", label: "Event marketing", recentCpaMinor: 1200, previousCpaMinor: 1000, changeRatio: 0.2, recentSpendMinor: 12_000, recentCustomers: 10 }] }));
    expect(moved.map((i) => i.kind)).toEqual(["channel_cpa_moved"]);
    expect(moved[0]!.facts).toMatchObject({ change_percent: 20, direction: "up", cpa_last_7d_minor: 1200 });
    const small = computeInsights(snapshot({ channels: [{ channelId: "c", channelKey: "events", label: "Event marketing", recentCpaMinor: 1190, previousCpaMinor: 1000, changeRatio: 0.19, recentSpendMinor: 0, recentCustomers: 0 }] }));
    expect(small).toEqual([]);
    const red = computeInsights(snapshot({ runwayMonths: 2.5, runwayBelow: [12, 9, 6, 3], netBurnMonthlyMinor: 400_000 }));
    expect(red[0]).toMatchObject({ kind: "runway_crossing", blocksContinue: true, facts: { threshold_months: 3, runway_months: 2.5 } });
    const amber = computeInsights(snapshot({ runwayMonths: 8, runwayBelow: [12, 9], netBurnMonthlyMinor: 125_000 }));
    expect(amber[0]).toMatchObject({ kind: "runway_crossing", blocksContinue: false, facts: { threshold_months: 9 } });
    const slip = computeInsights(snapshot({ roadmapSlips: [{ id: "r1", title: "Billing", horizon: "now", status: "planned", targetEnd: "2026-09-30", daysLate: 7 }, { id: "r2", title: "Docs", horizon: "next", status: "planned", targetEnd: "2026-10-05", daysLate: 2 }] }));
    expect(slip[0]).toMatchObject({ kind: "roadmap_slip", facts: { item_title: "Billing", days_late: 7, slipped_items: 2 } });
  });

  it("keys are stable for the same data and change with it", () => {
    const a = computeInsights(snapshot({ runwayMonths: 8, runwayBelow: [12, 9], netBurnMonthlyMinor: 125_000 }))[0]!.key;
    const b = computeInsights(snapshot({ runwayMonths: 8, runwayBelow: [12, 9], netBurnMonthlyMinor: 125_000 }))[0]!.key;
    const c = computeInsights(snapshot({ runwayMonths: 7, runwayBelow: [12, 9], netBurnMonthlyMinor: 140_000 }))[0]!.key;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("next-best decision", () => {
  it("is grounded in state, offers 2–4 options with exactly one recommended, and rotates by variant", () => {
    const blocked = nextBestDecision(snapshot({ tasks: { ...snapshot().tasks, blocked: 2 } }));
    expect(blocked.kind).toBe("unblock_tasks");
    expect(blocked.facts).toMatchObject({ blocked_tasks: 2 });
    expect(blocked.options.filter((o) => o.recommended)).toHaveLength(1);
    const none = nextBestDecision(snapshot({ channelsEnabled: 0 }));
    expect(none.kind).toBe("start_distribution");
    const fallback = nextBestDecision(snapshot());
    expect(fallback.kind).toBe("plan_next_cycle");
    expect(fallback.options.length).toBeGreaterThanOrEqual(2);
    expect(fallback.options.length).toBeLessThanOrEqual(4);
    expect(nextBestDecision(snapshot({ channelsEnabled: 0 }), 1).kind).toBe("plan_next_cycle");
    expect(nextBestDecision(snapshot(), 0).key).not.toBe(nextBestDecision(snapshot(), 1).key);
  });
});
