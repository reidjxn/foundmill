import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { InstructionsEditor, instructionsEqual, serializeInstructions } from "./InstructionsEditor";
import { mockInstructionVersions, mockInstructions } from "./mock";
import type { AgentInstructions } from "./types";

function Harness({ initial, violations }: { initial: AgentInstructions; violations?: Parameters<typeof InstructionsEditor>[0]["violations"] }) {
  const [value, setValue] = useState(initial);
  return <InstructionsEditor value={value} onChange={setValue} versions={mockInstructionVersions()} violations={violations} />;
}

describe("serializeInstructions", () => {
  it("is deterministic and section-ordered", () => {
    const text = serializeInstructions(mockInstructions());
    expect(text.indexOf("# Role")).toBeLessThan(text.indexOf("# Goals"));
    expect(text.indexOf("# Playbook")).toBeLessThan(text.indexOf("# Tone"));
    expect(text).toContain("1. Read the task and its acceptance tests.");
    expect(text).toContain("- Write the Playwright test before the component.");
    expect(instructionsEqual(mockInstructions(), mockInstructions())).toBe(true);
    expect(instructionsEqual(mockInstructions(), { ...mockInstructions(), tone: "x" })).toBe(false);
  });
});

describe("InstructionsEditor", () => {
  it("edits lists: add, remove and reorder", () => {
    render(<Harness initial={mockInstructions()} />);
    const rules = screen.getByRole("list", { name: "Rules" });
    expect(within(rules).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(within(screen.getByRole("list", { name: "Rules" })).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.change(within(screen.getByRole("list", { name: "Rules" })).getByLabelText("Item 5"), { target: { value: "Keep it short." } });
    fireEvent.click(within(screen.getByRole("list", { name: "Rules" })).getByRole("button", { name: "Move item 5 up" }));
    const inputs = within(screen.getByRole("list", { name: "Rules" })).getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs[3]!.value).toBe("Keep it short.");
    expect(screen.getByText(/Draft differs from live/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("list", { name: "Rules" })).getByRole("button", { name: "Remove item 4" }));
    expect(within(screen.getByRole("list", { name: "Rules" })).getAllByRole("listitem")).toHaveLength(4);
    // Removing the added rule restores the live text exactly.
    expect(screen.getByText("No changes")).toBeTruthy();
  });

  it("shows a diff against the live version and switches the comparison target", () => {
    const versions = mockInstructionVersions();
    const draft = { ...versions[1]!.instructions, tone: "Plain and warm." };
    render(<InstructionsEditor value={draft} onChange={vi.fn()} versions={versions} defaultMode="diff" />);
    const diff = document.querySelector("[data-diff-view]") as HTMLElement;
    expect(diff).toBeTruthy();
    expect(within(diff).getByText(/1 hunk/)).toBeTruthy();
    expect(within(diff).getAllByText(/Plain and warm\./).length).toBeGreaterThan(0);
  });

  it("flags house-rule contradictions on the line without removing them", () => {
    render(<Harness initial={mockInstructions()} violations={[{ section: "rules", index: 2, reason: "permits a schema change without asking" }]} />);
    expect(screen.getByText(/1 house-rule conflict/)).toBeTruthy();
    const rules = screen.getByRole("list", { name: "Rules" });
    const flagged = within(rules).getAllByRole("listitem")[2]!;
    expect(flagged.getAttribute("data-flagged")).toBe("true");
    expect(within(flagged).getByRole("status").textContent).toContain("has no effect");
    expect((within(flagged).getByRole("textbox") as HTMLInputElement).value).toContain("Ask before changing");
  });

  it("posts comments", () => {
    const onComment = vi.fn();
    render(<InstructionsEditor value={mockInstructions()} onChange={vi.fn()} onComment={onComment} comments={[{ id: "c1", author: "Coach", at: "2026-10-01T10:00:00Z", text: "Tests first lifted Testing by 6." }]} />);
    expect(screen.getByText(/Tests first lifted Testing/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "Agreed." } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(onComment).toHaveBeenCalledWith("Agreed.");
  });
});
