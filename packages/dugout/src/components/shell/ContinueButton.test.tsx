import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTINUE_PULSE_MS, ContinueButton, continueButtonAction, continueButtonLabel, continueTooltip, holidayCaption, holidayCaptionParts, untilPhrase } from "./ContinueButton";
import type { ContinueState } from "./types";

describe("ContinueButton", () => {
  it("says what pressing does, in the business's words, per state (B1)", async () => {
    expect(continueTooltip({ kind: "idle" })).toBe("Let the team work on their next tasks. Their notes land in the Inbox.");
    expect(continueTooltip({ kind: "blocked", count: 2 })).toBe("2 notes need your answer before the team can carry on. Press to open the first.");
    expect(continueTooltip({ kind: "blocked", count: 1 })).toBe("1 note needs your answer before the team can carry on. Press to open the first.");
    expect(continueTooltip({ kind: "processing" }, 3)).toBe("The team is working · cycle 3");
    expect(continueTooltip({ kind: "processing" })).toBe("The team is working");
    expect(continueTooltip({ kind: "matchday" })).toBe("A customer was won");
    expect(continueTooltip({ kind: "holiday", until: "2026-10-14" })).toBe("On vacation until Oct 14, 2026");
    const user = userEvent.setup();
    render(<ContinueButton state={{ kind: "processing" }} cycleNumber={3} />);
    const button = screen.getByRole("button", { name: "Pause the running cycle" });
    // The next wave's first-time callout anchors on the button.
    expect(button.getAttribute("data-coachmark")).toBe("continue");
    await user.hover(button);
    expect((await screen.findAllByText("The team is working · cycle 3")).length).toBeGreaterThan(0);
  });

  it("labels every state (BUILD §5.4)", () => {
    expect(continueButtonLabel({ kind: "idle" })).toBe("Continue");
    expect(continueButtonLabel({ kind: "blocked", count: 3 })).toBe("Respond · 3");
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
    const respond = screen.getByRole("button", { name: "Respond to 2 items" });
    expect(respond.getAttribute("data-variant")).toBe("danger");
    expect(respond.textContent).toContain("Respond · 2");
    await user.keyboard(" ");
    expect(handlers.onRespond).toHaveBeenCalledTimes(1);
    rerender(<ContinueButton state={{ kind: "holiday", until: "2026-10-14" }} bindSpace {...handlers} />);
    expect(screen.getByText("On vacation until Oct 14, 2026")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Come back" }));
    expect(handlers.onComeBack).toHaveBeenCalledTimes(1);
  });

  it("renders processing as a dark slab with an orbiting edge and Pause, blocked as Respond with a count capsule, Customer Update in gold", () => {
    const { rerender } = render(<ContinueButton state={{ kind: "processing" }} />);
    const pause = screen.getByRole("button", { name: "Pause the running cycle" });
    expect(pause.getAttribute("data-continue-state")).toBe("processing");
    expect(pause.className).toContain("orbit");
    expect(pause.className).toContain("continue-skin");
    expect(pause.textContent).toBe("Pause");
    rerender(<ContinueButton state={{ kind: "blocked", count: 7 }} />);
    const respond = screen.getByRole("button", { name: "Respond to 7 items" });
    expect(respond.querySelector("[data-continue-count]")?.textContent).toBe("7");
    // The separator is for assistive tech and text checks only: the eye reads "Respond [7]".
    expect(respond.textContent).toBe("Respond · 7");
    expect(respond.className).toContain("tone-status-bad");
    rerender(<ContinueButton state={{ kind: "matchday" }} />);
    expect(screen.getByRole("button", { name: "Go to Journey" }).getAttribute("data-variant")).toBe("gold");
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

  it("pulses once in red when it turns blocked, never on mount", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ContinueButton state={{ kind: "blocked", count: 1 }} />);
      expect(screen.getByRole("button", { name: "Respond to 1 item" }).getAttribute("data-pulsing")).toBeNull();
      rerender(<ContinueButton state={{ kind: "idle" }} />);
      expect(screen.getByRole("button", { name: "Continue" }).getAttribute("data-pulsing")).toBeNull();
      rerender(<ContinueButton state={{ kind: "blocked", count: 2 }} />);
      const respond = screen.getByRole("button", { name: "Respond to 2 items" });
      expect(respond.getAttribute("data-pulsing")).toBe("true");
      expect(respond.className).toContain("animate-ring-pulse");
      act(() => vi.advanceTimersByTime(CONTINUE_PULSE_MS + 1));
      expect(screen.getByRole("button", { name: "Respond to 2 items" }).getAttribute("data-pulsing")).toBeNull();
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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause the running cycle" }));
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
