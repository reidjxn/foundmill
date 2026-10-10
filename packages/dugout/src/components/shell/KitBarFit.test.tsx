import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(document.querySelector(".kitbar-date .kitbar-year")?.textContent).toBe(" 2026");
    // The mode chip says the mode once; the holiday is in its label (and beside Continue).
    expect(screen.getByRole("group", { name: "Business mode: Automated, on holiday" }).textContent).toBe("Automated");
    expect(document.querySelectorAll(".kitbar-chip-word")).toHaveLength(2);
    expect(document.querySelector(".kitbar-holiday-full")?.textContent).toBe("On holiday until 21 Oct 2026");
    expect(document.querySelector(".kitbar-holiday-short")?.textContent).toBe("Until 21 Oct");
    expect(screen.getByText("On holiday until 21 Oct 2026", { selector: ".sr-only" })).toBeTruthy();
    expect(holidayCaptionParts({ kind: "holiday", until: null, untilLabel: "the launch ships" })).toEqual({ full: "On holiday until the launch ships", year: "", short: "Until the launch ships" });
  });
});
