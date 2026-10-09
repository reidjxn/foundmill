import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTINUE_PULSE_MS, ContinueButton, continueButtonAction, continueButtonLabel, holidayCaption } from "./ContinueButton";
import type { ContinueState } from "./types";

describe("ContinueButton", () => {
  it("labels every state (BUILD §5.4)", () => {
    expect(continueButtonLabel({ kind: "idle" })).toBe("Continue");
    expect(continueButtonLabel({ kind: "blocked", count: 3 })).toBe("Respond · 3");
    expect(continueButtonLabel({ kind: "processing" })).toBe("Pause");
    expect(continueButtonLabel({ kind: "matchday" })).toBe("Go to Journey");
    expect(continueButtonLabel({ kind: "holiday", until: null })).toBe("Come back");
    expect(holidayCaption({ kind: "holiday", until: "2026-10-14" })).toBe("On holiday until 14 Oct 2026");
    expect(holidayCaption({ kind: "holiday", until: null, untilLabel: "the launch ships" })).toBe("On holiday until the launch ships");
    expect(holidayCaption({ kind: "holiday", until: null })).toBe("On holiday");
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
    expect(screen.getByText("On holiday until 14 Oct 2026")).toBeTruthy();
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

  it("does not act when disabled", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<ContinueButton state={{ kind: "idle" }} bindSpace disabled onContinue={onContinue} />);
    document.body.focus();
    await user.keyboard(" ");
    expect(onContinue).not.toHaveBeenCalled();
  });
});
