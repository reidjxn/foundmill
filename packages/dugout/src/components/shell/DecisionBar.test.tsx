import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionBar, costText, optionDescription, reversibilityText } from "./DecisionBar";
import { REORDER_OPTIONS } from "./fixtures";

describe("DecisionBar", () => {
  it("formats cost and reversibility without colour", () => {
    expect(costText(undefined)).toBe("Cost unknown");
    expect(costText(null)).toBe("No cost");
    expect(costText({ amountMinor: 0, currency: "EUR" })).toBe("No cost");
    expect(costText({ amountMinor: 1840000, currency: "EUR" })).toContain("18,400");
    expect(reversibilityText(true)).toBe("Reversible");
    expect(reversibilityText(false)).toBe("Not reversible");
    expect(optionDescription(REORDER_OPTIONS[0]!)).toMatch(/^Recommended\. Meridian Labs ships.*Not reversible\.$/);
  });

  it("marks the recommended option with a kit fill and thumbs-up, the others outlined", () => {
    render(<DecisionBar options={REORDER_OPTIONS} onChoose={() => {}} />);
    const a = screen.getByRole("button", { name: /Reorder 2,000 units/ });
    expect(a.getAttribute("data-variant")).toBe("primary");
    expect(a.getAttribute("data-recommended")).toBe("true");
    expect(a.querySelector("svg")).not.toBeNull();
    const c = screen.getByRole("button", { name: /Ask for a quote first/ });
    expect(c.getAttribute("data-variant")).toBe("default");
    expect(c.getAttribute("aria-keyshortcuts")).toBe("3");
    // Consequence, cost and reversibility reach assistive tech without hovering.
    expect(a.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(a.getAttribute("aria-describedby") as string)?.textContent).toContain("Not reversible");
  });

  it("chooses by click and by 1–4, and executes free text", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onExecute = vi.fn();
    render(<DecisionBar options={REORDER_OPTIONS} onChoose={onChoose} onExecute={onExecute} />);
    await user.click(screen.getByRole("button", { name: /Reorder 1,000 units/ }));
    expect(onChoose).toHaveBeenCalledWith(REORDER_OPTIONS[1]);
    document.body.focus();
    await user.keyboard("4");
    expect(onChoose).toHaveBeenLastCalledWith(REORDER_OPTIONS[3]);
    const execute = screen.getByRole("button", { name: "Execute the instruction" });
    expect((execute as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByRole("textbox", { name: "Free-text instruction" });
    await user.type(input, "spend up to €500 on LinkedIn ads next week");
    // Digits typed into the text box must not choose options.
    await user.type(input, " 2");
    expect(onChoose).toHaveBeenCalledTimes(2);
    expect((execute as HTMLButtonElement).disabled).toBe(false);
    await user.keyboard("{Enter}");
    expect(onExecute).toHaveBeenCalledWith("spend up to €500 on LinkedIn ads next week 2");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("locks when disabled, executing or answered, and shows the decision", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onReopen = vi.fn();
    const { rerender } = render(<DecisionBar options={REORDER_OPTIONS} onChoose={onChoose} onExecute={() => {}} disabled />);
    expect((screen.getByRole("button", { name: /Reorder 2,000 units/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("decision-bar").getAttribute("data-state")).toBe("disabled");
    document.body.focus();
    await user.keyboard("1");
    expect(onChoose).not.toHaveBeenCalled();
    rerender(<DecisionBar options={REORDER_OPTIONS} onChoose={onChoose} onExecute={() => {}} executing />);
    expect(screen.getByTestId("decision-bar").getAttribute("data-state")).toBe("executing");
    expect(screen.getByRole("button", { name: "Execute the instruction" }).getAttribute("aria-busy")).toBe("true");
    rerender(<DecisionBar options={REORDER_OPTIONS} onChoose={onChoose} answered={{ optionId: "c" }} onReopen={onReopen} />);
    expect(screen.getByTestId("decision-bar").getAttribute("data-state")).toBe("answered");
    expect(screen.getByText("Decided")).toBeTruthy();
    expect(screen.getByText("Ask for a quote first")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reorder 2,000 units/ })).toBeNull();
    await user.keyboard("1");
    expect(onChoose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onReopen).toHaveBeenCalledTimes(1);
    rerender(<DecisionBar options={REORDER_OPTIONS} onChoose={onChoose} answered={{ text: "pause the serum" }} />);
    expect(screen.getByText("“pause the serum”")).toBeTruthy();
  });

  it("renders at most four options and skips digit hotkeys when turned off", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const five = [...REORDER_OPTIONS, { id: "e", label: "Fifth" }];
    render(<DecisionBar options={five} onChoose={onChoose} hotkeys={false} />);
    expect(screen.queryByRole("button", { name: /Fifth/ })).toBeNull();
    document.body.focus();
    await user.keyboard("1");
    expect(onChoose).not.toHaveBeenCalled();
  });
});
