import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { CONTINUE_PULSE_MS, ContinueButton, continueButtonAction, continueButtonLabel, continueTooltip, cycleDefinitionSentence, holidayCaption, holidayCaptionParts, untilPhrase } from "./ContinueButton";
import type { ContinueState } from "./types";

describe("ContinueButton", () => {
  it("says what pressing does, in the business's words, per state (B1)", async () => {
    expect(continueTooltip({ kind: "idle" })).toBe("Let the team work until nothing is left to do. Their notes land in the Inbox.");
    expect(continueTooltip({ kind: "blocked", count: 2 })).toBe("2 things need you before the team can work (credits used up or a key to replace). Press to open the first.");
    expect(continueTooltip({ kind: "blocked", count: 1 })).toBe("1 thing needs you before the team can work (credits used up or a key to replace). Press to open the first.");
    expect(continueTooltip({ kind: "processing" }, 3)).toBe("The team is working · round of work 3");
    expect(continueTooltip({ kind: "processing" })).toBe("The team is working");
    // A run (one press, Nov 7, 2026): new cycles start on their own, between cycles too.
    expect(continueTooltip({ kind: "processing", run: true }, 5)).toBe("The team is working · round of work 5. New rounds of work start on their own until nothing is left to do.");
    expect(continueTooltip({ kind: "processing", run: true })).toBe("The team is working. New rounds of work start on their own until nothing is left to do.");
    expect(continueTooltip({ kind: "matchday" })).toBe("A customer was won");
    expect(continueTooltip({ kind: "holiday", until: "2026-10-14" })).toBe("On vacation until Oct 14, 2026");
    const user = userEvent.setup();
    render(<ContinueButton state={{ kind: "processing" }} cycleNumber={3} />);
    const button = screen.getByRole("button", { name: "Pause the team" });
    // The next wave's first-time callout anchors on the button.
    expect(button.getAttribute("data-coachmark")).toBe("continue");
    await user.hover(button);
    expect((await screen.findAllByText("The team is working · round of work 3")).length).toBeGreaterThan(0);
  });

  it("names and defines the round of work in the idle tooltip while guidance is on, as a sentence (a tooltip holds no Term)", async () => {
    const short = "A stretch where the team works for a while, then reports back in the Inbox.";
    expect(cycleDefinitionSentence(short)).toBe("A round of work is a stretch where the team works for a while, then reports back in the Inbox.");
    expect(cycleDefinitionSentence("  ")).toBe("");
    expect(continueTooltip({ kind: "idle" }, null, null, short)).toBe("Let the team work, one round of work after another, until nothing is left to do. A round of work is a stretch where the team works for a while, then reports back in the Inbox.");
    // Only idle changes; no definition, no change.
    expect(continueTooltip({ kind: "blocked", count: 1 }, null, null, short)).toBe("1 thing needs you before the team can work (credits used up or a key to replace). Press to open the first.");
    expect(continueTooltip({ kind: "idle" }, null, null, null)).toBe("Let the team work until nothing is left to do. Their notes land in the Inbox.");

    const user = userEvent.setup();
    // Outside a provider guidance reads as on: the definition comes from the source map.
    const { unmount } = render(<ContinueButton state={{ kind: "idle" }} />);
    await user.hover(screen.getByRole("button", { name: /Continue/ }));
    expect((await screen.findAllByText(/A round of work is a stretch where the team works/)).length).toBeGreaterThan(0);
    unmount();
    // The business's own words win, and guidance off says the plain sentence.
    const terms = { cycle: { id: "cycle", word: "Sprint", short: "One sprint of work." } };
    const on = render(
      <GuidanceProvider value={{ terms }}>
        <ContinueButton state={{ kind: "idle" }} />
      </GuidanceProvider>,
    );
    await user.hover(screen.getByRole("button", { name: /Continue/ }));
    expect((await screen.findAllByText(/A round of work is one sprint of work\./)).length).toBeGreaterThan(0);
    on.unmount();
    render(
      <GuidanceProvider value={{ guidance: "off", terms }}>
        <ContinueButton state={{ kind: "idle" }} />
      </GuidanceProvider>,
    );
    await user.hover(screen.getByRole("button", { name: /Continue/ }));
    expect((await screen.findAllByText("Let the team work until nothing is left to do. Their notes land in the Inbox.")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/A round of work is/)).toBeNull();
  });

  it("a caveat says what a press can and cannot do right now, under the tooltip and on the button (first-time founder report, Nov 8, 2026)", async () => {
    const user = userEvent.setup();
    const caveat = "The orchestrator is not reachable: a press writes one note; no agent works.";
    render(<ContinueButton state={{ kind: "idle" }} caveat={caveat} />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button.getAttribute("data-continue-caveat")).toBe(caveat);
    await user.hover(button);
    expect((await screen.findAllByText(caveat)).length).toBeGreaterThan(0);
    // The state's own sentence stays first; the caveat follows it.
    expect(screen.getAllByText(/^Let the team work/).length).toBeGreaterThan(0);
  });

  it("a hint gives the press a price under the tooltip: what the last round of work cost, as an Estimate", async () => {
    const user = userEvent.setup();
    render(<ContinueButton state={{ kind: "idle" }} hint="The last round of work cost $0.52 · Estimate" />);
    await user.hover(screen.getByRole("button", { name: "Continue" }));
    const hint = (await screen.findAllByText("The last round of work cost $0.52 · Estimate"))[0]!;
    expect(hint.hasAttribute("data-continue-hint")).toBe(true);
    expect(hint.className).toContain("text-secondary");
  });

  it("labels every state (BUILD §5.4)", () => {
    expect(continueButtonLabel({ kind: "idle" })).toBe("Continue");
    expect(continueButtonLabel({ kind: "blocked", count: 3 })).toBe("Needs you · 3");
    expect(continueButtonLabel({ kind: "processing" })).toBe("Pause");
    expect(continueButtonLabel({ kind: "matchday" })).toBe("Go to Journey");
    expect(continueButtonLabel({ kind: "holiday", until: null })).toBe("Come back");
    expect(holidayCaption({ kind: "holiday", until: "2026-10-14" })).toBe("On vacation until Oct 14, 2026");
    expect(holidayCaption({ kind: "holiday", until: null, untilLabel: "the launch ships" })).toBe("On vacation until the launch ships");
    expect(holidayCaption({ kind: "holiday", until: null })).toBe("On vacation");
  });

  it("never doubles the word until in a vacation caption", () => {
    // The open-ended vacation stores "until I return"; a founder may type "until MRR hits 10k".
    expect(holidayCaption({ kind: "holiday", until: null, untilLabel: "until I return" })).toBe("On vacation until I return");
    expect(holidayCaptionParts({ kind: "holiday", until: null, untilLabel: "until I return" })).toEqual({ full: "On vacation until I return", date: null, short: "Until I return" });
    expect(holidayCaption({ kind: "holiday", until: null, untilLabel: "Until MRR hits 10k" })).toBe("On vacation until MRR hits 10k");
    expect(untilPhrase("untilled soil")).toBe("untilled soil");
  });

  it("routes click and Space to the state's action", async () => {
    const user = userEvent.setup();
    const handlers = { onContinue: vi.fn(), onRespond: vi.fn(), onPause: vi.fn(), onGoToJourney: vi.fn(), onComeBack: vi.fn() };
    expect(continueButtonAction({ kind: "blocked", count: 1 }, handlers)).toBe(handlers.onRespond);
    expect(continueButtonAction({ kind: "matchday" }, handlers)).toBe(handlers.onGoToJourney);
    const { rerender } = render(<ContinueButton state={{ kind: "idle" }} bindSpace {...handlers} />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    document.body.focus();
    await user.keyboard(" ");
    expect(handlers.onContinue).toHaveBeenCalledTimes(2);
    rerender(<ContinueButton state={{ kind: "blocked", count: 2 }} bindSpace {...handlers} />);
    const respond = screen.getByRole("button", { name: "2 things need you before the team can work" });
    expect(respond.getAttribute("data-variant")).toBe("default");
    expect(respond.textContent).toContain("Needs you · 2");
    await user.keyboard(" ");
    expect(handlers.onRespond).toHaveBeenCalledTimes(1);
    rerender(<ContinueButton state={{ kind: "holiday", until: "2026-10-14" }} bindSpace {...handlers} />);
    expect(screen.getByText("On vacation until Oct 14, 2026")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Come back" }));
    expect(handlers.onComeBack).toHaveBeenCalledTimes(1);
  });

  it("renders processing as a dark slab with an orbiting edge and Pause, blocked as amber Needs you with a count capsule, Customer Update in gold", () => {
    const { rerender } = render(<ContinueButton state={{ kind: "processing" }} />);
    const pause = screen.getByRole("button", { name: "Pause the team" });
    expect(pause.getAttribute("data-continue-state")).toBe("processing");
    expect(pause.className).toContain("orbit");
    expect(pause.className).toContain("continue-skin");
    expect(pause.textContent).toBe("Pause");
    rerender(<ContinueButton state={{ kind: "blocked", count: 7 }} />);
    const respond = screen.getByRole("button", { name: "7 things need you before the team can work" });
    expect(respond.querySelector("[data-continue-count]")?.textContent).toBe("7");
    // The separator is for assistive tech and text checks only: the eye reads "Needs you [7]".
    expect(respond.textContent).toBe("Needs you · 7");
    expect(respond.className).toContain("tone-status-warn");
    rerender(<ContinueButton state={{ kind: "matchday" }} />);
    expect(screen.getByRole("button", { name: "Go to Journey" }).getAttribute("data-variant")).toBe("gold");
  });

  it("keeps the orbit and Pause for a whole run, between rounds of work too (Nov 7, 2026)", async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    render(<ContinueButton state={{ kind: "processing", run: true }} onPause={onPause} />);
    const pause = screen.getByRole("button", { name: "Pause the team" });
    expect(pause.className).toContain("orbit");
    expect(pause.textContent).toBe("Pause");
    await user.hover(pause);
    expect((await screen.findAllByText("The team is working. New rounds of work start on their own until nothing is left to do.")).length).toBeGreaterThan(0);
    await user.click(pause);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("pulses once for 600 ms when pulseKey changes, not on mount", () => {
    vi.useFakeTimers();
    try {
      const state: ContinueState = { kind: "idle" };
      const { rerender } = render(<ContinueButton state={state} pulseKey="cycle-1" />);
      const button = () => screen.getByRole("button", { name: "Continue" });
      expect(button().getAttribute("data-pulsing")).toBeNull();
      rerender(<ContinueButton state={state} pulseKey="cycle-2" />);
      expect(button().getAttribute("data-pulsing")).toBe("true");
      expect(button().className).toContain("animate-ring-pulse");
      act(() => vi.advanceTimersByTime(CONTINUE_PULSE_MS + 1));
      expect(button().getAttribute("data-pulsing")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pulses once when it turns blocked, never on mount", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ContinueButton state={{ kind: "blocked", count: 1 }} />);
      expect(screen.getByRole("button", { name: "1 thing needs you before the team can work" }).getAttribute("data-pulsing")).toBeNull();
      rerender(<ContinueButton state={{ kind: "idle" }} />);
      expect(screen.getByRole("button", { name: "Continue" }).getAttribute("data-pulsing")).toBeNull();
      rerender(<ContinueButton state={{ kind: "blocked", count: 2 }} />);
      const respond = screen.getByRole("button", { name: "2 things need you before the team can work" });
      expect(respond.getAttribute("data-pulsing")).toBe("true");
      expect(respond.className).toContain("animate-ring-pulse");
      act(() => vi.advanceTimersByTime(CONTINUE_PULSE_MS + 1));
      expect(screen.getByRole("button", { name: "2 things need you before the team can work" }).getAttribute("data-pulsing")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps keyboard focus while its action is pending and across a change of state (WCAG 2.4.3)", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onComeBack = vi.fn();
    const { rerender } = render(<ContinueButton state={{ kind: "idle" }} onContinue={onContinue} onComeBack={onComeBack} />);
    const button = screen.getByRole("button", { name: "Continue" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onContinue).toHaveBeenCalledTimes(1);
    // The cycle is starting: the button is busy and refuses a second press, but it still has focus.
    rerender(<ContinueButton state={{ kind: "idle" }} pending onContinue={onContinue} onComeBack={onComeBack} />);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Enter}");
    expect(onContinue).toHaveBeenCalledTimes(1);
    rerender(<ContinueButton state={{ kind: "processing" }} onContinue={onContinue} onComeBack={onComeBack} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause the team" }));
    // Vacation wraps the button with its caption (a new element): focus follows it there and back.
    rerender(<ContinueButton state={{ kind: "holiday", until: "2026-10-21" }} onContinue={onContinue} onComeBack={onComeBack} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Come back" }));
    rerender(<ContinueButton state={{ kind: "idle" }} onContinue={onContinue} onComeBack={onComeBack} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Continue" }));
  });

  it("does not act when disabled", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<ContinueButton state={{ kind: "idle" }} bindSpace disabled onContinue={onContinue} />);
    document.body.focus();
    await user.keyboard(" ");
    expect(onContinue).not.toHaveBeenCalled();
  });
});
