"use client";
/**
 * Legal › Compliance (BUILD §11.11): compliance events and filings with due dates as a list (DataTable with saved
 * views and right-click verbs) and a twelve-month calendar. The headline is days to the next deadline (the
 * department card's metric). Nothing here files anything; filings are recorded by the incorporation workflow and
 * the legal lead.
 */
import { useMemo, useState } from "react";
import { CalendarDays, CalendarRange, Inbox, List, Repeat } from "lucide-react";
import { DATE_FORMATS, Chip, DataTable, Panel, SegmentedControl, StatusStrip, cn, formatDate, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { DUE_WINDOW_DAYS, calendarMonths, calendarRows, daysToNextDeadline, type CalendarRow } from "./legal-data";
import { CALENDAR_PILL, Pill, Screen, fitTableHeight, humanise, useNow } from "./shared";
import type { ComplianceListResponse } from "./types";

const COMPLIANCE_INPUT = { pendingOnly: false, days: 365 } as const;

export const COMPLIANCE_SUB_VIEWS = [
  { slug: "list", title: "List" },
  { slug: "calendar", title: "Calendar" },
] as const;

export const COMPLIANCE_VIEWS: SavedView[] = [
  { id: "open", name: "Open", builtIn: true, columns: ["title", "kind", "dueAt", "daysLeft", "status", "recurrence"], sort: [{ id: "dueAt", desc: false }], filters: [{ id: "f-open", field: "status", op: "in", value: ["upcoming", "due", "overdue"] }] },
  { id: "overdue", name: "Overdue", builtIn: true, columns: ["title", "kind", "dueAt", "daysLeft", "ref"], sort: [{ id: "dueAt", desc: false }], filters: [{ id: "f-over", field: "status", op: "eq", value: "overdue" }] },
  { id: "filings", name: "Filings", builtIn: true, columns: ["title", "category", "dueAt", "status", "completedAt", "ref"], sort: [{ id: "dueAt", desc: false }], filters: [{ id: "f-fil", field: "kind", op: "eq", value: "filing" }] },
  { id: "compliance", name: "Compliance events", builtIn: true, columns: ["title", "category", "dueAt", "status", "recurrence"], sort: [{ id: "dueAt", desc: false }], filters: [{ id: "f-comp", field: "kind", op: "eq", value: "compliance" }] },
  { id: "done", name: "Done", builtIn: true, columns: ["title", "kind", "dueAt", "completedAt", "ref"], sort: [{ id: "completedAt", desc: true }], filters: [{ id: "f-done", field: "status", op: "in", value: ["done", "waived"] }] },
  { id: "all", name: "All", builtIn: true, columns: ["title", "kind", "category", "dueAt", "daysLeft", "status", "recurrence", "completedAt", "ref"], sort: [{ id: "dueAt", desc: false }], filters: [] },
];

export function daysLeftText(days: number | null): string {
  if (days === null) return "No date";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function complianceColumns(): DataTableColumn<CalendarRow>[] {
  return [
    { id: "title", accessorKey: "title", header: "Deadline", size: 260, cell: ({ row }) => <span className="t-body-strong text-primary">{row.original.title}</span>, meta: { locked: true } },
    { id: "kind", accessorKey: "kind", header: "Kind", size: 130, cell: ({ getValue }) => <Chip tone={getValue() === "filing" ? "info" : "neutral"} className="whitespace-nowrap">{getValue() === "filing" ? "Filing" : "Compliance"}</Chip>, meta: { filter: "select", filterOptions: [{ value: "filing", label: "Filing" }, { value: "compliance", label: "Compliance" }] } },
    { id: "category", accessorKey: "category", header: "Category", size: 160, cell: ({ getValue }) => <span className="text-secondary">{humanise(String(getValue()))}</span>, meta: { filter: "text" } },
    { id: "dueAt", accessorFn: (r) => r.dueAt ?? "", header: "Due", size: 120, cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatDate(String(getValue())) : "—"}</span>, meta: { filter: "date" } },
    { id: "daysLeft", accessorFn: (r) => r.daysLeft ?? Number.POSITIVE_INFINITY, header: "Days left", size: 120, cell: ({ row }) => <span className={cn("tabular-nums", row.original.daysLeft !== null && row.original.daysLeft < 0 && "text-status-bad")}>{daysLeftText(row.original.daysLeft)}</span>, meta: { numeric: true } },
    { id: "status", accessorKey: "status", header: "Status", size: 140, cell: ({ row }) => <Pill {...CALENDAR_PILL[row.original.status]} />, meta: { filter: "select", filterOptions: Object.entries(CALENDAR_PILL).map(([value, p]) => ({ value, label: p.word })) } },
    { id: "recurrence", accessorFn: (r) => r.recurrence ?? "", header: "Recurs", size: 100, cell: ({ getValue }) => (getValue() ? <span className="inline-flex items-center gap-1 text-secondary"><Repeat size={14} aria-hidden /> {humanise(String(getValue()))}</span> : <span className="text-secondary">Once</span>) },
    { id: "completedAt", accessorFn: (r) => r.completedAt ?? "", header: "Done on", size: 120, cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatDate(String(getValue())) : "—"}</span>, meta: { filter: "date" } },
    { id: "ref", accessorFn: (r) => r.ref ?? "", header: "Reference", size: 160, cell: ({ getValue }) => <span className="t-mono text-secondary">{String(getValue()) || "—"}</span> },
  ];
}

