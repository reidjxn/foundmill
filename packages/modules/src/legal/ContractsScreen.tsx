"use client";
/**
 * Legal › Contracts (BUILD §11.11): the contract register as a DataTable with saved views and right-click lifecycle
 * verbs, a new-contract form, and the selected contract's detail with its obligations. Signing is founder-only:
 * the only signing control is a link-out to the e-signature envelope, and recording a signature needs owner/admin.
 */
import { useId, useMemo, useState } from "react";
import { ArrowRight, Ban, CheckCircle2, ExternalLink, FileSignature, FileText, Plus, UserRound } from "lucide-react";
import { Button, Chip, ConsequenceLine, DataTable, EntityLink, Field, Input, KeyValueList, MiniTable, MoneyInput, Panel, SimpleSelect, useFormatters, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleScreenProps } from "../registry";
import { CONTRACT_NEXT, CONTRACT_STATUS_WORD, contractKindLabel, isExternalHref, readObligations, type Obligation } from "./legal-data";
import { DateText } from "../dates";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { CONTRACT_PILL, FounderLinkOut, FounderOnlyChip, InlineError, Pill, SIMPLE_VIEW_ID, Screen, fitTableHeight, fmtMoney, useAction, useCurrency, useDefaultViewId, useNow } from "./shared";
import type { BusinessGetResponse, ContractRow, ContractStatus, ContractsListResponse } from "./types";

const CONTRACTS_INPUT = { limit: 200 } as const;
const BUSINESS_INPUT: Record<string, unknown> = {};

export const CONTRACT_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): the contract, who it is with, where it stands and when it ends; first while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["title", "counterparty", "status", "endsAt"], sort: [{ id: "updatedAt", desc: true }], filters: [] },
  { id: "active", name: "Active", builtIn: true, columns: ["title", "kind", "counterparty", "value", "endsAt", "obligations"], sort: [{ id: "endsAt", desc: false }], filters: [{ id: "f-act", field: "status", op: "in", value: ["signed", "active"] }] },
  { id: "signature", name: "Awaiting signature", builtIn: true, columns: ["title", "kind", "counterparty", "value", "status"], sort: [{ id: "updatedAt", desc: true }], filters: [{ id: "f-sig", field: "status", op: "eq", value: "awaiting_signature" }] },
  { id: "drafts", name: "Drafts and review", builtIn: true, columns: ["title", "kind", "counterparty", "status", "updatedAt"], sort: [{ id: "updatedAt", desc: true }], filters: [{ id: "f-dr", field: "status", op: "in", value: ["draft", "review"] }] },
  { id: "all", name: "All", builtIn: true, columns: ["title", "kind", "counterparty", "status", "value", "endsAt", "obligations"], sort: [{ id: "updatedAt", desc: true }], filters: [] },
];

/** What each column's content needs and its share of the spare width: every view fits the 980 px table at 1280. */
export const CONTRACT_FIT = {
  title: { min: 190, grow: 3 },
  kind: { min: 120 },
  counterparty: { min: 170, grow: 2 },
  status: { min: 160 },
  value: { min: 104 },
  startsAt: { min: 112 },
  endsAt: { min: 112 },
  obligations: { min: 136 },
  updatedAt: { min: 112 },
} satisfies Record<string, ColumnFit>;
export type ContractColumnId = keyof typeof CONTRACT_FIT;

/** While a contract is open beside the table (8 of 12 columns), the table keeps the columns that identify a row. */
export const CONTRACT_COLUMNS_BESIDE_DETAIL: readonly ContractColumnId[] = ["title", "counterparty", "status", "value"];

const CONTRACT_KINDS = ["customer", "supplier", "nda", "employment", "contractor", "advisor", "lease", "partnership", "investment", "other"] as const;
const KIND_OPTIONS = CONTRACT_KINDS.map((k) => ({ value: k, label: contractKindLabel(k) }));
const PROVIDER_OPTIONS = [
  { value: "dropbox_sign", label: "Dropbox Sign" },
  { value: "manual", label: "Signed on paper or by email" },
  { value: "other", label: "Other" },
];

