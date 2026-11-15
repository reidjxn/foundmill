import { describe, expect, it } from "vitest";
import { NAMED_QUERY_IDS, barColumn, cashPosition, channelCpa, chartShape, conversions30d, isNamedQueryId, labelColumn, readExhibit, roadmapStatus, runwayForecast, sourceFor, tasksByStatus, transform } from "../exhibits";

describe("exhibit references (AC-11.3.6: charts only reference named queries)", () => {
  it("normalises the stored exhibit and recognises the catalogue", () => {
    expect(readExhibit({ kind: "chart", spec_ref: "conversions_30d" })).toEqual({ kind: "chart", specRef: "conversions_30d" });
    expect(readExhibit({ kind: "table", specRef: "tasks_by_status" })).toEqual({ kind: "table", specRef: "tasks_by_status" });
    expect(readExhibit(null)).toEqual({ kind: "none", specRef: null });
    expect(readExhibit("x")).toEqual({ kind: "none", specRef: null });
    for (const id of NAMED_QUERY_IDS) expect(isNamedQueryId(id)).toBe(true);
    expect(isNamedQueryId("select * from users")).toBe(false);
  });
  it("maps every named query to a tRPC query the page already holds", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(sourceFor("tasks_by_status").path).toBe("dev.tasks.list");
    expect(sourceFor("conversions_30d", now)).toEqual({ path: "journey.ribbon", input: { from: "2026-09-07", to: "2026-10-07" } });
    expect(sourceFor("channel_cpa").path).toBe("distribution.channels.list");
    expect(sourceFor("cash_position").path).toBe("finance.overview");
    expect(sourceFor("runway_forecast").path).toBe("finance.overview");
    expect(sourceFor("roadmap_status").path).toBe("product.roadmap.list");
  });
});

