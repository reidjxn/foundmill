import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import { Chip } from "../foundation/Chip";
import { Dialog, DialogContent, DialogTitle } from "../foundation/Dialog";
import { DataTable, cellTitle, type DataTableColumn } from "./DataTable";
import { generateLeads, LEAD_STAGE_LABELS, LEAD_VIEWS, type LeadRow } from "./fixtures";
import type { SavedView } from "./types";

const columns: DataTableColumn<LeadRow>[] = [
  { accessorKey: "name", header: "Name", size: 180 },
  { accessorKey: "company", header: "Company", size: 180 },
  {
    accessorKey: "stage",
    header: "Stage",
    cell: ({ getValue }) => LEAD_STAGE_LABELS[getValue() as LeadRow["stage"]],
    meta: {
      filter: "select",
      filterOptions: Object.entries(LEAD_STAGE_LABELS).map(([value, label]) => ({ value, label })),
    },
  },
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "channel", header: "Channel" },
  { accessorKey: "score", header: "Score", meta: { numeric: true }, size: 80 },
  {
    accessorKey: "value",
    header: "Value",
    meta: { numeric: true, csv: (r) => r.value.amountMinor / 100 },
    sortingFn: (a, b) => a.original.value.amountMinor - b.original.value.amountMinor,
    cell: ({ row }) => `€${(row.original.value.amountMinor / 100).toFixed(0)}`,
  },
  {
    accessorKey: "lastContact",
    header: "Last contact",
    meta: { filter: "date" },
    cell: ({ getValue }) => (getValue() as Date).toISOString().slice(0, 10),
  },
  { accessorKey: "country", header: "Country" },
];

const leads = generateLeads(40, "test-leads");
const grid = () => screen.getByRole("grid");
const bodyRows = () => within(grid()).getAllByRole("row").slice(1);

