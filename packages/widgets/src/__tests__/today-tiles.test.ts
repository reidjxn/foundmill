/**
 * The tiles Today's health strip reuses (founder, 2026-11-07): Cash, Runway and Customers this week are the status
 * strip's own builders, so Today and Details always show the same figures; spend is never added across currencies.
 */
import { describe, expect, it } from "vitest";
import { routes } from "../shared/routes";
import { SPEND_WORDS, cashTile, customersThisWeek, customersWeekTile, runwayTile, spendWeekTiles, statusTiles } from "../widgets/status-strip";
import { TODAY, finance, ribbon as ribbonOf } from "./fixtures";

const ribbon = ribbonOf();

const noop = () => {};

describe("Today's tiles are the status strip's", () => {
  it("Cash, Runway and Customers this week match the strip's tiles exactly", () => {
    const strip = statusTiles({ finance, ribbon, live: false, today: TODAY, currency: "USD", loading: { finance: false, ribbon: false, departments: false, positions: false }, open: noop });
    const pick = (label: string) => strip.find((t) => t.label === label)!;
    const strip0 = (t: object) => JSON.parse(JSON.stringify({ ...t, onClick: undefined }));
    expect(strip0(cashTile(finance, false, "USD", noop))).toEqual(strip0(pick("Cash")));
    expect(strip0(runwayTile(finance, false, noop))).toEqual(strip0(pick("Runway")));
    expect(strip0(customersWeekTile(ribbon, false, TODAY, noop))).toEqual(strip0(pick("Customers this week")));
  });

  it("counts first payments over the last 7 days against the 7 before", () => {
    const c = customersThisWeek(ribbon, TODAY)!;
    expect(c.spark).toHaveLength(14);
    expect(c.week).toBe(c.spark.slice(-7).reduce((a, b) => a + b, 0));
    expect(customersThisWeek(undefined, TODAY)).toBeNull();
  });

  it("reads the server's own customer figures (one field per fact) when they are for the same day, else the rows", () => {
    const served = { ...ribbon, customers: { today: TODAY, thisWeek: 41, previousWeek: 37, total: 1_073 } };
    const c = customersThisWeek(served, TODAY)!;
    expect([c.week, c.previous]).toEqual([41, 37]);
    expect(c.spark).toEqual(customersThisWeek(ribbon, TODAY)!.spark);
    expect(customersWeekTile(served, false, TODAY, noop)).toMatchObject({ value: 41, delta: { value: 4, label: "vs last week" } });
    // A response for another day (a tab left open past midnight) falls back to the rows for the asked day.
    const stale = { ...ribbon, customers: { today: "2000-01-01", thisWeek: 99, previousWeek: 0, total: 99 } };
    expect(customersThisWeek(stale, TODAY)!.week).toBe(customersThisWeek(ribbon, TODAY)!.week);
  });
});

describe("spendWeekTiles", () => {
  it("shows two figures, never summed, when the business is not in dollars", () => {
    const tiles = spendWeekTiles({ aiUsage: { amountMinor: 420, currency: "USD" }, channel: { amountMinor: 10_000, currency: "GBP", otherCurrencies: [] } }, false, noop);
    expect(tiles.map((t) => t.label)).toEqual([SPEND_WORDS.ai, SPEND_WORDS.channel]);
    expect(tiles[0]).toMatchObject({ value: { amountMinor: 420, currency: "USD" }, estimate: "estimate" });
    expect(tiles[1]).toMatchObject({ value: { amountMinor: 10_000, currency: "GBP" }, estimate: "estimate" });
  });

  it("leaves out channel spend when there was none, and names a channel kept in another currency", () => {
    expect(spendWeekTiles({ aiUsage: { amountMinor: 420, currency: "USD" }, channel: { amountMinor: 0, currency: "GBP", otherCurrencies: [] } }, false, noop).map((t) => t.label)).toEqual([SPEND_WORDS.ai]);
    const mixed = spendWeekTiles({ aiUsage: { amountMinor: 420, currency: "USD" }, channel: { amountMinor: 0, currency: "GBP", otherCurrencies: [{ currency: "EUR", amountMinor: 900 }] } }, false, noop);
    expect(mixed[1]!.caption).toMatch(/plus spend in EUR, not added/);
  });

  it("is one combined figure for a business in dollars", () => {
    const tiles = spendWeekTiles({ aiUsage: { amountMinor: 420, currency: "USD" }, channel: { amountMinor: 1_000, currency: "USD", otherCurrencies: [] } }, false, noop);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ label: SPEND_WORDS.combined, value: { amountMinor: 1_420, currency: "USD" }, estimate: "estimate" });
  });

  it("says Not known yet, never a zero, without the figures", () => {
    expect(spendWeekTiles(null, false, noop)[0]).toMatchObject({ value: "Not known yet" });
    expect(spendWeekTiles(undefined, true, noop)[0]).toMatchObject({ value: null, loading: true });
  });
});

describe("routes", () => {
  it("Today is the business's front door; the dashboards stay at /home", () => {
    expect(routes.today("b1")).toBe("/b/b1/today");
    expect(routes.home("b1")).toBe("/b/b1/home");
  });
});
