"use client";
/**
 * Finance › Cap table (BUILD §11.8): holders (CRM entities), share classes, issuances with vesting, the option pool,
 * SAFEs and convertible notes; round modelling (pre-money + investment → pro forma with SAFE conversion and pool
 * top-up, labelled Estimate); Delaware stock ledger and Swedish aktiebok exports. Read-only here: issuances are
 * recorded by the legal lead with the founder's approval, never by this screen.
 */
import { useId, useMemo, useState } from "react";
import { Calculator, Download, ExternalLink, FileSpreadsheet, Landmark, PieChart, Users } from "lucide-react";
import { Button, Chip, DataTable, cn, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Explainer, Field, Input, KeyValueList, MiniTable, MoneyInput, Panel, ProvenanceChip, StatusStrip, Term, Textarea, formatPercent, useFormatters, type ChipTone, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import { moduleTabHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleScreenProps } from "../registry";
import { aktiebokRows, delawareLedgerRows, entryCurrency, holderKindWord, modelRound, safeTerms, toCsv, vestingSummary, type RoundInput } from "./metrics";
import { DateText } from "../dates";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { SIMPLE_VIEW_ID, Screen, downloadText, fmtMoney, fmtQuantity, parseAmount, useCurrency, useDefaultViewId, useNow } from "./shared";
import type { CapTableEntryRow, CapTableResponse, CapTableSummary, SecurityRow } from "./types";

/** The tab's intro while guidance is on (UX plan §7.14: "Who owns what share of the company"). */
export const CAP_TABLE_EXPLAINER = {
  screenId: "finance/cap-table",
  purpose: "Who owns what share of the company.",
  action: "Read the holders and their classes; model a priced round below to see how a raise would change the shares.",
  watchFor: "SAFEs and notes are not shares until a round converts them; the round model is an Estimate, not a term sheet.",
} as const;

const KIND_TONE: Record<SecurityRow["kind"], ChipTone> = { common: "neutral", preferred: "info", option: "kit", warrant: "info", safe: "gold", note: "gold" };
const KIND_WORD: Record<SecurityRow["kind"], string> = { common: "Common", preferred: "Preferred", option: "Option", warrant: "Warrant", safe: "SAFE", note: "Note" };
const CONVERSION_WORD: Record<"cap" | "discount" | "price", string> = { cap: "at the valuation cap", discount: "at the discount", price: "at the round price" };

export function holderKind(kind: string): EntityKind {
  return kind === "organisation" || kind === "person" || kind === "team_member" || kind === "agent" ? kind : "person";
}

export type HolderRow = CapTableSummary["byHolder"][number] & { kind: string };

export function holderRows(data: CapTableResponse | undefined): HolderRow[] {
  if (!data) return [];
  const kinds = new Map(data.entries.map((e) => [e.holderEntityId, e.holder.kind]));
  return data.summary.byHolder.map((h) => ({ ...h, kind: kinds.get(h.holderEntityId) ?? "person" }));
}

export const HOLDER_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): who holds what share; it opens first while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["name", "kind", "quantity", "pct"], sort: [{ id: "quantity", desc: true }], filters: [] },
  { id: "all", name: "All holders", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [] },
  { id: "kinds", name: "Holders by kind", builtIn: true, columns: ["name", "kind", "quantity", "pct"], sort: [{ id: "kind", desc: false }], filters: [] },
  { id: "people", name: "People", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [{ id: "f-p", field: "kind", op: "in", value: ["person", "team_member"] }] },
  { id: "orgs", name: "Organizations", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [{ id: "f-o", field: "kind", op: "eq", value: "organisation" }] },
];