const NEXT_LABEL: Partial<Record<ContractStatus, { label: string; icon: typeof ArrowRight; variant?: "default" | "danger" }>> = {
  draft: { label: "Back to draft", icon: FileText },
  review: { label: "Send for review", icon: ArrowRight },
  awaiting_signature: { label: "Mark awaiting signature", icon: FileSignature },
  active: { label: "Mark active", icon: CheckCircle2 },
  expired: { label: "Mark expired", icon: Ban },
  terminated: { label: "Terminate", icon: Ban, variant: "danger" },
};

/** What ending a contract does, under its button (UX plan §6.2 ConsequenceLine, principle 6); always shown. */
export const TERMINATE_CONSEQUENCE = { consequence: "The contract ends here and its obligations stop being tracked; the other side is not told by the product.", reversible: false } as const;

export function contractColumns(businessId: string, currency: string, now: Date, sizes: Record<ContractColumnId, number> = fitColumns<ContractColumnId>(null, CONTRACT_FIT, [])): DataTableColumn<ContractRow>[] {
  return [
    { id: "title", accessorFn: (r) => r.title || contractKindLabel(r.kind), header: "Contract", size: sizes.title, cell: ({ row }) => <span className="t-body-strong text-primary">{row.original.title || `${contractKindLabel(row.original.kind)} agreement`}</span>, meta: { locked: true } },
    { id: "kind", accessorFn: (r) => contractKindLabel(r.kind), header: "Kind", size: sizes.kind, cell: ({ getValue }) => <Chip tone="neutral" className="whitespace-nowrap">{String(getValue())}</Chip>, meta: { filter: "select", filterOptions: KIND_OPTIONS.map((o) => ({ value: o.label, label: o.label })), csv: (r) => contractKindLabel(r.kind) } },
    {
      id: "counterparty",
      accessorFn: (r) => r.counterparty?.displayName ?? "",
      header: "Other side",
      size: sizes.counterparty,
      cell: ({ row }) => (row.original.counterparty ? <EntityLink entity={{ id: row.original.counterparty.id, kind: "organisation", name: row.original.counterparty.displayName, href: routes.crm(businessId, row.original.counterparty.id) }} hoverCard={false} /> : <span className="text-secondary">—</span>),
      meta: { filter: "text" },
    },
    { id: "status", accessorKey: "status", header: "Status", size: sizes.status, cell: ({ row }) => <Pill {...CONTRACT_PILL[row.original.status]} />, meta: { filter: "select", filterOptions: Object.entries(CONTRACT_STATUS_WORD).map(([value, label]) => ({ value, label })) } },
    { id: "value", accessorFn: (r) => r.valueMinor ?? 0, header: "Value", size: sizes.value, cell: ({ row }) => <span className="tabular-nums">{row.original.valueMinor === null ? "—" : fmtMoney(row.original.valueMinor, row.original.currency || currency)}</span>, meta: { numeric: true } },
    { id: "startsAt", accessorFn: (r) => r.startsAt ?? "", header: "Starts", size: sizes.startsAt, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
    { id: "endsAt", accessorFn: (r) => r.endsAt ?? "", header: "Ends", size: sizes.endsAt, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
    { id: "obligations", accessorFn: (r) => readObligations(r.obligations, now).filter((o) => o.status !== "met").length, header: "Open obligations", size: sizes.obligations, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>, meta: { numeric: true } },
    { id: "updatedAt", accessorFn: (r) => (r.updatedAt ? new Date(r.updatedAt).toISOString() : ""), header: "Updated", size: sizes.updatedAt, cell: ({ getValue }) => <DateText className="tabular-nums" value={getValue() ? String(getValue()) : null} />, meta: { filter: "date" } },
  ];
}

export function obligationColumns() {
  return [
    { id: "title", header: "Obligation", cell: (o: Obligation) => <span className="t-body-strong text-primary">{o.title}</span> },
    { id: "party", header: "Owed by", width: 100, cell: (o: Obligation) => <span className="text-secondary">{o.party === "us" ? "Us" : o.party === "them" ? "Them" : "Both"}</span> },
    { id: "due", header: "Due", width: 110, cell: (o: Obligation) => <DateText className="tabular-nums" value={o.dueAt} /> },
    { id: "status", header: "Status", width: 110, cell: (o: Obligation) => <Pill tone={o.status === "met" ? "good" : o.status === "overdue" ? "bad" : "neutral"} word={o.status === "met" ? "Met" : o.status === "overdue" ? "Overdue" : "Open"} /> },
  ];
}

export function ContractsScreen({ businessId }: ModuleScreenProps) {
  const { formatDate } = useFormatters();
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const id = useId();
  const list = useWidgetQuery<ContractsListResponse>("legal.contracts.list", CONTRACTS_INPUT);
  const business = useWidgetQuery<BusinessGetResponse>("business.get", BUSINESS_INPUT);
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance is on.
  const defaultViewId = useDefaultViewId("all");
  const savedViews = useSavedViews("legal.contracts", CONTRACT_VIEWS, { defaultViewId });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useWidgetQuery<ContractRow>("legal.contracts.get", selectedId ? { contractId: selectedId } : undefined, { enabled: !!selectedId });
  const action = useAction();
  const create = useAction();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ kind: "customer", title: "", value: "", startsAt: "", endsAt: "", docRef: "" });
  const [provider, setProvider] = useState("dropbox_sign");

  useBusinessEvents(() => list.refetch(), ["contract.signed"]);

  const rows = useMemo(() => (list.data?.items ?? []).filter((c) => !c.archivedAt), [list.data]);
  // The table shares its spare width by the fit specs' weights itself (DataTable `meta.grow`), for whichever columns show.
  const columns = useMemo(() => fitToGrow(contractColumns(businessId, currency, now), CONTRACT_FIT).filter((c) => !selectedId || CONTRACT_COLUMNS_BESIDE_DETAIL.includes(c.id as ContractColumnId)), [businessId, currency, now, selectedId]);
  const selected = useMemo(() => (selectedId ? ({ ...(rows.find((r) => r.id === selectedId) ?? {}), ...(detail.data ?? {}) } as ContractRow | undefined) : undefined), [rows, selectedId, detail.data]);
  const selectedRow = selected && selected.id ? selected : undefined;
  const obligations = useMemo(() => readObligations(selectedRow?.obligations, now), [selectedRow, now]);
  const isAdmin = business.data ? business.data.role === "owner" || business.data.role === "admin" : false;
  const empty = !list.isLoading && !list.error && rows.length === 0;

  const setStatus = async (contract: ContractRow, status: ContractStatus, opts: { provider?: string } = {}) => {
    await action.run("legal.contracts.setStatus", { contractId: contract.id, status, provider: opts.provider ?? "manual" }, {
      key: `${contract.id}:${status}`,
      then: () => {
        list.refetch();
        if (selectedId === contract.id) detail.refetch();
      },
    });
  };

  const rowActions = (row: ContractRow): RowAction<ContractRow>[] => {
    const moves = CONTRACT_NEXT[row.status].filter((s) => s !== "signed");
    return [
      { id: "open", label: "Open", icon: FileText, onSelect: (r) => setSelectedId(r.id) },
      { id: "crm", label: "Open the other side in CRM", icon: ExternalLink, disabled: !row.counterpartyEntityId, onSelect: (r) => r.counterpartyEntityId && navigate(routes.crm(businessId, r.counterpartyEntityId)) },
      ...moves.map((s, i) => {
        const meta = NEXT_LABEL[s];
        return { id: `to-${s}`, label: meta?.label ?? `Move to ${CONTRACT_STATUS_WORD[s].toLowerCase()}`, icon: meta?.icon, variant: meta?.variant, separatorBefore: i === 0, onSelect: (r: ContractRow) => void setStatus(r, s) } satisfies RowAction<ContractRow>;
      }),
    ];
  };

  const canCreate = form.title.trim().length > 0 || form.kind.length > 0;
  const submitCreate = async () => {
    const value = Number(form.value.replace(/[,\s£$€]/g, ""));
    await create.run<ContractRow>(
      "legal.contracts.create",
      {
        kind: form.kind,
        title: form.title.trim(),
        valueMinor: form.value.trim() && Number.isFinite(value) ? Math.round(value * 100) : null,
        currency,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        docRef: form.docRef.trim() || null,
        obligations: [],
      },
      {
        then: (c) => {
          setShowForm(false);
          setForm({ kind: "customer", title: "", value: "", startsAt: "", endsAt: "", docRef: "" });
          list.refetch();
          if (c?.id) setSelectedId(c.id);
        },
      },
    );
  };

  const emptyState = { icon: FileText, title: "No contracts yet", children: "Contracts the legal lead drafts from the template library appear here with their obligations; add one by hand to track an agreement you already have.", action: { label: "New contract", icon: Plus, onClick: () => setShowForm(true) } };

  return (
    <Screen name="legal/contracts">
      <Panel
        title="Contracts"
        span={selectedRow ? 8 : 12}
        flush
        loading={list.isLoading}
        error={list.error ? list.error.message : undefined}
        onRetry={list.refetch}
        empty={empty && !showForm ? emptyState : undefined}
        actions={
          <Button size="sm" icon={Plus} onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
            New contract
          </Button>
        }
        meta={rows.length ? `${rows.length} contract${rows.length === 1 ? "" : "s"}` : undefined}
        footer={<span>Right-click a contract to move it along its lifecycle. Signing is yours alone.</span>}
      >
        {showForm ? (
          <form
            aria-label="New contract"
            className="grid grid-cols-12 gap-3 border-b border-subtle p-panel-pad"
            onSubmit={(e) => {
              e.preventDefault();
              if (canCreate && create.pending === null) void submitCreate();
            }}
          >
            <Field htmlFor={`${id}-kind`} label="Kind" className="col-span-2">
              <SimpleSelect id={`${id}-kind`} options={KIND_OPTIONS} value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))} aria-label="Kind" />
            </Field>
            <Field htmlFor={`${id}-title`} label="Title" className="col-span-4">
              <Input id={`${id}-title`} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Master services agreement" maxLength={200} />
            </Field>
            <Field htmlFor={`${id}-value`} label="Value" className="col-span-2">
              <MoneyInput id={`${id}-value`} controlSize="md" currency={currency} value={form.value} onValueChange={(v) => setForm((f) => ({ ...f, value: v }))} placeholder="12,000" />
            </Field>
            <Field htmlFor={`${id}-starts`} label="Starts" className="col-span-2">
              <Input id={`${id}-starts`} type="date" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
            </Field>
            <Field htmlFor={`${id}-ends`} label="Ends" className="col-span-2">
              <Input id={`${id}-ends`} type="date" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
            </Field>
            <Field htmlFor={`${id}-doc`} label="Document link" hint="Drive, Notion or the e-signature envelope" className="col-span-8">
              <Input id={`${id}-doc`} value={form.docRef} onChange={(e) => setForm((f) => ({ ...f, docRef: e.target.value }))} placeholder="https://" maxLength={2048} />
            </Field>
            <div className="col-span-4 flex items-end justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" icon={Plus} loading={create.pending !== null} disabled={!canCreate}>
                Add contract
              </Button>
            </div>
            <InlineError error={create.error} className="col-span-12" />
          </form>
        ) : null}
        <div className="min-w-0">
          <DataTable<ContractRow> aria-label="Contracts" data={rows} columns={columns} {...savedViews} defaultViewId={defaultViewId} hideEmptyColumns height={fitTableHeight(rows.length, { minRows: showForm ? 4 : 6, maxRows: 16 })} exportFileName="contracts" rowActions={rowActions} onRowOpen={(r) => setSelectedId(r.id)} rowClassName={(r) => (r.id === selectedId ? "row-selected" : undefined)} />
        </div>
        <InlineError error={action.error} className="px-panel-pad py-1" />
      </Panel>

      {selectedRow ? (
        <Panel
          title={selectedRow.title || `${contractKindLabel(selectedRow.kind)} agreement`}
          span={4}
          loading={detail.isLoading && !detail.data}
          error={detail.error ? detail.error.message : undefined}
          onRetry={detail.refetch}
          actions={
            <div className="flex items-center gap-1">
              <Pill {...CONTRACT_PILL[selectedRow.status]} />
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                Close
              </Button>
            </div>
          }
          footer={<span>Obligations are tracked from the contract's terms; the Contract Review agent raises deviations from the playbook as Inbox decisions.</span>}
        >
          <KeyValueList
            aria-label="Contract facts"
            dense
            layout="grid"
            items={[
              { label: "Kind", value: contractKindLabel(selectedRow.kind) },
              { label: "Other side", value: selectedRow.counterparty ? <EntityLink entity={{ id: selectedRow.counterparty.id, kind: "organisation", name: selectedRow.counterparty.displayName, href: routes.crm(businessId, selectedRow.counterparty.id) }} /> : "—" },
              { label: "Value", value: selectedRow.valueMinor === null || selectedRow.valueMinor === undefined ? "—" : fmtMoney(selectedRow.valueMinor, selectedRow.currency || currency), numeric: true },
              { label: "Term", value: `${selectedRow.startsAt ? formatDate(selectedRow.startsAt) : "—"} → ${selectedRow.endsAt ? formatDate(selectedRow.endsAt) : "open-ended"}` },
              { label: "Signed", value: selectedRow.signedAt ? formatDate(selectedRow.signedAt) : "Not signed" },
              { label: "Document", value: selectedRow.docRef ? <span className="t-mono truncate">{selectedRow.docRef}</span> : "—" },
            ]}
          />
          <section aria-label="Signing" className="mt-3 flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-panel-pad">
            <p className="t-title text-primary">Signing</p>
            {selectedRow.status === "awaiting_signature" || selectedRow.status === "review" || selectedRow.status === "draft" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {isExternalHref(selectedRow.docRef) ? (
                    <FounderLinkOut href={selectedRow.docRef} icon={FileSignature} disabled={selectedRow.status !== "awaiting_signature"}>
                      Open to sign
                    </FounderLinkOut>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Button icon={FileSignature} disabled title="Add the e-signature envelope link to the contract first">
                        Open to sign
                      </Button>
                      <FounderOnlyChip />
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Field htmlFor={`${id}-provider`} label="Signed through" className="w-56">
                    <SimpleSelect id={`${id}-provider`} options={PROVIDER_OPTIONS} value={provider} onValueChange={setProvider} aria-label="Signed through" controlSize="sm" />
                  </Field>
                  <Button size="sm" icon={UserRound} disabled={!isAdmin || selectedRow.status !== "awaiting_signature"} loading={action.pending === `${selectedRow.id}:signed`} onClick={() => void setStatus(selectedRow, "signed", { provider })} title={isAdmin ? "Record that you signed outside the platform" : "Only the founder (owner or admin) records a signature"}>
                    Record my signature
                  </Button>
                  <FounderOnlyChip />
                </div>
                <p className="t-small text-secondary">Agents never sign. Marking a contract awaiting signature sends nothing: send the envelope from your e-signature tool and paste its link into the document field. You sign there, then record it here; when Dropbox Sign is connected and the document link names the signature request, Dropbox Sign tells the product once it is signed and the signature is recorded for you.</p>
              </>
            ) : (
              <p className="t-body text-primary">{selectedRow.signedAt ? `Signed ${formatDate(selectedRow.signedAt)} by the founder.` : CONTRACT_STATUS_WORD[selectedRow.status]}</p>
            )}
          </section>
          <section aria-label="Obligations" className="mt-3">
            <p className="t-title mb-1 text-primary">Obligations</p>
            <MiniTable<Obligation> aria-label="Obligations" rows={obligations} getRowKey={(o) => o.id} columns={obligationColumns()} emptyText="No obligations recorded for this contract." maxRows={20} caption={<span className="tabular-nums">{obligations.filter((o) => o.status !== "met").length} open of {obligations.length}</span>} />
          </section>
          <div className="mt-3 flex flex-wrap gap-1">
            {CONTRACT_NEXT[selectedRow.status]
              .filter((s) => s !== "signed")
              .map((s) => {
                const meta = NEXT_LABEL[s];
                return (
                  <Button key={s} size="sm" variant={meta?.variant ?? "default"} icon={meta?.icon} loading={action.pending === `${selectedRow.id}:${s}`} onClick={() => void setStatus(selectedRow, s)}>
                    {meta?.label ?? CONTRACT_STATUS_WORD[s]}
                  </Button>
                );
              })}
          </div>
          {/* Letting a contract go cannot be undone: the consequence sits under the buttons that offer it. */}
          {CONTRACT_NEXT[selectedRow.status].includes("terminated") ? <ConsequenceLine {...TERMINATE_CONSEQUENCE} className="mt-2" data-testid="terminate-consequence" /> : null}
        </Panel>
      ) : null}
    </Screen>
  );
}
