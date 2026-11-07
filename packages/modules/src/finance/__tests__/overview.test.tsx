import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider, formatMoney } from "@foundmill/dugout";
import { TERMS } from "@foundmill/shared/terms";
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
    // One plain sentence above the tiles, from the same figures (UX plan §7.14, C6).
    expect(screen.getByTestId("finance-summary").textContent).toBe("You have €150K in the bank and spend €20K more than you earn each month, so cash lasts about 8 months (Estimate).");
    // Abbreviations are spelled out on first use (the defined word is plain text while guidance is off).
    expect(document.querySelector("[data-metric='mrr'] [data-metric-label]")!.textContent).toBe("Monthly recurring revenue (MRR)");
    expect(document.querySelector("[data-metric='acquisitionCost'] [data-metric-label]")!.textContent).toBe("Cost to win a customer");
    expect(screen.queryByRole("button", { name: "Runway" })).toBeNull();
    expect(document.querySelector("[data-explainer]")).toBeNull();
    expect(document.querySelector("[data-plain-line]")).toBeNull();
    const cash = document.querySelector("[data-metric='cash']")!;
    expect(cash.querySelector("[data-value]")!.getAttribute("data-value")).toBe(formatMoney({ amountMinor: 15_000_000, currency: "EUR" }, { compact: true }));
    expect(within(cash as HTMLElement).getByRole("button", { name: /Where this number comes from: Bank balances/ })).toBeTruthy();
    expect(cash.querySelector("svg")).toBeTruthy(); // sparkline
    const runway = document.querySelector("[data-metric='runway']") as HTMLElement;
    expect(within(runway).getByText("7.5")).toBeTruthy();
    // "Estimate" once, in a sentence under the tiles, not a chip on each (Nov 7, 2026).
    expect(within(runway).queryByText("Estimate")).toBeNull();
    expect(screen.getByTestId("finance-estimate-note").textContent).toMatch(/^Estimate: .*net burn, runway, .* are worked out, not measured\.$/);
    // Three numbers first; the rest behind More numbers.
    expect([...screen.getByTestId("finance-headline").querySelectorAll("[data-metric]")].map((t) => t.getAttribute("data-metric"))).toEqual(["cash", "netBurn", "runway"]);
    expect(screen.getByTestId("finance-more").querySelectorAll("[data-metric]")).toHaveLength(7);
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

  it("guidance on: the intro, the defined words on the tile labels and the plain line under each figure (UX plan §7.14)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <OverviewScreen {...props} />, {}, { guidance: "on" });
    const explainer = document.querySelector("[data-explainer='finance/overview']") as HTMLElement;
    expect(within(explainer).getByText("Where the money is and how long it lasts.")).toBeTruthy();
    expect(within(explainer).getByText("The line under the numbers says which are estimates: worked out, not measured.")).toBeTruthy();
    // The summary sentence stays above the tiles.
    expect(screen.getByTestId("finance-summary")).toBeTruthy();
    // Runway's label is a defined word; its plain line is the definitions map's sentence.
    const runway = document.querySelector("[data-metric='runway']") as HTMLElement;
    expect(within(runway).getByRole("button", { name: "Runway" }).className).toContain("term-link");
    expect(runway.querySelector("[data-plain-line]")!.textContent).toBe(TERMS.runway.short);
    expect(document.querySelector("[data-metric='mrr'] [data-metric-label]")!.textContent).toBe("Monthly recurring revenue (MRR)");
    expect(within(document.querySelector("[data-metric='mrr']") as HTMLElement).getByRole("button", { name: "Monthly recurring revenue" })).toBeTruthy();
    // A metric the map does not define keeps the plain half of its own definition.
    expect(document.querySelector("[data-metric='cash'] [data-plain-line]")!.textContent).toBe("What is in every connected bank account today, added up in your currency.");
    expect(document.querySelectorAll("[data-plain-line]")).toHaveLength(10);
  });

  it("a bank balance below zero reads 'Cash is below zero' with the Estimate tag, never a negative runway (UX plan B8)", () => {
    const belowZero = { ...overview, cash: { ...overview.cash, amountMinor: -250_000 }, runway: { months: -1.2, label: "Estimate", warnings: [], blocksContinue: false } };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.overview": belowZero } });
    renderScreen(fake, <OverviewScreen {...props} />);
    const runway = document.querySelector("[data-metric='runway']") as HTMLElement;
    expect(within(runway).getByText("Cash is below zero")).toBeTruthy();
    expect(screen.getByTestId("finance-estimate-note").textContent).toContain("runway");
    expect(within(runway).getByText("The bank balance is negative, so there is no runway to count")).toBeTruthy();
    expect(within(runway).queryByText("-1.2")).toBeNull();
    expect(screen.queryByRole("status", { name: "Runway warning" })).toBeNull();
  });

  it("turns the warning red when runway is under 3 months, and never says Continue is blocked (AC-11.8.3; Nov 7, 2026)", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "finance.overview": overviewBlocking } });
    renderScreen(fake, <OverviewScreen {...props} />);
    const warning = screen.getByRole("status", { name: "Runway warning" });
    expect(within(warning).getByText("Runway under 3 months")).toBeTruthy();
    expect(within(warning).getByText(/The finance lead has drafted options in the Inbox/)).toBeTruthy();
    expect(warning.textContent).not.toMatch(/Continue/);
    expect(warning.className).toContain("status-bad");
  });

  it("shows an empty state without bank data, a loading state and an error with retry", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <OverviewScreen {...props} />);
    expect(screen.getByText("No bank or revenue data yet")).toBeTruthy();
    expect(screen.queryByTestId("finance-summary")).toBeNull(); // the empty state says it; no second sentence
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

describe("Pin to Home (audit #394)", () => {
  it("offers Pin to Home on the Cash panel and puts the Cash and runway widget on the active Home dashboard", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "dashboard.get": { id: "dash-1", layout: { widgets: [] } } } });
    renderScreen(
      fake,
      <TooltipProvider>
        <OverviewScreen {...props} />
      </TooltipProvider>,
    );
    within(screen.getByRole("region", { name: "Cash" })).getByRole("button", { name: "Panel menu" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Pin to Home" }));
    expect(fake.mutations).toEqual([{ path: "dashboard.update", input: { dashboardId: "dash-1", layout: { widgets: [expect.objectContaining({ key: "cash_runway", x: 0, y: 0 })] } } }]);
  });
});
