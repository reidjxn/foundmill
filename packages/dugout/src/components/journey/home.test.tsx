import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DayDigest } from "./DayDigest";
import { DepartmentCard } from "./DepartmentCard";
import { departmentCardFixtures, generateJourneyFixture, RIBBON_DEPARTMENTS, squadPulseFixture, trophyFixtures } from "./fixtures";
import { indexDailyRows, summariseDay } from "./ribbon/geometry";
import { buildPulseGrid, SquadPulse } from "./SquadPulse";
import { TrophyCabinet } from "./TrophyCabinet";

const cards = departmentCardFixtures();

describe("DepartmentCard", () => {
  it("renders each health state with a worded pill, the team strip and the metric", () => {
    const { container } = render(
      <>
        {cards.map((d) => (
          <DepartmentCard key={d.id} department={d} />
        ))}
      </>,
    );
    expect(container.querySelector("[data-department='d-distribution']")?.getAttribute("data-health")).toBe("good");
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("Failing")).toBeTruthy();
    expect(container.querySelectorAll("[data-department='d-development'] [data-squad-member]").length).toBe(5);
    // The figure is set in parts (dimmed raised currency, dimmed decimals); its text is the whole value.
    const figure = document.querySelector("[data-department-metric] [data-figure]");
    expect(figure?.textContent).toBe("€41.20");
    expect(figure?.querySelector(".t-currency")?.textContent).toBe("€");
    expect(figure?.querySelector(".t-decimals")?.textContent).toBe(".20");
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
    expect(screen.getByText("Quiet", { selector: "[data-now-quiet]" })).toBeTruthy();
    expect(screen.queryByText(/next cycle starts with Continue/)).toBeNull();
  });
  it("links entities in Now lines, exposes member status in the name and opens agents", async () => {
    const user = userEvent.setup();
    const onOpenEntity = vi.fn();
    const onOpenAgent = vi.fn();
    const onOpen = vi.fn();
    render(<DepartmentCard department={cards[0]!} onOpenEntity={onOpenEntity} onOpenAgent={onOpenAgent} onOpen={onOpen} entityKinds={{ "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c": "organisation" }} />);
    await user.click(screen.getByRole("link", { name: "Nordic Beauty AB" }));
    expect(onOpenEntity).toHaveBeenCalledWith("0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c");
    await user.click(screen.getByRole("button", { name: /Beacon, Paid ads, Degraded: Waiting: budget above threshold/ }));
    expect(onOpenAgent).toHaveBeenCalledWith("dept-3-2");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("d-distribution");
  });
});

describe("DepartmentCard · quiet", () => {
  const quiet = cards.find((d) => d.now.length === 0)!;

  it("fills Now with the line it is given, which opens the note", async () => {
    const user = userEvent.setup();
    const onOpenQuiet = vi.fn();
    const { container } = render(<DepartmentCard department={{ ...quiet, quiet: { kind: "respond", label: "Waiting for you", text: "Approve the Q4 retail terms", detail: "2 more in the Inbox" } }} onOpenQuiet={onOpenQuiet} />);
    expect(screen.getByText("Quiet", { selector: "[data-now-quiet]" })).toBeTruthy();
    expect(container.querySelector("[data-now-lines]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Waiting for you: Approve the Q4 retail terms. 2 more in the Inbox" }));
    expect(onOpenQuiet).toHaveBeenCalledTimes(1);
  });

  it("states a finished task as plain text, and says only what it knows without a line", () => {
    const { container, unmount } = render(<DepartmentCard department={{ ...quiet, quiet: { kind: "finished", label: "Last finished", text: "Customer interview synthesis", detail: "Aug 31" } }} onOpenQuiet={() => {}} />);
    expect(screen.getByText("Last finished")).toBeTruthy();
    expect(screen.getByText("Aug 31")).toBeTruthy();
    // A task is not something to open from Home: no button.
    expect(screen.queryByRole("button", { name: /Last finished/ })).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")?.getAttribute("data-now-quiet-line")).toBe("finished");
    unmount();
    render(<DepartmentCard department={{ ...quiet, quiet: null }} />);
    expect(screen.getByText("Nothing in progress right now.")).toBeTruthy();
  });

  it("shows placeholders while the work is loading instead of calling the department quiet", () => {
    const { container } = render(<DepartmentCard department={{ ...quiet, nowLoading: true }} />);
    expect(container.querySelector("[data-now-quiet]")).toBeNull();
    expect(container.querySelector("[data-now-quiet-line]")).toBeNull();
    expect(screen.getByLabelText("Loading what the team is doing").getAttribute("aria-busy")).toBe("true");
  });
});