export const ISSUANCE_VIEWS: SavedView[] = [
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["holder", "class", "quantity", "issuedAt"], sort: [{ id: "issuedAt", desc: true }], filters: [] },
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
  issuedAt: { min: 112 },
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
    { id: "kind", accessorKey: "kind", header: "Kind", size: sizes.kind, cell: ({ getValue }) => <span className="text-secondary">{holderKindWord(String(getValue()))}</span>, meta: { filter: "select", filterOptions: ["person", "organisation", "team_member"].map((k) => ({ value: k, label: holderKindWord(k) })) } },
    { id: "quantity", accessorKey: "quantity", header: "Shares", size: sizes.quantity, cell: ({ getValue }) => <span className="tabular-nums">{fmtQuantity(getValue() as number)}</span>, meta: { numeric: true } },
    {
      id: "pct",
      accessorFn: (r) => r.fullyDilutedPct ?? -1,
      header: "Fully diluted",
      size: sizes.pct,
      // A holder of SAFEs or notes alone has no shares until a priced round converts them (see round modeling).
      cell: ({ row }) =>
        row.original.fullyDilutedPct === null ? (
          <span className="text-secondary" title="SAFEs and notes are not shares until a priced round converts them">
            Not converted
          </span>
        ) : (
          <span className="text-body-strong text-primary tabular-nums">{formatPercent(row.original.fullyDilutedPct, { ofHundred: true, digits: 2 })}</span>
        ),
      meta: { numeric: true },
    },
    {
      id: "positions",
      accessorFn: (r) => r.positions.map((p) => `${p.class} ${p.quantity}`).join(", "),
      header: "Classes held",
      size: sizes.positions,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {row.original.positions.map((p) => (
            <Chip key={p.securityId} tone="neutral" className="shrink-0 whitespace-nowrap" title={p.convertible ? `${p.class}, converts at the next priced round` : `${fmtQuantity(p.quantity)} ${p.class}`}>
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
  // Prices and principals are denominated in their share class's currency (an entry's own column may say otherwise).
  const currencyOf = (r: CapTableEntryRow) => entryCurrency(r, byId.get(r.securityId));
  return [
    { id: "holder", accessorFn: (r) => r.holder.displayName, header: "Holder", size: sizes.holder, cell: ({ row }) => <EntityLink entity={{ id: row.original.holderEntityId, kind: holderKind(row.original.holder.kind), name: row.original.holder.displayName, href: routes.crm(businessId, row.original.holderEntityId) }} hoverCard={false} />, meta: { locked: true } },
    { id: "class", accessorFn: (r) => r.security.class, header: "Class", size: sizes.class, cell: ({ getValue }) => <span className="text-body-strong text-primary">{String(getValue())}</span>, meta: { filter: "select", filterOptions: securities.map((s) => ({ value: s.class, label: s.class })) } },
    { id: "kind", accessorFn: (r) => r.security.kind, header: "Kind", size: sizes.kind, cell: ({ getValue }) => <Chip tone={KIND_TONE[getValue() as SecurityRow["kind"]]} className="whitespace-nowrap">{KIND_WORD[getValue() as SecurityRow["kind"]]}</Chip>, meta: { filter: "select", filterOptions: Object.entries(KIND_WORD).map(([value, label]) => ({ value, label })) } },
    { id: "quantity", accessorFn: (r) => Number(r.quantity), header: "Quantity", size: sizes.quantity, cell: ({ getValue }) => <span className="tabular-nums">{fmtQuantity(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "price", accessorFn: (r) => r.priceMinor ?? 0, header: "Price", size: sizes.price, cell: ({ row }) => <span className="tabular-nums">{row.original.priceMinor === null ? "—" : fmtMoney(row.original.priceMinor, currencyOf(row.original))}</span>, meta: { numeric: true } },
    { id: "consideration", accessorFn: (r) => (r.priceMinor === null ? 0 : Math.round(r.priceMinor * Number(r.quantity))), header: "Consideration", size: sizes.consideration, cell: ({ row }) => <span className="tabular-nums">{row.original.priceMinor === null ? "—" : fmtMoney(Math.round(row.original.priceMinor * Number(row.original.quantity)), currencyOf(row.original))}</span>, meta: { numeric: true } },
    { id: "issuedAt", accessorFn: (r) => r.issuedAt ?? "", header: "Issued", size: sizes.issuedAt, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
    { id: "vesting", accessorFn: (r) => vestingSummary(r.vesting, r.quantity, now, r.issuedAt)?.text ?? "", header: "Vesting", size: sizes.vesting, cell: ({ getValue }) => <span className="text-secondary">{String(getValue()) || "Fully vested"}</span> },
    {
      id: "vestedPct",
      // No schedule: vested at issue. A schedule with no start date: unknown, never "100%".
      accessorFn: (r) => {
        const v = vestingSummary(r.vesting, r.quantity, now, r.issuedAt);
        return v ? (v.vestedPct ?? -1) : 100;
      },
      header: "Vested",
      size: sizes.vestedPct,
      cell: ({ getValue }) => <span className="tabular-nums">{(getValue() as number) < 0 ? "—" : formatPercent(getValue() as number, { ofHundred: true, digits: 0 })}</span>,
      meta: { numeric: true },
    },
    { id: "principal", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.principalMinor ?? 0, header: "Principal", size: sizes.principal, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t ? fmtMoney(t.principalMinor, currencyOf(row.original)) : "—"}</span>; }, meta: { numeric: true } },
    { id: "cap", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.valuationCapMinor ?? 0, header: "Valuation cap", size: sizes.cap, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t?.valuationCapMinor ? fmtMoney(t.valuationCapMinor, currencyOf(row.original), { compact: true }) : "—"}</span>; }, meta: { numeric: true } },
    { id: "discount", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.discountPct ?? 0, header: "Discount", size: sizes.discount, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t && t.discountPct > 0 ? formatPercent(t.discountPct, { ofHundred: true, digits: 0 }) : "—"}</span>; }, meta: { numeric: true } },
  ];
}

