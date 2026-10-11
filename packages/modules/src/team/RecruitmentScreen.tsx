"use client";
/**
 * Team › Recruitment (BUILD §6.3, §11.9, §11.13): the catalogue of agent templates (team.agents.catalogue) with a
 * saved view per family and "Hire…" into a department (team.agents.hire); the agent builder entry (a sentence →
 * the closest templates, hired under a custom name; Opus drafting of instructions and skills runs on the first
 * training run); and team moves: release, clone, loan between departments.
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Copy, ExternalLink, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Button, Chip, DataTable, DeptChip, ModelChip, Panel, ProvenanceChip, Textarea, formatMoney, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import type { ModuleKey } from "@foundmill/shared/constants";
import { fitColumns, fitToGrow, humanise, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { CloneDialog, HireDialog, LoanDialog, ReleaseDialog } from "./dialogs";
import { AgentCell, AgentStatusWordPill, FAMILY_LABELS, Screen, agentDept, agentEntity, agentHref, suggestTemplates, useAgents, useNow } from "./shared";
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

/** Column minimums and how the extra width is shared (see fit.ts). */
export const CATALOGUE_FIT: Record<string, ColumnFit> = {
  name: { min: 200, grow: 3 },
  family: { min: 120 },
  module: { min: 136, grow: 1 },
  model: { min: 92 },
  skills: { min: 140, grow: 4 },
  wage: { min: 176 },
  hired: { min: 80 },
};
export const MOVES_FIT: Record<string, ColumnFit> = {
  name: { min: 220, grow: 2 },
  role: { min: 180, grow: 2 },
  departments: { min: 180, grow: 1 },
  status: { min: 200, grow: 1 },
};

