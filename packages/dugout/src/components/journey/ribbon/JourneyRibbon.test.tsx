import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { generateJourneyFixture, RIBBON_DEPARTMENTS } from "../fixtures";
import { JourneyRibbon, RIBBON_GUTTER, RIBBON_TOOLBAR, type JourneyRibbonHandle } from "./JourneyRibbon";

const data = generateJourneyFixture({ days: 120, seed: "ribbon-test" });
const PLOT_W = 1200 - RIBBON_GUTTER;
/** Client coordinates of a point in the plot (the ribbon sits at 0,0). */
const plotX = (fraction: number) => RIBBON_GUTTER + PLOT_W * fraction;
const PLOT_Y = RIBBON_TOOLBAR + 100;

function renderRibbon(extra: Partial<React.ComponentProps<typeof JourneyRibbon>> = {}) {
  const ref = createRef<JourneyRibbonHandle>();
  const onOpenJourney = vi.fn();
  const onOpenDay = vi.fn();
  const onZoomChange = vi.fn();
  const utils = render(
    <JourneyRibbon
      ref={ref}
      currency="EUR"
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
  it("renders labelled rows (revenue, signups, paying customers, hours of team work), the forecast, runway, Today and a summary label", () => {
    const { container } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    expect(root.getAttribute("aria-label")).toContain("6 departments");
    expect(root.getAttribute("aria-label")).toMatch(/\d+ milestones/);
    expect(container.querySelector("[data-revenue-line]")).toBeTruthy();
    for (const kind of ["signups", "payments", "hours"]) expect(container.querySelector(`[data-track='${kind}']`)?.children.length).toBeGreaterThan(0);
    const labels = container.querySelector("[data-ribbon-labels]")!;
    for (const name of ["Revenue", "New signups", "Paying customers", "Hours of team work"]) expect(labels.textContent).toContain(name);
    // No "agent hours" anywhere a founder reads or hears (UX plan §8.2: the team's hours, in plain words).
    expect(labels.textContent).not.toMatch(/agent hours/i);
    expect(root.getAttribute("aria-label")).toMatch(/\d+ hours of team work/);
    expect(root.getAttribute("aria-label")).not.toMatch(/agent hours/i);
    const legend = container.querySelector("[data-ribbon-legend]")!;
    for (const name of ["Revenue", "Forecast", "Milestones", "Planned"]) expect(legend.textContent).toContain(name);
    expect(container.querySelector("[data-forecast]")).toBeTruthy();
    // 5 months of runway falls inside the 6-month horizon: the day the cash runs out is drawn.
    expect(container.querySelector("[data-runway]")?.getAttribute("data-runway")).toBe("bad");
    expect(container.querySelector("[data-runway]")?.textContent).toMatch(/^Cash runs out ~[A-Z][a-z]{2} \d{4} · Estimate$/);
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

  it("opens a Customer Update from a day with one payment and the day from a bar with several", async () => {
    const user = userEvent.setup();
    const { onOpenJourney, onOpenDay, container } = renderRibbon({ defaultZoom: "month" });
    const single = Array.from(container.querySelectorAll("[data-marker='payment'][data-count='1']")).find((el) => /Opens the Customer Update/.test(el.getAttribute("data-label") ?? "")) as SVGGElement | undefined;
    expect(single).toBeTruthy();
    await user.click(single as unknown as Element);
    expect(onOpenJourney).toHaveBeenCalledTimes(1);
    expect(data.conversions.some((c) => c.id === onOpenJourney.mock.calls[0]?.[0])).toBe(true);
    await user.click(screen.getByRole("button", { name: "All time" }));
    const bucket = Array.from(container.querySelectorAll("[data-marker='payment']")).find((el) => Number(el.getAttribute("data-count")) > 1) as SVGGElement | undefined;
    expect(bucket).toBeTruthy();
    await user.click(bucket as unknown as Element);
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay.mock.calls[0]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is one Tab stop: the payment bars are pointer targets, and arrow keys walk the days with a spoken readout", async () => {
    const user = userEvent.setup();
    const { onOpenDay, onOpenJourney, container } = renderRibbon({ defaultZoom: "month" });
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    // Nothing inside the aria-hidden plot takes focus (it used to hold one Tab stop per payment bar).
    expect(container.querySelectorAll("svg [tabindex], svg [role=button]")).toHaveLength(0);
    expect(root.getAttribute("aria-label")).toContain("Arrow keys move through the days");
    root.focus();
    await user.keyboard("{ArrowLeft}");
    const scrubber = container.querySelector("[data-scrubber]");
    const day = scrubber?.getAttribute("data-key-day");
    expect(day).toBe(new Date(Date.parse(`${data.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
    // The label column and the live readout follow the keyboard's day.
    const readout = container.querySelector("[data-ribbon-day-readout]")!;
    expect(readout.getAttribute("aria-live")).toBe("polite");
    expect(readout.textContent).toMatch(/new signups, .* paying customers, .* hours of team work\.$/);
    expect(container.querySelector("[data-on-this-day]")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onOpenDay.mock.calls.length + onOpenJourney.mock.calls.length).toBe(1);
    if (onOpenDay.mock.calls.length) expect(onOpenDay).toHaveBeenCalledWith(day);
    // Escape lets go of the day; the readout empties.
    await user.keyboard("{Escape}");
    expect(container.querySelector("[data-scrubber]")).toBeNull();
    expect(readout.textContent).toBe("");
  });

  it("scrolls with Shift+arrow keys and wheel, clamps, keeps the keyboard's day in view, and Home returns to today", () => {
    renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    const start = Number(root.getAttribute("data-scroll-x"));
    const exact = Number(root.getAttribute("data-scroll-x"));
    fireEvent.keyDown(root, { key: "ArrowLeft", shiftKey: true });
    expect(Number(root.getAttribute("data-scroll-x"))).toBeCloseTo(Math.max(0, exact - PLOT_W * 0.5), -0.5);
    fireEvent.keyDown(root, { key: "ArrowRight", shiftKey: true });
    expect(Number(root.getAttribute("data-scroll-x"))).toBeCloseTo(exact, -0.5);
    // A plain arrow walks the days; the window moves only once the day nears its edge.
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(Number(root.getAttribute("data-scroll-x"))).toBeCloseTo(exact, -0.5);
    fireEvent.wheel(root, { deltaY: 100000 });
    const max = Number(root.getAttribute("data-scroll-x"));
    fireEvent.wheel(root, { deltaY: 100 });
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(max);
    fireEvent.keyDown(root, { key: "Home" });
    expect(Number(root.getAttribute("data-scroll-x"))).toBe(start);
  });

  it("shows the On this day card on hover, opens the day on click, and ignores the label column", () => {
    const { onOpenDay, container } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 300, width: 1200, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(root, { clientX: plotX(0.7), clientY: PLOT_Y });
    const card = container.querySelector("[data-on-this-day]");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("Today");
    expect(container.querySelector("[data-scrubber]")).toBeTruthy();
    fireEvent.pointerDown(root, { clientX: plotX(0.7), clientY: PLOT_Y, button: 0 });
    fireEvent.pointerUp(root, { clientX: plotX(0.7), clientY: PLOT_Y, button: 0 });
    expect(onOpenDay).toHaveBeenCalledWith(data.today);
    fireEvent.pointerLeave(root);
    expect(container.querySelector("[data-on-this-day]")).toBeNull();
    // Over the row labels there is no day to show or open.
    fireEvent.pointerMove(root, { clientX: 40, clientY: PLOT_Y });
    expect(container.querySelector("[data-on-this-day]")).toBeNull();
    fireEvent.pointerDown(root, { clientX: 40, clientY: PLOT_Y, button: 0 });
    fireEvent.pointerUp(root, { clientX: 40, clientY: PLOT_Y, button: 0 });
    expect(onOpenDay).toHaveBeenCalledTimes(1);
  });

  it("labels show the last 7 days, then the hovered day's values", () => {
    const { container } = renderRibbon();
    const root = screen.getByRole("group", { name: /Journey ribbon/ });
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 300, width: 1200, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const read = (key: string) => container.querySelector(`[data-readout='${key}']`)?.textContent ?? "";
    expect(container.querySelector("[data-readout-when]")?.textContent).toBe("Last 7 days");
    const weekStart = new Date(Date.parse(`${data.today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    const weekSignups = data.rows.filter((r) => r.departmentId === null && r.day >= weekStart && r.day <= data.today).reduce((s, r) => s + r.signups, 0);
    expect(read("signups")).toBe(String(weekSignups));
    fireEvent.pointerMove(root, { clientX: plotX(0.7), clientY: PLOT_Y });
    expect(container.querySelector("[data-readout-when]")?.textContent).toBe("Today");
    const todayRow = data.rows.find((r) => r.departmentId === null && r.day === data.today)!;
    expect(read("signups")).toBe(String(todayRow.signups));
    expect(read("payments")).toBe(String(todayRow.payments));
    expect(read("revenue-day")).toMatch(/on the day$/);
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
      expect(container.querySelector("[data-today-tag]")?.textContent).toContain("Today · ");
      expect(container.querySelector("[data-today-tag]")?.textContent).toContain(" · 1 live");
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
    rerender(<JourneyRibbon rows={data.rows} departments={RIBBON_DEPARTMENTS} today={data.today} width={1200} overlay="none" animateIn={false} zoom="all" currency="EUR" />);
    expect(screen.getByRole("group", { name: /Journey ribbon/ }).getAttribute("data-zoom")).toBe("all");
  });
});
