"use client";
/**
 * Team › Recruitment (BUILD §6.3, §11.9, §11.13): the catalogue of agent templates (team.agents.catalogue) with a
 * saved view per family and "Hire…" into a department (team.agents.hire); the agent builder entry (a sentence →
 * the closest templates, hired under a custom name; Opus drafting of instructions and skills runs on the first
 * training run); and squad moves: release, clone, loan between departments.
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Copy, ExternalLink, Sparkles, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Avatar, Button, Chip, DataTable, EntityLink, ModelChip, Panel, ProvenanceChip, Textarea, formatMoney, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { useDepartments } from "@foundmill/widgets/shared/departments";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { CloneDialog, HireDialog, LoanDialog, ReleaseDialog } from "./dialogs";
import { AgentStatusWordPill, FAMILY_LABELS, Screen, agentDept, agentEntity, agentHref, suggestTemplates, useAgents, useNow } from "./shared";
import type { AgentRow, TemplateRow } from "./types";

export interface CatalogueRow extends TemplateRow {
  id: string;
  familyLabel: string;
  /** Agents in the squad hired from this template (matched on agent type). */
  hired: number;
}

export const CATALOGUE_VIEWS: SavedView[] = [
  { id: "all", name: "All templates", builtIn: true, columns: ["name", "family", "module", "model", "skills", "wage", "hired"], sort: [{ id: "family", desc: false }], filters: [] },
  { id: "leads", name: "Leads", builtIn: true, columns: ["name", "module", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-lead", field: "family", op: "in", value: ["lead", "assistant"] }] },
  { id: "workers", name: "Workers", builtIn: true, columns: ["name", "module", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-worker", field: "family", op: "eq", value: "worker" }] },
  { id: "channels", name: "Channel engines", builtIn: true, columns: ["name", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-channel", field: "family", op: "eq", value: "channel" }] },
  { id: "specialists", name: "Specialists", builtIn: true, columns: ["name", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-spec", field: "family", op: "eq", value: "specialist" }] },
  { id: "utilities", name: "Utilities", builtIn: true, columns: ["name", "model", "wage", "hired"], sort: [], filters: [{ id: "f-util", field: "family", op: "eq", value: "utility" }] },
];

export const MOVES_VIEWS: SavedView[] = [
  { id: "all", name: "All agents", builtIn: true, columns: ["name", "role", "departments", "status"], sort: [{ id: "name", desc: false }], filters: [] },
  { id: "idle", name: "Idle or paused", builtIn: true, columns: ["name", "role", "departments", "status"], sort: [], filters: [{ id: "f-idle", field: "status", op: "in", value: ["idle", "paused"] }] },
];

const FAMILY_ORDER: Record<TemplateRow["family"], number> = { assistant: 0, lead: 1, worker: 2, channel: 3, specialist: 4, utility: 5 };

export function toCatalogueRows(catalogue: readonly TemplateRow[] | undefined, agents: readonly AgentRow[] | undefined): CatalogueRow[] {
  const hiredBy = new Map<string, number>();
  for (const a of agents ?? []) if (a.agentType && !a.archivedAt) hiredBy.set(a.agentType, (hiredBy.get(a.agentType) ?? 0) + 1);
  return (catalogue ?? [])
    .map((t) => ({ ...t, id: t.key, familyLabel: FAMILY_LABELS[t.family], hired: hiredBy.get(t.key) ?? 0 }))
    .sort((a, b) => FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] || a.name.localeCompare(b.name));
}

export function RecruitmentScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate, currency = "EUR" } = useWidgetData();
  const now = useNow();
  const catalogue = useWidgetQuery<TemplateRow[]>("team.agents.catalogue", {});
  const agentsQuery = useAgents();
  const departments = useDepartments();
  const rows = useMemo(() => toCatalogueRows(catalogue.data, agentsQuery.data?.agents), [catalogue.data, agentsQuery.data]);
  const squad = useMemo(() => (agentsQuery.data?.agents ?? []).filter((a) => !a.archivedAt), [agentsQuery.data]);
  const [catalogueViews, setCatalogueViews] = useState<SavedView[]>(CATALOGUE_VIEWS);
  const [movesViews, setMovesViews] = useState<SavedView[]>(MOVES_VIEWS);
  const [hire, setHire] = useState<{ template: TemplateRow; name?: string } | null>(null);
  const [release, setRelease] = useState<AgentRow | null>(null);
  const [clone, setClone] = useState<AgentRow | null>(null);
  const [loan, setLoan] = useState<AgentRow | null>(null);
  const [sentence, setSentence] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const suggestions = useMemo(() => suggestTemplates(sentence, catalogue.data ?? []), [sentence, catalogue.data]);
  const open = (agentId: string) => navigate(agentHref(businessId, agentId));
  const refetch = () => agentsQuery.refetch();

  const catalogueColumns = useMemo<DataTableColumn<CatalogueRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Template",
        size: 260,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col py-0.5">
            <span className="truncate text-body-strong">{row.original.name}</span>
            <span className="truncate text-small text-secondary" title={row.original.description}>
              {row.original.role}
            </span>
          </span>
        ),
      },
      { id: "family", accessorKey: "family", header: "Family", size: 140, cell: ({ row }) => <Chip>{row.original.familyLabel}</Chip>, meta: { filter: "select", filterOptions: (Object.keys(FAMILY_LABELS) as TemplateRow["family"][]).map((f) => ({ value: f, label: FAMILY_LABELS[f] })) }, sortingFn: (a, b) => FAMILY_ORDER[a.original.family] - FAMILY_ORDER[b.original.family] },
      { id: "module", accessorFn: (r) => r.module ?? "", header: "Module", size: 120, cell: ({ row }) => <span className="text-secondary">{row.original.module ?? "Any"}</span> },
      { id: "model", accessorKey: "modelKey", header: "Model", size: 100, cell: ({ row }) => <ModelChip model={row.original.modelKey} /> },
      { id: "skills", accessorFn: (r) => r.skills.length, header: "Skills", size: 240, meta: { numeric: true, csv: (r) => r.skills.join("; ") }, cell: ({ row }) => (row.original.skills.length ? <span className="truncate text-secondary" title={row.original.skills.join(", ")}>{row.original.skills.length} · {row.original.skills.join(", ")}</span> : <span className="text-secondary">Set by training</span>) },
      {
        id: "wage",
        accessorKey: "wageCapMinor",
        header: "Wage cap",
        size: 150,
        meta: { numeric: true, csv: (r) => r.wageCapMinor / 100 },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {formatMoney({ amountMinor: row.original.wageCapMinor, currency })}/mo <ProvenanceChip kind="estimate" />
          </span>
        ),
      },
      { id: "hired", accessorKey: "hired", header: "In team", size: 90, meta: { numeric: true } },
    ],
    [currency],
  );
  const catalogueActions = (row: CatalogueRow): RowAction<CatalogueRow>[] => [{ id: "hire", label: "Hire…", icon: UserRoundPlus, onSelect: () => setHire({ template: row }) }];

  const movesColumns = useMemo<DataTableColumn<AgentRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Agent",
        size: 220,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar size={24} name={row.original.name} agent={{ seed: row.original.avatarSeed || row.original.id, dept: agentDept(row.original) }} status={row.original.status} />
            <EntityLink entity={{ id: row.original.id, kind: "agent", name: row.original.name, href: agentHref(businessId, row.original.id) }} details={agentEntity(businessId, row.original, currency)} hideIcon className="text-body-strong" onOpen={(e) => open(e.id)} onVerb={(verb, e) => verb === "open_profile" && open(e.id)} />
          </span>
        ),
      },
      { id: "role", accessorFn: (r) => r.role ?? "", header: "Role", size: 180 },
      { id: "departments", accessorFn: (r) => (r.departments ?? []).map((d) => d.name).join(", "), header: "Department(s)", size: 220, cell: ({ row }) => <span className="flex flex-wrap gap-1">{(row.original.departments ?? []).map((d) => <Chip key={d.id} tone={d.colourToken}>{d.name}</Chip>)}</span> },
      { id: "status", accessorKey: "status", header: "Status", size: 160, cell: ({ row }) => <AgentStatusWordPill status={row.original.status} expectedReturnAt={row.original.expectedReturnAt} now={now} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is stable per data source
    [businessId, currency, now],
  );
  const movesActions = (agent: AgentRow): RowAction<AgentRow>[] => [
    { id: "open", label: "Open profile", icon: ExternalLink, onSelect: () => open(agent.id) },
    { id: "clone", label: "Clone…", icon: Copy, separatorBefore: true, onSelect: () => setClone(agent) },
    { id: "loan", label: "Loan to department…", icon: ArrowLeftRight, onSelect: () => setLoan(agent) },
    { id: "release", label: "Release", icon: UserRoundMinus, variant: "danger", separatorBefore: true, disabled: agent.agentType === "chief_of_staff", onSelect: () => setRelease(agent) },
  ];

  return (
    <Screen name="team/recruitment">
      <Panel span={12} title="Agent builder" actions={<Chip icon={Sparkles}>Sentence to agent</Chip>} footer="The builder drafts the description, instructions, skills and tools from your sentence on the first training run; the closest template gives it a head start. Hiring is an approval-free action; the wage cap is an estimate until the first month closes.">
        <div className="flex flex-col gap-3">
          <Textarea value={sentence} onChange={(e) => setSentence(e.target.value)} rows={2} placeholder="e.g. an agent who writes our weekly customer newsletter and asks before sending" aria-label="Describe the agent" maxLength={400} />
          {sentence.trim() && !suggestions.length ? <p className="text-small text-secondary">No template matches those words yet; try naming the work (write, research, source, test, ads, email).</p> : null}
          {suggestions.length ? (
            <ul className="grid grid-cols-3 gap-gutter" aria-label="Suggested templates">
              {suggestions.map((s) => (
                <li key={s.template.key} className="flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-panel-pad" data-suggestion={s.template.key}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-body-strong">{s.template.name}</span>
                    <Chip tone={s.score >= 0.5 ? "good" : "neutral"}>{Math.round(s.score * 100)} % fit</Chip>
                  </span>
                  <span className="text-small text-secondary">{s.template.role} · {FAMILY_LABELS[s.template.family]}</span>
                  <span className="line-clamp-2 text-small text-secondary">{s.template.description}</span>
                  <span className="flex flex-wrap gap-1">
                    {s.matched.slice(0, 4).map((w) => (
                      <Chip key={w}>{w}</Chip>
                    ))}
                  </span>
                  <Button size="sm" icon={UserRoundPlus} onClick={() => setHire({ template: s.template })} className="self-start">
                    Hire from this template
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>

      <Panel
        span={12}
        title="Catalogue"
        flush
        loading={catalogue.isLoading && !catalogue.data}
        error={catalogue.error ? catalogue.error.message : undefined}
        onRetry={catalogue.refetch}
        empty={catalogue.data && rows.length === 0 ? { icon: Users, children: "The catalogue lists every agent template with its role, model and wage cap once the agents package is loaded." } : undefined}
        actions={
          <span className="text-small text-secondary tabular-nums" data-testid="catalogue-summary">
            {rows.length} templates · {squad.length} in the team
          </span>
        }
        footer={notice ? <span data-testid="recruitment-notice">{notice}</span> : "Double-click or right-click a template to hire it into a department. Wage caps are estimates."}
      >
        <DataTable<CatalogueRow> aria-label="Catalogue" data={rows} columns={catalogueColumns} views={catalogueViews} onViewsChange={setCatalogueViews} defaultViewId="all" rowActions={catalogueActions} onRowOpen={(row) => setHire({ template: row })} height={Math.min(480, Math.max(240, rows.length * 34 + 48))} density="comfortable" exportFileName="catalogue" className="border-0" />
      </Panel>

      <Panel
        span={12}
        title="Team moves"
        flush
        loading={agentsQuery.isLoading && !agentsQuery.data}
        error={agentsQuery.error ? agentsQuery.error.message : undefined}
        onRetry={refetch}
        empty={agentsQuery.data && squad.length === 0 ? { icon: Users, children: "Hired agents appear here; right-click one to clone it, loan it to another department or release it." } : undefined}
        footer="Release stops running tasks and keeps the history. Clone copies instructions, tools, model and skills. Loan adds a department; move replaces it."
      >
        <DataTable<AgentRow> aria-label="Team moves" data={squad} columns={movesColumns} views={movesViews} onViewsChange={setMovesViews} defaultViewId="all" rowActions={movesActions} onRowOpen={(a) => open(a.id)} height={Math.min(420, Math.max(200, squad.length * 28 + 48))} exportFileName="squad-moves" className="border-0" />
      </Panel>

      <HireDialog
        template={hire?.template ?? null}
        defaultName={hire?.name}
        onOpenChange={(o) => !o && setHire(null)}
        departments={departments.data}
        defaultDepartmentId={departmentId}
        currency={currency}
        onHired={(agent, template) => {
          setNotice(`${agent.name ?? template.name} hired. First training run queued.`);
          setSentence("");
          refetch();
        }}
      />
      <ReleaseDialog agent={release} onOpenChange={(o) => !o && setRelease(null)} onReleased={(a) => { setNotice(`${a.name} released.`); refetch(); }} />
      <CloneDialog agent={clone} onOpenChange={(o) => !o && setClone(null)} departments={departments.data} onCloned={(c) => { setNotice(`${c.name} joined the team.`); refetch(); }} />
      <LoanDialog agent={loan} onOpenChange={(o) => !o && setLoan(null)} departments={departments.data} onLoaned={(a, deptId, move) => { setNotice(`${a.name} ${move ? "moved to" : "on loan to"} ${departments.data?.find((d) => d.id === deptId)?.name ?? "another department"}.`); refetch(); }} />
    </Screen>
  );
}
