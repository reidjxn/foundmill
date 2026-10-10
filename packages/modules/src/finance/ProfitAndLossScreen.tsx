"use client";
/**
 * Finance › Profit and loss (BUILD §11.8, DESIGN §9): the management P&L as a DataTable with indented category lines,
 * subtotal rules and totals over a selectable period, labelled "Management P&L, unaudited, cash basis" when the
 * numbers come from categorised bank transactions (a connected ledger wins and is labelled as such). Selecting a line
 * lists its transactions; recategorising one through `finance.transactions.recategorise` can create a rule.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Landmark, Receipt, Tag, X } from "lucide-react";
import { Button, DataTable, EntityLink, MiniTable, Panel, SegmentedControl, StatusPill, cn, formatDate, formatPercent, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { PNL_SECTION_LABELS, buildPnl, categoryLabel, formatMonth, isUncategorised, ledgerPnlRows, monthStart, pnlTotals, type PnlRow } from "./metrics";
import { RecategoriseDialog } from "./RecategoriseDialog";
import { fitColumns, type ColumnFit } from "../fit";
import { Screen, fitTableHeight, fmtMoney, fmtSigned, useCurrency, useFittedColumns, useNow } from "./shared";
import type { PnlResponse, TransactionRow, TransactionsListResponse } from "./types";

export const PNL_PERIODS = [
  { value: "this-month", label: "This month", short: "This month", months: 0 },
  { value: "3m", label: "Last 3 months", short: "3 months", months: 3 },
  { value: "6m", label: "Last 6 months", short: "6 months", months: 6 },
  { value: "12m", label: "Last 12 months", short: "12 months", months: 12 },
] as const;
export type PnlPeriod = (typeof PNL_PERIODS)[number]["value"];

/** ISO range for a period key: full months before this month, or this month to date. */
export function periodRange(period: PnlPeriod, now: Date): { from: string; to: string; label: string } {
  const p = PNL_PERIODS.find((x) => x.value === period) ?? PNL_PERIODS[1];
  if (p.months === 0) return { from: monthStart(now, 0).toISOString(), to: monthStart(now, 1).toISOString(), label: `${formatMonth(now.toISOString().slice(0, 7))} to date` };
  const from = monthStart(now, -p.months);
  const to = monthStart(now, 0);
  return { from: from.toISOString(), to: to.toISOString(), label: `${formatMonth(from.toISOString().slice(0, 7))} – ${formatMonth(monthStart(now, -1).toISOString().slice(0, 7))}` };
}

export const PNL_VIEWS: SavedView[] = [
  { id: "all", name: "Management P&L", builtIn: true, columns: ["label", "amount", "pct", "count"], sort: [], filters: [] },
  { id: "operating", name: "Operating only", builtIn: true, columns: ["label", "amount", "pct", "count"], sort: [], filters: [{ id: "f-op", field: "section", op: "in", value: ["revenue", "cogs", "opex", "gross", "operating"] }] },
  { id: "uncategorised", name: "Needs categorising", builtIn: true, columns: ["label", "amount", "count"], sort: [], filters: [{ id: "f-unc", field: "section", op: "eq", value: "uncategorised" }] },
];

/** The number columns keep their width; the line column takes the rest, so the figures sit together at the right. */
export const PNL_FIT = {
  label: { min: 240, grow: 1 },
  amount: { min: 140 },
  pct: { min: 120 },
  count: { min: 120 },
  section: { min: 160 },
} satisfies Record<string, ColumnFit>;
export type PnlColumnId = keyof typeof PNL_FIT;

/** Section keys as the chart of accounts names them (the filter and the CSV never show "cogs" or "opex"). */
const SECTION_WORDS: Record<string, string> = { ...PNL_SECTION_LABELS, uncategorised: "Uncategorised", gross: "Gross profit", operating: "Operating result", net: "Net cash change" };