describe("SquadPulse", () => {
  const { cells, days } = squadPulseFixture();
  it("folds cells into a 7 × 24 grid led by the busiest department", () => {
    const { grid, max } = buildPulseGrid(RIBBON_DEPARTMENTS, cells);
    expect(grid.length).toBe(7);
    expect(grid.every((r) => r.length === 24)).toBe(true);
    expect(max).toBeGreaterThan(0);
    const busy = grid.flat().find((c) => c.total > 0)!;
    expect(busy.lead?.id).toBe(busy.breakdown[0]?.department.id);
    expect(busy.breakdown[0]!.agentHours).toBeGreaterThanOrEqual(busy.breakdown[busy.breakdown.length - 1]!.agentHours);
  });
  it("renders 168 grid cells with roving focus and selection", async () => {
    const onSelect = vi.fn();
    const { container } = render(<SquadPulse departments={RIBBON_DEPARTMENTS} days={days} cells={cells} onSelect={onSelect} />);
    expect(container.querySelectorAll("[data-pulse-cell]").length).toBe(168);
    expect(screen.getByRole("grid").getAttribute("aria-label")).toContain("agent hours over the last 7 days");
    const start = container.querySelector("[data-pulse-cell='6:9']") as HTMLElement;
    expect(start.tabIndex).toBe(0);
    start.focus();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowRight" });
    expect((document.activeElement as HTMLElement).getAttribute("data-pulse-cell")).toBe("6:10");
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowUp" });
    expect((document.activeElement as HTMLElement).getAttribute("data-pulse-cell")).toBe("5:10");
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(days[5], 10, expect.any(Array));
  });
  it("gives each visible hour label a box three columns wide and keeps a screen-reader header for every hour", () => {
    // A label box one column wide (about 24 px at 1280) cannot hold "12 AM" (about 35 px): no-clip.spec flagged all 8.
    render(<SquadPulse departments={RIBBON_DEPARTMENTS} days={days} cells={cells} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.getAttribute("aria-label"))).toEqual(Array.from({ length: 24 }, (_, h) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`)));
    const visible = headers.filter((h) => !h.classList.contains("sr-only"));
    expect(visible.map((h) => h.textContent)).toEqual(["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM"]);
    for (const h of visible) {
      expect(h.className).toContain("flex-[3]");
      expect(h.className).not.toMatch(/\b(flex-1|invisible)\b/);
    }
  });
});

describe("TrophyCabinet", () => {
  it("gives reached milestones the gold treatment, keeps locked ones ghosted and shares", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onShare = vi.fn();
    const { container } = render(<TrophyCabinet trophies={trophyFixtures()} onOpen={onOpen} onShare={onShare} />);
    expect(screen.getByText("Milestones")).toBeTruthy();
    expect(screen.getByText("6 of 8 reached")).toBeTruthy();
    expect(container.querySelectorAll("[data-trophy][data-achieved]").length).toBe(6);
    expect(screen.getAllByText("Not yet").length).toBe(2);
    await user.click(screen.getByRole("button", { name: /First enterprise contract, reached Oct 1, 2026/ }));
    expect(onOpen).toHaveBeenCalledWith("first_enterprise_contract");
    await user.click(screen.getByRole("button", { name: "Share First customer" }));
    expect(onShare).toHaveBeenCalledWith("customer_1");
    expect(screen.queryByRole("button", { name: /1,000th customer/ })).toBeNull();
  });
});

describe("DayDigest", () => {
  it("shows the day's numbers, wins and team hours", async () => {
    const user = userEvent.setup();
    const data = generateJourneyFixture({ days: 40, seed: "digest" });
    const index = indexDailyRows(data.rows, RIBBON_DEPARTMENTS);
    const dayWithPayment = data.conversions.find((c) => c.kind === "payment")!.occurredAt.slice(0, 10);
    const summary = summariseDay(dayWithPayment, { index, departments: RIBBON_DEPARTMENTS, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
    const onOpenJourney = vi.fn();
    render(<DayDigest summary={summary} highlights={["Scout closed [[ent:0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c|Nordic Beauty AB]]"]} onOpenJourney={onOpenJourney} onOpenEntity={() => {}} />);
    expect(screen.getByRole("region", { name: /Day digest/ })).toBeTruthy();
    expect(screen.getByText("Agent hours")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nordic Beauty AB" })).toBeTruthy();
    const replay = screen.getAllByRole("button", { name: /Open the Customer Update/ })[0]!;
    await user.click(replay);
    expect(onOpenJourney).toHaveBeenCalledWith(summary.conversions[0]!.id);
    expect(screen.getByText(/won today/)).toBeTruthy();
  });
});
