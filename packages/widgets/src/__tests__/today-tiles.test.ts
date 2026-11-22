/**
 * The tiles Today's health strip reuses (founder, 2026-11-07): Cash, Runway and Customers this week are the status
 * strip's own builders, so Today and Details always show the same figures. Today has no spend tile (WP-14 T4).
 */
import { describe, expect, it } from "vitest";
import { routes } from "../shared/routes";
import { NOT_KNOWN_YET } from "../shared/cash";
import { cashTile, customersThisWeek, customersWeekTile, runwayTile, statusTiles } from "../widgets/status-strip";
import { TODAY, finance, ribbon as ribbonOf } from "./fixtures";

const ribbon = ribbonOf();

const noop = () => {};

describe("Today's tiles are the status strip's", () => {
  it("Cash, Runway and Customers this week match the strip's tiles exactly", () => {
    const strip = statusTiles({ finance, ribbon, today: TODAY, currency: "USD", loading: { finance: false, ribbon: false, departments: false }, open: noop });
    const pick = (label: string) => strip.find((t) => t.label === label)!;
    const strip0 = (t: object) => JSON.parse(JSON.stringify({ ...t, onClick: undefined }));
    expect(strip0(cashTile(finance, false, "USD", noop))).toEqual(strip0(pick("Cash")));
    expect(strip0(runwayTile(finance, false, noop))).toEqual(strip0(pick("Runway")));
    expect(strip0(customersWeekTile(ribbon, false, TODAY, noop))).toEqual(strip0(pick("Customers this week")));
  });

  it("Cash with no bank connected is not known yet, never a zero (WP-02 T6)", () => {
    const none = { ...finance, cash: { ...finance.cash, accounts: 0, amountMinor: 0 } } as typeof finance;
    const tile = cashTile(none, false, "USD", noop);
    expect(tile.value).toEqual(NOT_KNOWN_YET.value);
    expect(tile.caption).toBe("No bank connected");
  });

  it("Runway with a balance below zero says so in the top bar's words, never a negative figure (B8)", () => {
    const overdrawn = { ...finance, cash: { ...finance.cash, amountMinor: -914_900 }, runway: { ...finance.runway, months: -4.2 } } as typeof finance;
    const tile = runwayTile(overdrawn, false, noop);
    expect(tile.value).toBe("Cash is below zero");
    expect(tile.unit).toBeUndefined();
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

describe("routes", () => {
  it("Today is the business's front door; the dashboards stay at /home", () => {
    expect(routes.today("b1")).toBe("/b/b1/today");
    expect(routes.home("b1")).toBe("/b/b1/home");
  });
});