export function pnlColumns(currency: string, sizes: Record<PnlColumnId, number> = fitColumns<PnlColumnId>(null, PNL_FIT, [])): DataTableColumn<PnlRow>[] {
  return [
    {
      id: "label",
      accessorKey: "label",
      header: "Line",
      size: sizes.label,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className={cn("flex min-w-0 items-center gap-1.5", r.depth === 1 && "pl-4", r.kind === "header" && "t-label", (r.kind === "subtotal" || r.kind === "total") && "text-body-strong text-primary")}>
            <span className="truncate">{r.label}</span>
            {r.warn ? <AlertTriangle size={12} className="shrink-0 text-status-warn" aria-label="Needs categorising" /> : null}
          </span>
        );
      },
      meta: { locked: true, filter: false },
    },
    {
      id: "amount",
      accessorFn: (r) => r.amountMinor,
      header: "Amount",
      size: sizes.amount,
      enableSorting: false,
      cell: ({ row }) => (row.original.amountMinor === null ? "" : <span className={cn("tabular-nums", (row.original.kind === "subtotal" || row.original.kind === "total") && "text-body-strong text-primary")}>{fmtSigned(row.original.amountMinor, currency)}</span>),
      meta: { numeric: true, filter: false, csv: (r) => (r.amountMinor === null ? "" : (r.amountMinor / 100).toFixed(2)) },
    },
    {
      id: "pct",
      accessorFn: (r) => r.pctOfRevenue,
      header: "% of revenue",
      size: sizes.pct,
      enableSorting: false,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v === null ? <span className="text-secondary">—</span> : <span className="tabular-nums">{formatPercent(v, { ofHundred: true, digits: 1 })}</span>;
      },
      meta: { numeric: true, filter: false },
    },
    {
      id: "count",
      accessorFn: (r) => r.count,
      header: "Transactions",
      size: sizes.count,
      enableSorting: false,
      cell: ({ row }) => (row.original.kind === "total" && row.original.id !== "t-net" ? "" : <span className="tabular-nums">{row.original.count}</span>),
      meta: { numeric: true, filter: false },
    },
    {
      id: "section",
      accessorFn: (r) => (r.id === "t-gross" ? "gross" : r.id === "t-operating" ? "operating" : (r.section ?? "net")),
      header: "Section",
      size: sizes.section,
      enableSorting: false,
      cell: ({ getValue }) => SECTION_WORDS[String(getValue() ?? "")] ?? "",
      meta: { filter: "select", filterOptions: (["revenue", "cogs", "opex", "financing", "tax", "other", "uncategorised"] as const).map((s) => ({ value: s, label: SECTION_WORDS[s] ?? s })), csv: (r) => SECTION_WORDS[r.id === "t-gross" ? "gross" : r.id === "t-operating" ? "operating" : (r.section ?? "net")] ?? "" },
    },
  ];
}

export function pnlRowClass(row: PnlRow): string | undefined {
  if (row.kind === "subtotal") return "border-t border-secondary";
  if (row.kind === "total") return "border-t border-secondary bg-panel-alt";
  if (row.kind === "header") return "bg-white/2";
  return undefined;
}

export function matchesLine(tx: Pick<TransactionRow, "category">, line: Pick<PnlRow, "section" | "category">): boolean {
  if (line.section === "uncategorised") return isUncategorised(tx.category);
  if (!line.category || isUncategorised(tx.category)) return false;
  return categoryLabel(tx.category) === categoryLabel(line.category);
}

