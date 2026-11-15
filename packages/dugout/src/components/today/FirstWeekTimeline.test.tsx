import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FIRST_WEEK_TIMELINE_WORDS, FirstWeekTimeline, type FirstWeekTimelineStep } from "./FirstWeekTimeline";

const steps: FirstWeekTimelineStep[] = [
  { id: "day1", label: "Day 1", state: "done", when: "Done Oct 7", team: "Drafted the specification and the roadmap.", asks: "You signed off the specification and the roadmap." },
  { id: "days2to3", label: "Days 2–3", state: "now", when: "Oct 8 – 9 (Estimate)", team: "Your team builds the first pieces of work.", asks: "You are asked to approve your first goal." },
  { id: "week1", label: "Week 1", state: "next", when: "Oct 10 – 13 (Estimate)", team: "Your team starts approaching the first customers.", asks: "You are asked “Ready to start selling?”." },
];

describe("FirstWeekTimeline", () => {
  it("lists the three steps with state, date, what the team does and what you are asked; the step under way is current", () => {
    render(<FirstWeekTimeline steps={steps} />);
    expect(screen.getByRole("heading", { name: FIRST_WEEK_TIMELINE_WORDS.title })).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Your first week" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "now", "next"]);
    expect(items[1]!.getAttribute("aria-current")).toBe("step");
    expect(items[0]!.getAttribute("aria-current")).toBeNull();
    expect(within(items[0]!).getByText("Done Oct 7")).toBeTruthy();
    expect(within(items[2]!).getByText("Oct 10 – 13 (Estimate)")).toBeTruthy();
    expect(screen.getByText("1 of 3 steps done")).toBeTruthy();
  });

  it("says when the team is stopped", () => {
    render(<FirstWeekTimeline steps={steps} paused="The team is stopped, so nothing moves on until you resume it." />);
    expect(screen.getByText(/The team is stopped/)).toBeTruthy();
  });
});
