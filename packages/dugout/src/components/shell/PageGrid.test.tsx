import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GridCell, PageGrid } from "./PageGrid";

describe("PageGrid", () => {
  it("is twelve columns, and unchanged without `stack`", () => {
    render(
      <PageGrid data-testid="grid">
        <GridCell span={6}>A</GridCell>
      </PageGrid>,
    );
    const grid = screen.getByTestId("grid");
    expect(grid.className).toContain("grid-cols-12");
    expect(grid.className).not.toContain("page-grid-stack");
    expect(grid.hasAttribute("data-stack")).toBe(false);
    expect(screen.getByText("A").className).toContain("col-span-6");
  });

  it("`stack` opts in to one column below the container's page-wide width, keeping the twelve above it", () => {
    render(
      <PageGrid stack flush data-testid="grid">
        <GridCell span={6}>A</GridCell>
        <GridCell span={6}>B</GridCell>
      </PageGrid>,
    );
    const grid = screen.getByTestId("grid");
    expect(grid.className).toContain("page-grid-stack");
    expect(grid.className).toContain("grid-cols-12");
    expect(grid.getAttribute("data-stack")).toBe("true");
  });
});
