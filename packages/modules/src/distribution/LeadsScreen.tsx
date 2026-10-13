"use client";
/**
 * Distribution › Leads (BUILD §11.7 lead generation): every entity holding the `lead` role (`crm.roles.byRole`) in a
 * DataTable with saved views, a lawful-basis column, a suppression indicator and right-click verbs (open profile,
 * set lawful basis, add note, end the lead role). Suppressed leads are never messaged by an engine.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowUpToLine, ExternalLink, NotebookPen, ScrollText, ShieldBan, UserRoundX } from "lucide-react";
import {
  Button,
  Chip,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EntityLink,
  Panel,
  SimpleSelect,
  StatusPill,
  Textarea,
  type DataTableColumn,
  type RowAction,
  type SavedView,
} from "@foundmill/dugout";
import { moduleHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleScreenProps } from "../registry";
import { LAWFUL_BASES, lawfulBasisLabel, suppressionOf } from "./channel-data";
import { RelativeDateText } from "../dates";
import { fitColumns, fitToGrow, type ColumnFit } from "../fit";
import { InlineError, Screen, fitTableHeight, plainWords, sourceLabel, useAction } from "./shared";
import type { AgentRow, LeadRow, Page } from "./types";

export const LEAD_VIEWS: SavedView[] = [
  { id: "all", name: "All leads", builtIn: true, columns: ["name", "email", "stage", "source", "lawfulBasis", "suppression", "added"], sort: [{ id: "added", desc: true }], filters: [] },
  { id: "owners", name: "Companies and owners", builtIn: true, columns: ["name", "company", "stage", "owner", "added"], sort: [{ id: "added", desc: true }], filters: [] },
  { id: "needs-basis", name: "Needs lawful basis", builtIn: true, columns: ["name", "company", "email", "source", "lawfulBasis", "added"], sort: [{ id: "added", desc: true }], filters: [{ id: "f-basis", field: "lawfulBasis", op: "eq", value: "Not recorded" }] },
  { id: "suppressed", name: "Suppressed", builtIn: true, columns: ["name", "company", "email", "suppression", "suppressionReason", "added"], sort: [{ id: "added", desc: true }], filters: [{ id: "f-sup", field: "suppressed", op: "eq", value: true }] },
  { id: "new", name: "New this week", builtIn: true, columns: ["name", "company", "stage", "source", "lawfulBasis", "owner", "added"], sort: [{ id: "added", desc: true }], filters: [{ id: "f-new", field: "stage", op: "eq", value: "new" }] },
];

/** What each column's content needs and its share of the spare width: every view fits the 980 px table at 1280. */
export const LEAD_FIT = {
  name: { min: 150, grow: 3 },
  company: { min: 130, grow: 1 },
  email: { min: 170, grow: 2 },
  stage: { min: 100 },
  source: { min: 120, grow: 1 },
  lawfulBasis: { min: 170 },
  suppression: { min: 116 },
  suppressed: { min: 96 },
  suppressionReason: { min: 150, grow: 2 },
  owner: { min: 140, grow: 1 },
  added: { min: 96 },
} satisfies Record<string, ColumnFit>;
export type LeadColumnId = keyof typeof LEAD_FIT;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function leadColumns(businessId: string, agents: readonly AgentRow[] | undefined, sizes: Record<LeadColumnId, number> = fitColumns<LeadColumnId>(null, LEAD_FIT, [])): DataTableColumn<LeadRow>[] {
  const agentName = (id: string) => agents?.find((a) => a.id === id)?.name ?? "Agent";
  return [
    {
      id: "name",
      accessorFn: (r) => r.displayName,
      header: "Lead",
      size: sizes.name,
      cell: ({ row }) => <EntityLink entity={{ id: row.original.id, kind: row.original.kind, name: row.original.displayName, href: routes.crm(businessId, row.original.id) }} className="text-body-strong" />,
      meta: { locked: true },
    },
    { id: "company", accessorFn: (r) => str(r.identifiers["company"]) || str(r.identifiers["domain"]), header: "Company", size: sizes.company, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    { id: "email", accessorFn: (r) => str(r.identifiers["email"]), header: "Email", size: sizes.email, cell: ({ getValue }) => <span className="truncate font-mono text-mono text-secondary">{String(getValue() ?? "") || "—"}</span> },
    { id: "stage", accessorFn: (r) => r.role.stage ?? "", header: "Stage", size: sizes.stage, cell: ({ getValue }) => (getValue() ? <Chip tone="neutral" className="whitespace-nowrap">{plainWords(String(getValue()))}</Chip> : <span className="text-secondary">—</span>), meta: { filter: "select", filterOptions: ["new", "contacted", "replied", "qualified", "suppressed"].map((s) => ({ value: s, label: plainWords(s) })) } },
    { id: "source", accessorFn: (r) => sourceLabel(r.source), header: "Source", size: sizes.source, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    {
      id: "lawfulBasis",
      accessorFn: (r) => lawfulBasisLabel(r.lawfulBasis),
      header: "Lawful basis",
      size: sizes.lawfulBasis,
      cell: ({ row }) => (row.original.lawfulBasis ? <Chip tone="good" icon={ScrollText} className="whitespace-nowrap">{lawfulBasisLabel(row.original.lawfulBasis)}</Chip> : <Chip tone="warn" icon={ScrollText} className="whitespace-nowrap">Not recorded</Chip>),
      meta: { filter: "select", filterOptions: [{ value: "Not recorded", label: "Not recorded" }, ...LAWFUL_BASES] },
    },
    {
      id: "suppression",
      accessorFn: (r) => (suppressionOf(r).suppressed ? "Suppressed" : "Clear"),
      header: "Suppression",
      size: sizes.suppression,
      cell: ({ row }) => {
        const s = suppressionOf(row.original);
        return s.suppressed ? (
          <StatusPill tone="bad" icon={ShieldBan} title={s.reason ?? undefined} className="whitespace-nowrap">
            Suppressed
          </StatusPill>
        ) : (
          <StatusPill tone="good" className="whitespace-nowrap">
            Clear
          </StatusPill>
        );
      },
      meta: { filter: "select", filterOptions: [{ value: "Suppressed", label: "Suppressed" }, { value: "Clear", label: "Clear" }] },
    },
    { id: "suppressed", accessorFn: (r) => suppressionOf(r).suppressed, header: "Suppressed", size: sizes.suppressed, cell: ({ getValue }) => (getValue() ? "Yes" : "No"), meta: { filter: "boolean" } },
    { id: "suppressionReason", accessorFn: (r) => suppressionOf(r).reason ?? "", header: "Reason", size: sizes.suppressionReason, cell: ({ getValue }) => <span className="truncate text-secondary">{String(getValue() ?? "") || "—"}</span> },
    {
      id: "owner",
      accessorFn: (r) => (r.role.ownerRef?.kind === "agent" ? agentName(r.role.ownerRef.id) : (r.role.ownerRef?.id ?? "")),
      header: "Owner",
      size: sizes.owner,
      cell: ({ row }) => {
        const o = row.original.role.ownerRef;
        if (!o) return <span className="text-secondary">Unassigned</span>;
        if (o.kind === "agent") return <EntityLink entity={{ id: o.id, kind: "agent", name: agentName(o.id), href: routes.agent(businessId, o.id) }} />;
        return <span className="text-secondary">{o.kind === "user" ? "Team member" : "Department"}</span>;
      },
    },
    { id: "added", accessorFn: (r) => r.role.startedAt, header: "Added", size: sizes.added, cell: ({ getValue }) => <RelativeDateText className="tabular-nums" value={String(getValue())} />, meta: { filter: "date" } },
  ];
}

export function LeadsScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const departments = useDepartments();
  const boardHref = moduleHref(businessId, departments.data, "distribution", "formation");
  const leads = useWidgetQuery<Page<LeadRow>>("crm.roles.byRole", { role: "lead", limit: 500 });
  const agents = useWidgetQuery<AgentRow[]>("team.agents.list", {});
  const action = useAction();
  // Saved per person, business and table (audit #204): they come back after a reload.
  const savedViews = useSavedViews("distribution.leads", LEAD_VIEWS, { defaultViewId: "all" });
  const [basisFor, setBasisFor] = useState<LeadRow | null>(null);
  const [noteFor, setNoteFor] = useState<LeadRow | null>(null);
  useBusinessEvents(() => leads.refetch(), ["lead.created", "lead.replied"]);

  const rows = useMemo(() => leads.data?.items ?? [], [leads.data]);
  const columns = useMemo(() => fitToGrow(leadColumns(businessId, agents.data), LEAD_FIT), [businessId, agents.data]);
  const openProfile = useCallback((r: LeadRow) => navigate(routes.crm(businessId, r.id)), [businessId, navigate]);

  const endRole = useCallback(
    async (r: LeadRow) => {
      const ok = await action.run("crm.roles.end", { roleId: r.role.id }, { key: `end:${r.id}` });
      if (ok !== undefined) leads.refetch();
    },
    [action, leads],
  );

  const rowActions = useCallback(
    (row: LeadRow): RowAction<LeadRow>[] => [
      { id: "open", label: "Open profile", icon: ExternalLink, onSelect: openProfile },
      { id: "basis", label: "Set lawful basis…", icon: ScrollText, onSelect: (r) => setBasisFor(r), separatorBefore: true },
      { id: "note", label: "Add note…", icon: NotebookPen, onSelect: (r) => setNoteFor(r) },
      { id: "end", label: "End lead role", icon: UserRoundX, variant: "danger", onSelect: (r) => void endRole(r), separatorBefore: true, disabled: !!row.role.endedAt },
    ],
    [openProfile, endRole],
  );

  const suppressed = rows.filter((r) => suppressionOf(r).suppressed).length;
  const missingBasis = rows.filter((r) => !r.lawfulBasis).length;
  return (
    <Screen name="distribution/leads">
      <Panel
        title="Leads"
        span={12}
        loading={leads.isLoading}
        error={leads.error ? leads.error.message : undefined}
        onRetry={leads.refetch}
        meta={rows.length ? `${rows.length} lead${rows.length === 1 ? "" : "s"} · ${missingBasis} without a lawful basis · ${suppressed} suppressed` : undefined}
        footer={<span>Engines skip suppressed leads and never cold-email EU consumers. Right-click a lead to record its lawful basis, add a note or end its lead role.</span>}
        flush
      >
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        <div className="min-w-0">
        <DataTable<LeadRow>
          aria-label="Leads"
          data={rows}
          columns={columns}
          {...savedViews}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={openProfile}
          height={fitTableHeight(rows.length, { minRows: 12, maxRows: 18 })}
          exportFileName="leads"
          empty={{ title: "No leads yet", children: "Qualified leads arrive here with their lawful basis once Lead generation runs on the board.", action: boardHref ? { label: "Open Lead generation", icon: ArrowUpToLine, onClick: () => navigate(`${boardHref}?channel=lead_generation`) } : undefined }}
        />
        </div>
      </Panel>
      <LawfulBasisDialog lead={basisFor} action={action} onClose={() => setBasisFor(null)} onSaved={() => leads.refetch()} />
      <NoteDialog lead={noteFor} action={action} onClose={() => setNoteFor(null)} />
    </Screen>
  );
}

function LawfulBasisDialog({ lead, action, onClose, onSaved }: { lead: LeadRow | null; action: ReturnType<typeof useAction>; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [value, setValue] = useState<string>("");
  useEffect(() => {
    setValue(lead?.lawfulBasis ?? "");
  }, [lead]);
  const save = async () => {
    if (!lead || !value) return;
    const ok = await action.run("crm.entity.update", { entityId: lead.id, patch: { lawfulBasis: value } }, { key: `basis:${lead.id}` });
    if (ok !== undefined) {
      onSaved();
      onClose();
    }
  };
  return (
    <Dialog open={!!lead} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set lawful basis</DialogTitle>
          <DialogDescription>{lead ? `${lead.displayName}. Outreach engines need a recorded basis before they contact a lead.` : ""}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label htmlFor={id} className="flex flex-col gap-1">
            <span className="t-label">Lawful basis</span>
            <SimpleSelect id={id} options={LAWFUL_BASES.map((b) => ({ value: b.value, label: b.label }))} value={value || undefined} onValueChange={setValue} placeholder="Choose a basis" />
          </label>
          <InlineError error={action.error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!value} loading={!!lead && action.pending === `basis:${lead.id}`} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ lead, action, onClose }: { lead: LeadRow | null; action: ReturnType<typeof useAction>; onClose: () => void }) {
  const id = useId();
  const [note, setNote] = useState("");
  useEffect(() => {
    setNote("");
  }, [lead]);
  const save = async () => {
    if (!lead || !note.trim()) return;
    const ok = await action.run("crm.notes.add", { entityId: lead.id, note: note.trim() }, { key: `note:${lead.id}` });
    if (ok !== undefined) onClose();
  };
  return (
    <Dialog open={!!lead} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>{lead ? `A note on ${lead.displayName}'s profile; agents read it before the next touch.` : ""}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label htmlFor={id} className="flex flex-col gap-1">
            <span className="t-label">Note</span>
            <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <InlineError error={action.error} className="mt-2" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!note.trim()} loading={!!lead && action.pending === `note:${lead.id}`} onClick={save}>
            Add note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
