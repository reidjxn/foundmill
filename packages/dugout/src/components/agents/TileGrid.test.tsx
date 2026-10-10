import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GroundViewToggle, TileGrid, gridFor, moveIndex, visibleItems, type TileGridItem } from "./TileGrid";

const items = (n: number): TileGridItem[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, label: `Tile ${i}` }));

describe("gridFor", () => {
  it("adapts to 1/2/4/6/9/12/16/24 and marks 12+ compact", () => {
    expect(gridFor(1)).toMatchObject({ capacity: 1, cols: 1, rows: 1, compact: false });
    expect(gridFor(3)).toMatchObject({ capacity: 4, cols: 2, rows: 2 });
    expect(gridFor(5)).toMatchObject({ capacity: 6, cols: 3, rows: 2 });
    expect(gridFor(7)).toMatchObject({ capacity: 9, cols: 3, rows: 3 });
    expect(gridFor(10)).toMatchObject({ capacity: 12, cols: 4, rows: 3, compact: true });
    expect(gridFor(16)).toMatchObject({ capacity: 16, cols: 4, rows: 4, compact: true });
    expect(gridFor(17)).toMatchObject({ capacity: 24, cols: 6, rows: 4 });
    expect(gridFor(99).capacity).toBe(24);
  });
});

describe("visibleItems / moveIndex", () => {
  it("overflows beyond the cap and swaps the focused item in", () => {
    const all = items(30);
    const plain = visibleItems(all, 24, null);
    expect(plain.shown).toHaveLength(24);
    expect(plain.overflow).toHaveLength(6);
    const focused = visibleItems(all, 24, "t27");
    expect(focused.shown.map((i) => i.id)).toContain("t27");
    expect(focused.shown).toHaveLength(24);
    expect(focused.overflow.map((i) => i.id)).toContain("t23");
  });

  it("moves on a 4-column grid and stops at edges", () => {
    expect(moveIndex(0, 16, 4, "ArrowRight")).toBe(1);
    expect(moveIndex(3, 16, 4, "ArrowRight")).toBe(4);
    expect(moveIndex(15, 16, 4, "ArrowRight")).toBe(15);
    expect(moveIndex(5, 16, 4, "ArrowDown")).toBe(9);
    expect(moveIndex(13, 16, 4, "ArrowDown")).toBe(13);
    expect(moveIndex(5, 16, 4, "ArrowUp")).toBe(1);
    expect(moveIndex(1, 16, 4, "ArrowUp")).toBe(1);
    expect(moveIndex(7, 16, 4, "End")).toBe(15);
    expect(moveIndex(7, 16, 4, "Home")).toBe(0);
  });
});

describe("TileGrid", () => {
  const renderTile = vi.fn((item: TileGridItem, ctx: { focused: boolean; compact: boolean; inRail: boolean }) => (
    <div data-testid={`tile-${item.id}`} data-ctx={`${ctx.focused ? "focused" : ""}${ctx.compact ? " compact" : ""}${ctx.inRail ? " rail" : ""}`}>
      {item.label}
      <button type="button">inner</button>
    </div>
  ));

  it("renders 16 compact tiles on a 4×4 grid", () => {
    const { container } = render(<TileGrid items={items(16)} renderTile={renderTile} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.capacity).toBe("16");
    const region = screen.getByRole("region", { name: "Agent tiles" });
    expect(region.style.gridTemplateColumns).toContain("repeat(4");
    expect(screen.getAllByRole("group")).toHaveLength(16);
    expect(screen.getByTestId("tile-t0").dataset.ctx).toBe(" compact");
    expect(screen.queryByTestId("overflow-strip")).toBeNull();
  });

  it("focuses a tile at two-thirds width with a rail, and Esc leaves focus", () => {
    const onFocusedChange = vi.fn();
    render(<TileGrid items={items(6)} renderTile={renderTile} onFocusedChange={onFocusedChange} />);
    const cell = screen.getByRole("group", { name: "Tile 2" });
    cell.focus();
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(onFocusedChange).toHaveBeenCalledWith("t2");
    expect(screen.getByTestId("tile-t2").dataset.ctx).toBe("focused");
    const rail = screen.getByRole("list", { name: "Other tiles" });
    expect(within(rail).getAllByRole("group")).toHaveLength(5);
    expect(screen.getByTestId("tile-t0").dataset.ctx).toBe(" compact rail");
    // One row the height of the region, so the focused tile never grows under what sits below the grid.
    expect(screen.getByRole("region").className).toContain("grid-rows-[minmax(0,1fr)]");
    const focusedCell = screen.getByRole("group", { name: "Tile 2" });
    fireEvent.keyDown(focusedCell, { key: "Escape" });
    expect(onFocusedChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("list", { name: "Other tiles" })).toBeNull();
  });

  it("moves between cells with arrow keys using the grid width", () => {
    render(<TileGrid items={items(9)} renderTile={renderTile} />);
    const first = screen.getByRole("group", { name: "Tile 0" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Tile 3" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Tile 4" }));
    expect(screen.getByRole("group", { name: "Tile 4" }).tabIndex).toBe(0);
    expect(screen.getByRole("group", { name: "Tile 0" }).tabIndex).toBe(-1);
  });

  it("shows an overflow strip past 24 and focusing from it brings the tile on screen", () => {
    render(<TileGrid items={items(30)} renderTile={renderTile} />);
    const strip = screen.getByTestId("overflow-strip");
    expect(within(strip).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(within(strip).getByRole("listitem", { name: "Tile 28" }));
    expect(screen.getByTestId("tile-t28").dataset.ctx).toBe("focused");
  });

  it("GroundViewToggle is a radio group", () => {
    const onChange = vi.fn();
    render(<GroundViewToggle value="tiles" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Task graph/ }));
    expect(onChange).toHaveBeenCalledWith("formation");
    expect(screen.getByRole("radio", { name: /Tiles/ }).getAttribute("aria-checked")).toBe("true");
  });
});