describe("DataTable", () => {
  it("renders every row when not virtualised, with numeric cells right-aligned and a footer count", () => {
    render(<DataTable data={leads} columns={columns} aria-label="Leads" />);
    expect(bodyRows()).toHaveLength(40);
    const scoreHeader = screen.getByRole("columnheader", { name: /Score/ });
    expect(scoreHeader.className).toContain("justify-end");
    expect(screen.getByText(/40 rows/)).toBeTruthy();
  });

  it("sorts on click, adds a secondary sort with Shift+click and reports it", async () => {
    const user = userEvent.setup();
    render(<DataTable data={leads} columns={columns} />);
    // Numeric columns sort highest first (TanStack's auto direction), then ascending, then back to unsorted.
    await user.click(screen.getByRole("button", { name: "Score" }));
    const desc = bodyRows().map((r) => Number(within(r).getAllByRole("gridcell")[5]?.textContent));
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(screen.getByRole("columnheader", { name: /Score/ }).getAttribute("aria-sort")).toBe(
      "descending",
    );
    await user.click(screen.getByRole("button", { name: "Score" }));
    const asc = bodyRows().map((r) => Number(within(r).getAllByRole("gridcell")[5]?.textContent));
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(screen.getByRole("columnheader", { name: /Score/ }).getAttribute("aria-sort")).toBe(
      "ascending",
    );
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Name" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText(/Sorted by Score, Name/)).toBeTruthy();
  });

  it("navigates with the keyboard: arrows move focus, Space selects, Shift extends, ⌘A selects all, Enter opens", async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        data={leads.slice(0, 6)}
        columns={columns}
        onRowOpen={onRowOpen}
        onSelectionChange={onSelectionChange}
      />,
    );
    const g = grid();
    await user.click(g);
    expect(g.getAttribute("aria-activedescendant")).toContain(`-row-${leads[0]?.id}`);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(g.getAttribute("aria-activedescendant")).toContain(`-row-${leads[2]?.id}`);
    await user.keyboard(" ");
    expect(bodyRows()[2]?.getAttribute("aria-selected")).toBe("true");
    expect(onSelectionChange).toHaveBeenLastCalledWith([leads[2]?.id], [leads[2]]);
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(bodyRows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(3);
    await user.keyboard("{Enter}");
    expect(onRowOpen).toHaveBeenCalledWith(leads[4]);
    await user.keyboard("{Meta>}a{/Meta}");
    expect(bodyRows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(6);
    expect(screen.getByText("6 selected")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(bodyRows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(0);
    await user.keyboard("{End}");
    expect(g.getAttribute("aria-activedescendant")).toContain(`-row-${leads[5]?.id}`);
    await user.keyboard("{Home}");
    expect(g.getAttribute("aria-activedescendant")).toContain(`-row-${leads[0]?.id}`);
  });

  it("selects with the checkbox column and marks selected rows with the kit edge", async () => {
    const user = userEvent.setup();
    render(<DataTable data={leads.slice(0, 3)} columns={columns} selectable />);
    await user.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    const row = bodyRows()[1] as HTMLElement;
    expect(row.getAttribute("aria-selected")).toBe("true");
    // The edge is the row's own ::before (a <tr> holds cells only), so the row carries the class and no extra child.
    expect(row.className).toContain("before:bg-kit-primary");
    expect([...row.children].every((c) => c.getAttribute("role") === "gridcell" || c.tagName === "TD")).toBe(true);
    expect((bodyRows()[0] as HTMLElement).className).not.toContain("before:bg-kit-primary");
    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(bodyRows().every((r) => r.getAttribute("aria-selected") === "true")).toBe(true);
  });

  it("applies a saved view's filters, sort and columns, tracks dirty state and saves", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [views, setViews] = useState<SavedView[]>(LEAD_VIEWS);
      const [active, setActive] = useState<string | null>("hot");
      return (
        <DataTable
          data={leads}
          columns={columns}
          views={views}
          activeViewId={active}
          onActiveViewChange={setActive}
          onViewsChange={setViews}
        />
      );
    }
    render(<Harness />);
    const hot = leads.filter(
      (l) => (l.stage === "qualified" || l.stage === "proposal") && l.score >= 14,
    );
    expect(bodyRows()).toHaveLength(hot.length);
    expect(screen.queryByRole("columnheader", { name: /Owner/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Edit filter: Stage is any of Qualified, Proposal/ }),
    ).toBeTruthy();
    const scores = bodyRows().map((r) =>
      Number(within(r).getAllByRole("gridcell")[3]?.textContent),
    );
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // Remove a filter → dirty → save.
    await user.click(screen.getByRole("button", { name: /Remove filter: Score ≥ 14/ }));
    expect(bodyRows().length).toBeGreaterThan(hot.length);
    const viewButton = screen.getByRole("button", {
      name: /View: Hot this week \(unsaved changes\)/,
    });
    await user.click(viewButton);
    await user.click(await screen.findByRole("menuitem", { name: "Save view" }));
    expect(screen.getByRole("button", { name: "View: Hot this week" })).toBeTruthy();

    // Switch view.
    await user.click(screen.getByRole("button", { name: "View: Hot this week" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /All leads/ }));
    expect(bodyRows()).toHaveLength(40);
    expect(screen.getByRole("columnheader", { name: /Owner/ })).toBeTruthy();
  });

  it("exports the visible columns of the filtered, sorted rows as CSV", async () => {
    const user = userEvent.setup();
    const onExportCsv = vi.fn();
    render(
      <DataTable
        data={leads.slice(0, 3)}
        columns={columns}
        views={LEAD_VIEWS}
        defaultViewId="scout"
        onExportCsv={onExportCsv}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Table menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Export CSV/ }));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
    const [csv, rows] = onExportCsv.mock.calls[0] as [string, LeadRow[]];
    expect(csv.split("\r\n")[0]).toBe("Name,Company,Stage,Channel,Value,Last contact");
    expect(rows.every((r) => r.owner === "Scout")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(rows.length + 1);
  });

  it("hides and shows columns from the chooser and toggles density", async () => {
    const user = userEvent.setup();
    render(<DataTable data={leads.slice(0, 3)} columns={columns} />);
    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Company" }));
    expect(screen.queryByRole("columnheader", { name: /Company/ })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Switch to comfortable rows" }));
    expect((bodyRows()[0] as HTMLElement).style.height).toBe("34px");
  });

  it("opens the right-click menu with the row's verbs", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    render(
      <DataTable
        data={leads.slice(0, 3)}
        columns={columns}
        rowActions={(row) => [
          { id: "msg", label: `Message ${row.name}`, icon: Mail, onSelect: onMessage },
          {
            id: "del",
            label: "Archive",
            icon: Trash2,
            variant: "danger",
            separatorBefore: true,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );
    fireEvent.contextMenu(bodyRows()[1] as HTMLElement);
    const item = await screen.findByRole("menuitem", { name: `Message ${leads[1]?.name}` });
    await user.click(item);
    expect(onMessage).toHaveBeenCalledWith(leads[1]);
  });

  it("opens the focused row's menu from the keyboard: Shift+F10, the Menu key, or a contextmenu at the grid", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    render(<DataTable data={leads.slice(0, 3)} columns={columns} aria-label="Leads" rowActions={(row) => [{ id: "msg", label: `Message ${row.name}`, icon: Mail, onSelect: onMessage }]} />);
    expect(grid().getAttribute("aria-keyshortcuts")).toBe("Shift+F10");
    grid().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    // The second row's verbs, not "No actions" (the grid has focus; the row is its active descendant).
    const item = await screen.findByRole("menuitem", { name: `Message ${leads[1]?.name}` });
    expect(screen.queryByRole("menuitem", { name: "No actions" })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: `Message ${leads[1]?.name}` })).toBeNull());
    expect(item).toBeTruthy();
    grid().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ContextMenu}");
    await user.click(await screen.findByRole("menuitem", { name: `Message ${leads[2]?.name}` }));
    expect(onMessage).toHaveBeenCalledWith(leads[2]);
    // A browser's own keyboard contextmenu lands on the grid itself: it is re-aimed at the focused row.
    grid().focus();
    await user.keyboard("{ArrowUp}");
    fireEvent.contextMenu(grid());
    expect(await screen.findByRole("menuitem", { name: `Message ${leads[1]?.name}` })).toBeTruthy();
  });

  it("a dialog opened from the keyboard row menu gives focus back to the grid when it closes", async () => {
    function WithMerge() {
      const [merging, setMerging] = useState<LeadRow | null>(null);
      return (
        <>
          <DataTable data={leads.slice(0, 3)} columns={columns} aria-label="Leads" rowActions={(row) => [{ id: "merge", label: `Merge ${row.name}`, onSelect: () => setMerging(row) }]} />
          <Dialog open={merging !== null} onOpenChange={(o) => !o && setMerging(null)}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Merge {merging?.name}</DialogTitle>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    render(<WithMerge />);
    grid().focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: `Merge ${leads[1]?.name}` });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Back on the grid, on the same row: the founder carries on from where they were.
    await waitFor(() => expect(document.activeElement).toBe(grid()));
  });

  it("shows loading, error and empty states inside the body", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<DataTable data={[]} columns={columns} loading />);
    expect(document.querySelector("[data-datatable]")?.getAttribute("aria-busy")).toBe("true");
    rerender(
      <DataTable
        data={[]}
        columns={columns}
        error="The leads query timed out."
        onRetry={onRetry}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
    rerender(
      <DataTable data={[]} columns={columns} empty="Leads appear here once a channel is live." />,
    );
    expect(screen.getByRole("status").textContent).toContain("Leads appear here");
  });

  it("virtualises large data sets: only a window of rows is in the DOM", () => {
    const many = generateLeads(5000, "virtual");
    render(<DataTable data={many} columns={columns} height={400} />);
    const n = bodyRows().length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(80);
    expect(screen.getByText(/5,000 rows/)).toBeTruthy();
  });

  it("shares the spare width among growing columns in the header and the body alike", () => {
    const grow: DataTableColumn<LeadRow>[] = [
      { accessorKey: "name", header: "Name", size: 180, meta: { grow: 2 } },
      { accessorKey: "company", header: "Company", size: 140, meta: { grow: 1 } },
      { accessorKey: "score", header: "Score", size: 80, meta: { numeric: true } },
    ];
    render(<DataTable data={leads.slice(0, 3)} columns={grow} />);
    const head = (name: string) => screen.getByRole("columnheader", { name: new RegExp(name) });
    expect(head("Name").style.flex).toBe("2 0 180px");
    expect(head("Company").style.flex).toBe("1 0 140px");
    // With growing columns the last one keeps its width instead of taking the spare.
    expect(head("Score").style.flex).toBe("");
    expect(head("Score").style.flexShrink).toBe("0");
    const cells = within(bodyRows()[0] as HTMLElement).getAllByRole("gridcell");
    expect(cells.map((c) => c.style.flex)).toEqual(["2 0 180px", "1 0 140px", ""]);
  });

  it("gives the spare width to the last column when none grows", () => {
    render(<DataTable data={leads.slice(0, 3)} columns={columns.slice(0, 3)} />);
    expect(screen.getByRole("columnheader", { name: /Stage/ }).style.flex).toBe("1 0 160px");
    expect(screen.getByRole("columnheader", { name: /Name/ }).style.flex).toBe("");
  });

  it("hides its own Filter button on request, still showing a view's filters read-only, and relabels it", () => {
    const { unmount } = render(<DataTable data={leads} columns={columns} hideFilter />);
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    unmount();
    const filtered: SavedView[] = [{ id: "won", name: "Won", columns: ["name", "stage"], sort: [], filters: [{ id: "f", field: "stage", op: "eq", value: "won" }] }];
    const second = render(<DataTable data={leads} columns={columns} views={filtered} hideFilter />);
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
    expect(screen.getByText(/Stage/, { selector: "[data-filter-chip] *, [data-filter-chip]" })).toBeTruthy();
    second.unmount();
    render(<DataTable data={leads} columns={columns} filterLabel="Filter rows" />);
    expect(screen.getByRole("button", { name: "Filter rows" })).toBeTruthy();
  });

  describe("content fit", () => {
    // jsdom lays nothing out: a cell's natural width is faked from its words (8 px a character).
    const natural = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
    afterEach(() => natural.mockReset());
    const fake = () => natural.mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-cell-content") || this.hasAttribute("data-header-label") ? (this.textContent ?? "").length * 8 : 0;
    });

    it("widens a chip-only column to its widest chip, never cutting it, and leaves free text alone", () => {
      fake();
      const chipCols: DataTableColumn<LeadRow>[] = [
        { accessorKey: "name", header: "Name", size: 60 },
        { id: "status", header: "Status", size: 60, cell: ({ row }) => <Chip tone="good">{`Customer since ${row.original.country}`}</Chip> },
      ];
      render(<DataTable data={leads.slice(0, 2)} columns={chipCols} />);
      const widest = Math.max(...leads.slice(0, 2).map((r) => `Customer since ${r.country}`.length * 8 + 1));
      expect(Number(screen.getByRole("separator", { name: "Resize Status" }).getAttribute("aria-valuenow"))).toBe(widest);
      // Plain text may still end in an ellipsis: the Name column keeps its width.
      expect(Number(screen.getByRole("separator", { name: "Resize Name" }).getAttribute("aria-valuenow"))).toBe(60);
    });

    it("fits numbers, then lets the column narrow again when the rows change", () => {
      fake();
      const money: DataTableColumn<{ id: string; v: string }>[] = [
        { accessorKey: "id", header: "Id", size: 80 },
        { accessorKey: "v", header: "Value", size: 64, meta: { numeric: true } },
      ];
      const { rerender } = render(<DataTable data={[{ id: "a", v: "£1,234,567.89" }]} columns={money} />);
      const width = () => Number(screen.getByRole("separator", { name: "Resize Value" }).getAttribute("aria-valuenow"));
      expect(width()).toBe("£1,234,567.89".length * 8 + 1);
      rerender(<DataTable data={[{ id: "b", v: "£5" }]} columns={money} />);
      expect(width()).toBe(64);
    });
  });

  it("resizes a column from the keyboard", async () => {
    const user = userEvent.setup();
    render(<DataTable data={leads.slice(0, 2)} columns={columns} />);
    const handle = screen.getByRole("separator", { name: "Resize Score" });
    const before = Number(handle.getAttribute("aria-valuenow"));
    handle.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(Number(handle.getAttribute("aria-valuenow"))).toBe(before + 16);
  });
});

describe("cell tooltips", () => {
  it("carry a text cell's whole value but never a stored key the cell shows in words", () => {
    expect(cellTitle("Summit Health Stores")).toBe("Summit Health Stores");
    expect(cellTitle("Sep 28, 2026")).toBe("Sep 28, 2026");
    expect(cellTitle("organisation")).toBeUndefined();
    expect(cellTitle("in_progress")).toBeUndefined();
    expect(cellTitle("wage-bill")).toBeUndefined();
    expect(cellTitle(12)).toBeUndefined();
    expect(cellTitle("")).toBeUndefined();
  });

  it("never carry a machine date or moment: the cell prints it in the person's own format", () => {
    expect(cellTitle("2026-10-10T05:16:57.031Z")).toBeUndefined();
    expect(cellTitle("2026-10-10T05:16:57+01:00")).toBeUndefined();
    expect(cellTitle("2026-10-07")).toBeUndefined();
    expect(cellTitle("Due 2026-10-07 at the latest")).toBe("Due 2026-10-07 at the latest");
  });
});
