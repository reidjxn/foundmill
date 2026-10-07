import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateJourneyFixture, RIBBON_DEPARTMENTS } from "../fixtures";
import { JourneyRibbon, type JourneyRibbonHandle } from "./JourneyRibbon";

const data = generateJourneyFixture({ days: 120, seed: "ribbon-test" });

function renderRibbon(extra: Partial<React.ComponentProps<typeof JourneyRibbon>> = {}) {
  const ref = createRef<JourneyRibbonHandle>();
  const onOpenJourney = vi.fn();
  const onOpenDay = vi.fn();
  const onZoomChange = vi.fn();
  const utils = render(
    <JourneyRibbon
      ref={ref}
      rows={data.rows}
      departments={RIBBON_DEPARTMENTS}
      conversions={data.conversions}
      milestones={data.milestones}
      chapters={data.chapters}
      forecast={data.forecast}
      roadmap={data.roadmap}
      runwayMonths={5}
      today={data.today}
      width={1200}
      height={300}
      overlay="svg"
      animateIn={false}
      onOpenJourney={onOpenJourney}
      onOpenDay={onOpenDay}
      onZoomChange={onZoomChange}
      kit={{ primary: "#2B6CB0", secondary: "#FFFFFF" }}
      {...extra}
    />,
  );
  return { ref, onOpenJourney, onOpenDay, onZoomChange, ...utils };
}

describe("JourneyRibbon", () => {
  it("renders the river, revenue line, forecast, runway, Today line and a summary label", () => {
    const { container } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    expect(root.getAttribute("aria-label")).toContain("6 departments");
    expect(container.querySelectorAll("[data-band]").length).toBe(6);
    expect(container.querySelector("[data-revenue-line]")).toBeTruthy();
    expect(container.querySelector("[data-forecast]")).toBeTruthy();
    expect(container.querySelector("[data-runway]")?.getAttribute("data-runway")).toBe("bad");
    expect(container.querySelector("[data-today]")).toBeTruthy();
    expect(container.querySelector("[data-pixi-layer]")).toBeNull();
    expect(root.getAttribute("data-zoom")).toBe("quarter");
  });

  it("switches zoom with the controls and keyboard, reporting changes", async () => {
    const user = userEvent.setup();
    const { onZoomChange } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(onZoomChange).toHaveBeenCalledWith("week");
    expect(root.getAttribute("data-zoom")).toBe("week");
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    root.focus();
    await user.keyboard("-");
    expect(root.getAttribute("data-zoom")).toBe("month");
    await user.keyboard("-");
    await user.keyboard("-");
    expect(root.getAttribute("data-zoom")).toBe("all");
    await user.keyboard("+");
    expect(root.getAttribute("data-zoom")).toBe("quarter");
  });

  it("opens a Customer Update from a single payment marker and a day from a bucket", async () => {
    const user = userEvent.setup();
    const { onOpenJourney, onOpenDay, container } = renderRibbon({ defaultZoom: "week" });
    const single = container.querySelector("[data-marker='payment'][data-count='1']") as SVGGElement | null;
    expect(single).toBeTruthy();
    await user.click(single as unknown as Element);
    expect(onOpenJourney).toHaveBeenCalledTimes(1);
    expect(data.conversions.some((c) => c.id === onOpenJourney.mock.calls[0]?.[0])).toBe(true);
    await user.click(screen.getByRole("button", { name: "All time" }));
    const bucket = Array.from(container.querySelectorAll("[data-marker='signup']")).find((el) => Number(el.getAttribute("data-count")) > 1) as SVGGElement | undefined;
    expect(bucket).toBeTruthy();
    (bucket as unknown as HTMLElement).focus();
    fireEvent.keyDown(bucket as unknown as Element, { key: "Enter" });
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay.mock.calls[0]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("scrolls with arrow keys and wheel, clamps, and Home returns to today", () => {
    renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    const start = Number(root.getAttribute("data-scroll-x"));
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(start + 120);
    fireEvent.keyDown(root, { key: "ArrowLeft", shiftKey: true });
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(Math.max(0, start + 120 - 600));
    fireEvent.wheel(root, { deltaY: 100000 });
    const max = Number(root.getAttribute("data-scroll-x"));
    fireEvent.wheel(root, { deltaY: 100 });
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(max);
    fireEvent.keyDown(root, { key: "Home" });
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(start);
  });

  it("shows the On this day card on hover and opens the day on click", () => {
    const { onOpenDay, container } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 300, width: 1200, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(root, { clientX: 840, clientY: 150 });
    const card = container.querySelector("[data-on-this-day]");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("Today");
    expect(container.querySelector("[data-scrubber]")).toBeTruthy();
    fireEvent.pointerDown(root, { clientX: 840, clientY: 150, button: 0 });
    fireEvent.pointerUp(root, { clientX: 840, clientY: 150, button: 0 });
    expect(onOpenDay).toHaveBeenCalledWith(data.today);
    fireEvent.pointerLeave(root);
    expect(container.querySelector("[data-on-this-day]")).toBeNull();
  });

  it("treats a drag as a scroll, not a click", () => {
    const { onOpenDay } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    const start = Number(root.getAttribute("data-scroll-x"));
    fireEvent.pointerDown(root, { clientX: 600, clientY: 150, button: 0, pointerId: 1 });
    fireEvent.pointerMove(root, { clientX: 500, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(root, { clientX: 500, clientY: 150, button: 0, pointerId: 1 });
    expect(onOpenDay).not.toHaveBeenCalled();
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(start + 100);
  });

  it("ripples live events into Today (SVG fallback) and announces them", () => {
    vi.useFakeTimers();
    try {
      const { ref, container } = renderRibbon();
      act(() => ref.current?.ripple({ kind: "payment", amountMinor: 5900, label: "Payment from Alma Botanics" }));
      expect(container.querySelector("[data-ripple='payment']")).toBeTruthy();
      expect(screen.getByText("Payment from Alma Botanics just now")).toBeTruthy();
      expect(container.querySelector("[data-today] text")?.textContent).toContain("LIVE 1");
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(container.querySelector("[data-ripple]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("controlled zoom follows the prop", () => {
    const { rerender } = renderRibbon({ zoom: "month" });
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    expect(root.getAttribute("data-zoom")).toBe("month");
    rerender(<JourneyRibbon rows={data.rows} departments={RIBBON_DEPARTMENTS} today={data.today} width={1200} overlay="none" animateIn={false} zoom="all" />);
    expect(screen.getByRole("group", { name: /Journey ribbon/ }).getAttribute("data-zoom")).toBe("all");
  });
});
