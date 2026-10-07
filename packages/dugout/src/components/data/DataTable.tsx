"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnSizingState,
  type FilterFn,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  Download,
  EllipsisVertical,
  Rows3,
  Rows4,
  RotateCcw,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { uniqueId } from "../../lib/seed";
import { Checkbox } from "../foundation/Checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../foundation/ContextMenu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../foundation/DropdownMenu";
import { EmptyState, type EmptyStateProps } from "../foundation/EmptyState";
import { ErrorState } from "../foundation/ErrorState";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { SkeletonRows } from "../foundation/Skeleton";
import { downloadCsv, toCsv, type CsvColumn } from "./csv";
import { FilterChips } from "./FilterChips";
import {
  matchesFilter,
  type FilterChipValue,
  type FilterField,
  type FilterFieldKind,
  type FilterOption,
} from "./filters";
import { SavedViewSelector } from "./SavedViewSelector";
import { ROW_HEIGHT, type RowAction, type SavedView, type TableDensity } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Column meta (TanStack's extension point). Declared here so every consumer of @foundmill/dugout gets it.
// ---------------------------------------------------------------------------------------------------------------------

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align with tabular digits (DESIGN §4). */
    numeric?: boolean;
    /** Text for the column chooser, CSV header and filter field when `header` is not a string. */
    label?: string;
    /** Filter editor kind; `false` hides the column from the filter chips. Default text, or number when `numeric`. */
    filter?: FilterFieldKind | false;
    filterOptions?: readonly FilterOption[];
    /** CSV cell; default is the cell value. */
    csv?: (row: TData) => unknown;
    /** Hide from the column chooser (always visible). */
    locked?: boolean;
    /** Cell text alignment. Default left, or right when `numeric`. */
    align?: "left" | "center" | "right";
    /** Cell class. */
    className?: string;
  }
}

export type DataTableColumn<T> = ColumnDef<T, unknown>;

export interface DataTableProps<T> {
  data: readonly T[];
  columns: DataTableColumn<T>[];
  /** Stable row id; default `row.id` when present, else the index. */
  getRowId?: (row: T, index: number) => string;

  /** Saved views `{id, name, columns, sort, filters}`. Omit for a table without a view switcher. */
  views?: SavedView[];
  activeViewId?: string | null;
  defaultViewId?: string;
  onViewsChange?: (views: SavedView[]) => void;
  onActiveViewChange?: (id: string | null) => void;

  density?: TableDensity;
  defaultDensity?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;

  /** Checkbox column + multi-select. Selection by keyboard works without it (Space, Shift+arrows, ⌘A). */
  selectable?: boolean;
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[], rows: T[]) => void;

  /** Right-click verbs for a row (BUILD §5.4 "right-click menu"). */
  rowActions?: (row: T) => RowAction<T>[];
  /** Enter or double-click. */
  onRowOpen?: (row: T) => void;
  onRowClick?: (row: T, event: MouseEvent) => void;
  rowClassName?: (row: T) => string | undefined;

  /** Body height in px (the header is sticky inside it). Default 480. */
  height?: number;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  empty?: ReactNode | (Omit<EmptyStateProps, "children"> & { children: ReactNode });

  /** Toolbar title (label style) at the left when there are no views. */
  title?: ReactNode;
  /** Extra toolbar content on the right. */
  toolbar?: ReactNode;
  hideToolbar?: boolean;
  /** Quick search across every visible string cell. */
  globalFilter?: string;

  exportFileName?: string;
  /** Receives the CSV instead of downloading it. */
  onExportCsv?: (csv: string, rows: T[]) => void;

  /** Default: virtualise above 100 rows. */
  virtualized?: boolean;
  overscan?: number;
  /** Status line under the body; default "N rows · M selected". Pass null to hide. */
  footer?: ReactNode | null;
  "aria-label"?: string;
  className?: string;
}

const SELECT_COLUMN_ID = "__select";
const MIN_COLUMN_WIDTH = 48;

interface ChipFilterValue {
  chips: FilterChipValue[];
  kind: FilterFieldKind;
}

