import "./setup";
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { DateFormatProvider } from "@foundmill/dugout";
import type { ReactNode } from "react";
import { DAY_FIRST_24H, ISO_24H, usDatesIn } from "../../dates.testing";
import { CapTableScreen } from "../CapTableScreen";
import { CashScreen } from "../CashScreen";
import { formatMonth } from "../metrics";
import { OverviewScreen } from "../OverviewScreen";
import { ProfitAndLossScreen, periodRange } from "../ProfitAndLossScreen";
import { RunwayScreen } from "../RunwayScreen";
import { WageBillScreen } from "../WageBillScreen";
import { NOW, createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-fin" };

/** Renders a finance screen as a person who chose `prefs` in Settings › Preferences sees it. */
function renderAs(prefs: typeof ISO_24H, ui: ReactNode) {
  const fake = createFakeSource({ businessId: BID, responses: dataResponses });
  return renderScreen(fake, <DateFormatProvider value={prefs}>{ui}</DateFormatProvider>);
}

describe("finance dates follow the person's date format", () => {
  it("month labels: formatMonth and the P&L period", () => {
    expect(formatMonth("2026-09", ISO_24H)).toBe("2026-09");
    expect(formatMonth("2026-09", DAY_FIRST_24H)).toBe("Sep 2026");
    expect(periodRange("3m", NOW, ISO_24H).label).toBe("2026-07 – 2026-09");
    expect(periodRange("this-month", NOW, ISO_24H).label).toBe("2026-10 to date");
  });

  it("Cash: transaction dates and consent dates (ISO, then day first)", () => {
    const { container, unmount } = renderAs(ISO_24H, <CashScreen {...props} />);
    expect(
      within(screen.getByRole("article", { name: "Ledgerly operating" })).getByText(
        /consent until 2026-10-12$/,
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("grid", { name: "Transactions" })).getAllByText("2026-10-03").length,
    ).toBeGreaterThan(0);
    expect(usDatesIn(container)).toEqual([]);
    unmount();
    renderAs(DAY_FIRST_24H, <CashScreen {...props} />);
    expect(
      within(screen.getByRole("article", { name: "Ledgerly operating" })).getByText(
        /consent until 12 Oct 2026$/,
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("grid", { name: "Transactions" })).getAllByText("3 Oct 2026").length,
    ).toBeGreaterThan(0);
  });

  it("P&L: the period caption", () => {
    const { container } = renderAs(ISO_24H, <ProfitAndLossScreen {...props} />);
    expect(screen.getByText("2026-07 – 2026-09")).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Cap table: issue dates and the last change", () => {
    const { container } = renderAs(ISO_24H, <CapTableScreen {...props} />);
    expect(screen.getByText(/last change 2026-08-14/)).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Payroll: the month and each staff member's start", () => {
    const { container } = renderAs(ISO_24H, <WageBillScreen {...props} />);
    expect(screen.getByText(/agents · .* in 2026-10 · Estimate/)).toBeTruthy();
    expect(
      within(screen.getByRole("table", { name: "Staff" })).getAllByText("2025-10").length,
    ).toBeGreaterThan(0);
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Runway: saved versions and the months in each scenario", () => {
    const { container } = renderAs(ISO_24H, <RunwayScreen {...props} />);
    expect(screen.getByText(/Latest versions: Base 2026-10-01/)).toBeTruthy();
    expect(screen.getAllByText("Cash, 2028-09").length).toBeGreaterThan(0);
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Overview: the monthly cash flow labels", () => {
    const { container } = renderAs(ISO_24H, <OverviewScreen {...props} />);
    expect(container.textContent).toContain("2026-09");
    expect(container.textContent).not.toContain("Sep 2026");
    expect(usDatesIn(container)).toEqual([]);
  });
});
