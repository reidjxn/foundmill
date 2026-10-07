/**
 * Finance › Cap table (BUILD §11.8): holders (CRM entities), share classes, issuances with vesting, the option pool,
 * SAFEs and convertible notes; round modelling (pre-money + investment → pro forma with SAFE conversion and pool
 * top-up, labelled Estimate); Delaware stock ledger and Swedish aktiebok exports. Read-only here: issuances are
 * recorded by the legal lead with the founder's approval, never by this screen.
 */
import { useId, useMemo, useState } from "react";
import { Calculator, Download, ExternalLink, FileSpreadsheet, Landmark, PieChart, Users } from "lucide-react";
import { Button, Chip, DataTable, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EntityLink, Field, Input, KeyValueList, MiniTable, Panel, ProvenanceChip, StatusStrip, Textarea, formatDate, formatPercent, type ChipTone, type DataTableColumn, type MetricTileProps, type RowAction, type SavedView } from "@foundmill/dugout";
import type { EntityKind } from "@foundmill/shared";
import { routes, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { aktiebokRows, delawareLedgerRows, modelRound, safeTerms, toCsv, vestingSummary, type RoundInput } from "./metrics";
import { Screen, downloadText, fmtMoney, fmtQuantity, useCurrency, useNow } from "./shared";
import type { CapTableEntryRow, CapTableResponse, CapTableSummary, SecurityRow } from "./types";

const KIND_TONE: Record<SecurityRow["kind"], ChipTone> = { common: "neutral", preferred: "info", option: "kit", warrant: "info", safe: "gold", note: "gold" };
const KIND_WORD: Record<SecurityRow["kind"], string> = { common: "Common", preferred: "Preferred", option: "Option", warrant: "Warrant", safe: "SAFE", note: "Note" };

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
  { id: "all", name: "All holders", builtIn: true, columns: ["name", "kind", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [] },
  { id: "people", name: "People", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [{ id: "f-p", field: "kind", op: "in", value: ["person", "team_member"] }] },
  { id: "orgs", name: "Organisations", builtIn: true, columns: ["name", "quantity", "pct", "positions"], sort: [{ id: "quantity", desc: true }], filters: [{ id: "f-o", field: "kind", op: "eq", value: "organisation" }] },
];

export const ISSUANCE_VIEWS: SavedView[] = [
  { id: "all", name: "All issuances", builtIn: true, columns: ["holder", "class", "kind", "quantity", "price", "consideration", "issuedAt", "vesting"], sort: [{ id: "issuedAt", desc: true }], filters: [] },
  { id: "options", name: "Options and vesting", builtIn: true, columns: ["holder", "class", "quantity", "issuedAt", "vesting", "vestedPct"], sort: [{ id: "issuedAt", desc: true }], filters: [{ id: "f-opt", field: "kind", op: "eq", value: "option" }] },
  { id: "convertibles", name: "SAFEs and notes", builtIn: true, columns: ["holder", "class", "kind", "principal", "cap", "discount", "issuedAt"], sort: [{ id: "issuedAt", desc: true }], filters: [{ id: "f-conv", field: "kind", op: "in", value: ["safe", "note"] }] },
];

export function holderColumns(businessId: string): DataTableColumn<HolderRow>[] {
  return [
    { id: "name", accessorKey: "displayName", header: "Holder", size: 220, cell: ({ row }) => <EntityLink entity={{ id: row.original.holderEntityId, kind: holderKind(row.original.kind), name: row.original.displayName, href: routes.crm(businessId, row.original.holderEntityId) }} />, meta: { locked: true } },
    { id: "kind", accessorKey: "kind", header: "Kind", size: 110, cell: ({ getValue }) => <span className="text-secondary">{String(getValue()).replace("_", " ")}</span>, meta: { filter: "select", filterOptions: ["person", "organisation", "team_member"].map((k) => ({ value: k, label: k.replace("_", " ") })) } },
    { id: "quantity", accessorKey: "quantity", header: "Shares", size: 120, cell: ({ getValue }) => <span className="tabular-nums">{fmtQuantity(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "pct", accessorKey: "fullyDilutedPct", header: "Fully diluted", size: 110, cell: ({ getValue }) => <span className="text-body-strong text-primary tabular-nums">{formatPercent(getValue() as number, { ofHundred: true, digits: 2 })}</span>, meta: { numeric: true } },
    {
      id: "positions",
      accessorFn: (r) => r.positions.map((p) => `${p.class} ${p.quantity}`).join(", "),
      header: "Positions",
      size: 280,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {row.original.positions.map((p) => (
            <Chip key={p.securityId} tone="neutral" title={`${fmtQuantity(p.quantity)} ${p.class}`}>
              {p.class} · {fmtQuantity(p.quantity)}
            </Chip>
          ))}
        </span>
      ),
    },
  ];
}

export function issuanceColumns(businessId: string, securities: readonly SecurityRow[], now: Date): DataTableColumn<CapTableEntryRow>[] {
  const byId = new Map(securities.map((s) => [s.id, s]));
  return [
    { id: "holder", accessorFn: (r) => r.holder.displayName, header: "Holder", size: 200, cell: ({ row }) => <EntityLink entity={{ id: row.original.holderEntityId, kind: holderKind(row.original.holder.kind), name: row.original.holder.displayName, href: routes.crm(businessId, row.original.holderEntityId) }} hoverCard={false} />, meta: { locked: true } },
    { id: "class", accessorFn: (r) => r.security.class, header: "Class", size: 140, cell: ({ getValue }) => <span className="text-body-strong text-primary">{String(getValue())}</span>, meta: { filter: "select", filterOptions: securities.map((s) => ({ value: s.class, label: s.class })) } },
    { id: "kind", accessorFn: (r) => r.security.kind, header: "Kind", size: 100, cell: ({ getValue }) => <Chip tone={KIND_TONE[getValue() as SecurityRow["kind"]]}>{KIND_WORD[getValue() as SecurityRow["kind"]]}</Chip>, meta: { filter: "select", filterOptions: Object.entries(KIND_WORD).map(([value, label]) => ({ value, label })) } },
    { id: "quantity", accessorFn: (r) => Number(r.quantity), header: "Quantity", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{fmtQuantity(getValue() as number)}</span>, meta: { numeric: true } },
    { id: "price", accessorFn: (r) => r.priceMinor ?? 0, header: "Price", size: 100, cell: ({ row }) => <span className="tabular-nums">{row.original.priceMinor === null ? "—" : fmtMoney(row.original.priceMinor, row.original.currency)}</span>, meta: { numeric: true } },
    { id: "consideration", accessorFn: (r) => (r.priceMinor === null ? 0 : Math.round(r.priceMinor * Number(r.quantity))), header: "Consideration", size: 120, cell: ({ row }) => <span className="tabular-nums">{row.original.priceMinor === null ? "—" : fmtMoney(Math.round(row.original.priceMinor * Number(row.original.quantity)), row.original.currency)}</span>, meta: { numeric: true } },
    { id: "issuedAt", accessorFn: (r) => r.issuedAt ?? "", header: "Issued", size: 110, cell: ({ getValue }) => <span className="tabular-nums">{getValue() ? formatDate(String(getValue())) : "—"}</span>, meta: { filter: "date" } },
    { id: "vesting", accessorFn: (r) => vestingSummary(r.vesting, r.quantity, now)?.text ?? "", header: "Vesting", size: 180, cell: ({ getValue }) => <span className="text-secondary">{String(getValue()) || "Fully vested"}</span> },
    { id: "vestedPct", accessorFn: (r) => vestingSummary(r.vesting, r.quantity, now)?.vestedPct ?? 100, header: "Vested", size: 90, cell: ({ getValue }) => <span className="tabular-nums">{formatPercent(getValue() as number, { ofHundred: true, digits: 0 })}</span>, meta: { numeric: true } },
    { id: "principal", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.principalMinor ?? 0, header: "Principal", size: 110, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t ? fmtMoney(t.principalMinor, row.original.currency) : "—"}</span>; }, meta: { numeric: true } },
    { id: "cap", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.valuationCapMinor ?? 0, header: "Valuation cap", size: 120, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t?.valuationCapMinor ? fmtMoney(t.valuationCapMinor, row.original.currency, { compact: true }) : "—"}</span>; }, meta: { numeric: true } },
    { id: "discount", accessorFn: (r) => safeTerms(r, byId.get(r.securityId))?.discountPct ?? 0, header: "Discount", size: 90, cell: ({ row }) => { const t = safeTerms(row.original, byId.get(row.original.securityId)); return <span className="tabular-nums">{t && t.discountPct > 0 ? formatPercent(t.discountPct, { ofHundred: true, digits: 0 }) : "—"}</span>; }, meta: { numeric: true } },
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
  const hColumns = useMemo(() => holderColumns(businessId), [businessId]);
  const iColumns = useMemo(() => issuanceColumns(businessId, data?.securities ?? [], now), [businessId, data?.securities, now]);
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
    const pre = Number(round.preMoney);
    const inv = Number(round.investment);
    const pct = Number(round.poolPct);
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
  const emptyState = { icon: PieChart, title: "No cap table yet", children: "Once the company is incorporated the legal lead records the founders' shares, the option pool and any SAFEs here; holders are CRM entities.", action: { label: "Open Legal", icon: Landmark, onClick: () => navigate(routes.department(businessId, "legal", "entity")) } };

  return (
    <Screen name="finance/cap-table">
      <section aria-label="Cap table summary" className="col-span-12" aria-busy={cap.isLoading || undefined}>
        <StatusStrip tiles={tiles.map((t) => ({ ...t, loading: cap.isLoading }))} />
      </section>
      <Panel title="Holders" span={8} flush loading={cap.isLoading} error={cap.error ? cap.error.message : undefined} onRetry={cap.refetch} empty={empty ? emptyState : undefined} footer={<span className="tabular-nums">{holders.length} holders · fully diluted over {fmtQuantity(data?.summary.totalQuantity ?? 0)} shares · right-click for CRM and issuances</span>}>
        <DataTable<HolderRow> aria-label="Holders" data={holders} columns={hColumns} getRowId={(r) => r.holderEntityId} views={holderViews} onViewsChange={setHolderViews} defaultViewId="all" height={320} exportFileName="cap-table-holders" rowActions={holderActions} onRowOpen={(r) => navigate(routes.crm(businessId, r.holderEntityId))} rowClassName={(r) => (holderFilter === r.holderEntityId ? "bg-panel-alt" : undefined)} />
      </Panel>
      <Panel title="Classes" span={4} loading={cap.isLoading} error={cap.error ? cap.error.message : undefined} empty={empty ? "Share classes appear with the first issuance." : undefined} footer={<span>Options count toward fully diluted; SAFEs and notes are shown at principal until they convert.</span>}>
        <MiniTable<CapTableSummary["byClass"][number]>
          aria-label="Share classes"
          rows={data?.summary.byClass ?? []}
          getRowKey={(c) => c.securityId}
          columns={[
            { id: "class", header: "Class", cell: (c) => <span className="text-body-strong text-primary">{c.class}</span> },
            { id: "kind", header: "Kind", width: 90, cell: (c) => <Chip tone={KIND_TONE[c.kind]}>{KIND_WORD[c.kind]}</Chip> },
            { id: "issued", header: "Issued", numeric: true, width: 100, cell: (c) => <span className="tabular-nums">{fmtQuantity(c.quantity)}</span> },
            { id: "authorised", header: "Authorised", numeric: true, width: 100, cell: (c) => <span className="tabular-nums">{c.authorisedQuantity === null ? "—" : fmtQuantity(c.authorisedQuantity)}</span> },
            { id: "holders", header: "Holders", numeric: true, width: 70, cell: (c) => <span className="tabular-nums">{c.holders}</span> },
            { id: "pct", header: "FD %", numeric: true, width: 80, cell: (c) => <span className="tabular-nums">{formatPercent(c.fullyDilutedPct, { ofHundred: true, digits: 2 })}</span> },
          ]}
        />
      </Panel>
      <Panel
        title={holderFilter ? `Issuances · ${holders.find((h) => h.holderEntityId === holderFilter)?.displayName ?? "holder"}` : "Issuances"}
        span={12}
        flush
        loading={cap.isLoading}
        error={cap.error ? cap.error.message : undefined}
        onRetry={cap.refetch}
        empty={empty ? emptyState : undefined}
        actions={
          <div className="flex items-center gap-1">
            {holderFilter ? (
              <Button size="sm" variant="ghost" onClick={() => setHolderFilter(null)}>
                All holders
              </Button>
            ) : null}
            <Button size="sm" icon={Download} onClick={() => exportCsv("delaware")} disabled={!data}>
              Delaware stock ledger
            </Button>
            <Button size="sm" icon={Download} onClick={() => exportCsv("aktiebok")} disabled={!data}>
              Aktiebok
            </Button>
          </div>
        }
        footer={<span className="tabular-nums">{entries.length} issuances · versioned and audited{lastChange ? ` · last change ${formatDate(lastChange)}` : ""} · exports are CSV registers for Delaware (stock ledger) and Sweden (aktiebok)</span>}
      >
        <DataTable<CapTableEntryRow> aria-label="Issuances" data={entries} columns={iColumns} views={issuanceViews} onViewsChange={setIssuanceViews} defaultViewId="all" height={360} exportFileName="cap-table-issuances" rowActions={issuanceActions} onRowOpen={(r) => navigate(routes.crm(businessId, r.holderEntityId))} empty={holderFilter ? "No issuances for this holder." : undefined} />
      </Panel>
      <Panel title="Round modelling" span={12} loading={cap.isLoading} empty={empty ? "Model a round once the first shares are recorded." : undefined} actions={<ProvenanceChip kind="estimate" />} footer={<span>Post-money SAFEs convert first at principal ÷ cap (or at the discount when it gives more shares), the pool is topped up to the target, then new shares are priced at pre-money ÷ pre-round fully diluted. An estimate for discussion, not a term sheet.</span>}>
        <form className="grid grid-cols-12 gap-gutter" aria-label="Round inputs" onSubmit={(e) => e.preventDefault()}>
          <Field htmlFor={`${id}-pre`} label="Pre-money valuation" hint={cur} className="col-span-3">
            <Input id={`${id}-pre`} numeric inputMode="decimal" value={round.preMoney} placeholder="4,000,000" onChange={(e) => setRound((r) => ({ ...r, preMoney: e.target.value }))} />
          </Field>
          <Field htmlFor={`${id}-inv`} label="Investment" hint={cur} className="col-span-3">
            <Input id={`${id}-inv`} numeric inputMode="decimal" value={round.investment} placeholder="1,000,000" onChange={(e) => setRound((r) => ({ ...r, investment: e.target.value }))} />
          </Field>
          <Field htmlFor={`${id}-pool`} label="Option pool target" hint="% of post-money fully diluted" className="col-span-3">
            <Input id={`${id}-pool`} numeric inputMode="decimal" value={round.poolPct} onChange={(e) => setRound((r) => ({ ...r, poolPct: e.target.value }))} />
          </Field>
          <Field htmlFor={`${id}-class`} label="New class" className="col-span-3">
            <Input id={`${id}-class`} value={round.newClass} onChange={(e) => setRound((r) => ({ ...r, newClass: e.target.value }))} />
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