export function ComplianceScreen({ businessId, subView }: ModuleScreenProps) {
  const now = useNow();
  const { navigate } = useWidgetData();
  const query = useWidgetQuery<ComplianceListResponse>("legal.compliance.list", COMPLIANCE_INPUT);
  const [views, setViews] = useState<SavedView[]>(COMPLIANCE_VIEWS);
  const [mode, setMode] = useState<"list" | "calendar">(subView === "calendar" ? "calendar" : "list");
  const [highlight, setHighlight] = useState<string | null>(null);

  const rows = useMemo(() => calendarRows(query.data, now), [query.data, now]);
  const months = useMemo(() => calendarMonths(rows, now, 12), [rows, now]);
  const columns = useMemo(() => complianceColumns(), []);
  const next = daysToNextDeadline(rows);
  const overdue = rows.filter((r) => r.status === "overdue").length;
  const dueSoon = rows.filter((r) => r.status === "due").length;
  const doneThisYear = rows.filter((r) => r.status === "done" && r.completedAt && r.completedAt.slice(0, 4) === String(now.getUTCFullYear())).length;
  const empty = !query.isLoading && !query.error && rows.length === 0;

  const tiles: MetricTileProps[] = [
    { label: "Days to next deadline", value: next === null ? "—" : next, format: "integer", caption: next === null ? "No open deadline" : next < 0 ? "Past due" : "Open deadline", provenance: { source: "Soonest open compliance event or filing", query: "legal.compliance.list" } },
    { label: "Overdue", value: overdue, format: "integer", provenance: { source: "Open items whose due date has passed" } },
    { label: `Due within ${DUE_WINDOW_DAYS} days`, value: dueSoon, format: "integer", provenance: { source: `Open items due in the next ${DUE_WINDOW_DAYS} days` } },
    { label: "Done this year", value: doneThisYear, format: "integer", provenance: { source: "Filings filed and compliance events completed this calendar year" } },
  ];

  const rowActions = (row: CalendarRow): RowAction<CalendarRow>[] => [
    { id: "calendar", label: "Show in calendar", icon: CalendarDays, disabled: !row.dueAt, onSelect: (r) => { setHighlight(r.id); setMode("calendar"); } },
    { id: "entity", label: "Open the legal entity", icon: List, onSelect: () => navigate(routes.department(businessId, "legal", "entity")) },
    { id: "inbox", label: "Open the Inbox", icon: Inbox, separatorBefore: true, onSelect: () => navigate(routes.inbox(businessId)) },
  ];

  const emptyState = { icon: CalendarRange, title: "No deadlines yet", children: "Importing a company fills the calendar from the registry; incorporation adds the first filings. Compliance events the legal lead records appear here too." };

  return (
    <Screen name="legal/compliance">
      <section aria-label="Compliance summary" className="col-span-12" aria-busy={query.isLoading || undefined}>
        <StatusStrip tiles={tiles.map((t) => ({ ...t, loading: query.isLoading }))} />
      </section>
      <Panel
        title={mode === "calendar" ? "Calendar" : "Deadlines"}
        span={12}
        flush={mode === "list"}
        loading={query.isLoading}
        error={query.error ? query.error.message : undefined}
        onRetry={query.refetch}
        empty={empty ? emptyState : undefined}
        meta={rows.length ? `${rows.length} deadline${rows.length === 1 ? "" : "s"} · ${overdue} overdue` : undefined}
        actions={
          <SegmentedControl<"list" | "calendar">
            aria-label="View"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "list", label: "List", icon: List },
              { value: "calendar", label: "Calendar", icon: CalendarDays },
            ]}
          />
        }
        footer={<span>Right-click a deadline to see it in the calendar, open the legal entity or the Inbox.</span>}
      >
        {mode === "list" ? (
          <DataTable<CalendarRow> aria-label="Deadlines" data={rows} columns={columns} getRowId={(r) => `${r.kind}-${r.id}`} views={views} onViewsChange={setViews} defaultViewId="open" height={fitTableHeight(rows.length, { minRows: 8, maxRows: 16 })} exportFileName="compliance-calendar" rowActions={rowActions} onRowOpen={(r) => { setHighlight(r.id); setMode("calendar"); }} rowClassName={(r) => (r.id === highlight ? "row-selected" : undefined)} />
        ) : (
          <ol aria-label="Twelve-month calendar" className="grid grid-cols-4 gap-gutter">
            {months.map((m) => (
              <li key={m.key} aria-label={m.label} className={cn("surface-raised flex min-h-28 flex-col gap-1.5 rounded-md p-2.5", m.rows.length === 0 && "opacity-70")}>
                <p className="t-title text-primary">{m.label}</p>
                {m.rows.length === 0 ? (
                  <p className="t-small text-secondary">Nothing due</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {m.rows.map((r) => (
                      <li key={`${r.kind}-${r.id}`} className={cn("flex flex-col gap-1 rounded-sm px-1.5 py-1", r.id === highlight && "row-selected")}>
                        <span className="t-body text-primary">{r.title}</span>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="t-mono text-tertiary">{r.dueAt ? formatDate(r.dueAt, DATE_FORMATS.dayMonth) : ""}</span>
                          <Pill {...CALENDAR_PILL[r.status]} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </Screen>
  );
}
