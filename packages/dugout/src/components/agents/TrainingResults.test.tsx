import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MOCK_COACH_EXPLANATION, mockTrainingResults } from "./mock";
import { TrainingResults, summariseTraining } from "./TrainingResults";

describe("summariseTraining", () => {
  it("counts ups, downs, unchanged and drops over one point", () => {
    const s = summariseTraining(mockTrainingResults());
    expect(s.improved).toBe(6);
    expect(s.dropped).toBe(3);
    expect(s.unchanged).toBe(2);
    expect(s.bigDrops.map((r) => r.id)).toEqual(["state_management", "speed"]);
    expect(s.meanDelta).toBeCloseTo(0.91, 2);
    expect(summariseTraining([]).meanDelta).toBe(0);
  });
});

describe("TrainingResults", () => {
  it("renders before → after with arrows, highlights drops > 1 and calls Promote / Discard", () => {
    const onPromote = vi.fn();
    const onDiscard = vi.fn();
    render(<TrainingResults results={mockTrainingResults()} coachExplanation={MOCK_COACH_EXPLANATION} candidateVersion={5} liveVersion={4} cost={{ amountMinor: 184, currency: "EUR" }} durationMs={214_000} onPromote={onPromote} onDiscard={onDiscard} />);
    const speed = document.querySelector('[data-skill="speed"]') as HTMLElement;
    expect(speed.dataset.bigDrop).toBe("true");
    expect(within(speed).getByText("Drop")).toBeTruthy();
    expect(within(speed).getByText(/down 3/)).toBeTruthy();
    const testing = document.querySelector('[data-skill="testing"]') as HTMLElement;
    expect(testing.dataset.bigDrop).toBeUndefined();
    expect(within(testing).getByText(/up 6/)).toBeTruthy();
    expect(within(testing).getByRole("img", { name: "to" })).toBeTruthy();
    const unchanged = document.querySelector('[data-skill="accessibility"]') as HTMLElement;
    expect(within(unchanged).getByText("no change")).toBeTruthy();
    expect(screen.getByText(/Speed dropped because/)).toBeTruthy();
    expect(screen.getByText(/State management, Speed dropped by more than one point/)).toBeTruthy();
    expect(screen.getByText("6 up")).toBeTruthy();
    expect(screen.getByText("3m 34s")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Promote v5" }));
    expect(onPromote).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalled();
    expect(screen.getByText(/The live version keeps working until you promote/)).toBeTruthy();
  });
});
