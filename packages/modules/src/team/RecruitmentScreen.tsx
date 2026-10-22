"use client";
/**
 * Team › Recruitment (BUILD §6.3, §11.9, §11.13): the catalogue of agent templates (team.agents.catalogue) with a
 * saved view per kind and "Hire…" into a department (team.agents.hire); the agent builder entry (a sentence →
 * the closest templates, hired under a custom name with the template's instructions, tools and skills; training from
 * the profile tunes them); and team moves: let go, duplicate, lend to another department (the API paths keep
 * release / clone / loan).
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Copy, ExternalLink, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { Button, Chip, DataTable, DeptChip, Explainer, ModelChip, Panel, ProvenanceChip, Term, Textarea, formatMoney, formatPercent, useGuided, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import type { ModuleKey } from "@foundmill/shared/constants";
import { useModuleEnv } from "../env";
import { fitColumns, fitToGrow, humanise, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { CloneDialog, HireDialog, LoanDialog, RELEASE_CONSEQUENCE, ReleaseDialog } from "./dialogs";
import { AgentCell, AgentStatusWordPill, FAMILY_LABELS, Screen, agentDept, agentEntity, agentHref, isChiefOfStaff, isChiefOfStaffType, SIMPLE_VIEW_ID, suggestTemplates, useAgents, useDefaultViewId, useNow } from "./shared";
import type { AgentRow, TemplateRow } from "./types";

export interface CatalogueRow extends TemplateRow {
  id: string;
  familyLabel: string;
  /** Agents in the squad hired from this template (matched on agent type). */
  hired: number;
}

