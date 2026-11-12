import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StreakStrip } from "./StreakStrip";

afterEach(cleanup);

const week = ["visited", "vacation", "missed", "visited", "visited", "visited", "today"].map((state, i) => ({ day: `2026-11-0${i + 1}`, label: `D${i}`, state: state as "visited" | "vacation" | "missed" | "today" }));

describe("StreakStrip", () => {
  it("shows the headline, the line and seven labeled days, and says when it is at risk", () => {
    render(<StreakStrip headline="3 days in a row" line="Open your business today to make it 4 days." week={week} atRisk />);
    expect(screen.getByTestId("streak-headline").textContent).toBe("3 days in a row");
    expect(screen.getByText("Open your business today to make it 4 days.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "The last seven days" }).querySelectorAll("li")).toHaveLength(7);
    expect(screen.getByText("On vacation: the streak is frozen")).toBeTruthy();
    expect(screen.getByTestId("streak-strip").getAttribute("data-at-risk")).toBe("true");
  });
});