const chipFilterFn: FilterFn<unknown> = (row, columnId, filterValue: ChipFilterValue) => {
  const cell = row.getValue(columnId);
  return filterValue.chips.every((chip) => matchesFilter(cell, chip, filterValue.kind));
};

const globalFilterFn: FilterFn<unknown> = (row, columnId, needle: string) => {
  const v = row.getValue(columnId);
  if (v === null || v === undefined) return false;
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  return text.toLowerCase().includes(needle.toLowerCase());
};

function isEmptyStateProps(
  v: unknown,
): v is Omit<EmptyStateProps, "children"> & { children: ReactNode } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "children" in v &&
    !("$$typeof" in v)
  );
}

function columnLabel<T>(table: Table<T>, id: string): string {
  const col = table.getColumn(id);
  if (!col) return id;
  const meta = col.columnDef.meta;
  if (meta?.label) return meta.label;
  const h = col.columnDef.header;
  return typeof h === "string" ? h : id;
}

function defLabel<T>(def: ColumnDef<T, unknown>, id: string): string {
  if (def.meta?.label) return def.meta.label;
  return typeof def.header === "string" ? def.header : id;
}

function defFilterKind<T>(def: ColumnDef<T, unknown>): FilterFieldKind {
  const meta = def.meta;
  if (meta?.filter) return meta.filter;
  return meta?.numeric ? "number" : "text";
}

interface ViewState {
  columns: string[];
  sort: SortingState;
  filters: FilterChipValue[];
  density: TableDensity;
}

function stateKey(s: ViewState): string {
  return JSON.stringify([
    s.columns,
    s.sort.map((x) => [x.id, x.desc]),
    s.filters.map((f) => [f.field, f.op, f.value]),
    s.density,
  ]);
}

function defaultRowId<T>(row: T, index: number): string {
  const id = (row as { id?: unknown })?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : String(index);
}

