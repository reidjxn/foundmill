import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DateFormatProvider } from "../foundation/DateFormatProvider";
import { ContinueButton, holidayCaptionParts } from "./ContinueButton";
import { fitKitBar, KITBAR_COMPACT_STEPS, kitBarFits, setKitBarCompact } from "./KitBarFit";
import { GameModeChip, ModeChip } from "./ModeChip";
import { RunwayChip } from "./RunwayChip";

describe("KitBarFit", () => {
  it("applies the compaction steps one at a time, cumulatively, until the bar fits", () => {
    const bar = document.createElement("header");
    // Fits once the holiday caption is short (step 2).
    const level = fitKitBar(bar, (b) => (b.getAttribute("data-compact") ?? "").split(" ").includes("holiday-short"));
    expect(level).toBe(2);
    expect(bar.getAttribute("data-compact")).toBe("year holiday-short");
    // A bar that fits whole carries no steps.
    expect(fitKitBar(bar, () => true)).toBe(0);
    expect(bar.hasAttribute("data-compact")).toBe(false);
    // A bar that never fits stops at the last step instead of looping.
    expect(fitKitBar(bar, () => false)).toBe(KITBAR_COMPACT_STEPS.length);
    setKitBarCompact(bar, 0);
    expect(bar.hasAttribute("data-compact")).toBe(false);
  });

  it("asks for the screen title's room (its natural width, at most 120 px) as well as no overflow", () => {
    const bar = document.createElement("header");
    const title = document.createElement("h1");
    title.setAttribute("data-testid", "kitbar-screen-title");
    const ghost = document.createElement("span");
    ghost.className = "fit-ghost";
    title.append(ghost);
    bar.append(title);
    let natural = 46;
    Object.defineProperty(ghost, "scrollWidth", { get: () => natural });
    title.getBoundingClientRect = () => ({ width: 30 }) as DOMRect;
    expect(kitBarFits(bar)).toBe(false);
    title.getBoundingClientRect = () => ({ width: 46 }) as DOMRect;
    expect(kitBarFits(bar)).toBe(true);
    natural = 400;
    title.getBoundingClientRect = () => ({ width: 120 }) as DOMRect;
    expect(kitBarFits(bar)).toBe(true);
  });

  it("gives the chips parts that can step down: the year, the date, the words and the holiday caption", () => {
    render(
      <header>
        <RunwayChip date="2026-10-10" runwayMonths={null} />
        <GameModeChip mode="live" />
        <ModeChip mode="automated" holiday />
        <ContinueButton state={{ kind: "holiday", until: "2026-10-21" }} />
      </header>,
    );
    expect(document.querySelector(".kitbar-date .kitbar-year")?.textContent).toBe(", 2026");
    // The mode chip says the mode once; the holiday is in its label (and beside Continue).
    expect(screen.getByRole("group", { name: "Business mode: Automated, on vacation" }).textContent).toBe("Automated");
    expect(document.querySelectorAll(".kitbar-chip-word")).toHaveLength(2);
    expect(document.querySelector(".kitbar-holiday-full")?.textContent).toBe("On vacation until Oct 21, 2026");
    expect(document.querySelector(".kitbar-holiday-short")?.textContent).toBe("Until Oct 21");
    expect(screen.getByText("On vacation until Oct 21, 2026", { selector: ".sr-only" })).toBeTruthy();
    expect(holidayCaptionParts({ kind: "holiday", until: null, untilLabel: "the launch ships" })).toEqual({ full: "On vacation until the launch ships", date: null, short: "Until the launch ships" });
  });

  it("drops the year first in the signed-in person's own date format (DateFormatProvider)", () => {
    const { unmount } = render(
      <DateFormatProvider value={{ date: "day_first", time: "24h" }}>
        <header>
          <RunwayChip date="2026-10-10" runwayMonths={null} />
          <ContinueButton state={{ kind: "holiday", until: "2026-10-21" }} />
        </header>
      </DateFormatProvider>,
    );
    expect(screen.getByTestId("kitbar-date").textContent).toBe("10 Oct 2026");
    expect(document.querySelector(".kitbar-date .kitbar-year")?.textContent).toBe(" 2026");
    expect(document.querySelector(".kitbar-holiday-full")?.textContent).toBe("On vacation until 21 Oct 2026");
    expect(document.querySelector(".kitbar-holiday-short")?.textContent).toBe("Until 21 Oct");
    unmount();
    render(
      <DateFormatProvider value={{ date: "iso", time: "24h" }}>
        <header>
          <RunwayChip date="2026-10-10" runwayMonths={null} />
          <ContinueButton state={{ kind: "holiday", until: "2026-10-21" }} />
        </header>
      </DateFormatProvider>,
    );
    // ISO puts the year first, so the part that goes is a lead: "2026-" + "10-10".
    expect(screen.getByTestId("kitbar-date").textContent).toBe("2026-10-10");
    expect(document.querySelector(".kitbar-date .kitbar-year")?.textContent).toBe("2026-");
    expect(document.querySelector(".kitbar-holiday-full")?.textContent).toBe("On vacation until 2026-10-21");
    expect(holidayCaptionParts({ kind: "holiday", until: "2026-10-21" }, { date: "iso", time: "12h" })).toEqual({ full: "On vacation until ", date: { lead: "2026-", core: "10-21", tail: "" }, short: "Until 10-21" });
  });
});
