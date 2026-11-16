// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EXAMPLE_IDEAS_LABEL, ExampleIdeas } from "../ExampleIdeas";
import { EXAMPLE_IDEAS } from "../first-timer-examples";
import { SOLE_REVIVAL_LOGO } from "../logos";

const shown = () => document.querySelector("[data-idea-name]")!.textContent;

describe("ExampleIdeas (the hero's examples, founder 2026-11-16)", () => {
  it("offers Northwind Skincare first, then Sole Revival, Tutorlane and Glitchwick, and shows the first", () => {
    render(<ExampleIdeas ideas={EXAMPLE_IDEAS} />);
    const group = screen.getByRole("radiogroup", { name: EXAMPLE_IDEAS_LABEL });
    const radios = screen.getAllByRole("radio");
    expect(group.contains(radios[0]!)).toBe(true);
    expect(radios.map((r) => r.textContent)).toEqual(["Northwind Skincare", "Sole Revival", "Tutorlane", "Glitchwick"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
    expect(shown()).toBe("Northwind Skincare");
  });

  it("switches the card on a click, and Sole Revival's card wears its own logo", () => {
    render(<ExampleIdeas ideas={EXAMPLE_IDEAS} />);
    fireEvent.click(screen.getByRole("radio", { name: "Sole Revival" }));
    expect(shown()).toBe("Sole Revival");
    expect(document.querySelector("[data-idea-card] header img")!.getAttribute("src")).toBe(SOLE_REVIVAL_LOGO);
  });

  it("moves with the arrow keys and Home/End, one tab stop for the group", () => {
    render(<ExampleIdeas ideas={EXAMPLE_IDEAS} />);
    const first = screen.getByRole("radio", { name: "Northwind Skincare" });
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toEqual([first]);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(shown()).toBe("Sole Revival");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(shown()).toBe("Glitchwick");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(shown()).toBe("Northwind Skincare");
  });

  it("gives every example ten ratings, each with its own reason", () => {
    for (const x of EXAMPLE_IDEAS) {
      expect(x.card.attributes, x.id).toHaveLength(10);
      if (x.id !== "sole-revival") expect(new Set(x.card.attributes!.map((a) => a.evidence)).size, x.id).toBe(10);
    }
  });
});
