import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DateFormatProvider } from "../foundation/DateFormatProvider";
import { ContinueButton, holidayCaptionParts } from "./ContinueButton";
import { createSearchWidthCache, fitKitBar, KitBarFit, KITBAR_COMPACT_STEPS, KITBAR_SEARCH_FULL_WIDTH, kitBarFits, kitBarIsRoomy, kitBarSearchFullWidth, setKitBarCompact } from "./KitBarFit";
import { GameModeChip, KITBAR_BRIEF_CLASS, KITBAR_BRIEF_ONLY_CLASS, ModeChip, modeChipTooltip } from "./ModeChip";
import { RunwayChip } from "./RunwayChip";

describe("KitBarFit", () => {
  it("applies the compaction steps one at a time, cumulatively, until the bar fits", () => {
    const bar = document.createElement("header");
    // Fits once the holiday caption is short (step 3; the brief phrase and the year went first).
    const level = fitKitBar(bar, (b) => (b.getAttribute("data-compact") ?? "").split(" ").includes("holiday-short"));
    expect(level).toBe(3);
    expect(bar.getAttribute("data-compact")).toBe("chips-brief year holiday-short");
    // A bar that fits whole, with its search at full width, carries no steps.
    expect(fitKitBar(bar, () => true)).toBe(0);
    expect(bar.hasAttribute("data-compact")).toBe(false);
    // A bar that never fits stops at the last step instead of looping.
    expect(fitKitBar(bar, () => false)).toBe(KITBAR_COMPACT_STEPS.length);
    setKitBarCompact(bar, 0);
    expect(bar.hasAttribute("data-compact")).toBe(false);
  });

  it("drops the chips' second phrase first, as soon as the search is below its whole width, before anything else gives way", () => {
    const bar = document.createElement("header");
    const search = document.createElement("button");
    search.setAttribute("data-testid", "kitbar-search");
    bar.append(search);
    let width = KITBAR_SEARCH_FULL_WIDTH;
    search.getBoundingClientRect = () => ({ width }) as DOMRect;
    expect(kitBarIsRoomy(bar)).toBe(true);
    expect(fitKitBar(bar, () => true)).toBe(0);
    // The search squeezed to 276 px: the brief words go, nothing else (the bar fits).
    width = 276;
    expect(kitBarIsRoomy(bar)).toBe(false);
    expect(fitKitBar(bar, () => true)).toBe(1);
    expect(bar.getAttribute("data-compact")).toBe("chips-brief");
    // Without a search in the bar the chips may keep their words.
    expect(kitBarIsRoomy(document.createElement("header"))).toBe(true);
    expect(KITBAR_COMPACT_STEPS[0]).toBe("chips-brief");
    expect(KITBAR_BRIEF_CLASS).toContain("chips-brief");
  });

  it("reads the search's whole width once, not on every change of words in the bar; a resize reads it again", async () => {
    const reads = vi.fn((search: HTMLElement) => kitBarSearchFullWidth(search));
    const cache = createSearchWidthCache(reads);
    const search = document.createElement("button");
    expect(cache.get(search)).toBe(KITBAR_SEARCH_FULL_WIDTH);
    cache.get(search);
    expect(reads).toHaveBeenCalledTimes(1);
    cache.clear();
    cache.get(search);
    expect(reads).toHaveBeenCalledTimes(2);
    // Another search element (the bar rendered again) is read afresh.
    cache.get(document.createElement("button"));
    expect(reads).toHaveBeenCalledTimes(3);

    // In the bar: three changes of the title's words, one style read of the search (the first fit's).
    const spy = vi.spyOn(window, "getComputedStyle");
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    try {
      render(
        <header>
          <span data-testid="kitbar-screen-title">Home</span>
          <button type="button" data-testid="kitbar-search">
            Search
          </button>
          <KitBarFit />
        </header>,
      );
      const title = screen.getByTestId("kitbar-screen-title");
      for (const words of ["Inbox", "Finance", "Runway"]) {
        await act(async () => {
          title.textContent = words;
          await Promise.resolve();
        });
      }
      const searchReads = spy.mock.calls.filter(([el]) => (el as HTMLElement).getAttribute?.("data-testid") === "kitbar-search").length;
      expect(searchReads).toBe(1);
      // The bar was fitted on load and after each change all the same (the search measured each time).
      const fits = rects.mock.contexts.filter((el) => (el as HTMLElement).getAttribute?.("data-testid") === "kitbar-search").length;
      expect(fits).toBeGreaterThanOrEqual(4);
    } finally {
      spy.mockRestore();
      rects.mockRestore();
    }
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
        <ModeChip mode="automated" holiday spendLineMinor={100_000} currency="GBP" />
        <ContinueButton state={{ kind: "holiday", until: "2026-10-21" }} />
      </header>,
    );
    expect(document.querySelector(".kitbar-date .kitbar-year")?.textContent).toBe(", 2026");
    // The mode chip says the setting in words at the widest step and its short form once the bar tightens; the holiday
    // is in its label (and beside Continue).
    const mode = screen.getByRole("group", { name: "What the team can do: decides alone, asks over £1,000, on vacation" });
    expect(mode.querySelector("[data-chip-full]")?.textContent).toBe("Decides alone, asks over £1,000");
    expect(mode.querySelector("[data-chip-full]")?.className).toContain(KITBAR_BRIEF_CLASS);
    expect(mode.querySelector("[data-chip-brief]")?.textContent).toBe("Asks over £1,000");
    expect(mode.querySelector("[data-chip-brief]")?.className).toContain(KITBAR_BRIEF_ONLY_CLASS);
    // The runway chip carries its short reason the same way.
    expect(document.querySelector("[data-runway-brief]")?.textContent).toBe("· connect a bank");
    expect(document.querySelectorAll(".kitbar-chip-word:not([data-chip-brief])")).toHaveLength(2);
    expect(document.querySelector(".kitbar-holiday-full")?.textContent).toBe("On vacation until Oct 21, 2026");
    expect(document.querySelector(".kitbar-holiday-short")?.textContent).toBe("Until Oct 21");
    expect(screen.getByText("On vacation until Oct 21, 2026", { selector: ".sr-only" })).toBeTruthy();
    expect(holidayCaptionParts({ kind: "holiday", until: null, untilLabel: "the launch ships" })).toEqual({ full: "On vacation until the launch ships", date: null, short: "Until the launch ships" });
    // A label that already says "until" is not doubled ("Until until I return").
    expect(holidayCaptionParts({ kind: "holiday", until: null, untilLabel: "until I return" })).toEqual({ full: "On vacation until I return", date: null, short: "Until I return" });
  });

  it("shows what is in force on vacation, saying what comes back (OL-26)", () => {
    render(<ModeChip mode="assisted" holiday spendLineMinor={5_000} currency="GBP" />);
    const chip = screen.getByRole("group", { name: "What the team can do: decides alone, asks over £50, on vacation; asks before spending over £50 when you come back" });
    expect(chip.querySelector("[data-chip-full]")?.textContent).toBe("Decides alone, asks over £50");
    expect(chip.getAttribute("data-mode")).toBe("automated");
    expect(chip.getAttribute("data-base-mode")).toBe("assisted");
    expect(modeChipTooltip("assisted", true, { spendLineMinor: 5_000, currency: "GBP" })).toMatch(/^On vacation\. .* Back to: asks before spending over £50\.$/);
  });

  it("tells the stakes in plain words with the business's currency, and where to change them (B3)", () => {
    expect(modeChipTooltip("assisted", false, { spendLineMinor: 5_000, currency: "GBP" })).toBe("The team does routine work on its own. It asks you before spending over £50, before anything it can't undo and before any contract. Moving money, signing and filings always come to you. Change it in Settings › What the team can do.");
    expect(modeChipTooltip("augmented")).toBe("The team prepares the work and asks you before contacting anyone, spending anything or doing what can't be undone. Moving money, signing and filings always come to you. Change it in Settings › What the team can do.");
    expect(modeChipTooltip("automated", false, { spendLineMinor: 100_000, currency: "USD" })).toMatch(/^The team works and decides on its own, and the Chief of Staff answers routine questions for you\. It still asks you before spending over \$1,000\./);
    // No line set: each agent's own limit, with the real default, never "no limit".
    expect(modeChipTooltip("assisted", false, { spendLineMinor: null, currency: "GBP" })).toContain("before spending over each agent's own limit (£250 unless you set one)");
    render(
      <>
        <ModeChip mode="assisted" spendLineMinor={5_000} currency="GBP" />
        <ModeChip mode="assisted" spendLineMinor={0} currency="GBP" />
        <ModeChip mode="assisted" spendLineMinor={null} currency="GBP" />
        <ModeChip mode="augmented" spendLineMinor={5_000} currency="GBP" />
        <ModeChip mode="automated" spendLineMinor={1_000_000} currency="SEK" />
      </>,
    );
    const part = (name: string, which: "full" | "brief") => screen.getByRole("group", { name }).querySelector(`[data-chip-${which}]`)?.textContent;
    expect(part("What the team can do: asks before spending over £50", "full")).toBe("Asks before spending over £50");
    expect(part("What the team can do: asks before spending over £50", "brief")).toBe("Asks over £50");
    expect(part("What the team can do: asks before any spending", "full")).toBe("Asks before any spending");
    expect(part("What the team can do: asks before spending over each agent's limit", "full")).toBe("Asks before spending over each agent's limit");
    expect(part("What the team can do: asks before spending over each agent's limit", "brief")).toBe("Asks before spending");
    expect(part("What the team can do: asks before acting", "full")).toBe("Asks before acting");
    expect(part("What the team can do: asks before acting", "brief")).toBe("Asks first");
    expect(part("What the team can do: decides alone, asks over kr 10K", "full")).toBe("Decides alone, asks over kr 10K");
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
