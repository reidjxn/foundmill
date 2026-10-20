"use client";
/**
 * Finance › Payroll (BUILD §11.8): per-agent monthly cost (tokens, sandbox minutes, tool calls, training) against
 * each agent's wage cap, the human payroll line from categorised bank transactions, and output per 100 units of team
 * cost. Every figure is an Estimate: the founder's Anthropic invoice is the only real cost. The team's cost is metered
 * in US dollars and is never added to staff payroll or compared with a cap in another currency (nothing is converted).
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Bot, GraduationCap, UserRound, Users } from "lucide-react";
import { AgentStatusPill, Chip, DataTable, DeptChip, EntityLink, MiniTable, Panel, StatusPill, StatusStrip, SimpleSelect, currencySymbol, formatCompact, formatNumber, formatPercent, useFormatters, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import { moduleTabHref, moduleTabLabel, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { failedWithoutData, unavailableWords } from "@foundmill/widgets/shared/errors";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleScreenProps } from "../registry";
import { capUsedPct, formatMonth, monthKey, monthStart, outputPerHundred, pnlLabelWords, sectionOf, trailingMonths } from "./metrics";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { Screen, fmtMoney, toDate, useCurrency, useNow } from "./shared";
import type { MembershipRow, PnlResponse, TaskRow, TasksListResponse, TeamAgentRow, WageRow, WagesResponse } from "./types";

export const CAP_WARN_PCT = 80;

/**
 * A staff member by the name the business knows them as. The link goes to their CRM record; without one the name is
 * plain text (an auth account id is not a CRM record, so it is never linked).
 */
