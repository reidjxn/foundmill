"use client";
/**
 * Legal › Entity (BUILD §11.11): the operating legal entity's facts, its officers as CRM links, the incorporation
 * history, and the "Import existing company" form (registration number + country → legal.import.lookup →
 * confirm → legal.import.confirm, which makes officers CRM people, seeds the cap table and fills the compliance
 * calendar). Registry content is untrusted until the founder confirms it.
 */
import { useId, useMemo, useState } from "react";
import { Building2, Download, ExternalLink, Landmark, Search, Users } from "lucide-react";
import { Button, Chip, DataTable, EntityLink, Field, Input, KeyValueList, MiniTable, MoneyInput, Panel, SimpleSelect, Timeline, useFormatters, type DataTableColumn, type RowAction, type SavedView, type TimelineEvent } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { INCORPORATION_STATUS_WORD, ROUTE_META, entityTypeLabel, formatAddress, jurisdictionName, officerRows, readSteps, type OfficerRow } from "./legal-data";
import { DateText } from "../dates";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { ENTITY_STATUS_PILL, Fact, InlineError, Pill, Screen, fitTableHeight, fmtMoney, humanise, useAction, useCurrency, useLegalStatus, useNow } from "./shared";
import type { IncorporationRow, LookupResult, OfficersResponse } from "./types";

const OFFICERS_INPUT = { role: "officer", limit: 200 } as const;

export const OFFICER_VIEWS: SavedView[] = [
  { id: "all", name: "All officers", builtIn: true, columns: ["name", "role", "appointedOn", "crm"], sort: [{ id: "name", desc: false }], filters: [] },
  { id: "directors", name: "Directors", builtIn: true, columns: ["name", "role", "appointedOn", "crm"], sort: [{ id: "name", desc: false }], filters: [{ id: "f-dir", field: "role", op: "contains", value: "director" }] },
  { id: "unlinked", name: "Not in CRM yet", builtIn: true, columns: ["name", "role", "appointedOn"], sort: [{ id: "name", desc: false }], filters: [{ id: "f-crm", field: "crm", op: "eq", value: "no" }] },
];

/** What each column's content needs and its share of the spare width (the table is 647 px at 1280). */
export const OFFICER_FIT = {
  name: { min: 180, grow: 2 },
  role: { min: 140, grow: 1 },
  appointedOn: { min: 110 },
  crm: { min: 130 },
} satisfies Record<string, ColumnFit>;
export type OfficerColumnId = keyof typeof OFFICER_FIT;

export function officerColumns(businessId: string, sizes: Record<OfficerColumnId, number> = fitColumns<OfficerColumnId>(null, OFFICER_FIT, [])): DataTableColumn<OfficerRow>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: "Officer",
      size: sizes.name,
      cell: ({ row }) =>
        row.original.entityId ? (
          <EntityLink entity={{ id: row.original.entityId, kind: "person", name: row.original.name, href: routes.crm(businessId, row.original.entityId) }} />
        ) : (
          <span className="t-body-strong text-primary">{row.original.name}</span>
        ),
      meta: { locked: true },
    },
    { id: "role", accessorKey: "role", header: "Role", size: sizes.role, cell: ({ getValue }) => <span className="text-secondary">{humanise(String(getValue()))}</span>, meta: { filter: "text" } },
    { id: "appointedOn", accessorFn: (r) => r.appointedOn ?? "", header: "Appointed", size: sizes.appointedOn, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
    {
      id: "crm",
      accessorFn: (r) => (r.entityId ? "yes" : "no"),
      header: "CRM",
      size: sizes.crm,
      cell: ({ row }) => (row.original.entityId ? <Chip tone="good" className="whitespace-nowrap">In CRM</Chip> : <Chip tone="neutral" className="whitespace-nowrap">Not in CRM yet</Chip>),
      meta: { filter: "select", filterOptions: [{ value: "yes", label: "In CRM" }, { value: "no", label: "Not in CRM yet" }] },
    },
  ];
}

const COUNTRY_OPTIONS = [
  { value: "gb", label: "United Kingdom (Companies House)" },
  { value: "se", label: "Sweden (Bolagsverket)" },
  { value: "other", label: "Other (OpenCorporates)" },
];

const SOURCE_LABEL: Record<LookupResult["source"], string> = { companies_house: "Companies House", bolagsverket: "Bolagsverket", opencorporates: "OpenCorporates" };