/**
 * DataTable (BUILD §5.4, DESIGN §8): TanStack Table 8 + react-virtual. Saved views with a switcher, column chooser,
 * multi-sort (Shift+click), filter chips with an editor, sticky label-style header, virtualised rows at 28/34 px,
 * keyboard navigation (arrows, Home/End, PageUp/Down, Enter opens, Space selects, Shift extends, ⌘A selects all,
 * Esc clears), row selection with a 3 px kit-primary edge, right-click verbs, CSV export, column resizing (drag or
 * arrow keys on the handle), numeric columns right-aligned tabular, loading/empty/error states, zebra 2 % and hover 4 %.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    data,
    columns,
    getRowId = defaultRowId,
    views,
    activeViewId: activeViewIdProp,
    defaultViewId,
    onViewsChange,
    onActiveViewChange,
    density: densityProp,
    defaultDensity = "compact",
    onDensityChange,
    selectable,
    selectedIds,
    onSelectionChange,
    rowActions,
    onRowOpen,
    onRowClick,
    rowClassName,
    height = 480,
    loading,
    error,
    onRetry,
    empty,
    title,
    toolbar,
    hideToolbar,
    globalFilter,
    exportFileName = "export",
    onExportCsv,
    virtualized,
    overscan = 12,
    footer,
    className,
  } = props;

  const tableId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- Saved views ---------------------------------------------------------------------------------------------------
  const [activeViewIdState, setActiveViewIdState] = useState<string | null>(
    () => activeViewIdProp ?? defaultViewId ?? views?.[0]?.id ?? null,
  );
  const activeViewId = activeViewIdProp !== undefined ? activeViewIdProp : activeViewIdState;
  const activeView = useMemo(
    () => views?.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  );

  const allColumnIds = useMemo(
    () =>
      columns.map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey ?? "").filter(Boolean),
    [columns],
  );

  const viewToState = useCallback(
    (v: SavedView | null): ViewState => ({
      columns: v ? v.columns.filter((id) => allColumnIds.includes(id)) : allColumnIds,
      sort: v ? v.sort.map((s) => ({ id: s.id, desc: s.desc })) : [],
      filters: v ? v.filters.map((f) => ({ ...f })) : [],
      density: v?.density ?? densityProp ?? defaultDensity,
    }),
    [allColumnIds, densityProp, defaultDensity],
  );

  const [sorting, setSorting] = useState<SortingState>(() => viewToState(activeView).sort);
  const [chips, setChips] = useState<FilterChipValue[]>(() => viewToState(activeView).filters);
  const [visibleIds, setVisibleIds] = useState<string[]>(() => viewToState(activeView).columns);
  const [densityState, setDensityState] = useState<TableDensity>(
    () => viewToState(activeView).density,
  );
  const density = densityProp ?? densityState;
  const setDensity = (d: TableDensity) => {
    setDensityState(d);
    onDensityChange?.(d);
  };

  const applyView = useCallback(
    (v: SavedView | null) => {
      const s = viewToState(v);
      setSorting(s.sort);
      setChips(s.filters);
      setVisibleIds(s.columns);
      if (densityProp === undefined) setDensityState(s.density);
    },
    [viewToState, densityProp],
  );

  const lastAppliedView = useRef<string | null>(activeViewId);
  useEffect(() => {
    if (lastAppliedView.current !== activeViewId) {
      lastAppliedView.current = activeViewId;
      applyView(activeView);
    }
  }, [activeViewId, activeView, applyView]);

  const selectView = (id: string) => {
    if (activeViewIdProp === undefined) setActiveViewIdState(id);
    onActiveViewChange?.(id);
  };

  const currentState: ViewState = { columns: visibleIds, sort: sorting, filters: chips, density };
  const dirty = !!activeView && stateKey(currentState) !== stateKey(viewToState(activeView));

  const saveView = () => {
    if (!views || !activeView || !onViewsChange) return;
    onViewsChange(
      views.map((v) =>
        v.id === activeView.id
          ? {
              ...v,
              columns: visibleIds,
              sort: sorting.map((s) => ({ id: s.id, desc: s.desc })),
              filters: chips,
              density,
            }
          : v,
      ),
    );
  };
  const saveViewAs = (name: string) => {
    if (!views || !onViewsChange) return;
    const view: SavedView = {
      id: uniqueId("view"),
      name,
      columns: visibleIds,
      sort: sorting.map((s) => ({ id: s.id, desc: s.desc })),
      filters: chips,
      density,
    };
    onViewsChange([...views, view]);
    lastAppliedView.current = view.id; // state already matches
    selectView(view.id);
  };
  const renameView = (id: string, name: string) => {
    if (!views || !onViewsChange) return;
    onViewsChange(views.map((v) => (v.id === id ? { ...v, name } : v)));
  };
  const deleteView = (id: string) => {
    if (!views || !onViewsChange) return;
    const next = views.filter((v) => v.id !== id);
    onViewsChange(next);
    if (activeViewId === id) selectView(next[0]?.id ?? "");
  };

  // ---- Table ---------------------------------------------------------------------------------------------------------
  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = {};
    for (const id of allColumnIds) vis[id] = visibleIds.includes(id);
    return vis;
  }, [allColumnIds, visibleIds]);
  const columnOrder = useMemo<ColumnOrderState>(
    () => [
      SELECT_COLUMN_ID,
      ...visibleIds,
      ...allColumnIds.filter((id) => !visibleIds.includes(id)),
    ],
    [visibleIds, allColumnIds],
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  const [rowSelectionState, setRowSelectionState] = useState<RowSelectionState>({});
  const rowSelection = useMemo<RowSelectionState>(() => {
    if (!selectedIds) return rowSelectionState;
    const s: RowSelectionState = {};
    for (const id of selectedIds) s[id] = true;
    return s;
  }, [selectedIds, rowSelectionState]);

  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const byField = new Map<string, FilterChipValue[]>();
    for (const c of chips) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
    return [...byField.entries()].map(([id, list]) => {
      const def = columns.find((c) => (c.id ?? (c as { accessorKey?: string }).accessorKey) === id);
      const value: ChipFilterValue = { chips: list, kind: def ? defFilterKind(def) : "text" };
      return { id, value };
    });
  }, [chips, columns]);

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<T, unknown> = {
      id: SELECT_COLUMN_ID,
      size: 36,
      minSize: 36,
      maxSize: 36,
      enableSorting: false,
      enableResizing: false,
      enableHiding: false,
      meta: { locked: true, filter: false, align: "center" },
      header: ({ table: t }) => (
        <Checkbox
          aria-label="Select all rows"
          checked={
            t.getIsAllRowsSelected() ? true : t.getIsSomeRowsSelected() ? "indeterminate" : false
          }
          onCheckedChange={(v) => t.toggleAllRowsSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select row ${row.index + 1}`}
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable]);

  const table = useReactTable<T>({
    data: data as T[],
    columns: allColumns,
    getRowId,
    state: {
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
      rowSelection,
      columnFilters,
      globalFilter: globalFilter ?? "",
    },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      if (!selectedIds) setRowSelectionState(next);
      if (onSelectionChange) {
        const ids = Object.keys(next).filter((k) => next[k]);
        const byId = new Map(table.getCoreRowModel().rows.map((r) => [r.id, r.original]));
        onSelectionChange(
          ids,
          ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined),
        );
      }
    },
    enableMultiSort: true,
    enableSortingRemoval: true,
    enableRowSelection: true,
    columnResizeMode: "onChange",
    defaultColumn: { filterFn: chipFilterFn as FilterFn<T>, minSize: MIN_COLUMN_WIDTH, size: 160 },
    globalFilterFn: globalFilterFn as FilterFn<T>,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filterFields = useMemo<FilterField[]>(
    () =>
      columns
        .map((c) => ({ id: c.id ?? (c as { accessorKey?: string }).accessorKey ?? "", def: c }))
        .filter((x) => x.id && x.def.meta?.filter !== false)
        .map((x) => ({
          id: x.id,
          label: defLabel(x.def, x.id),
          kind: defFilterKind(x.def),
          options: x.def.meta?.filterOptions,
        })),
    [columns],
  );

  const rows = table.getRowModel().rows;
  const rowHeight = ROW_HEIGHT[density];
  const isVirtual = virtualized ?? rows.length > 100;
  const virtualizer = useVirtualizer({
    count: isVirtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    // The body height is fixed by the `height` prop, so report it directly instead of measuring (also makes the
    // virtualiser work in DOM environments that lay nothing out).
    observeElementRect: (_instance, cb) => {
      cb({ width: scrollRef.current?.clientWidth || 1200, height });
      return () => {};
    },
  });
  const virtualItems = virtualizer.getVirtualItems();

  // ---- Keyboard and selection -----------------------------------------------------------------------------------------
  const [focusIndex, setFocusIndex] = useState(-1);
  const [focusWithin, setFocusWithin] = useState(false);
  const anchorRef = useRef<number>(-1);
  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(rows.length - 1);
  }, [rows.length, focusIndex]);

  const scrollRowIntoView = useCallback(
    (index: number) => {
      if (index < 0) return;
      if (isVirtual) {
        virtualizer.scrollToIndex(index, { align: "auto" });
      } else {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
        el?.scrollIntoView?.({ block: "nearest" });
      }
    },
    [isVirtual, virtualizer],
  );

  const selectOnly = (index: number) => {
    const r = rows[index];
    if (!r) return;
    table.setRowSelection({ [r.id]: true });
  };
  const selectRange = (from: number, to: number, additive: boolean) => {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const next: RowSelectionState = additive ? { ...rowSelection } : {};
    for (let i = a; i <= b; i++) {
      const r = rows[i];
      if (r) next[r.id] = true;
    }
    table.setRowSelection(next);
  };

  const moveFocus = (next: number, e: KeyboardEvent) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, next));
    setFocusIndex(clamped);
    scrollRowIntoView(clamped);
    if (e.shiftKey) {
      if (anchorRef.current < 0) anchorRef.current = focusIndex < 0 ? clamped : focusIndex;
      selectRange(anchorRef.current, clamped, false);
    } else {
      anchorRef.current = clamped;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (rows.length === 0) return;
    const target = e.target as HTMLElement;
    if (
      target !== e.currentTarget &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.getAttribute("role") === "separator")
    )
      return;
    const pageSize = Math.max(1, Math.floor(height / rowHeight) - 1);
    const meta = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveFocus(focusIndex < 0 ? 0 : focusIndex + 1, e);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(focusIndex < 0 ? 0 : focusIndex - 1, e);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(0, e);
        break;
      case "End":
        e.preventDefault();
        moveFocus(rows.length - 1, e);
        break;
      case "PageDown":
        e.preventDefault();
        moveFocus((focusIndex < 0 ? 0 : focusIndex) + pageSize, e);
        break;
      case "PageUp":
        e.preventDefault();
        moveFocus((focusIndex < 0 ? 0 : focusIndex) - pageSize, e);
        break;
      case "Enter": {
        const r = rows[focusIndex];
        if (r && onRowOpen) {
          e.preventDefault();
          onRowOpen(r.original);
        }
        break;
      }
      case " ": {
        const r = rows[focusIndex];
        if (r) {
          e.preventDefault();
          r.toggleSelected();
          anchorRef.current = focusIndex;
        }
        break;
      }
      case "a":
      case "A":
        if (meta) {
          e.preventDefault();
          table.toggleAllRowsSelected(true);
        }
        break;
      case "Escape":
        if (Object.keys(rowSelection).length > 0) {
          e.preventDefault();
          table.resetRowSelection();
        }
        break;
      default:
        break;
    }
  };

  const onRowMouseDown = (index: number, e: MouseEvent) => {
    if (e.button !== 0) return;
    setFocusIndex(index);
    const r = rows[index];
    if (!r) return;
    if (e.shiftKey) {
      e.preventDefault();
      selectRange(anchorRef.current < 0 ? index : anchorRef.current, index, e.metaKey || e.ctrlKey);
      return;
    }
    anchorRef.current = index;
    if (e.metaKey || e.ctrlKey) {
      r.toggleSelected();
    } else if (selectable || onSelectionChange || selectedIds) {
      selectOnly(index);
    }
  };

  // ---- Context menu ---------------------------------------------------------------------------------------------------
  const [menuRow, setMenuRow] = useState<Row<T> | null>(null);
  const menuActions = menuRow && rowActions ? rowActions(menuRow.original) : [];
  const onRowContextMenu = (index: number) => {
    const r = rows[index];
    if (!r) return;
    setMenuRow(r);
    setFocusIndex(index);
    anchorRef.current = index;
    if (!r.getIsSelected() && (selectable || onSelectionChange || selectedIds)) selectOnly(index);
  };

  // ---- CSV -----------------------------------------------------------------------------------------------------------
  const exportCsvNow = () => {
    const cols: CsvColumn<Row<T>>[] = table
      .getVisibleLeafColumns()
      .filter((c) => c.id !== SELECT_COLUMN_ID)
      .map((c) => ({
        header: columnLabel(table, c.id),
        value: (r) => (c.columnDef.meta?.csv ? c.columnDef.meta.csv(r.original) : r.getValue(c.id)),
      }));
    const csv = toCsv(cols, rows);
    if (onExportCsv)
      onExportCsv(
        csv,
        rows.map((r) => r.original),
      );
    else downloadCsv(exportFileName, csv);
  };

  // ---- Render --------------------------------------------------------------------------------------------------------
  const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;
  const state: "loading" | "error" | "empty" | "ready" = loading
    ? "loading"
    : error
      ? "error"
      : rows.length === 0
        ? "empty"
        : "ready";
  const visibleLeaf = table.getVisibleLeafColumns();
  const totalWidth = table.getTotalSize();
  const rowIdAttr = (r: Row<T>) => `${tableId}-row-${r.id}`;
  const activeDescendant =
    focusWithin && focusIndex >= 0 && rows[focusIndex]
      ? rowIdAttr(rows[focusIndex] as Row<T>)
      : undefined;

  const hasViews = !!views && views.length > 0;
  const showToolbar = !hideToolbar;

  const renderRow = (row: Row<T>, index: number, style?: CSSProperties) => {
    const selected = row.getIsSelected();
    const focused = index === focusIndex;
    return (
      <tr
        key={row.id}
        id={rowIdAttr(row)}
        role="row"
        aria-selected={selected}
        aria-rowindex={index + 2}
        data-row-index={index}
        data-selected={selected || undefined}
        data-focused={focused || undefined}
        style={{ ...style, height: rowHeight, minWidth: totalWidth }}
        onMouseDown={(e) => onRowMouseDown(index, e)}
        onClick={(e) => onRowClick?.(row.original, e)}
        onDoubleClick={() => onRowOpen?.(row.original)}
        onContextMenu={() => onRowContextMenu(index)}
        className={cn(
          "relative flex w-full items-stretch border-b hairline-50 text-body text-primary select-none",
          index % 2 === 1 && "bg-white/2",
          "hover:bg-white/4",
          selected && "bg-kit-primary/8",
          focused && focusWithin && "outline-2 -outline-offset-2 outline-link",
          rowClassName?.(row.original),
        )}
      >
        {selected ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-0.75 bg-kit-primary"
          />
        ) : null}
        {row.getVisibleCells().map((cell, ci) => {
          const meta = cell.column.columnDef.meta;
          const numeric = !!meta?.numeric;
          const align = meta?.align ?? (numeric ? "right" : "left");
          const last = ci === visibleLeaf.length - 1;
          return (
            <td
              key={cell.id}
              role="gridcell"
              className={cn(
                "flex min-w-0 items-center overflow-hidden px-2 whitespace-nowrap",
                align === "right" && "justify-end text-right",
                align === "center" && "justify-center text-center",
                numeric && "tabular",
                last && "flex-1",
                meta?.className,
              )}
              style={{
                width: cell.column.getSize(),
                minWidth: last ? cell.column.getSize() : undefined,
              }}
            >
              <span className="truncate">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </span>
            </td>
          );
        })}
      </tr>
    );
  };

  const body = (
    <div
      ref={scrollRef}
      className="relative overflow-auto"
      style={{ height }}
      data-density={density}
      data-state={state}
    >
      <table
        role="grid"
        tabIndex={0}
        aria-label={props["aria-label"]}
        aria-rowcount={rows.length + 1}
        aria-multiselectable
        aria-activedescendant={activeDescendant}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          if (e.target === e.currentTarget) {
            setFocusWithin(true);
            if (focusIndex < 0 && rows.length > 0) setFocusIndex(0);
          }
        }}
        onBlur={(e) => {
          if (e.target === e.currentTarget) setFocusWithin(false);
        }}
        className="grid w-full border-separate border-spacing-0 outline-none"
        style={{ minWidth: totalWidth }}
      >
        <thead
          className="sticky top-0 z-10 grid bg-panel-alt"
          onContextMenu={(e) => e.stopPropagation()}
        >
          {table.getHeaderGroups().map((hg) => (
            <tr
              key={hg.id}
              role="row"
              className="flex h-panel-header w-full border-b border-subtle"
              style={{ minWidth: totalWidth }}
            >
              {hg.headers.map((header, hi) => {
                const col = header.column;
                const meta = col.columnDef.meta;
                const numeric = !!meta?.numeric;
                const align = meta?.align ?? (numeric ? "right" : "left");
                const sorted = col.getIsSorted();
                const canSort = col.getCanSort();
                const sortIndex = sorting.length > 1 && sorted ? col.getSortIndex() + 1 : null;
                const last = hi === hg.headers.length - 1;
                const label = columnLabel(table, col.id);
                return (
                  <th
                    key={header.id}
                    role="columnheader"
                    scope="col"
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : canSort
                            ? "none"
                            : undefined
                    }
                    className={cn(
                      "relative flex min-w-0 items-center px-2",
                      align === "right" && "justify-end",
                      align === "center" && "justify-center",
                      last && "flex-1",
                    )}
                    style={{ width: col.getSize(), minWidth: last ? col.getSize() : undefined }}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={col.getToggleSortingHandler()}
                        className={cn(
                          "t-label flex min-w-0 items-center gap-1 rounded-chip hover:text-primary focus-visible:outline-2",
                          sorted && "text-primary",
                        )}
                        title={`Sort by ${label}. Shift+click to add a secondary sort.`}
                      >
                        <span className="truncate">
                          {flexRender(col.columnDef.header, header.getContext())}
                        </span>
                        <Icon
                          icon={
                            sorted === "asc"
                              ? ArrowUp
                              : sorted === "desc"
                                ? ArrowDown
                                : ChevronsUpDown
                          }
                          size={12}
                          className={cn(!sorted && "text-secondary/70")}
                        />
                        {sortIndex ? (
                          <span className="font-mono text-label text-secondary">{sortIndex}</span>
                        ) : null}
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "t-label truncate",
                          col.id === SELECT_COLUMN_ID && "flex items-center",
                        )}
                      >
                        {flexRender(col.columnDef.header, header.getContext())}
                      </span>
                    )}
                    {col.getCanResize() ? (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${label}`}
                        aria-valuenow={Math.round(col.getSize())}
                        aria-valuemin={MIN_COLUMN_WIDTH}
                        tabIndex={0}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => col.resetSize()}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                            e.preventDefault();
                            e.stopPropagation();
                            const delta = e.key === "ArrowLeft" ? -8 : 8;
                            setColumnSizing((prev) => ({
                              ...prev,
                              [col.id]: Math.max(MIN_COLUMN_WIDTH, col.getSize() + delta),
                            }));
                          }
                        }}
                        className={cn(
                          "absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none select-none after:absolute after:inset-y-1.5 after:right-0.5 after:w-px after:bg-subtle hover:after:bg-secondary focus-visible:after:bg-link",
                          col.getIsResizing() && "after:bg-link",
                        )}
                      />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        {state === "ready" ? (
          <tbody
            className="relative grid"
            style={isVirtual ? { height: virtualizer.getTotalSize() } : undefined}
          >
            {isVirtual
              ? virtualItems.map((vi) =>
                  renderRow(rows[vi.index] as Row<T>, vi.index, {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${vi.start}px)`,
                  }),
                )
              : rows.map((r, i) => renderRow(r, i))}
          </tbody>
        ) : (
          <tbody className="grid" onContextMenu={(e) => e.stopPropagation()}>
            <tr role="row" className="flex w-full">
              <td
                role="gridcell"
                className="w-full"
                aria-colspan={visibleLeaf.length}
                style={{ minWidth: totalWidth }}
              >
                {state === "loading" ? (
                  <SkeletonRows
                    rows={Math.min(12, Math.floor(height / rowHeight))}
                    cols={Math.max(2, Math.min(6, visibleLeaf.length))}
                  />
                ) : state === "error" ? (
                  <ErrorState onRetry={onRetry}>{error}</ErrorState>
                ) : isEmptyStateProps(empty) ? (
                  <EmptyState {...empty} />
                ) : (
                  <EmptyState>
                    {(empty as ReactNode) ??
                      (chips.length > 0 || globalFilter
                        ? "No rows match these filters. Remove a filter to see more."
                        : "Nothing here yet.")}
                  </EmptyState>
                )}
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );

  const chooserColumns = table
    .getAllLeafColumns()
    .filter((c) => c.id !== SELECT_COLUMN_ID && !c.columnDef.meta?.locked);

  return (
    <div
      className={cn("surface-panel flex min-w-0 flex-col overflow-hidden", className)}
      data-datatable
      aria-busy={loading || undefined}
    >
      {showToolbar ? (
        <div className="flex min-h-panel-header flex-wrap items-center gap-2 border-b border-subtle bg-panel-alt px-2 py-1">
          {hasViews ? (
            <SavedViewSelector
              views={views as SavedView[]}
              activeId={activeViewId}
              onSelect={selectView}
              dirty={dirty}
              onSave={onViewsChange ? saveView : undefined}
              onSaveAs={onViewsChange ? saveViewAs : undefined}
              onRename={onViewsChange ? renameView : undefined}
              onDelete={onViewsChange ? deleteView : undefined}
              onRevert={() => applyView(activeView)}
            />
          ) : title ? (
            <h2 className="t-label px-1">{title}</h2>
          ) : null}
          <FilterChips
            fields={filterFields}
            chips={chips}
            onChange={setChips}
            className="min-w-0 flex-1"
          />
          <div className="ml-auto flex items-center gap-1">
            {toolbar}
            <IconButton
              size="sm"
              icon={density === "compact" ? Rows4 : Rows3}
              label={
                density === "compact" ? "Switch to comfortable rows" : "Switch to compact rows"
              }
              pressed={density === "comfortable"}
              onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={Columns3} label="Choose columns" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                {chooserColumns.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    disabled={c.getIsVisible() && visibleIds.length <= 1}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) =>
                      setVisibleIds((prev) =>
                        checked
                          ? [...allColumnIds.filter((id) => prev.includes(id) || id === c.id)]
                          : prev.filter((id) => id !== c.id),
                      )
                    }
                  >
                    {columnLabel(table, c.id)}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setVisibleIds(allColumnIds)}>
                  Show all columns
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" icon={EllipsisVertical} label="Table menu" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={exportCsvNow} disabled={rows.length === 0}>
                  <Icon icon={Download} size="inline" className="text-secondary" />
                  Export CSV
                  <span className="ml-auto pl-4 text-small text-secondary tabular-nums">
                    {formatNumber(rows.length, { maxDigits: 0 })} rows
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setColumnSizing({})}>
                  <Icon icon={RotateCcw} size="inline" className="text-secondary" />
                  Reset column widths
                </DropdownMenuItem>
                {selectedCount > 0 ? (
                  <DropdownMenuItem onSelect={() => table.resetRowSelection()}>
                    Clear selection
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}

      {rowActions ? (
        <ContextMenu onOpenChange={(o) => (o ? null : setMenuRow(null))}>
          <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
          <ContextMenuContent aria-label="Row actions">
            {menuActions.length === 0 ? (
              <ContextMenuItem disabled>No actions</ContextMenuItem>
            ) : (
              menuActions.map((a, i) => (
                <span key={a.id} className="contents">
                  {a.separatorBefore && i > 0 ? <ContextMenuSeparator /> : null}
                  <ContextMenuItem
                    variant={a.variant}
                    disabled={a.disabled}
                    onSelect={() => menuRow && a.onSelect(menuRow.original)}
                  >
                    {a.icon ? (
                      <Icon
                        icon={a.icon}
                        size="inline"
                        className={a.variant === "danger" ? undefined : "text-secondary"}
                      />
                    ) : null}
                    {a.label}
                    {a.shortcut ? <ContextMenuShortcut>{a.shortcut}</ContextMenuShortcut> : null}
                  </ContextMenuItem>
                </span>
              ))
            )}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        body
      )}

      {footer === null ? null : (
        <div
          className="flex h-6 shrink-0 items-center gap-3 border-t border-subtle px-3 text-small text-secondary tabular-nums"
          data-table-footer
        >
          {footer ?? (
            <>
              <span>
                {formatNumber(rows.length, { maxDigits: 0 })} {rows.length === 1 ? "row" : "rows"}
                {rows.length !== data.length
                  ? ` of ${formatNumber(data.length, { maxDigits: 0 })}`
                  : ""}
              </span>
              {selectedCount > 0 ? (
                <span>{formatNumber(selectedCount, { maxDigits: 0 })} selected</span>
              ) : null}
              {sorting.length > 1 ? (
                <span>Sorted by {sorting.map((s) => columnLabel(table, s.id)).join(", ")}</span>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
