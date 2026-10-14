"use client";
/**
 * Finance › Cash (BUILD §11.8): every connected account with its latest balance and open-banking consent expiry
 * (AC-11.8.2: a warning from 7 days before lapse), and the transactions DataTable with category chips, saved views,
 * search and right-click recategorise. Read-only: balances and rows come from the bank connectors; nothing is paid.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ExternalLink, Landmark, Search, ShieldCheck, Tag } from "lucide-react";
import { Button, Chip, DataTable, EntityLink, Figure, Input, Panel, StatusPill, cn, formatRelative, useFormatters, type ChipTone, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { daysUntil } from "@foundmill/widgets/shared/time";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleScreenProps } from "../registry";
import { PNL_CATEGORY_OPTIONS, categoryLabel, monthStart, plainWords, sectionOf, type PnlSection } from "./metrics";
import { RecategoriseDialog } from "./RecategoriseDialog";
import { DateText } from "../dates";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { Screen, fmtMoney, fmtSigned, toDate, useCurrency, useNow } from "./shared";
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
const SOURCE_WORD: Record<CategorySource, string> = { rule: "by a rule", model: "by the finance lead", ledger: "from the ledger", user: "by you" };

export function CategoryChip({ category, source }: { category: string | null; source: CategorySource | null }) {
  const section = sectionOf(category);
  const label = categoryLabel(category);
  return (
    <Chip tone={SECTION_TONE[section]} icon={section === "uncategorised" ? AlertTriangle : undefined} title={source ? `Categorized ${SOURCE_WORD[source]}` : "Not categorized yet"}>
      {label}
    </Chip>
  );
}

export const TRANSACTION_VIEWS: SavedView[] = [
  { id: "all", name: "All transactions", builtIn: true, columns: ["bookedAt", "counterparty", "description", "category", "amount", "account"], sort: [{ id: "bookedAt", desc: true }], filters: [] },
  { id: "uncategorised", name: "Uncategorized", builtIn: true, columns: ["bookedAt", "counterparty", "description", "category", "amount"], sort: [{ id: "bookedAt", desc: true }], filters: [{ id: "f-unc", field: "categoryText", op: "eq", value: "Uncategorized" }] },
  { id: "in", name: "Money in", builtIn: true, columns: ["bookedAt", "counterparty", "category", "amount", "account"], sort: [{ id: "amount", desc: true }], filters: [{ id: "f-in", field: "amount", op: "gt", value: 0 }] },
  { id: "out", name: "Money out", builtIn: true, columns: ["bookedAt", "counterparty", "category", "amount", "account"], sort: [{ id: "amount", desc: false }], filters: [{ id: "f-out", field: "amount", op: "lt", value: 0 }] },
  { id: "month", name: "This month", builtIn: true, columns: ["bookedAt", "counterparty", "description", "category", "amount"], sort: [{ id: "bookedAt", desc: true }], filters: [{ id: "f-month", field: "thisMonth", op: "eq", value: true }] },
];

/** What each column's content needs and its share of the spare width: every view fits the 980 px table at 1280. */
export const TRANSACTION_FIT = {
  bookedAt: { min: 112 },
  counterparty: { min: 150, grow: 2 },
  description: { min: 180, grow: 3 },
  category: { min: 140, grow: 1 },
  categoryText: { min: 140 },
  amount: { min: 116 },
  account: { min: 130, grow: 1 },
  thisMonth: { min: 100 },
} satisfies Record<string, ColumnFit>;
export type TransactionColumnId = keyof typeof TRANSACTION_FIT;

