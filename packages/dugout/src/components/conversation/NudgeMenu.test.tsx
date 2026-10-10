import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NudgeAck } from "./NudgeAck";
import { NUDGE_MAX_LENGTH, NudgeMenu } from "./NudgeMenu";

const PRESETS = [
  { key: "check_sources", label: "Check your sources", hint: "Quote the record behind every figure.", text: "Check your sources: quote the record behind every figure." },
  { key: "keep_it_small", label: "Keep it small" },
];

describe("NudgeMenu", () => {
  it("offers the presets that fit the agent and sends the chosen one's text", async () => {
    const onNudge = vi.fn();
    render(<NudgeMenu target="Certification Specialist" presets={PRESETS} onNudge={onNudge} labelled />);
    await userEvent.click(screen.getByRole("button", { name: /Nudge Certification Specialist/ }));
    expect(screen.getByText("Quote the record behind every figure.")).toBeTruthy();
    expect(screen.queryByText("Focus on tests")).toBeNull();
    await userEvent.click(screen.getByText("Check your sources"));
    expect(onNudge).toHaveBeenCalledWith({ key: "check_sources", text: "Check your sources: quote the record behind every figure." });
  });

  it("a preset without its own text sends its label; a custom message is capped at 280", async () => {
    const onNudge = vi.fn();
    render(<NudgeMenu target="Backend Engineer" presets={PRESETS} onNudge={onNudge} />);
    await userEvent.click(screen.getByRole("button", { name: "Nudge Backend Engineer" }));
    await userEvent.click(screen.getByText("Keep it small"));
    expect(onNudge).toHaveBeenLastCalledWith({ key: "keep_it_small", text: "Keep it small" });
    await userEvent.click(screen.getByRole("button", { name: "Nudge Backend Engineer" }));
    await userEvent.click(screen.getByText("Custom message…"));
    const field = screen.getByRole("textbox", { name: "Message" });
    expect(field.getAttribute("maxLength")).toBe(String(NUDGE_MAX_LENGTH));
    expect(NUDGE_MAX_LENGTH).toBe(280);
    await userEvent.type(field, "Use the existing date helper.");
    await userEvent.click(screen.getByRole("button", { name: "Send nudge" }));
    expect(onNudge).toHaveBeenLastCalledWith({ key: null, text: "Use the existing date helper." });
  });
});

describe("NudgeAck", () => {
  it("is one bubble in the agent's voice, announced politely with what was nudged", () => {
    render(<NudgeAck name="Backend Engineer" avatarSeed="be" dept="dept-2" text="Understood." nudge="Focus on tests" />);
    const ack = screen.getByTestId("nudge-ack");
    expect(ack.getAttribute("role")).toBe("status");
    expect(ack.className).toContain("tone-dept-2");
    expect(ack.querySelectorAll('[data-author="agent"]')).toHaveLength(1);
    expect(ack.textContent).toContain("Nudge: Focus on tests.");
    expect(ack.textContent).toContain("Understood.");
  });
});
