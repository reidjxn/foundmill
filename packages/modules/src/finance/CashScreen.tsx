"use client";
/**
 * Finance › Cash (BUILD §11.8): every connected account with its latest balance and open-banking consent expiry
 * (AC-11.8.2: a warning from 7 days before lapse), and the transactions DataTable with category chips, saved views,
 * search and right-click recategorise. Read-only: balances and rows come from the bank connectors; nothing is paid.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ExternalLink, Landmark, Search, ShieldCheck, Tag } from "lucide-react";
import { Chip, DataTable, EntityLink, Input, Panel, StatusPill, cn, formatDate, formatRelative, type ChipTone, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { daysUntil, routes, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { PNL_CATEGORY_OPTIONS, chartEntry, monthStart, sectionOf, type PnlSection } from "./metrics";
import { RecategoriseDialog } from "./RecategoriseDialog";
import { Screen, fmtMoney, fmtSigned, useCurrency, useNow } from "./shared";
import type { AccountRow, AccountsListResponse, CategorySource, TransactionRow, TransactionsListResponse } from "./types";

export const CONSENT_WARN_DAYS = 7;

export function readAccounts(data: AccountsListResponse | undefined): AccountRow[] {
  if (!data) return [];
  return (Array.isArray(data) ? data : data.accounts).filter((a) => !a.archivedAt);
}

export type ConsentState = { tone: "good" | "warn" | "bad" | "neutral"; word: string; days: number | null };

/** Consent pill state: expired, lapsing within 7 days, valid, or no consent recorded (manual or mock accounts). */
export function consentState(consentExpiresAt: string | null | undefined, now: Date): ConsentState {
  const days = daysUntil(consentExpiresAt, now);
  if (days === null) return { tone: "neutral", word: "No consent expiry", days: null };
  if (days < 0) return { tone: "bad", word: "Consent expired", days };
  if (days <= CONSENT_WARN_DAYS) return { tone: "warn", word: days === 0 ? "Consent lapses today" : `Consent lapses in ${days} day${days === 1 ? "" : "s"}`, days };
  return { tone: "good", word: `Consent valid ${days} days`, days };
}

const SECTION_TONE: Record<PnlSection | "uncategorised", ChipTone> = { revenue: "good", cogs: "neutral", opex: "neutral", financing: "info", tax: "warn", other: "neutral", uncategorised: "warn" };
const SOURCE_WORD: Record<CategorySource, string> = { rule: "rule", model: "agent", ledger: "ledger", user: "you" };

export function CategoryChip({ category, source }: { category: string | null; source: CategorySource | null }) {
  const section = sectionOf(category);
  const label = category ? (chartEntry(category)?.category ?? category) : "Uncategorised";
  return (
    <Chip tone={SECTION_TONE[section]} icon={section === "uncategorised" ? AlertTriangle : undefined} title={source ? `Categorised by ${SOURCE_WORD[source]}` : "Not categorised yet"}>
      {label}
      {source ? <span className="ml-1 text-secondary">· {SOURCE_WORD[source]}</span> : null}
    </Chip>
  );
}

export const TRANSACTION_VIEWS: SavedView[] = [
  { id: "all", name: "All transactions", builtIn: true, columns: ["bookedAt", "counterparty", "description", "category", "amount", "account"], sort: [{ id: "bookedAt", desc: true }], filters: [] },
  { id: "uncategorised", name: "Uncategorised", builtIn: true, columns: ["bookedAt", "counterparty", "description", "category", "amount"], sort: [{ id: "bookedAt", desc: true }], filters: [{ id: "f-unc", field: "categoryText", op: "eq", value: "Uncategorised" }] },
  { id: "in", name: "Money in", builtIn: true, columns: ["bookedAt", "counterparty", "category", "amount", "account"], sort: [{ id: "amount", desc: true }], filters: [{ id: "f-in", field: "amount", op: "gt", value: 0 }] },
  { id: "out", name: "Money out", builtIn: true, columns: ["bookedAt", "counterparty", "category", "amount", "account"], sort: [{ id: "amount", desc: false }], filters: [{ id: "f-out", field: "amount", op: "lt", value: 0 }] },
  { id: "month", name: "This month", builtIn: true, columns: ["bookedAt", "counterparty", "description", "category", "amount"], sort: [{ id: "bookedAt", desc: true }], filters: [{ id: "f-month", field: "thisMonth", op: "eq", value: true }] },
];

