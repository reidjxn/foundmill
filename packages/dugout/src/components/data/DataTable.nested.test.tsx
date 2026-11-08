import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type DataTableColumn } from "./DataTable";
import { TEAM_ROWS, type TeamRow } from "./fixtures";

const columns: DataTableColumn<TeamRow>[] = [
  { accessorKey: "name", header: "Agent", size: 240 },
  { accessorKey: "role", header: "Role", size: 180 },
  { accessorKey: "department", header: "Department", meta: { filter: "select", filterOptions: ["Product", "Development", "Distribution"].map((v) => ({ value: v, label: v })) } },
  { accessorKey: "rating", header: "Rating", meta: { numeric: true }, size: 80 },
];

const grid = () => screen.getByRole("treegrid");
const bodyRows = () => within(grid()).getAllByRole("row").slice(1);
const names = () => bodyRows().map((r) => r.querySelector('td[data-col="name"] [data-cell-content]')?.textContent ?? "");

function Team(props: Partial<Parameters<typeof DataTable<TeamRow>>[0]>) {
  return (
    <DataTable<TeamRow>
      aria-label="Agents"
      data={TEAM_ROWS}
      columns={columns}
      getSubRows={(r) => r.reports}
      subRowsLabel={(_r, n) => `+${n} ${n === 1 ? "specialist" : "specialists"}`}
      isPinnedRow={(r) => r.pinned === true}
      {...props}
    />
  );
}

describe("DataTable nested rows", () => {
  it("shows the top level collapsed, as a tree grid, with a '+N' expander on every row with children", () => {
    render(<Team />);
    expect(names()).toEqual(["Chief of Staff", "Product Lead", "Engineering Lead", "Distribution Lead"]);
    expect(grid().getAttribute("role")).toBe("treegrid");
    const product = bodyRows()[1]!;
    expect(product.getAttribute("aria-level")).toBe("1");
    expect(product.getAttribute("aria-expanded")).toBe("false");
    expect(within(product).getByRole("button", { name: "Show 2 specialists under Product Lead" }).textContent).toBe("+2 specialists");
    // A row without children has no expander and no aria-expanded.
    expect(bodyRows()[0]!.hasAttribute("aria-expanded")).toBe(false);
    // The footer counts every row at every level.
    expect(screen.getByText("9 rows")).toBeTruthy();
  });

  it("opens and closes a row with its expander, indenting the children", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(<Team onExpandedChange={onExpandedChange} />);
    await user.click(screen.getByRole("button", { name: /under Engineering Lead/ }));
    expect(names()).toEqual(["Chief of Staff", "Product Lead", "Engineering Lead", "Backend Engineer", "Planner", "QA Engineer", "Distribution Lead"]);
    expect(onExpandedChange).toHaveBeenLastCalledWith(["eng"]);
    const child = bodyRows()[3]!;
    expect(child.getAttribute("aria-level")).toBe("2");
    expect((child.querySelector("[data-nest-level]") as HTMLElement).style.paddingLeft).toBe("20px");
    await user.click(screen.getByRole("button", { name: /Hide 3 specialists under Engineering Lead/ }));
    expect(names()).toHaveLength(4);
  });

  it("sorts each level on its own and keeps a pinned row first", async () => {
    const user = userEvent.setup();
    render(<Team defaultExpandedIds={["eng"]} />);
    // Rating, highest first: the leads reorder among themselves, the engineers under their lead.
    await user.click(screen.getByRole("button", { name: /Rating/ }));
    expect(names()).toEqual(["Chief of Staff", "Engineering Lead", "QA Engineer", "Backend Engineer", "Planner", "Product Lead", "Distribution Lead"]);
    await user.click(screen.getByRole("button", { name: /Rating/ }));
    expect(names()[0]).toBe("Chief of Staff");
    expect(names().slice(1)).toEqual(["Distribution Lead", "Product Lead", "Engineering Lead", "Planner", "Backend Engineer", "QA Engineer"]);
  });

  it("keeps a parent whose child matches a search or filter, and opens it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Team globalFilter="planner" />);
    expect(names()).toEqual(["Engineering Lead", "Planner"]);
    expect(bodyRows()[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("2 rows of 9")).toBeTruthy();
    // Closed during the search, it stays closed until the search changes.
    await user.click(screen.getByRole("button", { name: /Hide 1 specialist under Engineering Lead/ }));
    expect(names()).toEqual(["Engineering Lead"]);
    rerender(<Team globalFilter="engineer" />);
    expect(names()).toEqual(["Engineering Lead", "Backend Engineer", "QA Engineer"]);
    // Clearing the search returns to the founder's own (collapsed) choice.
    rerender(<Team globalFilter="" />);
    expect(names()).toHaveLength(4);
  });

  it("opens with ArrowRight, steps into and out of the children, and closes with ArrowLeft", async () => {
    const user = userEvent.setup();
    render(<Team />);
    const g = grid();
    await user.click(g);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(g.getAttribute("aria-activedescendant")).toContain("-row-eng");
    await user.keyboard("{ArrowRight}");
    expect(bodyRows()[2]!.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(g.getAttribute("aria-activedescendant")).toContain("-row-backend");
    await user.keyboard("{ArrowLeft}");
    expect(g.getAttribute("aria-activedescendant")).toContain("-row-eng");
    await user.keyboard("{ArrowLeft}");
    expect(bodyRows()[2]!.getAttribute("aria-expanded")).toBe("false");
    expect(names()).toHaveLength(4);
  });

  it("exports a flat CSV of every matching row, open or not, with the caller's extra columns", async () => {
    const user = userEvent.setup();
    const onExportCsv = vi.fn();
    const parentOf = new Map(TEAM_ROWS.flatMap((r) => (r.reports ?? []).map((c) => [c.id, r.name] as const)));
    render(<Team onExportCsv={onExportCsv} exportColumns={[{ header: "Reports to", value: (r) => parentOf.get(r.id) ?? "You" }]} />);
    await user.click(screen.getByRole("button", { name: "Table menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Export CSV/ }));
    const [csv, rows] = onExportCsv.mock.calls[0] as [string, TeamRow[]];
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("Agent,Role,Department,Rating,Reports to");
    expect(rows).toHaveLength(9);
    expect(lines[1]).toBe("Chief of Staff,Chief of Staff,Team,15,You");
    expect(lines).toContain("Planner,Planner,Development,12,Engineering Lead");
  });

  it("leaves a flat table exactly as it was", () => {
    render(<DataTable<TeamRow> aria-label="Flat" data={TEAM_ROWS} columns={columns} />);
    const g = screen.getByRole("grid");
    expect(within(g).getAllByRole("row").slice(1)).toHaveLength(4);
    expect(within(g).queryByRole("button", { name: /^Show / })).toBeNull();
  });
});