export function historyEvents(history: readonly IncorporationRow[]): TimelineEvent[] {
  return history.flatMap((inc) => {
    const steps = readSteps(inc.steps);
    const base = inc.createdAt ?? inc.updatedAt ?? new Date(0).toISOString();
    const events: TimelineEvent[] = [{ id: `${inc.id}-start`, at: base, title: `${ROUTE_META[inc.route].label} started`, description: `Status ${INCORPORATION_STATUS_WORD[inc.status].toLowerCase()}`, tone: inc.status === "abandoned" ? "bad" : inc.status === "complete" ? "good" : "info" }];
    for (const s of steps) if (s.at) events.push({ id: `${inc.id}-${s.step}-${s.at}`, at: s.at, title: humanise(s.step), description: s.note, tone: s.step === "abandoned" ? "bad" : s.step === "complete" ? "good" : "neutral" });
    return events;
  });
}

export function EntityScreen({ businessId }: ModuleScreenProps) {
  const { formatDate } = useFormatters();
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const id = useId();
  const status = useLegalStatus();
  const officers = useWidgetQuery<OfficersResponse>("crm.roles.byRole", OFFICERS_INPUT);
  const action = useAction();
  const [views, setViews] = useState<SavedView[]>(OFFICER_VIEWS);
  const [country, setCountry] = useState<"gb" | "se" | "other">("gb");
  const [regNo, setRegNo] = useState("");
  const [jurisdictionCode, setJurisdictionCode] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [shareCapital, setShareCapital] = useState("");
  const [imported, setImported] = useState<{ officers: number; created: boolean } | null>(null);
  const [details, setDetails] = useState<{ regNo: string; formedAt: string }>({ regNo: "", formedAt: "" });

  const entity = status.data?.entity ?? null;
  const rows = useMemo(() => officerRows(entity, officers.data?.items), [entity, officers.data]);
  const columns = useMemo(() => fitToGrow(officerColumns(businessId), OFFICER_FIT), [businessId]);
  const events = useMemo(() => historyEvents(status.data?.history ?? []), [status.data?.history]);
  const loading = status.isLoading;
  const noEntity = !loading && !status.error && !entity;

  const canLookup = regNo.trim().length >= (country === "se" ? 6 : country === "gb" ? 2 : 1) && (country !== "other" || jurisdictionCode.trim().length >= 2);

  const runLookup = async () => {
    const input = country === "other" ? { country, jurisdictionCode: jurisdictionCode.trim().toLowerCase(), regNo: regNo.trim() } : { country, regNo: regNo.trim() };
    await action.run<LookupResult>("legal.import.lookup", input, {
      key: "lookup",
      then: (result) => {
        setLookup(result);
        setImported(null);
      },
    });
  };

  const confirmImport = async () => {
    if (!lookup) return;
    const capital = Number(shareCapital.replace(/[,\s£$€]/g, ""));
    await action.run<{ entity: unknown; people: string[]; created?: boolean }>(
      "legal.import.confirm",
      {
        source: lookup.source,
        legalName: lookup.legalName,
        regNo: lookup.regNo,
        jurisdiction: lookup.jurisdiction,
        entityType: lookup.entityType,
        formedAt: lookup.formedAt,
        registeredAddress: lookup.registeredAddress,
        officers: lookup.officers,
        shareCapitalMinor: shareCapital.trim() && Number.isFinite(capital) && capital >= 0 ? Math.round(capital * 100) : null,
        currency,
        deadlines: lookup.deadlines,
      },
      {
        key: "confirm",
        then: (r) => {
          setImported({ officers: r.people.length, created: r.created !== false });
          setLookup(null);
          setRegNo("");
          status.refetch();
          officers.refetch();
        },
      },
    );
  };

  // A company formed here has no registration number or formation date until the registry issues them.
  const missingDetails = !!entity && entity.status !== "forming" && (!entity.regNo || !entity.formedAt);
  const saveDetails = async () => {
    if (!entity) return;
    const regNoText = details.regNo.trim();
    await action.run("legal.entity.update", { legalEntityId: entity.id, ...(regNoText ? { regNo: regNoText } : {}), ...(details.formedAt ? { formedAt: details.formedAt } : {}) }, {
      key: "details",
      then: () => {
        setDetails({ regNo: "", formedAt: "" });
        status.refetch();
      },
    });
  };

  const officerActions = (row: OfficerRow): RowAction<OfficerRow>[] => [
    { id: "crm", label: "Open in CRM", icon: ExternalLink, disabled: !row.entityId, onSelect: (r) => r.entityId && navigate(routes.crm(businessId, r.entityId)) },
    { id: "search", label: "Find in CRM", icon: Search, onSelect: (r) => navigate(`${routes.crm(businessId)}?q=${encodeURIComponent(r.name)}`) },
  ];

  const facts = entity
    ? [
        { label: "Legal name", value: <span className="t-body-strong text-primary">{entity.legalName}</span> },
        { label: "Status", value: <Pill {...ENTITY_STATUS_PILL[entity.status]} /> },
        { label: "Jurisdiction", value: jurisdictionName(entity.jurisdiction) || "—" },
        { label: "Entity type", value: entityTypeLabel(entity.entityType) || "—" },
        { label: "Registration number", value: entity.regNo ?? "—", mono: true },
        { label: "Formed", value: entity.formedAt ? formatDate(entity.formedAt) : "Not yet formed" },
        { label: "Registered address", value: formatAddress(entity.registeredAddress) || "—" },
        { label: "Share capital", value: entity.shareCapitalMinor === null ? "—" : fmtMoney(entity.shareCapitalMinor, entity.currency || currency), numeric: true },
        { label: "Source", value: entity.source ? (SOURCE_LABEL[entity.source as LookupResult["source"]] ?? humanise(entity.source)) : "Entered by hand" },
      ]
    : [];

  return (
    <Screen name="legal/entity">
      <Panel
        title="Legal entity"
        span={8}
        loading={loading}
        error={status.error ? status.error.message : undefined}
        onRetry={status.refetch}
        empty={noEntity ? { icon: Building2, title: "No legal entity yet", children: "Import an existing company on the right, or start an incorporation on the Incorporate tab; the entity's facts appear here.", action: { label: "Incorporate", icon: Landmark, onClick: () => navigate(routes.department(businessId, "legal", "incorporate")) } } : undefined}
        footer={entity ? <span>Legal name and address feed the contract templates and the generated policies. Officers are CRM people with the officer role.</span> : undefined}
      >
        {entity ? <KeyValueList aria-label="Entity facts" items={facts} layout="grid" /> : null}
        {missingDetails ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-3 border-t border-subtle pt-3"
            aria-label="Registry details"
            onSubmit={(e) => {
              e.preventDefault();
              if ((details.regNo.trim() || details.formedAt) && action.pending !== "details") void saveDetails();
            }}
          >
            {!entity?.regNo ? (
              <Field htmlFor={`${id}-entity-regno`} label="Registration number" hint="From the registry's confirmation">
                <Input id={`${id}-entity-regno`} value={details.regNo} onChange={(e) => setDetails((d) => ({ ...d, regNo: e.target.value }))} maxLength={60} className="w-48" />
              </Field>
            ) : null}
            {!entity?.formedAt ? (
              <Field htmlFor={`${id}-entity-formed`} label="Date formed">
                <Input id={`${id}-entity-formed`} type="date" value={details.formedAt} max={now.toISOString().slice(0, 10)} onChange={(e) => setDetails((d) => ({ ...d, formedAt: e.target.value }))} />
              </Field>
            ) : null}
            <Button type="submit" icon={Download} disabled={!details.regNo.trim() && !details.formedAt} loading={action.pending === "details"}>
              Save details
            </Button>
          </form>
        ) : null}
      </Panel>

      <Panel
        title="Import existing company"
        span={4}
        footer={<span>Lookups read the public registry through the gateway. Nothing is written until you confirm; registry content is treated as untrusted until then.</span>}
      >
        <form
          className="flex flex-col gap-3"
          aria-label="Import existing company"
          onSubmit={(e) => {
            e.preventDefault();
            if (canLookup && action.pending !== "lookup") void runLookup();
          }}
        >
          <Field htmlFor={`${id}-country`} label="Country">
            <SimpleSelect id={`${id}-country`} options={COUNTRY_OPTIONS} value={country} onValueChange={(v) => setCountry(v as "gb" | "se" | "other")} aria-label="Country" />
          </Field>
          {country === "other" ? (
            <Field htmlFor={`${id}-jcode`} label="Jurisdiction code" hint="OpenCorporates code, e.g. de, fr, no, dk, fi, ee">
              <Input id={`${id}-jcode`} value={jurisdictionCode} onChange={(e) => setJurisdictionCode(e.target.value)} placeholder="de" maxLength={10} />
            </Field>
          ) : null}
          <Field htmlFor={`${id}-regno`} label="Registration number" hint={country === "gb" ? "Company number, e.g. 12345678" : country === "se" ? "Organisationsnummer, e.g. 5591234567" : "Company number in that registry"}>
            <Input id={`${id}-regno`} value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder={country === "gb" ? "12345678" : country === "se" ? "5591234567" : "HRB 123456"} maxLength={40} />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" icon={Search} disabled={!canLookup} loading={action.pending === "lookup"}>
              Look up
            </Button>
            {imported ? <Chip tone="good">{imported.created ? "Imported" : "Updated"} · {imported.officers} officer{imported.officers === 1 ? "" : "s"} in the CRM</Chip> : null}
          </div>
          <InlineError error={action.error} />
        </form>

        {lookup ? (
          <section aria-label="Lookup result" className="mt-3 flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-panel-pad">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="t-title text-primary">From {SOURCE_LABEL[lookup.source]}</p>
              <Chip tone="warn" className="whitespace-nowrap">
                Untrusted until confirmed
              </Chip>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Fact label="Legal name">{lookup.legalName}</Fact>
              <Fact label="Registration number" mono>
                {lookup.regNo}
              </Fact>
              <Fact label="Jurisdiction">{jurisdictionName(lookup.jurisdiction) || "—"}</Fact>
              <Fact label="Entity type">{entityTypeLabel(lookup.entityType) || "—"}</Fact>
              <Fact label="Status">{lookup.status ? humanise(lookup.status) : "—"}</Fact>
              <Fact label="Formed">{lookup.formedAt ? formatDate(lookup.formedAt) : "—"}</Fact>
            </div>
            <Fact label="Registered address">{formatAddress(lookup.registeredAddress) || "—"}</Fact>
            {lookup.officers.length ? (
              <MiniTable<LookupResult["officers"][number]>
                aria-label="Officers found"
                rows={lookup.officers}
                getRowKey={(o, i) => `${i}-${o.name}`}
                maxRows={8}
                columns={[
                  { id: "name", header: "Officer", cell: (o) => <span className="t-body-strong text-primary">{o.name}</span> },
                  { id: "role", header: "Role", width: 140, cell: (o) => <span className="text-secondary">{humanise(o.role)}</span> },
                  { id: "appointed", header: "Appointed", width: 110, cell: (o) => <span className="tabular-nums">{o.appointedOn ? formatDate(o.appointedOn) : "—"}</span> },
                ]}
                caption={<span>{lookup.officers.length} officer{lookup.officers.length === 1 ? "" : "s"} become CRM people on confirm</span>}
              />
            ) : (
              <p className="t-small text-secondary">No officers in this registry record; add them in the CRM afterward.</p>
            )}
            {lookup.deadlines.length ? (
              <p className="t-small text-secondary">
                Deadlines found: {lookup.deadlines.map((d) => `${humanise(d.kind)} ${formatDate(d.dueAt)}`).join(" · ")} — they fill the compliance calendar on confirm.
              </p>
            ) : null}
            <Field htmlFor={`${id}-capital`} label="Share capital" hint="Optional; seeds the cap table as one ordinary class">
              <MoneyInput id={`${id}-capital`} controlSize="lg" currency={currency} value={shareCapital} onValueChange={setShareCapital} placeholder="25,000" />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="button" variant="primary" icon={Download} onClick={() => void confirmImport()} loading={action.pending === "confirm"}>
                Confirm and import
              </Button>
              <Button type="button" variant="ghost" onClick={() => setLookup(null)}>
                Discard
              </Button>
            </div>
            <p className="t-small text-secondary">Checked {formatDate(lookup.checkedAt)} · {now.getUTCFullYear()} registry data</p>
          </section>
        ) : null}
      </Panel>

      <Panel
        title="Officers"
        span={8}
        flush
        loading={loading || officers.isLoading}
        error={officers.error ? officers.error.message : undefined}
        onRetry={officers.refetch}
        empty={!loading && !officers.isLoading && rows.length === 0 ? { icon: Users, children: "Officers appear once a company is imported or formed; each becomes a CRM person with the officer role." } : undefined}
        meta={rows.length ? `${rows.length} officer${rows.length === 1 ? "" : "s"}` : undefined}
        footer={<span>Right-click an officer to open them in the CRM.</span>}
      >
        <div className="min-w-0">
          <DataTable<OfficerRow> aria-label="Officers" data={rows} columns={columns} getRowId={(r) => r.key} views={views} onViewsChange={setViews} defaultViewId="all" height={fitTableHeight(rows.length, { minRows: 3, maxRows: 10 })} exportFileName="officers" rowActions={officerActions} onRowOpen={(r) => r.entityId && navigate(routes.crm(businessId, r.entityId))} />
        </div>
      </Panel>

      <Panel title="History" span={4} loading={loading} empty={!loading && events.length === 0 ? "Incorporation and import events appear here." : undefined}>
        <Timeline aria-label="Entity history" events={events} now={now} order="desc" />
      </Panel>
    </Screen>
  );
}