export function transactionColumns(accounts: readonly AccountRow[], businessId: string, monthStartIso: string, sizes: Record<TransactionColumnId, number> = fitColumns<TransactionColumnId>(null, TRANSACTION_FIT, [])): DataTableColumn<TransactionRow>[] {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return [
    { id: "bookedAt", accessorKey: "bookedAt", header: "Date", size: sizes.bookedAt, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() as string} />, meta: { filter: "date", locked: true } },
    {
      id: "counterparty",
      accessorFn: (r) => r.counterparty ?? "",
      header: "Counterparty",
      size: sizes.counterparty,
      cell: ({ row }) => {
        const r = row.original;
        if (r.counterpartyEntityId) return <EntityLink entity={{ id: r.counterpartyEntityId, kind: "organisation", name: r.counterparty ?? "Counterparty", href: routes.crm(businessId, r.counterpartyEntityId) }} />;
        return <span className="truncate text-body-strong text-primary">{r.counterparty ?? <span className="text-secondary">—</span>}</span>;
      },
    },
    { id: "description", accessorKey: "description", header: "Description", size: sizes.description, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "")}</span> },
    {
      id: "category",
      accessorFn: (r) => categoryLabel(r.category),
      header: "Category",
      size: sizes.category,
      cell: ({ row }) => <CategoryChip category={row.original.category} source={row.original.categorySource} />,
      meta: { filter: "select", filterOptions: [{ value: "Uncategorized", label: "Uncategorized" }, ...PNL_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))] },
    },
    { id: "categoryText", accessorFn: (r) => categoryLabel(r.category), header: "Category name", size: sizes.categoryText, cell: ({ getValue }) => String(getValue()), meta: { filter: "text" } },
    {
      id: "amount",
      accessorKey: "amountMinor",
      header: "Amount",
      size: sizes.amount,
      cell: ({ row }) => <span className={cn("tabular-nums", row.original.amountMinor > 0 && "text-status-good")}>{fmtSigned(row.original.amountMinor, row.original.currency)}</span>,
      meta: { numeric: true, csv: (r) => (r.amountMinor / 100).toFixed(2) },
    },
    { id: "account", accessorFn: (r) => accountName.get(r.accountId) ?? r.accountId.slice(0, 8), header: "Account", size: sizes.account, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue())}</span>, meta: { filter: "select", filterOptions: accounts.map((a) => ({ value: a.name, label: a.name })) } },
    // bookedAt arrives as a Date (superjson) or an ISO string: compare instants, never a Date with a string.
    { id: "thisMonth", accessorFn: (r) => (toDate(r.bookedAt)?.getTime() ?? Number.NEGATIVE_INFINITY) >= Date.parse(monthStartIso), header: "This month", size: sizes.thisMonth, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
  ];
}

const PROVIDER_NAMES: Record<string, string> = { tink: "Tink", plaid: "Plaid", gocardless: "GoCardless", truelayer: "TrueLayer", stripe: "Stripe", wise: "Wise", manual: "Added by hand", mock: "Simulated bank" };

/** The bank connection's display name ("tink" → "Tink"). */
export function providerName(provider: string | null | undefined): string {
  if (!provider) return "Bank";
  return PROVIDER_NAMES[provider.toLowerCase()] ?? plainWords(provider);
}

export function AccountCard({ account, now, onReconnect }: { account: AccountRow; now: Date; onReconnect: () => void }) {
  const { formatDate } = useFormatters();
  const consent = consentState(account.consentExpiresAt, now);
  return (
    <article aria-label={account.name} className="flex min-w-0 flex-col gap-2 bg-panel p-panel-pad">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="t-data min-w-0 flex-1">{account.name}</span>
        <Chip tone="neutral" icon={Landmark}>
          {providerName(account.provider)}
        </Chip>
      </div>
      <Figure value={fmtMoney(account.balanceMinor, account.currency)} className="t-display-lg text-primary" data-value={account.balanceMinor} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={consent.tone} icon={consent.tone === "good" ? ShieldCheck : consent.tone === "neutral" ? CalendarClock : AlertTriangle}>
          {consent.word}
        </StatusPill>
        {consent.tone === "warn" || consent.tone === "bad" ? (
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={onReconnect}>
            Renew consent
          </Button>
        ) : null}
      </div>
      <span className="text-small text-secondary">{account.balanceAt ? `Balance as of ${formatRelative(account.balanceAt, now)}` : "Balance not synced yet"}{account.consentExpiresAt ? ` · consent until ${formatDate(account.consentExpiresAt)}` : ""}</span>
    </article>
  );
}

const ACCOUNT_COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

