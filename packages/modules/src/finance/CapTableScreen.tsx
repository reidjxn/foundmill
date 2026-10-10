"use client";
/**
 * Finance › Cap table (BUILD §11.8): holders (CRM entities), share classes, issuances with vesting, the option pool,
 * SAFEs and convertible notes; round modelling (pre-money + investment → pro forma with SAFE conversion and pool
 * top-up, labelled Estimate); Delaware stock ledger and Swedish aktiebok exports. Read-only here: issuances are
 * recorded by the legal lead with the founder's approval, never by this screen.
 */
import { useId, useMemo, useState } from "react";
import { Calculator, Download, ExternalLink, FileSpreadsheet, Landmark, PieChart, Users } from "lucide-react";
import { Button, Chip, DataTable, cn, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Field, Input, KeyValueList, MiniTable, MoneyInput, Panel, ProvenanceChip, StatusStrip, Textarea, formatDate, formatPercent, type ChipTone, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { aktiebokRows, delawareLedgerRows, modelRound, plainWords, safeTerms, toCsv, vestingSummary, type RoundInput } from "./metrics";
import { fitColumns, type ColumnFit } from "../fit";
import { Screen, downloadText, fmtMoney, fmtQuantity, parseAmount, useCurrency, useFittedColumns, useNow } from "./shared";
import type { CapTableEntryRow, CapTableResponse, CapTableSummary, SecurityRow } from "./types";

const KIND_TONE: Record<SecurityRow["kind"], ChipTone> = { common: "neutral", preferred: "info", option: "kit", warrant: "info", safe: "gold", note: "gold" };
const KIND_WORD: Record<SecurityRow["kind"], string> = { common: "Common", preferred: "Preferred", option: "Option", warrant: "Warrant", safe: "SAFE", note: "Note" };

export function holderKind(kind: string): EntityKind {
  return kind === "organisation" || kind === "person" || kind === "team_member" || kind === "agent" ? kind : "person";
}

export type HolderRow = CapTableSummary["byHolder"][number] & { kind: string };

const HOLDER_KIND_WORD: Record<string, string> = { person: "Person", organisation: "Organisation", team_member: "Team member", agent: "Agent" };

export function holderRows(data: CapTableResponse | undefined): HolderRow[] {
  if (!data) return [];
  const kinds = new Map(data.entries.map((e) => [e.holderEntityId, e.holder.kind]));
  return data.summary.byHolder.map((h) => ({ ...h, kind: kinds.get(h.holderEntityId) ?? "person" }));
}

export const HOLDER_VIEWS: SavedView[] = [
  { id: "all", name: "All holders", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [] },
  { id: "kinds", name: "Holders by kind", builtIn: true, columns: ["name", "kind", "quantity", "pct"], sort: [{ id: "kind", desc: false }], filters: [] },
  { id: "people", name: "People", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [{ id: "f-p", field: "kind", op: "in", value: ["person", "team_member"] }] },
  { id: "orgs", name: "Organisations", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [{ id: "f-o", field: "kind", op: "eq", value: "organisation" }] },
];

export const ISSUANCE_VIEWS: SavedView[] = [
  { id: "all", name: "All issuances", builtIn: true, columns: ["holder", "class", "kind", "quantity", "price", "consideration", "issuedAt", "vesting"], sort: [{ id: "issuedAt", desc: true }], filters: [] },
  { id: "options", name: "Options and vesting", builtIn: true, columns: ["holder", "class", "quantity", "issuedAt", "vesting", "vestedPct"], sort: [{ id: "issuedAt", desc: true }], filters: [{ id: "f-opt", field: "kind", op: "eq", value: "option" }] },
  { id: "convertibles", name: "SAFEs and notes", builtIn: true, columns: ["holder", "class", "kind", "principal", "cap", "discount", "issuedAt"], sort: [{ id: "issuedAt", desc: true }], filters: [{ id: "f-conv", field: "kind", op: "in", value: ["safe", "note"] }] },
];

/** What each column's content needs and its share of the spare width (Holders is 647 px wide at 1280). */
export const HOLDER_FIT = {
  name: { min: 170, grow: 2 },
  kind: { min: 110 },
  quantity: { min: 110 },
  pct: { min: 120 },
  positions: { min: 180, grow: 3 },
} satisfies Record<string, ColumnFit>;
export type HolderColumnId = keyof typeof HOLDER_FIT;

/** What each column's content needs and its share of the spare width (Issuances is 980 px wide at 1280). */
export const ISSUANCE_FIT = {
  holder: { min: 140, grow: 2 },
  class: { min: 160, grow: 2 },
  kind: { min: 92 },
  quantity: { min: 100 },
  price: { min: 80 },
  consideration: { min: 130 },
  issuedAt: { min: 100 },
  vesting: { min: 176, grow: 1 },
  vestedPct: { min: 90 },
  principal: { min: 110 },
  cap: { min: 120 },
  discount: { min: 90 },
} satisfies Record<string, ColumnFit>;
export type IssuanceColumnId = keyof typeof ISSUANCE_FIT;

export function holderColumns(businessId: string, sizes: Record<HolderColumnId, number> = fitColumns<HolderColumnId>(null, HOLDER_FIT, [])): DataTableColumn<HolderRow>[] {
  return [
    { id: "name", accessorKey: "displayName", header: "Holder", size: sizes.name, cell: ({ row }) => <EntityLink entity={{ id: row.original.holderEntityId, kind: holderKind(row.original.kind), name: row.original.displayName, href: routes.crm(businessId, row.original.holderEntityId) }} />, meta: { locked: true } },
    { id: "kind", accessorKey: "kind", header: "Kind", size: sizes.kind, cell: ({ getValue }) => <span className="text-secondary">{HOLDER_KIND_WORD[String(getValue())] ?? plainWords(String(getValue()))}</span>, meta: { filter: "select", filterOptions: ["person", "organisation", "team_member"].map((k) => ({ value: k, label: HOLDER_KIND_WORD[k] ?? k })) } },
    { id: "quantity", accessorKey: "quantity", header: "Shares", size: sizes.quantity, cell: ({ getValue }) => <span className="tabular-nums">{fmtQuantity(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "pct", accessorKey: "fullyDilutedPct", header: "Fully diluted", size: sizes.pct, cell: ({ getValue }) => <span className="text-body-strong text-primary tabular-nums">{formatPercent(getValue() as number, { ofHundred: true, digits: 2 })}</span>, meta: { numeric: true } },
    {
      id: "positions",
      accessorFn: (r) => r.positions.map((p) => `${p.class} ${p.quantity}`).join(", "),
      header: "Classes held",
      size: sizes.positions,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {row.original.positions.map((p) => (
            <Chip key={p.securityId} tone="neutral" className="shrink-0 whitespace-nowrap" title={`${fmtQuantity(p.quantity)} ${p.class}`}>
              {p.class}
            </Chip>
          ))}
        </span>
      ),
    },
  ];
}

export function issuanceColumns(businessId: string, securities: readonly SecurityRow[], now: Date, sizes: Record<IssuanceColumnId, number> = fitColumns<IssuanceColumnId>(null, ISSUANCE_FIT, [])): DataTableColumn<CapTableEntryRow>[] {
  const byId = new Map(securities.map((s) => [s.id, s]));
  // A price is denominated in its share class's currency (an entry recorded without one must not read as another currency).
  const entryCurrency = (r: CapTableEntryRow) => byId.get(r.securityId)?.currency || r.currency;
  return [
    { id: "holder", accessorFn: (r) => r.holder.displayName, header: "Holder", size: sizes.holder, cell: ({ row }) => <EntityLink entity={{ id: row.original.holderEntityId, kind: holderKind(row.original.holder.kind), name: row.original.holder.displayName, href: routes.crm(businessId, row.original.holderEntityId) }} hoverCard={false} />, meta: { locked: true } },
    { id: "class", accessorFn: (r) => r.security.class, header: "Class", size: sizes.class, cell: ({ getValue }) => <span className="text-body-strong text-primary">{String(getValue())}</span>, meta: { filter: "select", filterOptions: securities.map((s) => ({ value: s.class, label: s.class })) } },
    { id: "kind", accessorFn: (r) => r.security.kind, header: "Kind", size: sizes.kind, cell: ({ getValue }) => <Chip tone={KIND_TONE[getValue() as SecurityRow["kind"]]} className="whitespace-nowrap">{KIND_WORD[getValue() as SecurityRow["kind"]]}</Chip>, meta: { filter: "select", filterOptions: Object.entries(KIND_WORD).map(([value, label]) => ({ value, label })) } },
    { id: "quantity", accessorFn: (r) => Number(r.quantity), header: "Quantity", size: sizes.quantity, cell: ({ getValue }) => <span className="tabular-nums">{fmtQuantity(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "price", accessorFn: (r) => r.priceMinor ?? 0, header: "Price", size: sizes.price, cell: ({ row }) => <span className="tabular-nums">{row.original.priceMinor === null ? "—" : fmtMoney(row.original.priceMinor, entryCurrency(row.original))}</span>, meta: { numeric: true } },
    { id: "consideration", accessorFn: (r) => (r.priceMinor === null ? 0 : Math.round(r.priceMinor * Number(r.quantity))), header: "Consideration", size: sizes.consideration, cell: ({ row }) => <span className="tabular-nums">{row.original.priceMinor === null ? "—" : fmtMoney(Math.round(row.original.priceMinor * Number(row.original.quantity)), entryCurrency(row.original))}</span>, meta: { numeric: true } },
    { id: "issuedAt", accessorFn: (r) => r.issuedAt ?? "", header: "Issued", size: sizes.issuedAt, cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatDate(String(getValue())) : "—"}</span>, meta: { filter: "date" } },
    { id: "vesting", accessorFn: (r) => vestingSummary(r.vesting, r.quantity, now)?.text ?? "", header: "Vesting", size: sizes.vesting, cell: ({ getValue }) => <span className="text-secondary">{String(getValue()) || "Fully vested"}</span> },
    { id: "vestedPct", accessorFn: (r) => vestingSummary(r.vesting, r.quantity, now)?.vestedPct ?? 100, header: "Vested", size: sizes.vestedPct, cell: ({ getValue }) => <span className="tabular-nums">{formatPercent(getValue() as number, { ofHundred: true, digits: 0 })}</span>, meta: { numeric: true } },
    { id: "principal", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.principalMinor ?? 0, header: "Principal", size: sizes.principal, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t ? fmtMoney(t.principalMinor, row.original.currency) : "—"}</span>; }, meta: { numeric: true } },
    { id: "cap", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.valuationCapMinor ?? 0, header: "Valuation cap", size: sizes.cap, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t?.valuationCapMinor ? fmtMoney(t.valuationCapMinor, row.original.currency, { compact: true }) : "—"}</span>; }, meta: { numeric: true } },
    { id: "discount", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.discountPct ?? 0, header: "Discount", size: sizes.discount, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t && t.discountPct > 0 ? formatPercent(t.discountPct, { ofHundred: true, digits: 0 }) : "—"}</span>; }, meta: { numeric: true } },
  ];
}

