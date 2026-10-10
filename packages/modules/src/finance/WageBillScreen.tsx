"use client";
/**
 * Finance › Wage bill (BUILD §11.8): per-agent monthly cost (tokens, sandbox minutes, tool calls, training) against
 * each agent's wage cap, the human payroll line from categorised bank transactions, and output per euro (tasks
 * completed per 100 units of cost). Every figure is an Estimate: the founder's Anthropic invoice is the only real cost.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Bot, GraduationCap, UserRound, Users } from "lucide-react";
import { AgentStatusPill, Chip, DataTable, DeptChip, EntityLink, MiniTable, Panel, StatusPill, StatusStrip, SimpleSelect, currencySymbol, formatCompact, formatDate, formatNumber, formatPercent, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { capUsedPct, formatMonth, monthKey, monthStart, outputPerHundred, sectionOf, trailingMonths } from "./metrics";
import { fitColumns, type ColumnFit } from "../fit";
import { Screen, fmtMoney, toDate, useCurrency, useFittedColumns, useNow } from "./shared";
import type { MembershipRow, PnlResponse, TaskRow, TasksListResponse, TeamAgentRow, WageRow, WagesResponse } from "./types";

export const CAP_WARN_PCT = 80;

/** "owner" → "Owner"; membership roles read as words. */
export function memberRoleWord(role: string | null | undefined): string {
  if (!role) return "Member";
  const w = role.replace(/[_-]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export interface WageBillRow {
  agentId: string;
  name: string;
  role: string;
  modelKey: string;
  status: TeamAgentRow["status"] | null;
  department: TeamAgentRow["departments"][number] | null;
  tokens: number;
  sandboxMinutes: number;
  toolCalls: number;
  trainingMinor: number;
  costMinor: number;
  capMinor: number | null;
  capUsedPct: number | null;
  tasksDone: number;
  outputPerHundred: number | null;
}

export function readAgents(data: TeamAgentRow[] | { agents: TeamAgentRow[] } | undefined): TeamAgentRow[] {
  if (!data) return [];
  return Array.isArray(data) ? data : (data.agents ?? []);
}

/** One row per agent with usage in the period; agents without usage still appear (zero cost) so caps are visible. */
export function wageBillRows(wages: readonly WageRow[], agents: readonly TeamAgentRow[], tasks: readonly TaskRow[], period: string): WageBillRow[] {
  const doneByAgent = new Map<string, number>();
  for (const t of tasks) {
    if (t.status !== "done" || !t.assigneeAgentId) continue;
    // Dates arrive as Date objects through superjson even where the row type says string.
    const ended = toDate(t.endedAt ?? t.updatedAt ?? null)?.toISOString() ?? null;
    if (ended && !ended.startsWith(period)) continue;
    doneByAgent.set(t.assigneeAgentId, (doneByAgent.get(t.assigneeAgentId) ?? 0) + 1);
  }
  const byAgent = new Map<string, WageBillRow>();
  for (const a of agents) {
    byAgent.set(a.id, { agentId: a.id, name: a.name, role: a.role, modelKey: String(a.modelKey), status: a.status, department: a.departments?.[0] ?? null, tokens: 0, sandboxMinutes: 0, toolCalls: 0, trainingMinor: 0, costMinor: 0, capMinor: a.wage?.capMinor ?? null, capUsedPct: null, tasksDone: doneByAgent.get(a.id) ?? 0, outputPerHundred: null });
  }
  for (const w of wages) {
    if (!w.agentId) continue;
    const row = byAgent.get(w.agentId) ?? { agentId: w.agentId, name: w.name ?? "Former agent", role: "", modelKey: "", status: null, department: null, tokens: 0, sandboxMinutes: 0, toolCalls: 0, trainingMinor: 0, costMinor: 0, capMinor: w.wageCapMinor, capUsedPct: null, tasksDone: doneByAgent.get(w.agentId) ?? 0, outputPerHundred: null };
    row.tokens += w.tokens;
    row.sandboxMinutes += w.sandboxMinutes;
    row.toolCalls += w.toolCalls;
    row.trainingMinor += w.trainingMinor;
    row.costMinor += w.costMinor;
    if (w.wageCapMinor !== null && row.capMinor === null) row.capMinor = w.wageCapMinor;
    byAgent.set(w.agentId, row);
  }
  return [...byAgent.values()]
    .map((r) => ({ ...r, capUsedPct: capUsedPct(r.costMinor, r.capMinor), outputPerHundred: outputPerHundred(r.tasksDone, r.costMinor) }))
    .sort((a, b) => b.costMinor - a.costMinor || a.name.localeCompare(b.name));
}

/**
 * The table shares the row with Staff (8 of 12 columns: 647 px at 1280), so each view carries what fits there: the
 * wage cap cell already shows the share used, and an agent's model and role are one click away on its profile.
 */
export const WAGE_VIEWS: SavedView[] = [
  { id: "all", name: "All agents", builtIn: true, columns: ["name", "cost", "cap", "tasks", "output"], sort: [{ id: "cost", desc: true }], filters: [] },
  { id: "usage", name: "Usage detail", builtIn: true, columns: ["name", "tokens", "sandbox", "tools", "training", "cost"], sort: [{ id: "cost", desc: true }], filters: [] },
  { id: "teams", name: "By department", builtIn: true, columns: ["name", "department", "status", "cost"], sort: [{ id: "department", desc: false }], filters: [] },
  { id: "near-cap", name: "Near wage cap", builtIn: true, columns: ["name", "role", "cost", "cap", "tasks"], sort: [{ id: "capPct", desc: true }], filters: [{ id: "f-cap", field: "capPct", op: "gte", value: CAP_WARN_PCT }] },
  { id: "idle", name: "Cost without output", builtIn: true, columns: ["name", "department", "cost", "tasks", "output"], sort: [{ id: "cost", desc: true }], filters: [{ id: "f-idle-tasks", field: "tasks", op: "eq", value: 0 }, { id: "f-idle-cost", field: "cost", op: "gt", value: 0 }] },
];

/** What each column's content needs and its share of the spare width. */
export const WAGE_FIT = {
  name: { min: 150, grow: 3 },
  role: { min: 130, grow: 1 },
  department: { min: 170, grow: 1 },
  model: { min: 84 },
  status: { min: 120 },
  tokens: { min: 90 },
  sandbox: { min: 96 },
  tools: { min: 96 },
  training: { min: 100 },
  cost: { min: 100 },
  cap: { min: 152 },
  capPct: { min: 100 },
  tasks: { min: 102 },
  output: { min: 130 },
} satisfies Record<string, ColumnFit>;
export type WageColumnId = keyof typeof WAGE_FIT;

/** "Tasks per £100": output per 100 units of the business's own currency. */
export function perHundredLabel(currency: string): string {
  const symbol = currencySymbol(currency);
  return symbol ? `Tasks per ${symbol}100` : `Tasks per 100 ${currency}`;
}

export function wageColumns(businessId: string, currency: string, sizes: Record<WageColumnId, number> = fitColumns<WageColumnId>(null, WAGE_FIT, [])): DataTableColumn<WageBillRow>[] {
  return [
    { id: "name", accessorKey: "name", header: "Agent", size: sizes.name, cell: ({ row }) => <EntityLink entity={{ id: row.original.agentId, kind: "agent", name: row.original.name, href: routes.agent(businessId, row.original.agentId) }} />, meta: { locked: true } },
    { id: "role", accessorKey: "role", header: "Role", size: sizes.role, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    { id: "department", accessorFn: (r) => r.department?.name ?? "", header: "Department", size: sizes.department, cell: ({ row }) => (row.original.department ? <DeptChip dept={row.original.department.colourToken} fit>{row.original.department.name}</DeptChip> : <span className="text-secondary">—</span>), meta: { filter: "text" } },
    { id: "model", accessorKey: "modelKey", header: "Model", size: sizes.model, cell: ({ getValue }) => (getValue() ? <Chip tone="neutral" mono>{String(getValue())}</Chip> : null), meta: { filter: "select", filterOptions: ["opus", "sonnet", "haiku"].map((m) => ({ value: m, label: m })) } },
    { id: "status", accessorFn: (r) => r.status ?? "", header: "Status", size: sizes.status, cell: ({ row }) => (row.original.status ? <AgentStatusPill status={row.original.status} /> : <span className="text-secondary">Released</span>) },
    { id: "tokens", accessorKey: "tokens", header: "Tokens", size: sizes.tokens, cell: ({ getValue }) => <span className="tabular-nums">{formatCompact(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "sandbox", accessorKey: "sandboxMinutes", header: "Sandbox", size: sizes.sandbox, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(getValue() as number, { digits: 0 })} min</span>, meta: { numeric: true, label: "Sandbox minutes", csv: (r) => r.sandboxMinutes } },
    { id: "tools", accessorKey: "toolCalls", header: "Tool calls", size: sizes.tools, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(getValue() as number, { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "training", accessorKey: "trainingMinor", header: "Training", size: sizes.training, cell: ({ getValue }) => <span className="tabular-nums">{fmtMoney(getValue() as number, currency)}</span>, meta: { numeric: true, csv: (r) => (r.trainingMinor / 100).toFixed(2) } },
    { id: "cost", accessorKey: "costMinor", header: "Cost", size: sizes.cost, cell: ({ getValue }) => <span className="text-body-strong text-primary tabular-nums">{fmtMoney(getValue() as number, currency)}</span>, meta: { numeric: true, csv: (r) => (r.costMinor / 100).toFixed(2) } },
    {
      id: "cap",
      accessorFn: (r) => r.capMinor ?? 0,
      header: "Wage cap",
      size: sizes.cap,
      cell: ({ row }) => {
        const r = row.original;
        if (r.capMinor === null) return <span className="text-secondary">Uncapped</span>;
        const pct = r.capUsedPct ?? 0;
        return (
          <span className="flex items-center justify-end gap-1.5">
            <span className="tabular-nums">{fmtMoney(r.capMinor, currency)}</span>
            {pct >= 100 ? (
              <StatusPill tone="bad" icon={AlertTriangle} className="whitespace-nowrap">
                Over cap
              </StatusPill>
            ) : pct >= CAP_WARN_PCT ? (
              <StatusPill tone="warn" icon={AlertTriangle} className="whitespace-nowrap">
                {formatPercent(pct, { ofHundred: true, digits: 0 })}
              </StatusPill>
            ) : (
              <span className="text-small text-secondary tabular-nums">{formatPercent(pct, { ofHundred: true, digits: 0 })}</span>
            )}
          </span>
        );
      },
      meta: { numeric: true, csv: (r) => (r.capMinor === null ? "" : (r.capMinor / 100).toFixed(2)) },
    },
    { id: "capPct", accessorFn: (r) => r.capUsedPct ?? 0, header: "Cap used", size: sizes.capPct, cell: ({ getValue }) => <span className="tabular-nums">{formatPercent(getValue() as number, { ofHundred: true, digits: 0 })}</span>, meta: { numeric: true } },
    { id: "tasks", accessorKey: "tasksDone", header: "Tasks done", size: sizes.tasks, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>, meta: { numeric: true } },
    { id: "output", accessorFn: (r) => r.outputPerHundred ?? 0, header: perHundredLabel(currency), size: sizes.output, cell: ({ row }) => (row.original.outputPerHundred === null ? <span className="text-secondary">—</span> : <span className="tabular-nums">{formatNumber(row.original.outputPerHundred, { maxDigits: 2 })}</span>), meta: { numeric: true, label: perHundredLabel(currency) } },
  ];
}

export function WageBillScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const periods = useMemo(() => [monthKey(now), ...trailingMonths(now, 6).reverse()], [now]);
  const [period, setPeriod] = useState(periods[0]!);
  const wages = useWidgetQuery<WagesResponse>("finance.wages", { period });
  const agents = useWidgetQuery<TeamAgentRow[] | { agents: TeamAgentRow[] }>("team.agents.list", { includeArchived: true });
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { status: "done", limit: 500 });
  const humans = useWidgetQuery<MembershipRow[]>("team.humans.list", {});
  const range = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    const from = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
    return { from: from.toISOString(), to: monthStart(from, 1).toISOString() };
  }, [period]);
  const pnl = useWidgetQuery<PnlResponse>("finance.pnl", range);
  const [views, setViews] = useState<SavedView[]>(WAGE_VIEWS);

  const rows = useMemo(() => wageBillRows(wages.data?.rows ?? [], readAgents(agents.data), tasks.data?.items ?? [], period), [wages.data, agents.data, tasks.data, period]);
  const fitted = useFittedColumns(WAGE_FIT, views, "all");
  const columns = useMemo(() => wageColumns(businessId, currency, fitted.sizes), [businessId, currency, fitted.sizes]);
  const squadMinor = rows.reduce((n, r) => n + r.costMinor, 0);
  const tasksDone = rows.reduce((n, r) => n + r.tasksDone, 0);
  const payrollMinor = useMemo(() => {
    const cats = pnl.data?.categories ?? [];
    return cats.filter((c) => sectionOf(c.category) === "opex" && /payroll|salar|wage|contractor|staff/i.test(c.category ?? "")).reduce((n, c) => n + c.outflowMinor - c.inflowMinor, 0);
  }, [pnl.data]);
  const staff = humans.data ?? [];
  const overCap = rows.filter((r) => (r.capUsedPct ?? 0) >= CAP_WARN_PCT);

  const tiles: MetricTileProps[] = [
    { label: "Team wage bill", value: { amountMinor: squadMinor, currency }, estimate: "estimate", provenance: { source: "Usage ledger: tokens, sandbox minutes, tool calls, training", query: "finance.wages", note: "Metered at list prices; the Anthropic invoice is the only real cost." }, caption: `${rows.filter((r) => r.costMinor > 0).length} agents with usage in ${formatMonth(period)}` },
    { label: "Human payroll", value: { amountMinor: payrollMinor, currency }, estimate: "estimate", provenance: { source: pnl.data?.label ?? "Management P&L, unaudited, cash basis", query: "finance.pnl categories Payroll, Contractors", note: "Bank outflows categorised as payroll or contractors in the month." }, caption: `${staff.length} staff member${staff.length === 1 ? "" : "s"}` },
    { label: "Total wage bill", value: { amountMinor: squadMinor + payrollMinor, currency }, estimate: "estimate", provenance: { source: "Team wage bill + human payroll", note: "Team and staff together for the month." }, caption: formatMonth(period) },
    { label: perHundredLabel(currency), value: outputPerHundred(tasksDone, squadMinor) ?? "—", format: "decimal", estimate: outputPerHundred(tasksDone, squadMinor) === null ? undefined : "estimate", provenance: { source: "Tasks completed ÷ team wage bill", query: "dev.tasks.list status=done", note: `Tasks marked done in the month for every ${perHundredLabel(currency).replace("Tasks per ", "")} of team cost.` }, caption: `${tasksDone} task${tasksDone === 1 ? "" : "s"} done` },
  ];

  const rowActions = (): RowAction<WageBillRow>[] => [
    { id: "profile", label: "Open agent profile", icon: Bot, onSelect: (r) => navigate(routes.agent(businessId, r.agentId)) },
    { id: "wage", label: "Adjust wage cap", icon: GraduationCap, onSelect: (r) => navigate(routes.agent(businessId, r.agentId, "settings")) },
  ];

  const loading = wages.isLoading || agents.isLoading;
  const error = wages.error ?? agents.error;

  return (
    <Screen name="finance/wage-bill">
      <section aria-label="Wage bill summary" className="col-span-12" aria-busy={loading || undefined}>
        <StatusStrip tiles={tiles.map((t) => ({ ...t, loading }))} />
      </section>
      <Panel
        title="Team"
        span={8}
        flush
        loading={loading}
        error={error ? error.message : undefined}
        onRetry={() => {
          wages.refetch();
          agents.refetch();
        }}
        empty={wages.data && agents.data && rows.length === 0 ? { icon: Users, title: "No agents hired yet", children: "Hire agents from Team › Recruitment and their monthly cost appears here against each wage cap.", action: { label: "Open recruitment", icon: Users, onClick: () => navigate(routes.department(businessId, "team", "recruitment")) } } : undefined}
        actions={
          <div className="flex items-center gap-2">
            {overCap.length ? (
              <StatusPill tone={overCap.some((r) => (r.capUsedPct ?? 0) >= 100) ? "bad" : "warn"} icon={AlertTriangle} className="whitespace-nowrap">
                {overCap.length} near or over cap
              </StatusPill>
            ) : null}
            <SimpleSelect aria-label="Period" controlSize="sm" value={period} onValueChange={setPeriod} options={periods.map((p) => ({ value: p, label: formatMonth(p) }))} />
          </div>
        }
        footer={<span className="tabular-nums">{rows.length} agents · {fmtMoney(squadMinor, currency)} in {formatMonth(period)} · Estimate: metered usage at list prices</span>}
      >
        <div ref={fitted.ref} className="min-w-0">
          <DataTable<WageBillRow> aria-label="Team wage bill" data={rows} columns={columns} getRowId={(r) => r.agentId} views={views} onViewsChange={setViews} defaultViewId="all" onActiveViewChange={fitted.onActiveViewChange} height={480} exportFileName={`wage-bill-${period}`} rowActions={rowActions} onRowOpen={(r) => navigate(routes.agent(businessId, r.agentId))} />
        </div>
      </Panel>
      <Panel title="Staff" span={4} loading={humans.isLoading || pnl.isLoading} error={humans.error ? humans.error.message : undefined} onRetry={humans.refetch} empty={humans.data && staff.length === 0 ? { icon: UserRound, children: "Invite staff from Team › Staff; their payroll shows here from bank transactions." } : undefined} footer={<span>Payroll is the month's bank outflows categorised Payroll or Contractors.</span>}>
        <MiniTable<MembershipRow>
          aria-label="Staff"
          rows={staff}
          getRowKey={(m) => m.id}
          maxRows={12}
          columns={[
            { id: "who", header: "Member", cell: (m) => <EntityLink entity={{ id: m.userId, kind: "team_member", name: m.displayName ?? m.email ?? "Team member" }} hoverCard={false} /> },
            { id: "role", header: "Role", width: 84, cell: (m) => <Chip tone="neutral">{memberRoleWord(m.role)}</Chip> },
            { id: "since", header: "Since", width: 80, cell: (m) => <span className="tabular-nums">{m.createdAt ? formatDate(m.createdAt, "MMM yyyy") : "—"}</span> },
          ]}
          caption={<span className="tabular-nums">Payroll {fmtMoney(payrollMinor, currency)} · Estimate</span>}
        />
      </Panel>
    </Screen>
  );
}
