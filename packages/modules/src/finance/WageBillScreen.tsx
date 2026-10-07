"use client";
/**
 * Finance › Wage bill (BUILD §11.8): per-agent monthly cost (tokens, sandbox minutes, tool calls, training) against
 * each agent's wage cap, the human payroll line from categorised bank transactions, and output per euro (tasks
 * completed per 100 units of cost). Every figure is an Estimate: the founder's Anthropic invoice is the only real cost.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Bot, GraduationCap, UserRound, Users } from "lucide-react";
import { AgentStatusPill, Chip, DataTable, DeptChip, EntityLink, MiniTable, Panel, StatusPill, StatusStrip, SimpleSelect, formatCompact, formatDate, formatNumber, formatPercent, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { capUsedPct, formatMonth, monthKey, monthStart, outputPerHundred, sectionOf, trailingMonths } from "./metrics";
import { Screen, fmtMoney, useCurrency, useNow } from "./shared";
import type { MembershipRow, PnlResponse, TaskRow, TasksListResponse, TeamAgentRow, WageRow, WagesResponse } from "./types";

export const CAP_WARN_PCT = 80;

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
    const ended = t.endedAt ?? t.updatedAt ?? null;
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

export const WAGE_VIEWS: SavedView[] = [
  { id: "all", name: "All agents", builtIn: true, columns: ["name", "role", "department", "model", "status", "tokens", "sandbox", "tools", "training", "cost", "cap", "tasks", "output"], sort: [{ id: "cost", desc: true }], filters: [] },
  { id: "near-cap", name: "Near wage cap", builtIn: true, columns: ["name", "role", "cost", "cap", "capPct", "tasks"], sort: [{ id: "capPct", desc: true }], filters: [{ id: "f-cap", field: "capPct", op: "gte", value: CAP_WARN_PCT }] },
  { id: "idle", name: "Cost without output", builtIn: true, columns: ["name", "role", "department", "cost", "tasks", "output"], sort: [{ id: "cost", desc: true }], filters: [{ id: "f-idle-tasks", field: "tasks", op: "eq", value: 0 }, { id: "f-idle-cost", field: "cost", op: "gt", value: 0 }] },
];

export function wageColumns(businessId: string, currency: string): DataTableColumn<WageBillRow>[] {
  return [
    { id: "name", accessorKey: "name", header: "Agent", size: 200, cell: ({ row }) => <EntityLink entity={{ id: row.original.agentId, kind: "agent", name: row.original.name, href: routes.agent(businessId, row.original.agentId) }} />, meta: { locked: true } },
    { id: "role", accessorKey: "role", header: "Role", size: 160, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    { id: "department", accessorFn: (r) => r.department?.name ?? "", header: "Department", size: 140, cell: ({ row }) => (row.original.department ? <DeptChip dept={row.original.department.colourToken}>{row.original.department.name}</DeptChip> : <span className="text-secondary">—</span>), meta: { filter: "text" } },
    { id: "model", accessorKey: "modelKey", header: "Model", size: 90, cell: ({ getValue }) => (getValue() ? <Chip tone="neutral" mono>{String(getValue())}</Chip> : null), meta: { filter: "select", filterOptions: ["opus", "sonnet", "haiku"].map((m) => ({ value: m, label: m })) } },
    { id: "status", accessorFn: (r) => r.status ?? "", header: "Status", size: 110, cell: ({ row }) => (row.original.status ? <AgentStatusPill status={row.original.status} /> : <span className="text-secondary">Released</span>) },
    { id: "tokens", accessorKey: "tokens", header: "Tokens", size: 90, cell: ({ getValue }) => <span className="tabular-nums">{formatCompact(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "sandbox", accessorKey: "sandboxMinutes", header: "Sandbox min", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(getValue() as number, { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "tools", accessorKey: "toolCalls", header: "Tool calls", size: 90, cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(getValue() as number, { digits: 0 })}</span>, meta: { numeric: true } },
    { id: "training", accessorKey: "trainingMinor", header: "Training", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{fmtMoney(getValue() as number, currency)}</span>, meta: { numeric: true, csv: (r) => (r.trainingMinor / 100).toFixed(2) } },
    { id: "cost", accessorKey: "costMinor", header: "Cost", size: 110, cell: ({ getValue }) => <span className="text-body-strong text-primary tabular-nums">{fmtMoney(getValue() as number, currency)}</span>, meta: { numeric: true, csv: (r) => (r.costMinor / 100).toFixed(2) } },
    {
      id: "cap",
      accessorFn: (r) => r.capMinor ?? 0,
      header: "Wage cap",
      size: 150,
      cell: ({ row }) => {
        const r = row.original;
        if (r.capMinor === null) return <span className="text-secondary">Uncapped</span>;
        const pct = r.capUsedPct ?? 0;
        return (
          <span className="flex items-center justify-end gap-1.5">
            <span className="tabular-nums">{fmtMoney(r.capMinor, currency)}</span>
            {pct >= 100 ? (
              <StatusPill tone="bad" icon={AlertTriangle}>
                Over cap
              </StatusPill>
            ) : pct >= CAP_WARN_PCT ? (
              <StatusPill tone="warn" icon={AlertTriangle}>
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
    { id: "capPct", accessorFn: (r) => r.capUsedPct ?? 0, header: "Cap used %", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{formatPercent(getValue() as number, { ofHundred: true, digits: 0 })}</span>, meta: { numeric: true } },
    { id: "tasks", accessorKey: "tasksDone", header: "Tasks done", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>, meta: { numeric: true } },
    { id: "output", accessorFn: (r) => r.outputPerHundred ?? 0, header: `Tasks per 100 ${currency}`, size: 130, cell: ({ row }) => (row.original.outputPerHundred === null ? <span className="text-secondary">—</span> : <span className="tabular-nums">{formatNumber(row.original.outputPerHundred, { maxDigits: 2 })}</span>), meta: { numeric: true, label: "Output per 100" } },
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
  const columns = useMemo(() => wageColumns(businessId, currency), [businessId, currency]);
  const squadMinor = rows.reduce((n, r) => n + r.costMinor, 0);
  const tasksDone = rows.reduce((n, r) => n + r.tasksDone, 0);
  const payrollMinor = useMemo(() => {
    const cats = pnl.data?.categories ?? [];
    return cats.filter((c) => sectionOf(c.category) === "opex" && /payroll|salar|wage|contractor|staff/i.test(c.category ?? "")).reduce((n, c) => n + c.outflowMinor - c.inflowMinor, 0);
  }, [pnl.data]);
  const staff = humans.data ?? [];
  const overCap = rows.filter((r) => (r.capUsedPct ?? 0) >= CAP_WARN_PCT);

  const tiles: MetricTileProps[] = [
    { label: "Squad wage bill", value: { amountMinor: squadMinor, currency }, estimate: "estimate", provenance: { source: "Usage ledger: tokens, sandbox minutes, tool calls, training", query: "finance.wages", note: "Metered at list prices; the Anthropic invoice is the only real cost." }, caption: `${rows.filter((r) => r.costMinor > 0).length} agents with usage in ${formatMonth(period)}` },
    { label: "Human payroll", value: { amountMinor: payrollMinor, currency }, estimate: "estimate", provenance: { source: pnl.data?.label ?? "Management P&L, unaudited, cash basis", query: "finance.pnl categories Payroll, Contractors", note: "Bank outflows categorised as payroll or contractors in the month." }, caption: `${staff.length} staff member${staff.length === 1 ? "" : "s"}` },
    { label: "Total wage bill", value: { amountMinor: squadMinor + payrollMinor, currency }, estimate: "estimate", provenance: { source: "Squad wage bill + human payroll", note: "Squad and staff together for the month." }, caption: formatMonth(period) },
    { label: `Tasks per 100 ${currency}`, value: outputPerHundred(tasksDone, squadMinor) ?? "—", format: "decimal", estimate: "estimate", provenance: { source: "Tasks completed ÷ squad wage bill", query: "dev.tasks.list status=done", note: "Output per euro: tasks marked done in the month per 100 units of squad cost." }, caption: `${tasksDone} tasks done` },
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
        title="Squad"
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
              <StatusPill tone={overCap.some((r) => (r.capUsedPct ?? 0) >= 100) ? "bad" : "warn"} icon={AlertTriangle}>
                {overCap.length} near or over cap
              </StatusPill>
            ) : null}
            <SimpleSelect aria-label="Period" controlSize="sm" value={period} onValueChange={setPeriod} options={periods.map((p) => ({ value: p, label: formatMonth(p) }))} />
          </div>
        }
        footer={<span className="tabular-nums">{rows.length} agents · {fmtMoney(squadMinor, currency)} in {formatMonth(period)} · Estimate: metered usage at list prices</span>}
      >
        <DataTable<WageBillRow> aria-label="Squad wage bill" data={rows} columns={columns} getRowId={(r) => r.agentId} views={views} onViewsChange={setViews} defaultViewId="all" height={480} exportFileName={`wage-bill-${period}`} rowActions={rowActions} onRowOpen={(r) => navigate(routes.agent(businessId, r.agentId))} />
      </Panel>
      <Panel title="Staff" span={4} loading={humans.isLoading || pnl.isLoading} error={humans.error ? humans.error.message : undefined} onRetry={humans.refetch} empty={humans.data && staff.length === 0 ? { icon: UserRound, children: "Invite staff from Team › Staff; their payroll shows here from bank transactions." } : undefined} footer={<span>Payroll is the month's bank outflows categorised Payroll or Contractors.</span>}>
        <MiniTable<MembershipRow>
          aria-label="Staff"
          rows={staff}
          getRowKey={(m) => m.id}
          maxRows={12}
          columns={[
            { id: "who", header: "Member", cell: (m) => <EntityLink entity={{ id: m.userId, kind: "team_member", name: m.displayName ?? m.email ?? `Member ${m.userId.slice(0, 8)}` }} hoverCard={false} /> },
            { id: "role", header: "Role", width: 72, cell: (m) => <Chip tone="neutral">{m.role}</Chip> },
            { id: "since", header: "Since", width: 80, cell: (m) => <span className="tabular-nums">{m.createdAt ? formatDate(m.createdAt, "MMM yyyy") : "—"}</span> },
          ]}
          caption={<span className="tabular-nums">Payroll {fmtMoney(payrollMinor, currency)} · Estimate</span>}
        />
      </Panel>
    </Screen>
  );
}