export function CapTableScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const id = useId();
  const cap = useWidgetQuery<CapTableResponse>("finance.capTable.get", {});
  const [holderViews, setHolderViews] = useState<SavedView[]>(HOLDER_VIEWS);
  const [issuanceViews, setIssuanceViews] = useState<SavedView[]>(ISSUANCE_VIEWS);
  const [holderFilter, setHolderFilter] = useState<string | null>(null);
  const [round, setRound] = useState<{ preMoney: string; investment: string; poolPct: string; newClass: string }>({ preMoney: "", investment: "", poolPct: "10", newClass: "Series Seed Preferred" });
  const [exportText, setExportText] = useState<{ title: string; csv: string } | null>(null);

  const data = cap.data;
  const cur = data?.securities[0]?.currency || data?.entries[0]?.currency || currency;
  const holders = useMemo(() => holderRows(data), [data]);
  const entries = useMemo(() => (data?.entries ?? []).filter((e) => !e.archivedAt && (!holderFilter || e.holderEntityId === holderFilter)), [data, holderFilter]);
  const holderFit = useFittedColumns(HOLDER_FIT, holderViews, "all");
  const issuanceFit = useFittedColumns(ISSUANCE_FIT, issuanceViews, "all");
  const hColumns = useMemo(() => holderColumns(businessId, holderFit.sizes), [businessId, holderFit.sizes]);
  const iColumns = useMemo(() => issuanceColumns(businessId, data?.securities ?? [], now, issuanceFit.sizes), [businessId, data?.securities, now, issuanceFit.sizes]);
  const pool = useMemo(() => {
    const classes = data?.summary.byClass.filter((c) => c.kind === "option") ?? [];
    const authorised = classes.reduce((n, c) => n + (c.authorisedQuantity ?? 0), 0);
    const issued = classes.reduce((n, c) => n + c.quantity, 0);
    return { authorised, issued, available: Math.max(0, authorised - issued) };
  }, [data]);
  const convertibles = useMemo(() => {
    const byId = new Map((data?.securities ?? []).map((s) => [s.id, s]));
    return (data?.entries ?? []).map((e) => safeTerms(e, byId.get(e.securityId))).filter((t): t is NonNullable<typeof t> => !!t);
  }, [data]);
  const convertiblePrincipal = convertibles.reduce((n, t) => n + t.principalMinor, 0);
  const lastChange = useMemo(() => (data?.entries ?? []).map((e) => e.updatedAt ?? e.createdAt ?? "").filter(Boolean).sort().at(-1) ?? null, [data]);

  const roundInput: RoundInput | null = useMemo(() => {
    const pre = parseAmount(round.preMoney) ?? Number.NaN;
    const inv = parseAmount(round.investment) ?? Number.NaN;
    const pct = Number(round.poolPct.replace(/[%\s]/g, ""));
    if (!Number.isFinite(pre) || pre <= 0 || !Number.isFinite(inv) || inv <= 0) return null;
    return { preMoneyMinor: Math.round(pre * 100), investmentMinor: Math.round(inv * 100), poolTargetPct: Number.isFinite(pct) ? pct : 0, newClass: round.newClass || "New investors" };
  }, [round]);
  const proForma = useMemo(() => (data && roundInput ? modelRound(data, roundInput) : null), [data, roundInput]);

  const exportCsv = (which: "delaware" | "aktiebok") => {
    if (!data) return;
    const rows = which === "delaware" ? delawareLedgerRows(data.entries, now) : aktiebokRows(data.entries);
    const csv = toCsv(rows);
    const title = which === "delaware" ? "Delaware stock ledger" : "Aktiebok";
    if (!downloadText(`${which}-${now.toISOString().slice(0, 10)}.csv`, csv)) setExportText({ title, csv });
  };

  const tiles: MetricTileProps[] = [
    { label: "Fully diluted shares", value: data?.summary.totalQuantity ?? null, format: "integer", provenance: { source: "Cap table entries, every live position including options and converted instruments", query: "finance.capTable.get" } },
    { label: "Holders", value: holders.length, format: "integer", provenance: { source: "Distinct holder entities in the CRM" } },
    { label: "Option pool", value: pool.authorised ? pool.available / pool.authorised : "—", format: "percent", caption: pool.authorised ? `${fmtQuantity(pool.available)} of ${fmtQuantity(pool.authorised)} unallocated` : "No option class yet", provenance: { source: "Authorised option classes minus issued options", note: "The share of the pool still available to grant." } },
    { label: "Convertibles", value: { amountMinor: convertiblePrincipal, currency: cur }, caption: `${convertibles.length} SAFE${convertibles.length === 1 ? "" : "s"} or note${convertibles.length === 1 ? "" : "s"} outstanding`, provenance: { source: "Principal of post-money SAFEs and convertible notes", note: "Converts into shares at the next priced round (see round modelling)." } },
  ];

  const holderActions = (row: HolderRow): RowAction<HolderRow>[] => [
    { id: "crm", label: "Open in CRM", icon: ExternalLink, onSelect: (r) => navigate(routes.crm(businessId, r.holderEntityId)) },
    { id: "issuances", label: holderFilter === row.holderEntityId ? "Show all issuances" : "Show this holder's issuances", icon: FileSpreadsheet, onSelect: (r) => setHolderFilter(holderFilter === r.holderEntityId ? null : r.holderEntityId) },
  ];
  const issuanceActions = (): RowAction<CapTableEntryRow>[] => [{ id: "crm", label: "Open holder in CRM", icon: ExternalLink, onSelect: (r) => navigate(routes.crm(businessId, r.holderEntityId)) }];

  const empty = data && data.entries.length === 0 && data.securities.length === 0;
  const nothingToExport = !data || data.entries.length === 0;
  // One empty state for an empty cap table (the Holders panel, with the way forward); the other panels keep their place
  // with one quiet line of what they will hold, no second icon, button or zero-count footer.
  const emptyState = { icon: PieChart, title: "No cap table yet", children: "The legal lead records the founders' shares here once the company is incorporated.", action: { label: "Open Legal", icon: Landmark, onClick: () => navigate(routes.department(businessId, "legal", "entity")) } };
  const quiet = (text: string, padded?: boolean) => <p className={cn("text-small text-secondary", padded && "px-panel-pad py-3")}>{text}</p>;

  return (
    <Screen name="finance/cap-table">
      <section aria-label="Cap table summary" className="col-span-12" aria-busy={cap.isLoading || undefined}>
        <StatusStrip tiles={tiles.map((t) => ({ ...t, loading: cap.isLoading }))} />
      </section>
      <Panel title="Holders" span={8} flush loading={cap.isLoading} error={cap.error ? cap.error.message : undefined} onRetry={cap.refetch} empty={empty ? emptyState : undefined} footer={empty ? undefined : <span className="tabular-nums">{holders.length} holder{holders.length === 1 ? "" : "s"} · fully diluted over {fmtQuantity(data?.summary.totalQuantity ?? 0)} shares · right-click for CRM and issuances</span>}>
        <div ref={holderFit.ref} className="min-w-0">
        <DataTable<HolderRow> aria-label="Holders" data={holders} columns={hColumns} getRowId={(r) => r.holderEntityId} views={holderViews} onViewsChange={setHolderViews} defaultViewId="all" onActiveViewChange={holderFit.onActiveViewChange} height={320} exportFileName="cap-table-holders" rowActions={holderActions} onRowOpen={(r) => navigate(routes.crm(businessId, r.holderEntityId))} rowClassName={(r) => (holderFilter === r.holderEntityId ? "bg-panel-alt" : undefined)} />
        </div>
      </Panel>
      <Panel title="Classes" span={4} loading={cap.isLoading} error={cap.error ? cap.error.message : undefined} footer={empty ? undefined : <span>Options count toward fully diluted; SAFEs and notes are shown at principal until they convert.</span>}>
        {empty ? quiet("Share classes appear with the first issuance.") : null}
        {/* A narrow column: each class is a row of words over a line of figures, never a table cut at its edge. */}
        <ul aria-label="Share classes" className="flex flex-col" hidden={!!empty}>
          {(data?.summary.byClass ?? []).map((c) => (
            <li key={c.securityId} className="flex flex-col gap-1 border-b border-line-faint py-2 first:pt-0 last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 text-body-strong text-primary">{c.class}</span>
                <Chip tone={KIND_TONE[c.kind]} className="whitespace-nowrap">
                  {KIND_WORD[c.kind]}
                </Chip>
                <span className="ml-auto whitespace-nowrap text-body-strong text-primary tabular-nums" title="Fully diluted">
                  {formatPercent(c.fullyDilutedPct, { ofHundred: true, digits: 2 })}
                </span>
              </div>
              <p className="text-small text-secondary tabular-nums">
                {fmtQuantity(c.quantity)} issued{c.authorisedQuantity === null ? "" : ` of ${fmtQuantity(c.authorisedQuantity)} authorised`} · {c.holders} holder{c.holders === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title={holderFilter ? `Issuances · ${holders.find((h) => h.holderEntityId === holderFilter)?.displayName ?? "holder"}` : "Issuances"}
        span={12}
        flush
        loading={cap.isLoading}
        error={cap.error ? cap.error.message : undefined}
        onRetry={cap.refetch}
        meta={empty ? undefined : `${entries.length} issuance${entries.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1">
            {holderFilter ? (
              <Button size="sm" variant="ghost" onClick={() => setHolderFilter(null)}>
                All holders
              </Button>
            ) : null}
            <Button size="sm" icon={Download} onClick={() => exportCsv("delaware")} disabled={nothingToExport} title={nothingToExport ? "Nothing to export until shares are recorded" : "Download the Delaware stock ledger as CSV"}>
              Delaware stock ledger
            </Button>
            <Button size="sm" icon={Download} onClick={() => exportCsv("aktiebok")} disabled={nothingToExport} title={nothingToExport ? "Nothing to export until shares are recorded" : "Download the Swedish share register (aktiebok) as CSV"}>
              Aktiebok
            </Button>
          </div>
        }
        footer={empty ? undefined : <span className="tabular-nums">Versioned and audited{lastChange ? ` · last change ${formatDate(lastChange)}` : ""} · exports are CSV registers for Delaware (stock ledger) and Sweden (aktiebok)</span>}
      >
        {empty ? (
          quiet("Each issuance and its vesting appear here once the first shares are recorded.", true)
        ) : (
          <div ref={issuanceFit.ref} className="min-w-0">
          <DataTable<CapTableEntryRow> aria-label="Issuances" data={entries} columns={iColumns} views={issuanceViews} onViewsChange={setIssuanceViews} defaultViewId="all" onActiveViewChange={issuanceFit.onActiveViewChange} height={360} exportFileName="cap-table-issuances" rowActions={issuanceActions} onRowOpen={(r) => navigate(routes.crm(businessId, r.holderEntityId))} empty={holderFilter ? "No issuances for this holder." : undefined} />
          </div>
        )}
      </Panel>
      <Panel title="Round modelling" span={12} loading={cap.isLoading} actions={empty ? undefined : <ProvenanceChip kind="estimate" />} footer={empty ? undefined : <span>Post-money SAFEs convert first at principal ÷ cap (or at the discount when it gives more shares), the pool is topped up to the target, then new shares are priced at pre-money ÷ pre-round fully diluted. An estimate for discussion, not a term sheet.</span>}>
        {empty ? (
          quiet("Model a priced round here once the first shares are recorded.")
        ) : (
          <>
          <form className="grid grid-cols-12 gap-gutter" aria-label="Round inputs" onSubmit={(e) => e.preventDefault()}>
            <Field htmlFor={`${id}-pre`} label="Pre-money valuation" className="col-span-3">
              <MoneyInput id={`${id}-pre`} controlSize="lg" currency={cur} value={round.preMoney} placeholder="4,000,000" onValueChange={(v) => setRound((r) => ({ ...r, preMoney: v }))} />
            </Field>
            <Field htmlFor={`${id}-inv`} label="Investment" className="col-span-3">
              <MoneyInput id={`${id}-inv`} controlSize="lg" currency={cur} value={round.investment} placeholder="1,000,000" onValueChange={(v) => setRound((r) => ({ ...r, investment: v }))} />
            </Field>
            <Field htmlFor={`${id}-pool`} label="Option pool target" hint="Of post-money, fully diluted" className="col-span-3">
              <Input id={`${id}-pool`} controlSize="lg" numeric inputMode="decimal" suffix="%" value={round.poolPct} onChange={(e) => setRound((r) => ({ ...r, poolPct: e.target.value }))} />
            </Field>
            <Field htmlFor={`${id}-class`} label="New class" className="col-span-3">
              <Input id={`${id}-class`} controlSize="lg" value={round.newClass} onChange={(e) => setRound((r) => ({ ...r, newClass: e.target.value }))} />
            </Field>
          </form>
          {proForma ? (
            <div className="mt-3 grid grid-cols-12 gap-gutter" aria-label="Pro forma">
              <div className="col-span-4">
                <KeyValueList
                  dense
                  items={[
                    { label: "Post-money", value: fmtMoney(proForma.postMoneyMinor, cur, { compact: true }), numeric: true },
                    { label: "Price per share", value: fmtMoney(proForma.pricePerShareMinor, cur), numeric: true },
                    { label: "New shares", value: fmtQuantity(proForma.newShares), numeric: true },
                    { label: "Investor stake", value: formatPercent(proForma.investorPct, { ofHundred: true, digits: 2 }), numeric: true },
                    { label: "SAFE shares", value: fmtQuantity(proForma.safeShares), numeric: true, hint: proForma.conversions.length ? proForma.conversions.map((c) => `${c.holder}: ${fmtQuantity(c.shares)} via ${c.method}`).join(" · ") : "No convertibles" },
                    { label: "Pool top-up", value: fmtQuantity(proForma.poolTopUpShares), numeric: true },
                    { label: "Post-round FD", value: fmtQuantity(proForma.postRoundFullyDiluted), numeric: true },
                  ]}
                />
              </div>
              <div className="col-span-8">
                <MiniTable<(typeof proForma.rows)[number]>
                  aria-label="Pro forma ownership"
                  rows={proForma.rows}
                  getRowKey={(r) => r.id}
                  maxRows={30}
                  highlight={(r) => r.kind === "investor"}
                  columns={[
                    { id: "name", header: "Holder", cell: (r) => <span className={r.kind === "investor" ? "text-body-strong text-primary" : undefined}>{r.name}</span> },
                    { id: "before", header: "Before", numeric: true, width: 90, cell: (r) => <span className="tabular-nums">{formatPercent(r.beforePct, { ofHundred: true, digits: 2 })}</span> },
                    { id: "afterQ", header: "Shares after", numeric: true, width: 120, cell: (r) => <span className="tabular-nums">{fmtQuantity(r.afterQuantity)}</span> },
                    { id: "after", header: "After", numeric: true, width: 90, cell: (r) => <span className="text-body-strong text-primary tabular-nums">{formatPercent(r.afterPct, { ofHundred: true, digits: 2 })}</span> },
                  ]}
                  caption={<span className="flex items-center gap-1">Pro forma fully diluted ownership <ProvenanceChip kind="estimate" /></span>}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-small text-secondary">
              <Calculator size={14} /> Enter a pre-money valuation and an investment to see the pro forma.
            </p>
          )}
          </>
        )}
      </Panel>
      <Dialog open={!!exportText} onOpenChange={(open) => (open ? undefined : setExportText(null))}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{exportText?.title}</DialogTitle>
            <DialogDescription>Downloads are not available in this window. Copy the register below.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea aria-label={`${exportText?.title ?? "Register"} CSV`} readOnly value={exportText?.csv ?? ""} rows={12} className="font-mono text-mono" />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" icon={Users} onClick={() => setExportText(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  );
}