export function StaffName({ member, businessId }: { member: MembershipRow; businessId: string }) {
  const name = member.displayName?.trim() || member.email?.trim() || `${memberRoleWord(member.role)} on the team`;
  if (!member.entityId) return <span className="truncate text-body-strong text-primary">{name}</span>;
  return <EntityLink entity={{ id: member.entityId, kind: "team_member", name, href: routes.crm(businessId, member.entityId) }} hoverCard={false} />;
}

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
export function wageBillRows(wages: readonly WageRow[], agents: readonly TeamAgentRow[], tasks: readonly TaskRow[], period: string, currencies: { cost: string; cap: string } | null = null): WageBillRow[] {
  // Costs are metered in US dollars and wage caps are US dollars too; a share is shown only when the two currencies match
  // (an answer that labels them differently is never compared, nothing is converted).
  const comparable = currencies === null || currencies.cost === currencies.cap;
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
    .map((r) => ({ ...r, capUsedPct: comparable ? capUsedPct(r.costMinor, r.capMinor) : null, outputPerHundred: outputPerHundred(r.tasksDone, r.costMinor) }))
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

/**
 * The team's cost tile: the figure is metered in US dollars (tokens, sandbox minutes, tool calls, training), so where
 * it is, the tile says so instead of "payroll" in another currency (UX plan §7.14, C21). Any other currency keeps
 * "Team payroll".
 */
export function teamCostLabel(currency: string): string {
  return currency.toUpperCase() === "USD" ? "AI usage cost (USD)" : "Team payroll";
}

/** "Tasks per £100": output per 100 units of the business's own currency. */
export function perHundredLabel(currency: string): string {
  const symbol = currencySymbol(currency);
  return symbol ? `Tasks per ${symbol}100` : `Tasks per 100 ${currency}`;
}

/** `currency` is the costs' (US dollars, metered); `capCurrency` the wage caps' (US dollars too; finance.wages `wageCapCurrency`). */
export function wageColumns(businessId: string, currency: string, sizes: Record<WageColumnId, number> = fitColumns<WageColumnId>(null, WAGE_FIT, []), capCurrency: string = currency): DataTableColumn<WageBillRow>[] {
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
        // No share when the cap and the cost are in different currencies (nothing is converted).
        if (r.capUsedPct === null) return <span className="tabular-nums">{fmtMoney(r.capMinor, capCurrency)}</span>;
        const pct = r.capUsedPct;
        return (
          <span className="flex items-center justify-end gap-1.5">
            <span className="tabular-nums">{fmtMoney(r.capMinor, capCurrency)}</span>
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
  const { prefs: datePrefs, formatMonthYear } = useFormatters();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const departments = useDepartments();
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
  // Saved per person, business and table (audit #204): they come back after a reload.
  const savedViews = useSavedViews("finance.payroll", WAGE_VIEWS, { defaultViewId: "all" });

  // The team's cost is metered in US dollars (finance.wages `currency`) and wage caps cap that cost (`wageCapCurrency`,
  // US dollars too); staff payroll is in the business's currency.
  const teamCurrency = wages.data?.currency ?? currency;
  const capCurrency = wages.data?.rows.find((r) => r.wageCapCurrency)?.wageCapCurrency ?? teamCurrency;
  const rows = useMemo(() => wageBillRows(wages.data?.rows ?? [], readAgents(agents.data), tasks.data?.items ?? [], period, { cost: teamCurrency, cap: capCurrency }), [wages.data, agents.data, tasks.data, period, teamCurrency, capCurrency]);
  const columns = useMemo(() => fitToGrow(wageColumns(businessId, teamCurrency, undefined, capCurrency), WAGE_FIT), [businessId, teamCurrency, capCurrency]);
  const squadMinor = rows.reduce((n, r) => n + r.costMinor, 0);
  const tasksDone = rows.reduce((n, r) => n + r.tasksDone, 0);
  const payrollMinor = useMemo(() => {
    const cats = pnl.data?.categories ?? [];
    return cats.filter((c) => sectionOf(c.category) === "opex" && /payroll|salar|wage|contractor|staff/i.test(c.category ?? "")).reduce((n, c) => n + c.outflowMinor - c.inflowMinor, 0);
  }, [pnl.data]);
  const staff = humans.data ?? [];
  const overCap = rows.filter((r) => (r.capUsedPct ?? 0) >= CAP_WARN_PCT);
  // A refused or failed query is unknown, not zero: those tiles say "No access" (a member walled from Finance) or
  // "Couldn't load", never a made-up €0.00 labeled Estimate.
  const wagesFailed = failedWithoutData(wages);
  const pnlFailed = failedWithoutData(pnl);
  const unavailable = (label: string, error: Error | null): MetricTileProps => ({ label, ...unavailableWords(error, "Finance") });
  const teamLabel = teamCostLabel(teamCurrency);

  const known: MetricTileProps[] = [
    { label: teamLabel, value: { amountMinor: squadMinor, currency: teamCurrency }, estimate: "estimate", provenance: { source: "Usage ledger: tokens, sandbox minutes, tool calls, training", query: "finance.wages", note: "Metered at list prices; the Anthropic invoice is the only real cost." }, caption: `${rows.filter((r) => r.costMinor > 0).length} agents with usage in ${formatMonth(period, datePrefs)}` },
    { label: "Human payroll", value: { amountMinor: payrollMinor, currency }, estimate: "estimate", provenance: { source: pnlLabelWords(pnl.data?.label), query: "finance.pnl categories Payroll, Contractors", note: "Bank outflows categorized as payroll or contractors in the month." }, caption: `${staff.length} staff member${staff.length === 1 ? "" : "s"}` },
    teamCurrency === currency
      ? { label: "Total payroll", value: { amountMinor: squadMinor + payrollMinor, currency }, estimate: "estimate", provenance: { source: `${teamLabel} + human payroll`, note: "Team and staff together for the month." }, caption: formatMonth(period, datePrefs) }
      : // Never added across currencies (nothing is converted): both parts, each in its own currency.
        { label: "Total payroll", value: `${fmtMoney(squadMinor, teamCurrency, { compact: true })} + ${fmtMoney(payrollMinor, currency, { compact: true })}`, estimate: "estimate", provenance: { source: `${teamLabel} + human payroll`, note: "Kept apart: the team's AI usage is metered in US dollars, staff are paid in the business's currency." }, caption: formatMonth(period, datePrefs) },
    { label: perHundredLabel(teamCurrency), value: outputPerHundred(tasksDone, squadMinor) ?? "—", format: "decimal", estimate: outputPerHundred(tasksDone, squadMinor) === null ? undefined : "estimate", provenance: { source: `Tasks completed ÷ ${teamLabel.toLowerCase()}`, query: "dev.tasks.list status=done", note: `Tasks marked done in the month for every ${perHundredLabel(teamCurrency).replace("Tasks per ", "")} of team cost.` }, caption: `${tasksDone} task${tasksDone === 1 ? "" : "s"} done` },
  ];
  const tiles: MetricTileProps[] = [
    wagesFailed ? unavailable(teamLabel, wages.error) : known[0]!,
    pnlFailed ? unavailable("Human payroll", pnl.error) : known[1]!,
    wagesFailed || pnlFailed ? unavailable("Total payroll", wages.error ?? pnl.error) : known[2]!,
    wagesFailed ? unavailable(perHundredLabel(teamCurrency), wages.error) : known[3]!,
  ];

  const rowActions = (): RowAction<WageBillRow>[] => [
    { id: "profile", label: "Open agent profile", icon: Bot, onSelect: (r) => navigate(routes.agent(businessId, r.agentId)) },
    { id: "wage", label: "Adjust wage cap", icon: GraduationCap, onSelect: (r) => navigate(routes.agent(businessId, r.agentId, "settings")) },
  ];

  const loading = wages.isLoading || agents.isLoading;
  const error = wages.error ?? agents.error;
  // The Team module's screens by the department that owns it, as the founder named it (never a hard-coded "Team").
  const recruitment = { label: moduleTabLabel(departments.data, "team", "recruitment") ?? "the Recruitment tab", href: moduleTabHref(businessId, departments.data, "team", "recruitment") };
  const staffTab = moduleTabLabel(departments.data, "team", "staff") ?? "the Staff tab";

  return (
    <Screen name="finance/wage-bill">
      <section aria-label="Payroll summary" className="col-span-12" aria-busy={loading || undefined}>
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
        empty={wages.data && agents.data && rows.length === 0 ? { icon: Users, title: "No agents hired yet", children: `Hire agents from ${recruitment.label} and their monthly cost appears here against each wage cap.`, action: { label: "Open recruitment", icon: Users, onClick: () => navigate(recruitment.href) } } : undefined}
        actions={
          <div className="flex items-center gap-2">
            {overCap.length ? (
              <StatusPill tone={overCap.some((r) => (r.capUsedPct ?? 0) >= 100) ? "bad" : "warn"} icon={AlertTriangle} className="whitespace-nowrap">
                {overCap.length} near or over cap
              </StatusPill>
            ) : null}
            <SimpleSelect aria-label="Period" controlSize="sm" value={period} onValueChange={setPeriod} options={periods.map((p) => ({ value: p, label: formatMonth(p, datePrefs) }))} />
          </div>
        }
        footer={wages.data ? <span className="tabular-nums">{rows.length} agents · {fmtMoney(squadMinor, teamCurrency)} in {formatMonth(period, datePrefs)} · Estimate: {teamCurrency.toUpperCase() === "USD" ? "AI usage metered in US dollars at list prices" : "metered usage at list prices"}</span> : undefined}
      >
        <div className="min-w-0">
          <DataTable<WageBillRow> aria-label="Team payroll" data={rows} columns={columns} getRowId={(r) => r.agentId} {...savedViews} defaultViewId="all" height={480} exportFileName={`wage-bill-${period}`} rowActions={rowActions} onRowOpen={(r) => navigate(routes.agent(businessId, r.agentId))} />
        </div>
      </Panel>
      <Panel title="Staff" span={4} loading={humans.isLoading || pnl.isLoading} error={humans.error ? humans.error.message : undefined} onRetry={humans.refetch} empty={humans.data && staff.length === 0 ? { icon: UserRound, children: `Invite staff from ${staffTab}; their payroll shows here from bank transactions.` } : undefined} footer={<span>Payroll is the month's bank outflows categorized Payroll or Contractors.</span>}>
        <MiniTable<MembershipRow>
          aria-label="Staff"
          rows={staff}
          getRowKey={(m) => m.id}
          maxRows={12}
          columns={[
            { id: "who", header: "Member", cell: (m) => <StaffName member={m} businessId={businessId} /> },
            { id: "role", header: "Role", width: 84, cell: (m) => <Chip tone="neutral">{memberRoleWord(m.role)}</Chip> },
            { id: "since", header: "Since", width: 80, cell: (m) => <span className="tabular-nums">{m.createdAt ? formatMonthYear(m.createdAt) : "—"}</span> },
          ]}
          caption={pnlFailed ? <span>Payroll: {unavailableWords(pnl.error, "Finance").caption}</span> : <span className="tabular-nums">Payroll {fmtMoney(payrollMinor, currency)} · Estimate</span>}
        />
      </Panel>
    </Screen>
  );
}
