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
import { addDays } from "@foundmill/widgets";
import { BID, dataResponses, TODAY } from "./fixtures";

const props = { businessId: BID, departmentId: "d1" };

function renderAs(prefs: typeof ISO_24H, ui: ReactNode) {
  const fake = createFakeSource({ businessId: BID, responses: dataResponses });
  return renderScreen(fake, <DateFormatProvider value={prefs}>{ui}</DateFormatProvider>);
}

describe("distribution dates follow the person's date format", () => {
  it("Campaigns: starts and ends, in the table and the detail", () => {
    const { container } = renderAs(ISO_24H, <CampaignsScreen {...props} />);
    // The fixtures are relative to today: the launch runs from 10 days ago to 20 days ahead.
    expect(screen.getAllByText(addDays(TODAY, -10)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(addDays(TODAY, 20)).length).toBeGreaterThan(0);
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
    // The latest win in the fixtures is yesterday's payment.
    const latest = addDays(TODAY, -1);
    expect(screen.getAllByText(latest).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: `Open Customer Update ${latest}` })).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });
});