export const CATALOGUE_VIEWS: SavedView[] = [
  // Simple (UX plan §7.10): what each template is, where it works and what it costs; it opens first while guidance is on.
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["name", "family", "module", "wage"], sort: [{ id: "family", desc: false }], filters: [] },
  { id: "all", name: "All templates", builtIn: true, columns: ["name", "family", "module", "model", "skills", "wage", "hired"], sort: [{ id: "family", desc: false }], filters: [] },
  { id: "leads", name: "Leads", builtIn: true, columns: ["name", "module", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-lead", field: "family", op: "in", value: ["lead", "assistant"] }] },
  { id: "workers", name: "Workers", builtIn: true, columns: ["name", "module", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-worker", field: "family", op: "eq", value: "worker" }] },
  { id: "channels", name: "Channel engines", builtIn: true, columns: ["name", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-channel", field: "family", op: "eq", value: "channel" }] },
  { id: "specialists", name: "Specialists", builtIn: true, columns: ["name", "model", "skills", "wage", "hired"], sort: [], filters: [{ id: "f-spec", field: "family", op: "eq", value: "specialist" }] },
  { id: "utilities", name: "Utilities", builtIn: true, columns: ["name", "model", "wage", "hired"], sort: [], filters: [{ id: "f-util", field: "family", op: "eq", value: "utility" }] },
];

export const MOVES_VIEWS: SavedView[] = [
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["name", "role", "departments", "status"], sort: [{ id: "name", desc: false }], filters: [] },
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

/**
 * The department a template is hired into by default: the department over its module (departments are labels over
 * modules). Specialists and the Operations Lead share the development module with the engineers, but in a physical
 * business they work in Operations (the department its Operations Lead leads, over the development module's
 * Specialists tab), so that department wins for them when the business has one.
 */
export function departmentForTemplate(template: Pick<TemplateRow, "module" | "family" | "key">, departments: readonly DepartmentRow[] | undefined, agents: readonly Pick<AgentRow, "id" | "agentType">[] | undefined): DepartmentRow | undefined {
  if (!template.module) return undefined;
  const moduleKey = template.module as ModuleKey;
  if (template.family === "specialist" || template.key === OPERATIONS_LEAD) {
    const operations = (departments ?? [])
      .filter((d) => !d.hidden && d.moduleKeys.includes(moduleKey))
      .sort((a, b) => a.position - b.position)
      .find((d) => (agents ?? []).some((a) => a.id === (d.leadAgentId ?? d.lead?.id) && a.agentType === OPERATIONS_LEAD));
    if (operations) return operations;
  }
  return departmentForModule(departments, moduleKey);
}

const OPERATIONS_LEAD = "operations_lead";

/** The department a template works in, by name, for the catalog's Department column. */
export function moduleLabel(template: Pick<TemplateRow, "module" | "family" | "key">, departments: readonly DepartmentRow[] | undefined, agents?: readonly Pick<AgentRow, "id" | "agentType">[]): string {
  if (!template.module) return "Any";
  return departmentForTemplate(template, departments, agents)?.name ?? humanise(template.module);
}

const FAMILY_ORDER: Record<TemplateRow["family"], number> = { assistant: 0, lead: 1, worker: 2, channel: 3, specialist: 4, utility: 5 };

/** What the Recruitment tab is for (UX plan §6.2 Explainer, C10), with the wage cap defined on first use. */
export const TEAM_RECRUITMENT_EXPLAINER = {
  screenId: "team-recruitment",
  purpose: "Hire new agents: describe one in a sentence, or pick a ready-made template from the catalog.",
  action: "Say what the agent should do and press Draft this agent; or use the … on a template and choose Hire…. It joins a department and starts next cycle.",
  watchFor: (
    <>
      The <Term id="wage_cap">wage cap</Term>: the most an agent may cost per month, in US dollars (Estimate).
    </>
  ),
} as const;

export function toCatalogueRows(catalogue: readonly TemplateRow[] | undefined, agents: readonly AgentRow[] | undefined): CatalogueRow[] {
  const hiredBy = new Map<string, number>();
  for (const a of agents ?? []) if (a.agentType && !a.archivedAt) hiredBy.set(a.agentType, (hiredBy.get(a.agentType) ?? 0) + 1);
  return (catalogue ?? [])
    .map((t) => ({ ...t, id: t.key, familyLabel: FAMILY_LABELS[t.family], hired: hiredBy.get(t.key) ?? 0 }))
    .sort((a, b) => FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] || a.name.localeCompare(b.name));
}

export function RecruitmentScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate, currency } = useWidgetData();
  const guided = useGuided();
  const now = useNow();
  const catalogue = useWidgetQuery<TemplateRow[]>("team.agents.catalogue", {});
  const agentsQuery = useAgents();
  const departments = useDepartments();
  const rows = useMemo(() => toCatalogueRows(catalogue.data, agentsQuery.data?.agents), [catalogue.data, agentsQuery.data]);
  const team = useMemo(() => (agentsQuery.data?.agents ?? []).filter((a) => !a.archivedAt), [agentsQuery.data]);
  // Saved per person, business and table (audit #204): they come back after a reload.
  const defaultViewId = useDefaultViewId("all");
  const catalogueSavedViews = useSavedViews("team.recruitment.catalog", CATALOGUE_VIEWS, { defaultViewId });
  const movesSavedViews = useSavedViews("team.recruitment.moves", MOVES_VIEWS, { defaultViewId });
  const { readOnly } = useModuleEnv();
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
  const draft = () => best && !readOnly && setHire({ template: best });
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
      // "Kind" to the founder (C10); the column id and the enum keep `family`.
      { id: "family", accessorKey: "family", header: "Kind", size: catalogueSizes.family, cell: ({ row }) => <Chip>{row.original.familyLabel}</Chip>, meta: { filter: "select", filterOptions: (Object.keys(FAMILY_LABELS) as TemplateRow["family"][]).map((f) => ({ value: f, label: FAMILY_LABELS[f] })) }, sortingFn: (a, b) => FAMILY_ORDER[a.original.family] - FAMILY_ORDER[b.original.family] },
      { id: "module", accessorFn: (r) => moduleLabel(r, departments.data, agentsQuery.data?.agents), header: "Department", size: catalogueSizes.module, meta: { label: "Department" }, cell: ({ row }) => <span className={row.original.module ? "text-primary" : "text-secondary"}>{moduleLabel(row.original, departments.data, agentsQuery.data?.agents)}</span> },
      { id: "model", accessorKey: "modelKey", header: "Model", size: catalogueSizes.model, cell: ({ row }) => <ModelChip model={row.original.modelKey} />, meta: { term: "model" } },
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
        // A wage cap caps metered model cost, so it is in US dollars whatever the business's currency (C19).
        header: "Wage cap (USD)",
        size: catalogueSizes.wage,
        meta: { numeric: true, csv: (r) => r.wageCapMinor / 100 },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
            {formatMoney({ amountMinor: row.original.wageCapMinor, currency: CREDITS_CURRENCY })}
            <span className="t-unit">/mo</span>
            <ProvenanceChip kind="estimate" />
          </span>
        ),
      },
      { id: "hired", accessorKey: "hired", header: "In team", size: catalogueSizes.hired, meta: { numeric: true }, cell: ({ row }) => (row.original.hired ? row.original.hired : <span className="text-tertiary">—</span>) },
    ], CATALOGUE_FIT),
    [catalogueSizes, departments.data, agentsQuery.data],
  );
  const catalogueActions = (row: CatalogueRow): RowAction<CatalogueRow>[] => readOnly ? [] : [{ id: "hire", label: "Hire…", icon: UserRoundPlus, onSelect: () => setHire({ template: row }) }];

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
    // One Chief of Staff per business: it is never duplicated, and the designated one is never let go.
    { id: "clone", label: "Duplicate…", icon: Copy, separatorBefore: true, disabled: isChiefOfStaffType(agent), onSelect: () => setClone(agent) },
    { id: "loan", label: "Lend to another department…", icon: ArrowLeftRight, onSelect: () => setLoan(agent) },
    { id: "release", label: "Let go", icon: UserRoundMinus, variant: "danger", separatorBefore: true, disabled: isChiefOfStaff(agent), onSelect: () => setRelease(agent) },
  ];

  return (
    <Screen name="team/recruitment">
      <Panel span={12} title="Agent builder" glow="brand" footer="The closest template gives the new agent its description, instructions, skills and tools; train it from its profile to tune them. Hiring needs no approval; the wage cap is an estimate until the first month closes.">
        <div className="flex flex-col gap-3">
          {/* The per-screen intro (UX plan §6.2): inside the first panel's body, never floating; nothing with guidance off. */}
          <Explainer {...TEAM_RECRUITMENT_EXPLAINER} />
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
            {/* The key cap is an operator's affordance: shown only with guidance off; the shortcut works in both states. */}
            <Button variant="generate" size="md" disabled={!best} kbd={guided ? undefined : "⌘↵"} onClick={draft} data-testid="draft-agent">
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
                      {formatPercent(s.score, { digits: 0 })} fit
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
                  <Button size="sm" icon={UserRoundPlus} onClick={() => setHire({ template: s.template })} disabled={Boolean(readOnly)} title={readOnly} className="mt-auto self-start">
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
        footer={
          notice ? (
            <span data-testid="recruitment-notice" className="text-secondary">
              {notice}
            </span>
          ) : (
            <span>
              Use the … on a template (or double-click it) to hire it into a department. <Term id="wage_cap">Wage caps</Term> are estimates, in US dollars.
            </span>
          )
        }
      >
        {/* What the catalog is, in one line under its title (UX plan C10): information, so it stays in both guidance states; the tab's Explainer is on the builder above. */}
        <p className="border-b border-line-faint px-panel-pad py-2 text-small text-secondary" data-testid="catalogue-intro">
          Ready-made agents. Hire one into a department and it starts next cycle.
        </p>
        <div className="min-w-0">
          <DataTable<CatalogueRow> aria-label="Catalog" data={rows} columns={catalogueColumns} {...catalogueSavedViews} defaultViewId={defaultViewId} rowActions={catalogueActions} onRowOpen={(row) => !readOnly && setHire({ template: row })} height={Math.min(480, Math.max(240, rows.length * 34 + 44))} density="comfortable" exportFileName="catalogue" className="border-0" />
        </div>
      </Panel>

      <Panel
        span={12}
        title="Team moves"
        flush
        loading={agentsQuery.isLoading && !agentsQuery.data}
        error={agentsQuery.error ? agentsQuery.error.message : undefined}
        onRetry={refetch}
        empty={agentsQuery.data && team.length === 0 ? { icon: Users, children: "Hired agents appear here; use the … on a row to duplicate one, lend it to another department or let it go." } : undefined}
        footer={`Letting an agent go: ${RELEASE_CONSEQUENCE} Duplicating copies instructions, tools, model and skills. Lending adds a department; moving replaces it.`}
      >
        <div className="min-w-0">
          <DataTable<AgentRow> aria-label="Team moves" data={team} columns={movesColumns} {...movesSavedViews} defaultViewId={defaultViewId} rowActions={movesActions} onRowOpen={(a) => open(a.id)} height={Math.min(420, Math.max(200, team.length * 28 + 44))} exportFileName="team-moves" className="border-0" />
        </div>
      </Panel>

      <HireDialog
        template={hire?.template ?? null}
        defaultName={hire?.name}
        onOpenChange={(o) => !o && setHire(null)}
        departments={departments.data}
        defaultDepartmentId={departmentId}
        preferredDepartmentId={hire ? departmentForTemplate(hire.template, departments.data, agentsQuery.data?.agents)?.id : undefined}
        onHired={(agent, template, skills) => {
          setNotice(`${agent.name ?? template.name} hired${skills ? ` with ${plural(skills, "added skill")}` : ""}. Train it from its profile to tune its skills.`);
          setSentence("");
          refetch();
        }}
      />
      <ReleaseDialog agent={release} onOpenChange={(o) => !o && setRelease(null)} onReleased={(a) => { setNotice(`${a.name} has left the team.`); refetch(); }} />
      <CloneDialog agent={clone} onOpenChange={(o) => !o && setClone(null)} departments={departments.data} onCloned={(c) => { setNotice(`${c.name} joined the team.`); refetch(); }} />
      <LoanDialog agent={loan} onOpenChange={(o) => !o && setLoan(null)} departments={departments.data} onLoaned={(a, deptId, move) => { setNotice(`${a.name} ${move ? "moved to" : "lent to"} ${departments.data?.find((d) => d.id === deptId)?.name ?? "another department"}.`); refetch(); }} />
    </Screen>
  );
}