export function CashScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const accountsQ = useWidgetQuery<AccountsListResponse>("finance.accounts.list", {});
  const [accountId, setAccountId] = useState<string | null>(null);
  const txQ = useWidgetQuery<TransactionsListResponse>("finance.transactions.list", accountId ? { accountId, limit: 500 } : { limit: 500 });
  // Saved per person, business and table (audit #204): they come back after a reload.
  const savedViews = useSavedViews("finance.cash", TRANSACTION_VIEWS, { defaultViewId: "all" });
  const [search, setSearch] = useState("");
  const [recat, setRecat] = useState<TransactionRow | null>(null);

  const accounts = useMemo(() => readAccounts(accountsQ.data), [accountsQ.data]);
  const rows = useMemo(() => txQ.data?.items ?? [], [txQ.data]);
  const monthIso = useMemo(() => monthStart(now, 0).toISOString(), [now]);
  // The table shares its spare width by the fit specs' weights itself (DataTable `meta.grow`), at any width and view.
  const columns = useMemo(() => fitToGrow(transactionColumns(accounts, businessId, monthIso), TRANSACTION_FIT), [accounts, businessId, monthIso]);
  const totals = useMemo(() => {
    const by = new Map<string, number>();
    for (const a of accounts) by.set(a.currency, (by.get(a.currency) ?? 0) + a.balanceMinor);
    return [...by.entries()].map(([cur, amountMinor]) => ({ currency: cur, amountMinor }));
  }, [accounts]);
  const lapsing = accounts.filter((a) => consentState(a.consentExpiresAt, now).tone !== "good" && consentState(a.consentExpiresAt, now).tone !== "neutral");
  const connectBank = () => navigate(routes.settings(businessId, "integrations"));
  // Renewing goes to the account's own connector row in Settings › Integrations, which offers "Renew consent" there.
  const reconnect = (account: AccountRow) => navigate(`${routes.settings(businessId, "integrations")}?connector=${encodeURIComponent(account.provider.toLowerCase())}`);

  const rowActions = (row: TransactionRow): RowAction<TransactionRow>[] => [
    { id: "recat", label: "Recategorize…", icon: Tag, onSelect: (r) => setRecat(r) },
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
        empty={accountsQ.data && accounts.length === 0 ? { icon: Landmark, title: "No bank accounts connected", children: "Connect Tink or Plaid in Settings and every account appears here with its balance and consent expiry.", action: { label: "Connect a bank", icon: Landmark, onClick: connectBank } } : undefined}
        meta={accounts.length ? `${accounts.length} connected${totals.length ? ` · ${totals.map((t) => fmtMoney(t.amountMinor, t.currency)).join(" + ")}` : ""}` : undefined}
        actions={
          lapsing.length ? (
            <StatusPill tone={lapsing.some((a) => consentState(a.consentExpiresAt, now).tone === "bad") ? "bad" : "warn"} icon={AlertTriangle} className="whitespace-nowrap">
              {lapsing.length} consent{lapsing.length === 1 ? "" : "s"} to renew
            </StatusPill>
          ) : undefined
        }
        footer={<span>Balances are read from the bank at each sync. Consent reminders land in the Inbox {CONSENT_WARN_DAYS} days before a connection lapses.</span>}
      >
        <div className={cn("grid gap-px bg-subtle", ACCOUNT_COLS[Math.min(4, Math.max(1, accounts.length))])} role="list" aria-label="Bank accounts">
          {accounts.map((a) => (
            <div key={a.id} role="listitem" className={cn(accountId === a.id && "outline outline-2 -outline-offset-2 outline-link")}>
              <AccountCard account={a} now={now} onReconnect={() => reconnect(a)} />
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
        empty={txQ.data && rows.length === 0 && !accountId ? { icon: Landmark, title: "No transactions yet", children: "Transactions sync from your connected accounts; the finance lead categorizes them into the standard chart of accounts." } : undefined}
        actions={<Input icon={Search} controlSize="sm" placeholder="Search transactions" aria-label="Search transactions" title="Search counterparty or description" value={search} onChange={(e) => setSearch(e.target.value)} wrapperClassName="w-64" />}
        footer={<span className="tabular-nums">Latest {rows.length} transactions{accountId ? ` in ${accounts.find((a) => a.id === accountId)?.name ?? "this account"}` : ""} · right-click a row to recategorize · base currency {currency}</span>}
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
        <div className="min-w-0">
        <DataTable<TransactionRow>
          aria-label="Transactions"
          data={rows}
          columns={columns}
          {...savedViews}
          defaultViewId="all"
          height={520}
          globalFilter={search}
          exportFileName="transactions"
          rowActions={rowActions}
          onRowOpen={(row) => setRecat(row)}
          empty={accountId ? "No transactions in this account." : undefined}
        />
        </div>
      </Panel>
      <RecategoriseDialog transaction={recat} onClose={() => setRecat(null)} onSaved={() => txQ.refetch()} />
    </Screen>
  );
}