/** The department a template works in: the department over its module (departments are labels over modules). */
export function moduleLabel(module: string | null | undefined, departments: readonly DepartmentRow[] | undefined): string {
  if (!module) return "Any";
  return departmentForModule(departments, module as ModuleKey)?.name ?? humanise(module);
}

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
  const team = useMemo(() => (agentsQuery.data?.agents ?? []).filter((a) => !a.archivedAt), [agentsQuery.data]);
  const [catalogueViews, setCatalogueViews] = useState<SavedView[]>(CATALOGUE_VIEWS);
  const [movesViews, setMovesViews] = useState<SavedView[]>(MOVES_VIEWS);
  const [hire, setHire] = useState<{ template: TemplateRow; name?: string } | null>(null);
  const [release, setRelease] = useState<AgentRow | null>(null);
  const [clone, setClone] = useState<AgentRow | null>(null);
  const [loan, setLoan] = useState<AgentRow | null>(null);
  const [sentence, setSentence] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const suggestions = useMemo(() => suggestTemplates(sentence, catalogue.data ?? []), [sentence, catalogue.data]);
  const best = suggestions[0]?.template ?? null;
  const open = (agentId: string) => navigate(agentHref(businessId, agentId));
  const refetch = () => agentsQuery.refetch();
  const draft = () => best && setHire({ template: best });
  // Each column at its minimum; the tables share their spare width by the specs' weights themselves (`meta.grow`).
  const catalogueSizes = useMemo(() => fitColumns(null, CATALOGUE_FIT, []), []);
  const movesSizes = useMemo(() => fitColumns(null, MOVES_FIT, []), []);

  const catalogueColumns = useMemo<DataTableColumn<CatalogueRow>[]>(
    () => fitToGrow<CatalogueRow>([
      {
        id: "name",
        accessorKey: "name",
        header: "Template",
        size: catalogueSizes.name,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0 truncate" title={row.original.description}>
            <span className="text-body-strong">{row.original.name}</span>
            {row.original.role && row.original.role.toLowerCase() !== row.original.name.toLowerCase() ? <span className="ml-2 text-secondary">{row.original.role}</span> : null}
          </span>
        ),
      },
      { id: "family", accessorKey: "family", header: "Family", size: catalogueSizes.family, cell: ({ row }) => <Chip>{row.original.familyLabel}</Chip>, meta: { filter: "select", filterOptions: (Object.keys(FAMILY_LABELS) as TemplateRow["family"][]).map((f) => ({ value: f, label: FAMILY_LABELS[f] })) }, sortingFn: (a, b) => FAMILY_ORDER[a.original.family] - FAMILY_ORDER[b.original.family] },
      { id: "module", accessorFn: (r) => moduleLabel(r.module, departments.data), header: "Department", size: catalogueSizes.module, meta: { label: "Department" }, cell: ({ row }) => <span className={row.original.module ? "text-primary" : "text-secondary"}>{moduleLabel(row.original.module, departments.data)}</span> },
      { id: "model", accessorKey: "modelKey", header: "Model", size: catalogueSizes.model, cell: ({ row }) => <ModelChip model={row.original.modelKey} /> },
      {
        id: "skills",
        accessorFn: (r) => r.skills.length,
        header: "Skills",
        size: catalogueSizes.skills,
        meta: { filter: "number", csv: (r) => r.skills.map(humanise).join("; ") },
        cell: ({ row }) => {
          const skills = row.original.skills.map(humanise);
          if (!skills.length) return <span className="text-secondary">Set by training</span>;
          return (
            <span className="block min-w-0 truncate" title={skills.join(", ")}>
              <span className="text-primary tabular-nums">{skills.length}</span>
              <span className="text-tertiary"> · </span>
              <span className="text-secondary">{skills.join(", ")}</span>
            </span>
          );
        },
      },
      {
        id: "wage",
        accessorKey: "wageCapMinor",
        header: "Wage cap",
        size: catalogueSizes.wage,
        meta: { numeric: true, csv: (r) => r.wageCapMinor / 100 },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
            {formatMoney({ amountMinor: row.original.wageCapMinor, currency })}
            <span className="t-unit">/mo</span>
            <ProvenanceChip kind="estimate" />
          </span>
        ),
      },
      { id: "hired", accessorKey: "hired", header: "In team", size: catalogueSizes.hired, meta: { numeric: true }, cell: ({ row }) => (row.original.hired ? row.original.hired : <span className="text-tertiary">—</span>) },
    ], CATALOGUE_FIT),
    [currency, catalogueSizes, departments.data],
  );
  const catalogueActions = (row: CatalogueRow): RowAction<CatalogueRow>[] => [{ id: "hire", label: "Hire…", icon: UserRoundPlus, onSelect: () => setHire({ template: row }) }];

  const movesColumns = useMemo<DataTableColumn<AgentRow>[]>(
    () => fitToGrow<AgentRow>([
      {
        id: "name",
        accessorKey: "name",
        header: "Agent",
        size: movesSizes.name,
        meta: { locked: true },
        cell: ({ row }) => <AgentCell businessId={businessId} agent={{ id: row.original.id, name: row.original.name, seed: row.original.avatarSeed || row.original.id, dept: agentDept(row.original), status: row.original.status }} details={agentEntity(businessId, row.original, currency)} onOpen={open} />,
      },
      { id: "role", accessorFn: (r) => r.role ?? "", header: "Role", size: movesSizes.role },
      {
        id: "departments",
        accessorFn: (r) => (r.departments ?? []).map((d) => d.name).join(", "),
        header: "Departments",
        size: movesSizes.departments,
        cell: ({ row }) => {
          const [first, ...rest] = row.original.departments ?? [];
          if (!first) return <span className="text-tertiary">—</span>;
          return (
            <span className="flex min-w-0 items-center gap-1.5" title={(row.original.departments ?? []).map((d) => d.name).join(", ")}>
              <DeptChip dept={first.colourToken} fit>
                {first.name}
              </DeptChip>
              {rest.length ? <span className="shrink-0 text-small text-secondary tabular-nums">+{rest.length}</span> : null}
            </span>
          );
        },
      },
      { id: "status", accessorKey: "status", header: "Status", size: movesSizes.status, cell: ({ row }) => <AgentStatusWordPill status={row.original.status} expectedReturnAt={row.original.expectedReturnAt} now={now} /> },
    ], MOVES_FIT),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is stable per data source
    [businessId, currency, now, movesSizes],
  );
  const movesActions = (agent: AgentRow): RowAction<AgentRow>[] => [
    { id: "open", label: "Open profile", icon: ExternalLink, onSelect: () => open(agent.id) },
    { id: "clone", label: "Clone…", icon: Copy, separatorBefore: true, onSelect: () => setClone(agent) },
    { id: "loan", label: "Loan to department…", icon: ArrowLeftRight, onSelect: () => setLoan(agent) },
    { id: "release", label: "Release", icon: UserRoundMinus, variant: "danger", separatorBefore: true, disabled: agent.agentType === "chief_of_staff", onSelect: () => setRelease(agent) },
  ];

  return (
    <Screen name="team/recruitment">
      <Panel span={12} title="Agent builder" glow="brand" footer="The closest template gives the new agent a head start; its first training run drafts the description, instructions, skills and tools. Hiring needs no approval; the wage cap is an estimate until the first month closes.">
        <div className="flex flex-col gap-3">
          <Textarea
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && best) {
                e.preventDefault();
                draft();
              }
            }}
            rows={2}
            placeholder="Describe the agent in a sentence, e.g. an agent who writes our weekly customer newsletter and asks before sending"
            aria-label="Describe the agent"
            maxLength={400}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="generate" size="md" disabled={!best} kbd="⌘↵" onClick={draft} data-testid="draft-agent">
              Draft this agent
            </Button>
            <span className="min-w-0 text-small text-secondary" role="status">
              {best ? (
                <>
                  Starts from <span className="text-primary">{best.name}</span>, the closest of {plural(suggestions.length, "template")}. Pick another below.
                </>
              ) : sentence.trim() ? (
                "No template matches those words yet; try naming the work (write, research, source, test, ads, email)."
              ) : (
                "Say what the agent does and who it answers to; the closest templates appear as you type."
              )}
            </span>
          </div>
          {suggestions.length ? (
            <ul className="grid grid-cols-3 gap-3" aria-label="Suggested templates">
              {suggestions.map((s, i) => (
                <li key={s.template.key} className={i === 0 ? "edge edge-tint tone-kit-lift flex min-w-0 flex-col gap-2 rounded-md bg-surface-2 p-panel-pad" : "edge flex min-w-0 flex-col gap-2 rounded-md bg-surface-2 p-panel-pad"} data-suggestion={s.template.key}>
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 text-body-strong">{s.template.name}</span>
                    <Chip tone={s.score >= 0.5 ? "good" : "neutral"} className="shrink-0">
                      {Math.round(s.score * 100)} % fit
                    </Chip>
                  </span>
                  <span className="text-small text-secondary">
                    {s.template.role} · {FAMILY_LABELS[s.template.family]}
                  </span>
                  <span className="line-clamp-2 text-small text-secondary">{s.template.description}</span>
                  <span className="flex flex-wrap gap-1">
                    {s.matched.slice(0, 4).map((w) => (
                      <Chip key={w}>{w}</Chip>
                    ))}
                  </span>
                  <Button size="sm" icon={UserRoundPlus} onClick={() => setHire({ template: s.template })} className="mt-auto self-start">
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
        title="Catalog"
        flush
        loading={catalogue.isLoading && !catalogue.data}
        error={catalogue.error ? catalogue.error.message : undefined}
        onRetry={catalogue.refetch}
        empty={catalogue.data && rows.length === 0 ? { icon: Users, children: "The catalog lists every agent template with its role, model and wage cap once the agents package is loaded." } : undefined}
        meta={
          rows.length ? (
            <span data-testid="catalogue-summary">
              {plural(rows.length, "template")} · {team.length} in the team
            </span>
          ) : undefined
        }
        footer={notice ? <span data-testid="recruitment-notice" className="text-secondary">{notice}</span> : "Double-click or right-click a template to hire it into a department. Wage caps are estimates."}
      >
        <div className="min-w-0">
          <DataTable<CatalogueRow> aria-label="Catalog" data={rows} columns={catalogueColumns} views={catalogueViews} onViewsChange={setCatalogueViews} defaultViewId="all" rowActions={catalogueActions} onRowOpen={(row) => setHire({ template: row })} height={Math.min(480, Math.max(240, rows.length * 34 + 44))} density="comfortable" exportFileName="catalogue" className="border-0" />
        </div>
      </Panel>

      <Panel
        span={12}
        title="Team moves"
        flush
        loading={agentsQuery.isLoading && !agentsQuery.data}
        error={agentsQuery.error ? agentsQuery.error.message : undefined}
        onRetry={refetch}
        empty={agentsQuery.data && team.length === 0 ? { icon: Users, children: "Hired agents appear here; right-click one to clone it, loan it to another department or release it." } : undefined}
        footer="Release stops running tasks and keeps the history. Clone copies instructions, tools, model and skills. Loan adds a department; move replaces it."
      >
        <div className="min-w-0">
          <DataTable<AgentRow> aria-label="Team moves" data={team} columns={movesColumns} views={movesViews} onViewsChange={setMovesViews} defaultViewId="all" rowActions={movesActions} onRowOpen={(a) => open(a.id)} height={Math.min(420, Math.max(200, team.length * 28 + 44))} exportFileName="team-moves" className="border-0" />
        </div>
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
