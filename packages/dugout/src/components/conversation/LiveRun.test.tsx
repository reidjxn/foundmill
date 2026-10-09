import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  LiveRun,
  formatLogTime,
  formatRunClock,
  liveRunSummary,
  type LiveRunItem,
} from "./LiveRun";
import { RUN_ACTIVITY, RUN_ITEMS, RUN_LOG, RUN_STEPS } from "./fixtures";

const METER = {
  tokens: 4812,
  elapsedMs: 19_000,
  remainingMs: 40_000,
  cost: { amountMinor: 21, currency: "GBP" },
};

describe("LiveRun", () => {
  it("draws the step rail: done, current (with its drafters), pending", () => {
    render(<LiveRun steps={RUN_STEPS} items={RUN_ITEMS} meter={METER} />);
    const steps = screen.getAllByTestId("live-run-step");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual([
      "done",
      "done",
      "current",
      "pending",
      "pending",
    ]);
    expect(steps[2]!.getAttribute("aria-current")).toBe("step");
    expect(steps[2]!.textContent).toContain("Drafting cards, in progress");
    expect(
      within(steps[2]!)
        .getAllByRole("img")
        .map((i) => i.getAttribute("aria-label")),
    ).toEqual(["Isolde", "Pike", "Marlow"]);
    expect(steps[0]!.querySelector("svg")).not.toBeNull();
  });

  it("says the segment bar's counts in words, and shapes each item by state", () => {
    render(<LiveRun steps={RUN_STEPS} items={RUN_ITEMS} meter={METER} />);
    const bar = screen.getByRole("img", { name: "2 of 12 cards landed, 1 drafting, 2 queued" });
    const segs = [...bar.children];
    expect(segs).toHaveLength(12);
    expect(segs.map((s) => s.getAttribute("data-state")).slice(0, 6)).toEqual([
      "landed",
      "landed",
      "drafting",
      "queued",
      "queued",
      "empty",
    ]);
    expect((segs[2] as HTMLElement).style.getPropertyValue("--progress")).toBe("0.45");
  });

  it("meters tokens, elapsed, time left and cost, with both estimates spelled in full", () => {
    render(<LiveRun steps={RUN_STEPS} items={RUN_ITEMS} meter={METER} />);
    const meter = screen.getByTestId("live-run-meter");
    expect(meter.textContent).toContain("2 of 12");
    expect(meter.textContent).toContain("4,812 tokens");
    expect(meter.textContent).toContain("0:19");
    expect(meter.textContent).toContain("about 0:40 left");
    expect(meter.textContent).toContain("£0.21");
    expect(within(meter).getAllByText("Estimate")).toHaveLength(2);
  });

  it("drops the time left once the run is done", () => {
    render(<LiveRun status="done" steps={RUN_STEPS} items={RUN_ITEMS} meter={METER} />);
    expect(screen.getByTestId("live-run-meter").textContent).not.toContain("left");
    expect(screen.getByTestId("live-run").getAttribute("data-status")).toBe("done");
  });

  it('attributes the work: "Marlow is drafting Shelfproof"', () => {
    render(<LiveRun steps={RUN_STEPS} activity={RUN_ACTIVITY} />);
    const list = screen.getByTestId("live-run-activity");
    expect(list.textContent).toContain("Marlow is drafting Shelfproof");
    expect(list.textContent).toContain("Teodor is up next");
    // Waiting is not working: no live portrait, no dots.
    expect(list.querySelectorAll("li")[1]!.hasAttribute("data-active")).toBe(false);
    expect(list.querySelectorAll("li")[0]!.hasAttribute("data-active")).toBe(true);
  });

  it("streams the active drafter's reasoning on the log line, named in their colour", () => {
    render(<LiveRun steps={RUN_STEPS} log={RUN_LOG} />);
    const log = screen.getByTestId("live-run-log");
    expect(log.textContent).toContain("14:06:21");
    expect(log.querySelector("[data-who]")!.textContent).toBe("Marlow");
    expect(log.className).toContain("tone-dept-7");
    // While the stream is open the words are read once, whole.
    expect(within(log).getByText(RUN_LOG.text).className).toContain("sr-only");
  });

  it("uses kit-lift, never a generic violet, when a drafter has no department", () => {
    render(
      <LiveRun
        steps={[
          {
            id: "s",
            label: "Drafting",
            state: "current",
            people: [{ name: "Ideation agent", avatarSeed: "ideation" }],
          },
        ]}
        log={{ text: "Weighing pull", person: { name: "Ideation agent", avatarSeed: "ideation" } }}
      />,
    );
    expect(screen.getByTestId("live-run-log").className).toContain("tone-kit-lift");
    expect(screen.getByTestId("live-run-step").className).toContain("tone-kit-lift");
  });
});

describe("live run helpers", () => {
  it("summarises items", () => {
    const items: LiveRunItem[] = [
      { id: "a", state: "landed" },
      { id: "b", state: "failed" },
    ];
    expect(liveRunSummary(items).words).toBe("1 of 2 cards landed, 1 could not be finished");
    expect(liveRunSummary([{ id: "a", state: "landed" }], ["concept", "concepts"]).words).toBe(
      "1 of 1 concept landed",
    );
  });
  it("formats clocks", () => {
    expect(formatRunClock(19_000)).toBe("0:19");
    expect(formatRunClock(64_000)).toBe("1:04");
    expect(formatRunClock(3_725_000)).toBe("1:02:05");
    expect(formatLogTime(new Date(2026, 9, 9, 14, 6, 21))).toBe("14:06:21");
  });
});
