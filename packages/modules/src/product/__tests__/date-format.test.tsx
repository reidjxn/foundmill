import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { DateFormatProvider } from "@foundmill/dugout";
import type { ReactNode } from "react";
import { DAY_FIRST_24H, ISO_24H, usDatesIn } from "../../dates.testing";
import { ChangesScreen } from "../ChangesScreen";
import { ResearchScreen } from "../ResearchScreen";
import { RoadmapScreen } from "../RoadmapScreen";
import { SourcesScreen } from "../SourcesScreen";
import { SpecificationScreen } from "../SpecificationScreen";
import { VisionScreen } from "../VisionScreen";
import { timelineScale } from "../roadmap/board";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses, roadmap } from "./fixtures";

const departments = [
  {
    id: "d1",
    name: "Product",
    slug: "product",
    colourToken: "dept-1",
    position: 0,
    moduleKeys: ["product"],
    lead: null,
    squad: [],
    tabs: [
      { id: "t1", slug: "specification", title: "Specification", position: 1 },
      { id: "t2", slug: "roadmap", title: "Roadmap", position: 2 },
    ],
  },
];
const props = { businessId: BID, departmentId: "d1" };

function renderAs(prefs: typeof ISO_24H, ui: ReactNode) {
  const fake = createFakeSource({
    businessId: BID,
    responses: { ...dataResponses, "department.list": departments },
  });
  return renderScreen(fake, <DateFormatProvider value={prefs}>{ui}</DateFormatProvider>);
}

describe("product dates follow the person's date format", () => {
  it("the roadmap timeline's year ticks", () => {
    const items = roadmap.items;
    const ticks = (prefs: typeof ISO_24H) =>
      timelineScale(
        [...items, { ...items[0]!, targetStart: "2026-12-01", targetEnd: "2027-02-15" }],
        new Date("2026-10-07T12:00:00Z"),
        prefs,
      ).ticks.map((t) => t.label);
    expect(ticks(ISO_24H)).toContain("2027-01");
    expect(ticks(ISO_24H)).toContain("Feb");
    expect(ticks(DAY_FIRST_24H)).toContain("Jan 2027");
  });

  it("Vision: the published version and Now items' target dates", () => {
    const { container } = renderAs(ISO_24H, <VisionScreen {...props} />);
    expect(screen.getByText("Version 3 · published 2026-10-04 · 5 blocks · 2 pinned")).toBeTruthy();
    expect(screen.getByText("by 10-20")).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Sources: the date each source was added", () => {
    const { container } = renderAs(DAY_FIRST_24H, <SourcesScreen {...props} />);
    expect(within(screen.getByRole("grid")).getByText("4 Oct 2026")).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Changes: raised and resolved dates, and the open proposal's moment on a 24-hour clock", () => {
    const { container } = renderAs(ISO_24H, <ChangesScreen {...props} />);
    expect(container.textContent).toMatch(/· 2026-10-05 \d{2}:00/);
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Research: each note's date", () => {
    const { container } = renderAs(DAY_FIRST_24H, <ResearchScreen {...props} />);
    expect(
      within(screen.getByRole("list", { name: "Research notes" })).getByText("4 Oct"),
    ).toBeTruthy();
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Specification: each version's date, and the restore dialog", async () => {
    const { container } = renderAs(ISO_24H, <SpecificationScreen {...props} />);
    const list = screen.getByRole("list", { name: "Spec versions" });
    expect(within(list).getByText("10-04")).toBeTruthy();
    expect(within(list).getByText("10-04").closest("time")!.getAttribute("title")).toMatch(
      /^2026-10-04 \d{2}:00$/,
    );
    expect(usDatesIn(container)).toEqual([]);
    fireEvent.click(within(list).getByRole("button", { name: "Select version 2 for comparison" }));
    fireEvent.click(within(list).getByRole("button", { name: "Select version 3 for comparison" }));
    fireEvent.click(screen.getByRole("button", { name: /^Compare$/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore v2" }),
    );
    expect(
      within(await screen.findByRole("dialog", { name: /Restore version 2/ })).getByText(
        /published 2026-09-20\./,
      ),
    ).toBeTruthy();
  });

  it("Roadmap: card target dates (board) and the Today tag (timeline)", () => {
    const board = renderAs(ISO_24H, <RoadmapScreen {...props} />);
    expect(screen.getByText("by 10-20").getAttribute("title")).toBe("2026-09-28 – 2026-10-20");
    expect(usDatesIn(board.container)).toEqual([]);
    board.unmount();
    const timeline = renderAs(DAY_FIRST_24H, <RoadmapScreen {...props} subView="timeline" />);
    expect(timeline.container.querySelector("[data-today-tag]")!.textContent).toMatch(
      /^Today · \d{1,2} [A-Z][a-z]{2}$/,
    );
    expect(usDatesIn(timeline.container)).toEqual([]);
  });
});