export function CapTableScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const { formatDate } = useFormatters();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const departments = useDepartments();
  const id = useId();
  const cap = useWidgetQuery<CapTableResponse>("finance.capTable.get", {});
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance is on.
  const defaultViewId = useDefaultViewId("all");
  const holderSavedViews = useSavedViews("finance.cap-table.holders", HOLDER_VIEWS, { defaultViewId });
  const issuanceSavedViews = useSavedViews("finance.cap-table.issuances", ISSUANCE_VIEWS, { defaultViewId });
  const [holderFilter, setHolderFilter] = useState<string | null>(null);
  const [round, setRound] = useState<{ preMoney: string; investment: string; poolPct: string; newClass: string }>({ preMoney: "", investment: "", poolPct: "10", newClass: "Series Seed Preferred" });
  const [exportText, setExportText] = useState<{ title: string; csv: string } | null>(null);

  const data = cap.data;
  const cur = data?.securities[0]?.currency || data?.entries[0]?.currency || currency;
  const holders = useMemo(() => holderRows(data), [data]);
  const entries = useMemo(() => (data?.entries ?? []).filter((e) => !e.archivedAt && (!holderFilter || e.holderEntityId === holderFilter)), [data, holderFilter]);
  // Both tables share their spare width by the fit specs' weights themselves (DataTable `meta.grow`).
  const hColumns = useMemo(() => fitToGrow(holderColumns(businessId), HOLDER_FIT), [businessId]);
  const iColumns = useMemo(() => fitToGrow(issuanceColumns(businessId, data?.securities ?? [], now), ISSUANCE_FIT), [businessId, data?.securities, now]);
  const pool = useMemo(() => {
    const classes = data?.summary.byClass.filter((c) => c.kind === "option") ?? [];
    const authorised = classes.reduce((n, c) => n + (c.authorisedQuantity ?? 0), 0);
    const issued = classes.reduce((n, c) => n + c.quantity, 0);
    return { authorised, issued, available: Math.max(0, authorised - issued) };
  }, [data]);
  const convertibles = useMemo(() => {
    const byId = new Map((data?.securities ?? []).map((s) => [s.id, s]));
    return (data?.entries ?? []).filter((e) => !e.archivedAt).map((e) => ({ securityId: e.securityId, currency: entryCurrency(e, byId.get(e.securityId)), terms: safeTerms(e, byId.get(e.securityId)) })).filter((c): c is { securityId: string; currency: string; terms: NonNullable<ReturnType<typeof safeTerms>> } => !!c.terms);
  }, [data]);
  const convertiblePrincipal = convertibles.reduce((n, c) => n + c.terms.principalMinor, 0);
  const principalOfClass = (securityId: string) => convertibles.filter((c) => c.securityId === securityId).reduce((n, c) => n + c.terms.principalMinor, 0);
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
    const rows = which === "delaware" ? delawareLedgerRows(data.entries, now, data.securities) : aktiebokRows(data.entries, data.securities);
    const csv = toCsv(rows);
    const title = which === "delaware" ? "Delaware stock ledger" : "Aktiebok";
    if (!downloadText(`${which}-${now.toISOString().slice(0, 10)}.csv`, csv)) setExportText({ title, csv });
  };

  // Each tile's plain line while guidance is on (PlainFigure): what the figure is, before where it comes from.
  const tiles: MetricTileProps[] = [
    { label: "Fully diluted shares", value: data?.summary.totalQuantity ?? null, format: "integer", plain: "Every share that exists today or that an option could become.", provenance: { source: "Cap table entries: every issued share and option", query: "finance.capTable.get", note: "SAFEs and convertible notes are left out until a priced round converts them; round modeling shows the shares they would convert into (Estimate)." } },
    { label: "Holders", value: holders.length, format: "integer", plain: "People and organizations that own a share of the company.", provenance: { source: "Distinct holder entities in the CRM" } },
    { label: "Option pool", value: pool.authorised ? pool.available / pool.authorised : "—", format: "percent", plain: "The share of the options set aside for hires that is still unallocated.", caption: pool.authorised ? `${fmtQuantity(pool.available)} of ${fmtQuantity(pool.authorised)} unallocated` : "No option class yet", provenance: { source: "Authorized option classes minus issued options", note: "The share of the pool still available to grant." } },
    { label: "Convertibles", value: { amountMinor: convertiblePrincipal, currency: cur }, plain: "Money invested that turns into shares at the next priced round.", caption: <>{convertibles.length} <Term id="safe">SAFE{convertibles.length === 1 ? "" : "s"}</Term> or note{convertibles.length === 1 ? "" : "s"} outstanding</>, provenance: { source: "Principal of post-money SAFEs and convertible notes", note: "Converts into shares at the next priced round (see round modeling)." } },
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
  const emptyState = { icon: PieChart, title: "No cap table yet", children: "The legal lead records the founders' shares here once the company is incorporated.", action: { label: "Open Legal", icon: Landmark, onClick: () => navigate(moduleTabHref(businessId, departments.data, "legal", "entity")) } };
  const quiet = (text: string, padded?: boolean) => <p className={cn("text-small text-secondary", padded && "px-panel-pad py-3")}>{text}</p>;

  return (
    <Screen name="finance/cap-table">
      <section aria-label="Cap table summary" className="col-span-12" aria-busy={cap.isLoading || undefined}>
        <StatusStrip tiles={tiles.map((t) => ({ ...t, loading: cap.isLoading }))} />
      </section>
      <Panel title={<Term id="cap_table">Holders</Term>} span={8} flush loading={cap.isLoading} error={cap.error ? cap.error.message : undefined} onRetry={cap.refetch} empty={empty ? emptyState : undefined} footer={empty ? undefined : <span className="tabular-nums">{holders.length} holder{holders.length === 1 ? "" : "s"} · fully diluted over {fmtQuantity(data?.summary.totalQuantity ?? 0)} shares · use the … button or right-click for CRM and issuances</span>}>
        {/* What the cap table is, in the tab's intro while guidance is on (UX plan §7.14). */}
        <Explainer {...CAP_TABLE_EXPLAINER} className="m-panel-pad mb-2" />
        <div className="min-w-0">
        <DataTable<HolderRow> aria-label="Holders" data={holders} columns={hColumns} getRowId={(r) => r.holderEntityId} {...holderSavedViews} defaultViewId={defaultViewId} height={320} exportFileName="cap-table-holders" rowActions={holderActions} onRowOpen={(r) => navigate(routes.crm(businessId, r.holderEntityId))} rowClassName={(r) => (holderFilter === r.holderEntityId ? "bg-panel-alt" : undefined)} />
        </div>
      </Panel>
      <Panel
        title="Classes"
        span={4}
        loading={cap.isLoading}
        error={cap.error ? cap.error.message : undefined}
        footer={
          empty ? undefined : (
            <span>
              Options count toward fully diluted; <Term id="safe">SAFEs</Term> and notes are shown at principal until they convert.
            </span>
          )
        }
      >
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
                {c.fullyDilutedPct === null ? null : (
                  <span className="ml-auto whitespace-nowrap text-body-strong text-primary tabular-nums" title="Fully diluted">
                    {formatPercent(c.fullyDilutedPct, { ofHundred: true, digits: 2 })}
                  </span>
                )}
              </div>
              <p className="text-small text-secondary tabular-nums">
                {c.convertible
                  ? `${fmtMoney(principalOfClass(c.securityId), convertibles.find((x) => x.securityId === c.securityId)?.currency ?? cur)} principal · converts at the next priced round`
                  : `${fmtQuantity(c.quantity)} issued${c.authorisedQuantity === null ? "" : ` of ${fmtQuantity(c.authorisedQuantity)} authorized`}`}{" "}
                · {c.holders} holder{c.holders === 1 ? "" : "s"}
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
        footer={
          empty ? undefined : (
            <span className="tabular-nums">
              Versioned and audited{lastChange ? ` · last change ${formatDate(lastChange)}` : ""} · <Term id="vesting">vesting</Term> shows how much of a grant its holder has earned so far · exports are CSV registers for Delaware (stock ledger) and Sweden (aktiebok)
            </span>
          )
        }
      >
        {empty ? (
          quiet("Each issuance and its vesting appear here once the first shares are recorded.", true)
        ) : (
          <div className="min-w-0">
          <DataTable<CapTableEntryRow> aria-label="Issuances" data={entries} columns={iColumns} {...issuanceSavedViews} defaultViewId={defaultViewId} height={360} exportFileName="cap-table-issuances" rowActions={issuanceActions} onRowOpen={(r) => navigate(routes.crm(businessId, r.holderEntityId))} empty={holderFilter ? "No issuances for this holder." : undefined} />
          </div>
        )}
      </Panel>
      <Panel title="Round modeling" span={12} loading={cap.isLoading} actions={empty ? undefined : <ProvenanceChip kind="estimate" />} footer={empty ? undefined : <span>Post-money SAFEs convert first at principal ÷ cap (or at the discount when it gives more shares), the pool is topped up to the target, then new shares are priced at pre-money ÷ pre-round fully diluted. An estimate for discussion, not a term sheet.</span>}>
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
                    { label: "SAFE shares", value: fmtQuantity(proForma.safeShares), numeric: true, hint: proForma.conversions.length ? undefined : "No convertibles" },
                    { label: "Pool top-up", value: fmtQuantity(proForma.poolTopUpShares), numeric: true },
                    { label: "Post-round FD", value: fmtQuantity(proForma.postRoundFullyDiluted), numeric: true },
                  ]}
                />
                {proForma.conversions.length ? (
                  // One wrapping line per conversion, under the figures (never squeezed into a figure's cell).
                  <ul aria-label="SAFE conversions" className="mt-2 flex flex-col gap-1 border-t border-line-faint pt-2 text-small text-secondary">
                    {proForma.conversions.map((c) => (
                      <li key={c.entryId} className="break-words">
                        <span className="text-primary">{c.holder}</span>: <span className="tabular-nums">{fmtQuantity(c.shares)}</span> shares {CONVERSION_WORD[c.method]}
                      </li>
                    ))}
                  </ul>
                ) : null}
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