export function transactionColumns(accounts: readonly AccountRow[], businessId: string, monthStartIso: string): DataTableColumn<TransactionRow>[] {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return [
    { id: "bookedAt", accessorKey: "bookedAt", header: "Date", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{formatDate(getValue() as string)}</span>, meta: { filter: "date", locked: true } },
    {
      id: "counterparty",
      accessorFn: (r) => r.counterparty ?? "",
      header: "Counterparty",
      size: 200,
      cell: ({ row }) => {
        const r = row.original;
        if (r.counterpartyEntityId) return <EntityLink entity={{ id: r.counterpartyEntityId, kind: "organisation", name: r.counterparty ?? "Counterparty", href: routes.crm(businessId, r.counterpartyEntityId) }} />;
        return <span className="truncate text-body-strong text-primary">{r.counterparty ?? <span className="text-secondary">—</span>}</span>;
      },
    },
    { id: "description", accessorKey: "description", header: "Description", size: 280, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "")}</span> },
    {
      id: "category",
      accessorFn: (r) => r.category ?? "",
      header: "Category",
      size: 190,
      cell: ({ row }) => <CategoryChip category={row.original.category} source={row.original.categorySource} />,
      meta: { filter: "select", filterOptions: [{ value: "", label: "Uncategorised" }, ...PNL_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))] },
    },
    { id: "categoryText", accessorFn: (r) => (r.category ? (chartEntry(r.category)?.category ?? r.category) : "Uncategorised"), header: "Category name", cell: ({ getValue }) => String(getValue()), meta: { filter: "text" } },
    {
      id: "amount",
      accessorKey: "amountMinor",
      header: "Amount",
      size: 130,
      cell: ({ row }) => <span className={cn("tabular-nums", row.original.amountMinor > 0 && "text-status-good")}>{fmtSigned(row.original.amountMinor, row.original.currency)}</span>,
      meta: { numeric: true, csv: (r) => (r.amountMinor / 100).toFixed(2) },
    },
    { id: "account", accessorFn: (r) => accountName.get(r.accountId) ?? r.accountId.slice(0, 8), header: "Account", size: 160, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue())}</span>, meta: { filter: "select", filterOptions: accounts.map((a) => ({ value: a.name, label: a.name })) } },
    { id: "thisMonth", accessorFn: (r) => r.bookedAt >= monthStartIso, header: "This month", cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
  ];
}

export function AccountCard({ account, now, onReconnect }: { account: AccountRow; now: Date; onReconnect: () => void }) {
  const consent = consentState(account.consentExpiresAt, now);
  return (
    <article aria-label={account.name} className="flex min-w-0 flex-col gap-1 bg-panel p-panel-pad">
      <div className="flex items-center gap-1">
        <span className="t-label min-w-0 flex-1 truncate">{account.name}</span>
        <Chip tone="neutral" mono>
          {account.provider}
        </Chip>
      </div>
      <span className="t-display-lg text-primary" data-value={account.balanceMinor}>
        {fmtMoney(account.balanceMinor, account.currency)}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={consent.tone} icon={consent.tone === "good" ? ShieldCheck : consent.tone === "neutral" ? CalendarClock : AlertTriangle}>
          {consent.word}
        </StatusPill>
        {consent.tone === "warn" || consent.tone === "bad" ? (
          <button type="button" className="inline-flex items-center gap-1 text-small text-link hover:underline" onClick={onReconnect}>
            <ExternalLink size={12} /> Renew consent
          </button>
        ) : null}
      </div>
      <span className="text-small text-secondary">{account.balanceAt ? `Balance as of ${formatRelative(account.balanceAt, now)}` : "Balance not synced yet"}{account.consentExpiresAt ? ` · consent until ${formatDate(account.consentExpiresAt)}` : ""}</span>
    </article>
  );
}