export function ProfitAndLossScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const [period, setPeriod] = useState<PnlPeriod>("3m");
  const range = useMemo(() => periodRange(period, now), [period, now]);
  const pnl = useWidgetQuery<PnlResponse>("finance.pnl", { from: range.from, to: range.to });
  const [views, setViews] = useState<SavedView[]>(PNL_VIEWS);
  const [selected, setSelected] = useState<PnlRow | null>(null);
  const [recat, setRecat] = useState<TransactionRow | null>(null);
  const transactions = useWidgetQuery<TransactionsListResponse>("finance.transactions.list", { from: range.from, to: range.to, limit: 500 }, { enabled: !!selected });

  const ledger = pnl.data?.source === "ledger" ? (pnl.data.snapshots.find((s) => s.basis !== "cash") ?? null) : null;
  const rows = useMemo<PnlRow[]>(() => {
    if (!pnl.data) return [];
    if (ledger) return ledgerPnlRows(ledger.pnl);
    return buildPnl(pnl.data.categories);
  }, [pnl.data, ledger]);
  const totals = useMemo(() => (pnl.data && !ledger ? pnlTotals(pnl.data.categories) : null), [pnl.data, ledger]);
  const fitted = useFittedColumns(PNL_FIT, views, "all");
  const columns = useMemo(() => pnlColumns(pnl.data?.snapshots[0]?.currency ?? currency, fitted.sizes), [currency, pnl.data?.snapshots, fitted.sizes]);
  const lineTransactions = useMemo(() => (selected ? (transactions.data?.items ?? []).filter((t) => matchesLine(t, selected)) : []), [selected, transactions.data]);
  const empty = pnl.data && pnl.data.categories.length === 0 && !ledger;

  const rowActions = (row: PnlRow): RowAction<PnlRow>[] => {
    const isLine = row.kind === "line";
    return [
      { id: "show", label: "Show transactions", icon: Receipt, disabled: !isLine, onSelect: (r) => setSelected(r) },
      { id: "recat", label: "Recategorise a transaction…", icon: Tag, disabled: !isLine, onSelect: (r) => setSelected(r) },
      { id: "cash", label: "Open in Cash", icon: Landmark, separatorBefore: true, onSelect: () => navigate(routes.department(businessId, "finance", "cash")) },
    ];
  };

  return (
    <Screen name="finance/pnl">
      <Panel
        title="Profit and loss"
        span={selected ? 8 : 12}
        flush
        loading={pnl.isLoading}
        error={pnl.error ? pnl.error.message : undefined}
        onRetry={pnl.refetch}
        empty={empty ? { icon: Landmark, title: "No transactions in this period", children: "Connect a bank account and the finance lead categorises every transaction into the standard chart of accounts.", action: { label: "Connect a bank", icon: Landmark, onClick: () => navigate(routes.settings(businessId, "integrations")) } } : undefined}
        meta={pnl.data ? (ledger ? `Ledger · ${ledger.basis} basis` : pnl.data.label) : undefined}
        actions={<SegmentedControl<PnlPeriod> aria-label="Period" size="sm" value={period} onValueChange={setPeriod} options={PNL_PERIODS.map((p) => ({ value: p.value, label: p.short, title: p.label }))} />}
        footer={
          <>
            <span>{range.label}</span>
            {totals ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">Gross margin {totals.grossMarginPct === null ? "—" : formatPercent(totals.grossMarginPct, { ofHundred: true, digits: 1 })}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">Operating result {fmtSigned(totals.operatingResultMinor, currency, { compact: true })}</span>
                {totals.uncategorisedMinor !== 0 ? (
                  <StatusPill tone="warn" icon={AlertTriangle} className="whitespace-nowrap">
                    Uncategorised {fmtSigned(totals.uncategorisedMinor, currency, { compact: true })}
                  </StatusPill>
                ) : null}
              </>
            ) : null}
            <span aria-hidden>·</span>
            {ledger ? <span>Ledger snapshot {ledger.period}{ledger.source ? ` from ${ledger.source}` : ""}; bank categorisation is not shown while a ledger is connected.</span> : <span>Right-click a line to see its transactions or recategorise one.</span>}
          </>
        }
      >
        <div ref={fitted.ref} className="min-w-0">
        <DataTable<PnlRow>
          aria-label="Profit and loss"
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="all"
          height={fitTableHeight(rows.length, { minRows: 6, maxRows: 40 })}
          density="compact"
          virtualized={false}
          exportFileName={`pnl-${period}`}
          rowClassName={pnlRowClass}
          rowActions={rowActions}
          onRowOpen={(row) => (row.kind === "line" ? setSelected(row) : undefined)}
          footer={null}
          onActiveViewChange={fitted.onActiveViewChange}
        />
        </div>
      </Panel>
      {selected ? (
        <Panel
          title={`Transactions · ${selected.label}`}
          span={4}
          loading={transactions.isLoading}
          error={transactions.error ? transactions.error.message : undefined}
          onRetry={transactions.refetch}
          actions={
            <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(null)}>
              Close
            </Button>
          }
          empty={transactions.data && lineTransactions.length === 0 ? "No transactions in this line for the period." : undefined}
          footer={<span>Pick a transaction to recategorise it. Applying to a counterparty creates a rule for future syncs.</span>}
        >
          <MiniTable<TransactionRow>
            aria-label={`Transactions in ${selected.label}`}
            rows={lineTransactions}
            maxRows={50}
            getRowKey={(t) => t.id}
            onRowClick={(t) => setRecat(t)}
            columns={[
              { id: "date", header: "Date", width: 84, cell: (t) => <span className="tabular-nums">{formatDate(t.bookedAt, "d MMM")}</span> },
              {
                id: "who",
                header: "Counterparty",
                cell: (t) => (t.counterpartyEntityId ? <EntityLink entity={{ id: t.counterpartyEntityId, kind: "organisation", name: t.counterparty ?? "Counterparty" }} hoverCard={false} /> : <span className="truncate">{t.counterparty ?? t.description}</span>),
              },
              { id: "amount", header: "Amount", numeric: true, width: 100, cell: (t) => <span className="tabular-nums">{fmtSigned(t.amountMinor, t.currency)}</span> },
              {
                id: "act",
                header: "",
                width: 32,
                cell: (t) => (
                  <Button size="sm" variant="ghost" icon={Tag} aria-label={`Recategorise ${t.counterparty ?? t.description}`} onClick={(e) => (e.stopPropagation(), setRecat(t))}>
                    Edit
                  </Button>
                ),
              },
            ]}
            caption={<span className="tabular-nums">{lineTransactions.length} of {transactions.data?.items.length ?? 0} transactions in the period · {fmtMoney(lineTransactions.reduce((n, t) => n + t.amountMinor, 0), currency)}</span>}
          />
        </Panel>
      ) : null}
      <RecategoriseDialog
        transaction={recat}
        onClose={() => setRecat(null)}
        onSaved={() => {
          pnl.refetch();
          transactions.refetch();
        }}
      />
    </Screen>
  );
}
