import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { formatMoney } from "@foundmill/dugout";
import { OverviewScreen, forecastRunway, overviewTiles } from "../OverviewScreen";
import { NOW, createFakeSource, renderScreen } from "./fake-source";
import { BID, channels, dataResponses, emptyResponses, overview, overviewBlocking, pnl } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

describe("overviewTiles", () => {
  it("computes the ten metrics from the overview, trailing P&L and channel board (AC-11.8.1)", () => {
    const tiles = overviewTiles({ overview, pnl, channels, currency: "EUR", now: NOW });
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(tiles.map((t) => t.key)).toEqual(["cash", "grossBurn", "netBurn", "runway", "revenue", "mrr", "arr", "grossMargin", "acquisitionCost", "payback"]);
    expect(by.cash!.value).toEqual({ amountMinor: 15_000_000, currency: "EUR" });
    expect(by.cash!.spark).toEqual([12_700_000, 11_100_000, 9_500_000, 7_900_000, 16_400_000, 15_000_000]);
    expect(by.grossBurn!.value).toEqual({ amountMinor: 3_500_000, currency: "EUR" });
    expect(by.grossBurn!.estimate).toBe("estimate");
    // August's SAFE is financing: the spark keeps burning that month instead of dipping to −€85,000.
    expect(by.netBurn!.spark).toEqual([1_800_000, 1_600_000, 1_600_000, 1_600_000, 1_500_000, 1_400_000]);
    expect(by.runway!.value).toBe("7.5");
    expect(by.runway!.caption).toBe("Forecast: 14.2 mo");
    expect(by.revenue!.value).toEqual({ amountMinor: 6_000_000, currency: "EUR" });
    // Nor is the SAFE revenue: August's bar is the €20,000 of operating inflows, not €120,000.
    expect(by.revenue!.spark).toEqual([1_200_000, 1_500_000, 1_700_000, 1_800_000, 2_000_000, 2_200_000]);
    expect(by.mrr!.value).toEqual({ amountMinor: 2_000_000, currency: "EUR" });
    expect(by.arr!.value).toEqual({ amountMinor: 24_000_000, currency: "EUR" });
    expect(by.grossMargin!.value).toBe(0.875);
    expect(by.acquisitionCost!.value).toEqual({ amountMinor: 50_000, currency: "EUR" });
    expect(by.acquisitionCost!.provenance?.note).toContain("Per channel: Paid search €500, Content and SEO €500");
    // CPA €500 ÷ (MRR €20,000 × 87.5 % ÷ 120 paying customers) = 3.4 months. Dividing by the 24 customers the channels
    // acquired instead (the old denominator) read 0.7 months, five times too short.
    expect(by.payback!.value).toBe("3.4");
    expect(by.payback!.caption).toBe("120 paying customers");
    const unknownBase = Object.fromEntries(overviewTiles({ overview: { ...overview, payingCustomers: undefined }, pnl, channels, currency: "EUR", now: NOW }).map((t) => [t.key, t]));
    expect(unknownBase.payback!.value).toBe("—");
    for (const t of tiles) expect(t.provenance?.note).toBeTruthy(); // every tile carries its hover definition
  });

  it("reads the forecast runway from the Base drivers, else the first negative month of the series", () => {
    expect(forecastRunway(overview, NOW)).toBe(14.2);
    const base = overview.forecasts.base!;
    const noDrivers = { ...overview, forecasts: { base: { ...base, drivers: undefined, series: [{ month: "2026-10", cashMinor: 5 }, { month: "2026-11", cashMinor: -1 }] } } } as typeof overview;
    expect(forecastRunway(noDrivers, NOW)).toBe(1);
    expect(forecastRunway({ ...overview, forecasts: {} }, NOW)).toBeNull();
  });
});

describe("OverviewScreen", () => {
  it("renders the metric tiles with definitions on hover, Estimate chips, sparklines and the runway warning", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <OverviewScreen {...props} />);
    expect(screen.getByRole("region", { name: "Finance metrics" })).toBeTruthy();
    const cash = document.querySelector("[data-metric='cash']")!;
    expect(cash.querySelector("[data-value]")!.getAttribute("data-value")).toBe(formatMoney({ amountMinor: 15_000_000, currency: "EUR" }, { compact: true }));
    expect(within(cash as HTMLElement).getByRole("button", { name: /Where this number comes from: Bank balances/ })).toBeTruthy();
    expect(cash.querySelector("svg")).toBeTruthy(); // sparkline
    const runway = document.querySelector("[data-metric='runway']") as HTMLElement;
    expect(within(runway).getByText("7.5")).toBeTruthy();
    expect(within(runway).getByText("Estimate")).toBeTruthy();
    expect(within(runway).getByText("Forecast: 14.2 mo")).toBeTruthy();
    expect(document.querySelectorAll("[data-metric-tile]")).toHaveLength(10);
    const warning = screen.getByRole("status", { name: "Runway warning" });
    expect(within(warning).getByText("Runway under 9 months")).toBeTruthy();
    expect(within(warning).getByText(/under the 9-month threshold/)).toBeTruthy();
    fireEvent.click(within(warning).getByRole("button", { name: "Open Inbox" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/inbox`);
    expect(fake.queried.get("finance.pnl")).toEqual({ from: "2026-07-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
    expect(screen.getByRole("region", { name: "Cash" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Net cash change" })).toBeTruthy();
  });

  it("turns the warning red and names the blocked Continue when runway is under 3 months (AC-11.8.3)", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.overview": overviewBlocking } });
    renderScreen(fake, <OverviewScreen {...props} />);
    const warning = screen.getByRole("status", { name: "Runway warning" });
    expect(within(warning).getByText("Runway under 3 months")).toBeTruthy();
    expect(within(warning).getByText(/Continue is blocked until the warning in the Inbox is acknowledged/)).toBeTruthy();
    expect(warning.className).toContain("status-bad");
  });

  it("shows an empty state without bank data, a loading state and an error with retry", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <OverviewScreen {...props} />);
    expect(screen.getByText("No bank or revenue data yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect a bank" }));
    expect(empty.navigations[0]).toBe(`/b/${BID}/settings/integrations`);
    expect(screen.queryByRole("status", { name: "Runway warning" })).toBeNull();
    unmount();

    const loading = createFakeSource({ businessId: BID });
    const { container, unmount: u2 } = renderScreen(loading, <OverviewScreen {...props} />);
    expect(container.querySelectorAll("[aria-busy='true']").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-metric-tile]")).toHaveLength(10);
    u2();

    const failing = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.overview": new Error("bank sync failed") } });
    renderScreen(failing, <OverviewScreen {...props} />);
    expect(screen.getByText("The finance overview could not be loaded.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["finance.overview"]).toBe(1);
  });
});