export function CashScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const accountsQ = useWidgetQuery<AccountsListResponse>("finance.accounts.list", {});
  const [accountId, setAccountId] = useState<string | null>(null);
  const txQ = useWidgetQuery<TransactionsListResponse>("finance.transactions.list", accountId ? { accountId, limit: 500 } : { limit: 500 });
  const [views, setViews] = useState<SavedView[]>(TRANSACTION_VIEWS);
  const [search, setSearch] = useState("");
  const [recat, setRecat] = useState<TransactionRow | null>(null);

  const accounts = useMemo(() => readAccounts(accountsQ.data), [accountsQ.data]);
  const rows = useMemo(() => txQ.data?.items ?? [], [txQ.data]);
  const monthIso = useMemo(() => monthStart(now, 0).toISOString(), [now]);
  const columns = useMemo(() => transactionColumns(accounts, businessId, monthIso), [accounts, businessId, monthIso]);
  const totals = useMemo(() => {
    const by = new Map<string, number>();
    for (const a of accounts) by.set(a.currency, (by.get(a.currency) ?? 0) + a.balanceMinor);
    return [...by.entries()].map(([cur, amountMinor]) => ({ currency: cur, amountMinor }));
  }, [accounts]);
  const lapsing = accounts.filter((a) => consentState(a.consentExpiresAt, now).tone !== "good" && consentState(a.consentExpiresAt, now).tone !== "neutral");
  const reconnect = () => navigate(routes.settings(businessId, "integrations"));

  const rowActions = (row: TransactionRow): RowAction<TransactionRow>[] => [
    { id: "recat", label: "Recategorise…", icon: Tag, onSelect: (r) => setRecat(r) },
    { id: "crm", label: row.counterpartyEntityId ? "Open counterparty in CRM" : "Counterparty not linked", icon: ExternalLink, disabled: !row.counterpartyEntityId, onSelect: (r) => (r.counterpartyEntityId ? navigate(routes.crm(businessId, r.counterpartyEntityId)) : undefined) },
  ];

  return (
    <Screen name="finance/cash">
      <Panel
        title="Accounts"
        span={12}
        flush
        loading={accountsQ.isLoading}
        error={accountsQ.error ? accountsQ.error.message : undefined}
        onRetry={accountsQ.refetch}
        empty={accountsQ.data && accounts.length === 0 ? { icon: Landmark, title: "No bank accounts connected", children: "Connect Tink or Plaid in Settings and every account appears here with its balance and consent expiry.", action: { label: "Connect a bank", icon: Landmark, onClick: reconnect } } : undefined}
        actions={
          <span className="flex items-center gap-2">
            {totals.map((t) => (
              <span key={t.currency} className="text-body-strong text-primary tabular-nums">
                {fmtMoney(t.amountMinor, t.currency)}
              </span>
            ))}
            {lapsing.length ? (
              <StatusPill tone={lapsing.some((a) => consentState(a.consentExpiresAt, now).tone === "bad") ? "bad" : "warn"} icon={AlertTriangle}>
                {lapsing.length} consent{lapsing.length === 1 ? "" : "s"} to renew
              </StatusPill>
            ) : null}
          </span>
        }
        footer={<span>Balances are read from the bank at each sync. Consent reminders land in the Inbox {CONSENT_WARN_DAYS} days before a connection lapses.</span>}
      >
        <div className="grid gap-px bg-subtle" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, accounts.length))}, minmax(0, 1fr))` }} role="list" aria-label="Bank accounts">
          {accounts.map((a) => (
            <div key={a.id} role="listitem" className={cn(accountId === a.id && "outline outline-2 -outline-offset-2 outline-link")}>
              <AccountCard account={a} now={now} onReconnect={reconnect} />
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Transactions"
        span={12}
        flush
        loading={txQ.isLoading}
        error={txQ.error ? txQ.error.message : undefined}
        onRetry={txQ.refetch}
        empty={txQ.data && rows.length === 0 && !accountId ? { icon: Landmark, title: "No transactions yet", children: "Transactions sync from your connected accounts; the finance lead categorises them into the standard chart of accounts." } : undefined}
        actions={<Input icon={Search} controlSize="sm" placeholder="Search counterparty, description" aria-label="Search transactions" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />}
        footer={<span className="tabular-nums">Latest {rows.length} transactions{accountId ? ` in ${accounts.find((a) => a.id === accountId)?.name ?? "this account"}` : ""} · right-click a row to recategorise · base currency {currency}</span>}
      >
        {accounts.length > 1 ? (
          <div role="group" aria-label="Filter by account" className="flex flex-wrap items-center gap-1 border-b border-subtle px-panel-pad py-2">
            <Chip tone={accountId === null ? "kit" : "neutral"} selected={accountId === null} onClick={() => setAccountId(null)}>
              All accounts
            </Chip>
            {accounts.map((a) => (
              <Chip key={a.id} tone={accountId === a.id ? "kit" : "neutral"} selected={accountId === a.id} onClick={() => setAccountId(accountId === a.id ? null : a.id)}>
                {a.name}
              </Chip>
            ))}
          </div>
        ) : null}
        <DataTable<TransactionRow>
          aria-label="Transactions"
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="all"
          height={520}
          globalFilter={search}
          exportFileName="transactions"
          rowActions={rowActions}
          onRowOpen={(row) => setRecat(row)}
          empty={accountId ? "No transactions in this account." : undefined}
        />
      </Panel>
      <RecategoriseDialog transaction={recat} onClose={() => setRecat(null)} onSaved={() => txQ.refetch()} />
    </Screen>
  );
}
