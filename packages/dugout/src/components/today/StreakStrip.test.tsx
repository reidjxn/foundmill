import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StreakStrip } from "./StreakStrip";

afterEach(cleanup);

const opened = ["2026-11-04", "2026-11-05", "2026-11-07"].map((day, i) => ({ day, label: `D${i}` }));

describe("StreakStrip", () => {
  it("is one quiet line: the headline, the line and a dot for each day the founder came (WP-04 D5)", () => {
    render(<StreakStrip headline="3 days in a row" line="Your best yet. Come back tomorrow to keep it going." opened={opened} />);
    expect(screen.getByTestId("streak-headline").textContent).toBe("3 days in a row");
    expect(screen.getByText("Your best yet. Come back tomorrow to keep it going.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Days you opened it this week" }).querySelectorAll("li")).toHaveLength(3);
    const strip = screen.getByTestId("streak-strip");
    // Not a panel with a heading, and nothing about a day missed or a streak at risk.
    expect(strip.querySelector("h2, h3")).toBeNull();
    expect(strip.textContent).not.toMatch(/Not opened|at risk/i);
    expect(strip.hasAttribute("data-at-risk")).toBe(false);
  });

  it("draws no list when no day of the week was opened", () => {
    render(<StreakStrip headline="Start a streak today" line="Open your business each day to build one. Vacation days never break it." opened={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
