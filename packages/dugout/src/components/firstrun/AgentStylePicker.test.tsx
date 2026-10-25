import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AGENT_STYLES, AGENT_STYLE_META } from "@foundmill/shared/personas";
import { AGENT_STYLE_LABEL, AgentStylePicker } from "./AgentStylePicker";

describe("AgentStylePicker", () => {
  it("is a labeled radio group of the four styles, each with its label and description", () => {
    render(<AgentStylePicker value="humans" onChange={() => undefined} />);
    const group = screen.getByRole("radiogroup", { name: AGENT_STYLE_LABEL });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(AGENT_STYLES.length);
    for (const style of AGENT_STYLES) {
      const card = screen.getByRole("radio", { name: AGENT_STYLE_META[style].label });
      expect(card.textContent).toContain(AGENT_STYLE_META[style].description);
      expect(card.getAttribute("aria-checked")).toBe(style === "humans" ? "true" : "false");
    }
  });

  it("choosing a card calls onChange with the style", async () => {
    const onChange = vi.fn();
    render(<AgentStylePicker value="humans" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    expect(onChange).toHaveBeenCalledWith("fantasy");
  });

  it("works from the keyboard: arrows move and select, Space selects the focused card", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AgentStylePicker value="humans" onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: AGENT_STYLE_META.humans.label }));
    await user.keyboard("{ArrowRight}");
    // Arrow keys move focus to the next card ...
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: AGENT_STYLE_META.cartoon_3d.label }));
    // ... and Space chooses it.
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith("cartoon_3d");
  });

  it("disabled: nothing can be chosen", async () => {
    const onChange = vi.fn();
    render(<AgentStylePicker value="cartoon_2d" onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole("radio", { name: "Fantasy" }));
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole("radio", { name: AGENT_STYLE_META.cartoon_2d.label }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("test ids follow the prefix", () => {
    render(<AgentStylePicker value="humans" onChange={() => undefined} testIdPrefix="launch-style" />);
    expect(screen.getByTestId("launch-style-picker")).toBeTruthy();
    expect(screen.getByTestId("launch-style-fantasy")).toBeTruthy();
  });
});
