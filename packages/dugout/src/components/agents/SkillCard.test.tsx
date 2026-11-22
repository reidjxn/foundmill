import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NOT_TESTED_YET, SkillCard } from "./SkillCard";
import type { LibrarySkillOption } from "./SkillCard";

const SKILL: LibrarySkillOption = { key: "release_notes", name: "Release notes", description: "Writes release notes customers can follow.", categoryLabel: "Product", attribute: { name: "Release notes", group: "craft" } };

describe("SkillCard", () => {
  it("available and selected: a checkbox named by the skill, described by what it does", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<SkillCard skill={SKILL} state="available" onToggle={onToggle} />);
    const box = screen.getByRole("checkbox", { name: /Release notes/ });
    expect(box.getAttribute("data-state")).toBe("unchecked");
    expect(box.getAttribute("aria-describedby") && document.getElementById(box.getAttribute("aria-describedby")!)?.textContent).toBe(SKILL.description);
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalled();
    rerender(<SkillCard skill={SKILL} state="selected" onToggle={onToggle} />);
    expect(screen.getByRole("checkbox", { name: /Release notes/ }).getAttribute("data-state")).toBe("checked");
  });

  it("unavailable: the reason replaces the description, readable, and the checkbox is disabled", () => {
    const { container } = render(<SkillCard skill={SKILL} state="unavailable" reason="Quill already has this skill" />);
    const box = screen.getByRole("checkbox", { name: /Release notes/ }) as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText("Quill already has this skill")).toBeTruthy();
    expect(screen.queryByText(SKILL.description)).toBeNull();
    expect(container.querySelector(".opacity-60")).toBeNull();
  });

  it("added: no checkbox, a Remove button named for the skill, and whether it is tested", () => {
    const onRemove = vi.fn();
    const { rerender } = render(<SkillCard skill={SKILL} state="added" onRemove={onRemove} result={{ tested: false }} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(NOT_TESTED_YET)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Release notes" }));
    expect(onRemove).toHaveBeenCalled();
    rerender(<SkillCard skill={SKILL} state="added" onRemove={onRemove} result={{ tested: true, rating: 14 }} />);
    expect(screen.getByText("14 of 20")).toBeTruthy();
  });

  it("suggested: the reason as a chip; effect only when given; Read is a toggle", () => {
    const onPreview = vi.fn();
    const { rerender } = render(<SkillCard skill={SKILL} state="available" suggested reason="Fits this role" onPreview={onPreview} previewing={false} />);
    expect(screen.getByText("Fits this role")).toBeTruthy();
    expect(screen.queryByText(/Used in/)).toBeNull();
    const read = screen.getByRole("button", { name: "Read the skill: Release notes" });
    expect(read.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(read);
    expect(onPreview).toHaveBeenCalled();
    rerender(<SkillCard skill={SKILL} state="available" effect="Used in 3 tasks since Nov 3" />);
    expect(screen.getByText("Used in 3 tasks since Nov 3")).toBeTruthy();
  });
});
