import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DecisionLead, decisionLeadSentence } from "./DecisionLead";
import type { DecisionOption } from "./DecisionBar";

const GO: DecisionOption = { id: "go", label: "Run the sale", recommended: true, consequence: "A 20% discount for a week.", cost: { amountMinor: 4000, currency: "USD" }, reversible: true };
const WAIT: DecisionOption = { id: "wait", label: "Wait a week", reversible: true, cost: null };

describe("DecisionLead (WP-10 T10)", () => {
  it("renders nothing without a recommended option", () => {
    const { container } = render(<DecisionLead agentName="Juno" recommended={undefined} others={[WAIT]} onChoose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("says what the agent suggests, what it costs (an Estimate) and whether it can be undone", () => {
    expect(decisionLeadSentence("Juno", GO)).toBe("Juno suggests: Run the sale. A 20% discount for a week. Costs $40.00 (Estimate). Can be undone.");
    expect(decisionLeadSentence("Juno", { id: "x", label: "Sign", reversible: false })).toBe("Juno suggests: Sign. Cannot be undone.");
  });

  it("the filled button is the recommended one; the others are not", () => {
    render(<DecisionLead agentName="Juno" recommended={GO} others={[WAIT]} onChoose={() => {}} />);
    expect(screen.getByRole("button", { name: "Run the sale" }).className).toContain("btn-primary");
    expect(screen.getByRole("button", { name: "Wait a week" }).className).not.toContain("btn-primary");
  });

  it("choosing calls onChoose once with that option, and Ask opens the conversation", () => {
    const onChoose = vi.fn();
    const onAsk = vi.fn();
    render(<DecisionLead agentName="Juno" recommended={GO} others={[WAIT]} onChoose={onChoose} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "Run the sale" }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(GO);
    fireEvent.click(screen.getByRole("button", { name: "Not sure? Ask Juno" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("disabled locks every button", () => {
    render(<DecisionLead agentName="Juno" recommended={GO} others={[WAIT]} onChoose={() => {}} disabled />);
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
