import "./setup";
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { DateFormatProvider } from "@foundmill/dugout";
import type { ReactNode } from "react";
import { DAY_FIRST_24H, ISO_24H, usDatesIn } from "../../dates.testing";
import { AttributionScreen } from "../AttributionScreen";
import { CampaignsScreen } from "../CampaignsScreen";
import { LeadsScreen } from "../LeadsScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d1" };

function renderAs(prefs: typeof ISO_24H, ui: ReactNode) {
  const fake = createFakeSource({ businessId: BID, responses: dataResponses });
  return renderScreen(fake, <DateFormatProvider value={prefs}>{ui}</DateFormatProvider>);
}

describe("distribution dates follow the person's date format", () => {
  it("Campaigns: starts and ends, in the table and the detail", () => {
    const { container } = renderAs(ISO_24H, <CampaignsScreen {...props} />);
    expect(screen.getAllByText("2026-10-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-10-31").length).toBeGreaterThan(0);
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Leads: when each lead was added (relative, with the date on hover)", () => {
    const { container } = renderAs(DAY_FIRST_24H, <LeadsScreen {...props} />);
    const titles = Array.from(
      within(screen.getByRole("grid", { name: "Leads" })).getAllByText(/ago|just now|yesterday/),
    ).map((el) => el.getAttribute("title"));
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Attribution: the latest wins' dates and their Open buttons", () => {
    const { container } = renderAs(ISO_24H, <AttributionScreen {...props} />);
    expect(screen.getByText("2026-10-10")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Customer Update 2026-10-10" })).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });
});
