import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { matchDayFixture, NORTHWIND_KIT } from "../fixtures";
import { MatchdayRoundupTable, sortRoundupRows, type RoundupRow } from "../MatchdayRoundupTable";
import { JourneyStage } from "./JourneyStage";
import { buildReplaySchedule } from "./schedule";

const fx = matchDayFixture();

function setReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: query.includes("reduce") ? matches : false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => setReducedMotion(false));

describe("JourneyStage", () => {
  it("starts on Who was involved with the captain starred and steps through every stage", async () => {
    const user = userEvent.setup();
    const onOpenEntity = vi.fn();
    const { container } = render(<JourneyStage journey={fx.journey} touches={fx.touches} customer={fx.customer} agents={fx.agents} kit={NORTHWIND_KIT} autoplay={false} overlay="none" onOpenEntity={onOpenEntity} />);
    const root = container.querySelector("[data-journey-stage]")!;
    expect(root.getAttribute("data-stage")).toBe("team_sheet");
    expect(root.getAttribute("data-schedule-hash")).toBe(buildReplaySchedule(fx.journey, fx.touches, "full").hash);
    expect([...screen.getAllByLabelText("Lead channel"), ...screen.getAllByLabelText("Standout agent")].length).toBe(2);
    expect(screen.getByText("Featured update")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "First touch" }));
    expect(root.getAttribute("data-stage")).toBe("kick_off");
    expect(container.querySelector("[data-stage-panel='kick_off']")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Touches" }));
    expect(container.querySelectorAll("[data-touch-row]").length).toBe(fx.touches.length);
    await user.click(screen.getAllByRole("link", { name: "Nordic Beauty AB" })[0] as HTMLElement);
    expect(onOpenEntity).toHaveBeenCalledWith(fx.journey.entityId);
    await user.click(screen.getByRole("button", { name: "Rails" }));
    expect(container.querySelector("[data-rail-panel='attribution']")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "xC curve" }));
    expect(container.querySelector("[data-rail-panel='xc']")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Expected conversion over the journey/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("tablist", { name: "Stat panels" }), { key: "ArrowRight" });
    expect(container.querySelector("[data-rail-panel='attribution']")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Win moment" }));
    expect(container.querySelector("[data-stage-panel='goal']")).toBeTruthy();
    expect(screen.getByText("Customer won")).toBeTruthy();
    expect(screen.getAllByText("Sound off").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Debrief" }));
    expect(container.querySelectorAll("[data-agent-rating]").length).toBe(3);
    expect(screen.getByText("Standout agent")).toBeTruthy();
    expect(screen.getByLabelText("Rating 10 of 10")).toBeTruthy();
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);
  });

  it("Instant speed lands on the debrief at once and speed changes are reported", async () => {
    const user = userEvent.setup();
    const onSpeedChange = vi.fn();
    const { container } = render(<JourneyStage journey={fx.journey} touches={fx.touches} customer={fx.customer} kit={NORTHWIND_KIT} defaultSpeed="instant" onSpeedChange={onSpeedChange} overlay="none" />);
    const root = container.querySelector("[data-journey-stage]")!;
    expect(root.getAttribute("data-stage")).toBe("full_time");
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Highlights" }));
    expect(onSpeedChange).toHaveBeenCalledWith("highlights");
    expect(root.getAttribute("data-journey-stage")).toBe("highlights");
    expect(screen.getByRole("button", { name: "Highlights" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/00:00 \/ 00:1[0-5]/)).toBeTruthy();
  });

  it("plays the clock from the Play control and pauses", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<JourneyStage journey={fx.journey} touches={fx.touches} customer={fx.customer} kit={NORTHWIND_KIT} defaultSpeed="highlights" autoplay={false} overlay="none" />);
      const root = container.querySelector("[data-journey-stage]")!;
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      await vi.advanceTimersByTimeAsync(2600);
      expect(Number(root.getAttribute("data-time"))).toBeGreaterThan(2000);
      expect(root.getAttribute("data-stage")).toBe("kick_off");
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      const paused = Number(root.getAttribute("data-time"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(Number(root.getAttribute("data-time"))).toBe(paused);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reduced motion renders the static summary with every fact (AC-11.4.5)", () => {
    setReducedMotion(true);
    const { container } = render(<JourneyStage journey={fx.journey} touches={fx.touches} customer={fx.customer} kit={NORTHWIND_KIT} overlay="none" />);
    expect(container.querySelector("[data-journey-stage='static']")).toBeTruthy();
    expect(container.querySelector("[data-stage-panel='goal'][data-static]")).toBeTruthy();
    expect(container.querySelector("[data-stage-panel='full_time']")).toBeTruthy();
    expect(container.querySelector("[data-stage-panel='team_sheet']")).toBeTruthy();
    expect(container.querySelector("[data-stage-panel='rails']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(container.querySelector("[data-goal-burst]")).toBeNull();
  });
});

const roundupRows: RoundupRow[] = [
  { conversionId: "c1", kind: "signup", level: "friendly", customerName: "Linnea Haug", channelKey: "seo", amountMinor: 0, currency: "EUR", occurredAt: "2026-10-07T08:10:00.000Z", touchCount: 3 },
  { conversionId: "c2", kind: "payment", level: "cup", customerName: "Alma Botanics", entityId: "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c", channelKey: "paid_ads", amountMinor: 5900, currency: "EUR", occurredAt: "2026-10-07T11:42:00.000Z", touchCount: 7 },
  { conversionId: "c3", kind: "activation", level: "league", customerName: null, channelKey: null, amountMinor: 0, currency: "EUR", occurredAt: "2026-10-07T09:30:00.000Z", touchCount: 2, replayAvailable: false },
];

describe("MatchdayRoundupTable", () => {
  it("sorts, totals and opens replays", async () => {
    const user = userEvent.setup();
    const onOpenReplay = vi.fn();
    const { container } = render(<MatchdayRoundupTable rows={roundupRows} day="2026-10-07" onOpenReplay={onOpenReplay} />);
    const ids = () => Array.from(container.querySelectorAll("[data-roundup-row]")).map((r) => r.getAttribute("data-roundup-row"));
    expect(ids()).toEqual(["c2", "c3", "c1"]);
    expect(screen.getByText("1 payments · 1 activations · 1 signups")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Time" }));
    expect(ids()).toEqual(["c1", "c3", "c2"]);
    await user.click(screen.getByRole("button", { name: "Win" }));
    expect(ids()[0]).toBe("c2");
    await user.click(screen.getByRole("button", { name: "Replay payment for Alma Botanics" }));
    expect(onOpenReplay).toHaveBeenCalledWith("c2");
    expect((screen.getByRole("button", { name: "Replay activation" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sortRoundupRows(roundupRows, "value", "desc")[0]?.conversionId).toBe("c2");
    expect(screen.getByText("Anonymous")).toBeTruthy();
  });
  it("shows an empty state", () => {
    render(<MatchdayRoundupTable rows={[]} onOpenReplay={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Wins that do not get a full Customer Update");
  });
});