describe("transforms", () => {
  it("counts tasks by status in a stable order", () => {
    const d = tasksByStatus({ items: [{ status: "done" }, { status: "running" }, { status: "done" }, { status: "weird" }] });
    expect(d.rows).toEqual([
      { status: "In progress", count: 1 },
      { status: "Done", count: 2 },
      { status: "Weird", count: 1 },
    ]);
    expect(chartShape("chart", d)).toBe("bar");
    expect(chartShape("table", d)).toBe("table");
    expect(chartShape("diagram", d)).toBe("funnel");
  });
  it("builds one point per day from business-wide rows, falling back to conversions", () => {
    const d = conversions30d({ rows: [{ day: "2026-10-01", departmentId: null, signups: 2, activations: 1, payments: 0 }, { day: "2026-10-01", departmentId: "dept", signups: 99, activations: 99, payments: 99 }], conversions: [] }, "2026-10-01", "2026-10-03");
    expect(d.series?.[0]?.points).toEqual([
      { x: "2026-10-01", y: 2 },
      { x: "2026-10-02", y: 0 },
      { x: "2026-10-03", y: 0 },
    ]);
    expect(d.rows?.[0]).toEqual({ stage: "signups", count: 2 });
    const fb = conversions30d({ rows: [], conversions: [{ kind: "payment", occurredAt: "2026-10-02T10:00:00Z" }] }, "2026-10-01", "2026-10-02");
    expect(fb.series?.[2]?.points[1]).toEqual({ x: "2026-10-02", y: 1 });
    expect(chartShape("chart", d)).toBe("line");
  });
  it("channel CPA sorts cheapest first and is labelled an estimate", () => {
    const d = channelCpa({ channels: [{ channelKey: "seo", enabled: true, form: { spendMinor: 10_000, customers: 2 } }, { channelKey: "paid_ads", enabled: true, meta: { label: "Paid ads" }, form: { spendMinor: 10_000, customers: 10 } }, { channelKey: "pr", enabled: false, form: null }] }, "EUR");
    expect(d.label).toBe("Estimate");
    expect(d.rows?.map((r) => r.channel)).toEqual(["Paid ads", "seo"]);
    expect(d.rows?.[0]?.cpa_minor).toBe(1000);
    expect(barColumn(d)?.key).toBe("cpa_minor");
    expect(labelColumn(d)?.key).toBe("channel");
  });
  it("channel CPA leaves out a channel on the board that cannot really act, unless it is in offline tracking or has spend to show", () => {
    const no = { available: false };
    const d = channelCpa(
      {
        channels: [
          { channelKey: "social", enabled: true, form: null, availability: no },
          { channelKey: "print", enabled: true, form: null, availability: no, kitMode: true },
          { channelKey: "paid_ads", enabled: true, form: { spendMinor: 5_000, customers: 1 }, availability: no },
          { channelKey: "seo", enabled: true, form: null, availability: { available: true } },
        ],
      },
      "EUR",
    );
    expect(d.rows?.map((r) => r.channel).sort()).toEqual(["paid ads", "print", "seo"]);
  });
  it("a chart with nothing to draw is an empty state, not a bar chart on a £0.00–£0.01 axis (audit OL-31)", () => {
    // Enabled channels that have not brought a customer yet have no cost per customer.
    const noCustomers = channelCpa({ channels: [{ channelKey: "seo", enabled: true, form: null }, { channelKey: "paid_ads", enabled: true, form: { spendMinor: 0, customers: 0 } }] }, "GBP");
    expect(noCustomers.rows?.map((r) => r.cpa_minor)).toEqual([null, null]);
    expect(chartShape("chart", noCustomers)).toBe("empty");
    expect(chartShape("diagram", noCustomers)).toBe("empty");
    // The table form still lists the channels.
    expect(chartShape("table", noCustomers)).toBe("table");
    // All zeros draw nothing either.
    expect(chartShape("chart", roadmapStatus({ items: [] }))).toBe("empty");
    // One real figure is a chart again.
    const one = channelCpa({ channels: [{ channelKey: "seo", enabled: true, form: { spendMinor: 5_000, customers: 5 } }, { channelKey: "pr", enabled: true, form: null }] }, "GBP");
    expect(chartShape("chart", one)).toBe("bar");
  });
  it("cash position is a table of estimates; the runway forecast only draws scenarios with points", () => {
    const finance = { cash: { amountMinor: 1, currency: "GBP" }, burn: { netBurnMinor: 2, grossBurnMinor: 3 }, runway: { months: 4 }, forecasts: { base: { scenario: "base", currency: "GBP", series: [{ month: "2026-11", cashMinor: 100 }] }, upside: { scenario: "upside", currency: "GBP", series: [] }, downside: null } };
    expect(cashPosition(finance, "USD").rows).toHaveLength(4);
    expect(cashPosition(undefined, "USD").rows).toEqual([]);
    // Before finance answers the exhibit reads in the business's currency, never a fixed one.
    expect(cashPosition(undefined, "USD").currency).toBe("USD");
    expect(cashPosition(finance, "USD").currency).toBe("GBP");
    const f = runwayForecast(finance, "USD");
    expect(f.label).toBe("Forecast");
    expect(f.series?.map((s) => s.key)).toEqual(["base"]);
    expect(chartShape("chart", f)).toBe("empty");
    expect(chartShape("chart", runwayForecast({ ...finance, forecasts: { base: { scenario: "base", currency: "GBP", series: [{ month: "2026-11", cashMinor: 100 }, { month: "2026-12", cashMinor: 90 }] } } }, "USD"))).toBe("line");
  });
  it("roadmap status per horizon and the generic transform entry point", () => {
    const d = roadmapStatus({ items: [{ horizon: "now", status: "done", tasks: [{ status: "done" }, { status: "running" }] }, { horizon: "later", status: "planned", tasks: [] }] });
    expect(d.rows?.[0]).toEqual({ horizon: "now", items: 1, done: 1, tasks: 2, tasks_done: 1 });
    expect(transform("roadmap_status", { items: [] }, { currency: "EUR" }).id).toBe("roadmap_status");
    expect(transform("conversions_30d", undefined, { currency: "EUR", from: "2026-10-01", to: "2026-10-01" }).series?.[0]?.points).toHaveLength(1);
  });
});
