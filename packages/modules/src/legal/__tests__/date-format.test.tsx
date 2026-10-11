import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { DateFormatProvider } from "@foundmill/dugout";
import type { ReactNode } from "react";
import { DAY_FIRST_24H, ISO_24H, usDatesIn } from "../../dates.testing";
import { ComplianceScreen } from "../ComplianceScreen";
import { ContractsScreen } from "../ContractsScreen";
import { EntityScreen } from "../EntityScreen";
import { IPScreen } from "../IPScreen";
import { IncorporateScreen } from "../IncorporateScreen";
import { PoliciesScreen } from "../PoliciesScreen";
import { calendarMonths, calendarRows } from "../legal-data";
import { NOW, createFakeSource, renderScreen, type FakeSource } from "./fake-source";
import {
  BID,
  compliance,
  dataResponses,
  emptyResponses,
  lookupResult,
  recommendation,
} from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

function renderAs(
  prefs: typeof ISO_24H,
  ui: ReactNode,
  fake: FakeSource = createFakeSource({ businessId: BID, responses: dataResponses }),
) {
  return {
    fake,
    ...renderScreen(fake, <DateFormatProvider value={prefs}>{ui}</DateFormatProvider>),
  };
}

describe("legal dates follow the person's date format", () => {
  it("the compliance calendar's month labels", () => {
    const months = calendarMonths(calendarRows(compliance, NOW), NOW, 12, ISO_24H);
    expect(months[0]!.label).toBe("2026-10");
    expect(calendarMonths([], NOW, 3, DAY_FIRST_24H).map((m) => m.label)).toEqual([
      "Oct 2026",
      "Nov 2026",
      "Dec 2026",
    ]);
  });

  it("Entity: formed, officers' appointments and a lookup's deadlines", async () => {
    const { container, unmount } = renderAs(ISO_24H, <EntityScreen {...props} />);
    expect(
      within(screen.getByRole("grid", { name: "Officers" })).getByText("2025-06-15"),
    ).toBeTruthy();
    expect(screen.getAllByText("2024-03-01").length).toBeGreaterThan(0);
    expect(usDatesIn(container)).toEqual([]);
    unmount();
    const fake = createFakeSource({
      businessId: BID,
      responses: emptyResponses,
      onMutate: (path) => (path === "legal.import.lookup" ? lookupResult : {}),
    });
    renderAs(DAY_FIRST_24H, <EntityScreen {...props} />, fake);
    const form = screen.getByRole("form", { name: "Import existing company" });
    fireEvent.change(within(form).getByLabelText("Registration number"), {
      target: { value: "12345678" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Look up" }));
    const result = await screen.findByRole("region", { name: "Lookup result" });
    expect(
      within(result).getByText(
        /Deadlines found: Annual accounts 31 Mar 2027 · Confirmation statement 14 Mar 2027/,
      ),
    ).toBeTruthy();
  });

  it("Incorporate: date-checked stamps and the steps' dates", async () => {
    const fake = createFakeSource({
      businessId: BID,
      responses: dataResponses,
      onMutate: (path) => (path === "legal.recommend" ? recommendation : {}),
    });
    const { container } = renderAs(ISO_24H, <IncorporateScreen {...props} />, fake);
    expect(screen.getByText(/Done · 2026-10-05/)).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("form", { name: "Recommender inputs" })).getByRole("button", {
        name: "Recommend",
      }),
    );
    const section = await screen.findByRole("region", { name: "Recommendation" });
    expect(
      within(within(section).getAllByRole("article")[0]!).getByText("Date checked 2026-10-07"),
    ).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("IP: the screened date of each mark", () => {
    const { container } = renderAs(ISO_24H, <IPScreen {...props} />);
    const form = screen.getByRole("form", { name: "Screen a mark" });
    fireEvent.change(within(form).getByLabelText("Word mark"), {
      target: { value: "Fresh Skincare" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Screen" }));
    expect(
      within(screen.getByRole("grid", { name: "Marks screened" })).getByText(/^\d{4}-\d{2}-\d{2}$/),
    ).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Contracts: the table, the term and the obligations", async () => {
    const { container } = renderAs(ISO_24H, <ContractsScreen {...props} />);
    expect(
      within(screen.getByRole("grid", { name: "Contracts" })).getAllByText("2027-10-31").length,
    ).toBeGreaterThan(0);
    fireEvent.doubleClick(
      within(screen.getByRole("grid", { name: "Contracts" })).getByText(
        "Acme Retail master services agreement",
      ),
    );
    const detail = await screen.findByRole("region", {
      name: "Acme Retail master services agreement",
    });
    expect(within(detail).getByText(/^2026-11-01 → /)).toBeTruthy();
    expect(
      within(within(detail).getByRole("table", { name: "Obligations" })).getByText("2026-12-01"),
    ).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Compliance: the list, then the calendar's months and days", () => {
    const { container, unmount } = renderAs(ISO_24H, <ComplianceScreen {...props} />);
    expect(
      within(screen.getByRole("grid", { name: "Deadlines" })).getByText("2026-10-20"),
    ).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
    unmount();
    const cal = renderAs(DAY_FIRST_24H, <ComplianceScreen {...props} subView="calendar" />);
    const october = within(screen.getByRole("list", { name: "Twelve-month calendar" })).getByRole(
      "listitem",
      { name: "Oct 2026" },
    );
    expect(within(october).getByText("20 Oct")).toBeTruthy();
    expect(usDatesIn(cal.container)).toEqual([]);
  });

  it("Policies: the generated-on date (the policy text itself is stored and keeps its words)", () => {
    const { container } = renderAs(ISO_24H, <PoliciesScreen {...props} />);
    expect(screen.getByText(/the legal entity and the archetype on 2026-10-07\./)).toBeTruthy();
    expect(container.textContent).not.toContain("on Oct 7, 2026");
  });
});
