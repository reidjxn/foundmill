import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderViewProvider } from "../guidance/BuilderView";
import { SkillGrid, gridSource, skillHoverText } from "./SkillGrid";
import type { SkillRow } from "./types";

const rows: SkillRow[] = [
  { id: "copy", name: "Copywriting", group: "craft", value: 10, tested: 10, potential: 10, source: { kind: "starting" } },
  { id: "plan", name: "Planning", group: "judgement", value: 14, tested: 14, source: { kind: "tested", on: "2026-11-14T15:00:00Z" } },
];

describe("SkillGrid ratings a first-timer can read (WP-10 T9)", () => {
  it("a starting row is labeled Estimate, and its hover says Starting estimate", () => {
    render(<SkillGrid skills={[rows[0]!]} />);
    expect(screen.getByRole("button", { name: /Estimate/ })).toBeTruthy();
    expect(skillHoverText(rows[0]!)).toBe("Starting estimate 10 · Potential 10");
  });

  it("Builder view off shows the figure and the band word: '14 of 20 · Good' (founder decision 5)", () => {
    const { container } = render(
      <BuilderViewProvider on={false}>
        <SkillGrid skills={rows} />
      </BuilderViewProvider>,
    );
    expect(screen.getByLabelText("Planning: 14 of 20 · Good")).toBeTruthy();
    expect(container.querySelector('[data-skill="plan"]')?.textContent).toContain("14");
  });

  it("with a legend, says what the ratings are from and shows the key once", () => {
    const { container } = render(<SkillGrid skills={rows} legend />);
    expect(container.querySelector("[data-skill-source]")?.textContent).toBe("From practice tests on Nov 14.");
    expect(container.querySelectorAll("[data-rating-key]")).toHaveLength(1);
    expect(gridSource([rows[0]!])).toEqual({ kind: "starting" });
    expect(gridSource([{ source: { kind: "work", tasks: 3 } }, { source: { kind: "work", tasks: 2 } }])).toEqual({ kind: "work", tasks: 5 });
    expect(gridSource([{}])).toBeNull();
  });
});
