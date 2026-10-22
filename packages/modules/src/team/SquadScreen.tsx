"use client";
/**
 * Team › Agents (BUILD §6.3, §11.9): the team DataTable with the exact columns Agent, Role, Department(s), Status,
 * Current task, Form, Rating /20, Tools, Model, AI cost, Latest update built from Dugout's team cells, the five saved
 * views General / Health / Tools / Cost / Performance, right-click verbs (open profile, change model, duplicate, lend,
 * let go) and live status: `agent.health_changed` flips the row within 2 s (AC-11.9.1).
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Copy, Cpu, ExternalLink, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Button, DataTable, Explainer, FormCells, MODEL_LABELS, Panel, SQUAD_VIEWS, Term, formatRelative, squadColumns, useAgentPersona, useGuided, type DataTableColumn, type RowAction, type SavedView, type SquadRow } from "@foundmill/dugout";
import { AGENT_STATUSES } from "@foundmill/shared/constants";
import { moduleTabHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useWidgetData } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { usePinToHomeMenu } from "@foundmill/widgets/shared/pin";
import { useModuleEnv } from "../env";
import { fitToGrow, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { CloneDialog, LoanDialog, ReleaseDialog } from "./dialogs";
import { ModelChangeDialog, describeModelSet } from "./ModelChangeDialog";
import { AgentCell, AgentStatusWordPill, InlineError, STATUS_WORD, Screen, agentEntity, agentHref, agentTypeNoun, isChiefOfStaff, isChiefOfStaffType, taskHref, toSquadRow, useAgents, useLiveAgentStatus, useNow, useTeamOptions, withLiveStatus } from "./shared";
import type { AgentRow } from "./types";

/** The built-in "Simple" saved view (UX plan §7.10): the four columns a first-timer needs, the table's default while guidance is on. */
export const SIMPLE_VIEW_ID = "simple";

/**
 * Simple first, then the five BUILD §11.9 views. Simple (UX plan §7.10) is Agent, Status, Current task, Rating and
 * opens by default while guidance is on; General shows the AI cost (DESIGN §9 Team) and fits the panel at 1280 and
 * 1440; Tools and the latest update are in the Tools, Health and Performance views and the column chooser.
 */
export const TEAM_SQUAD_VIEWS: SavedView[] = [
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["name", "status", "currentTask", "rating"], sort: [{ id: "rating", desc: true }], filters: [] },
  ...SQUAD_VIEWS.map((v) => (v.id === "general" ? { ...v, columns: ["name", "role", "departments", "status", "currentTask", "form", "rating", "model", "wage"] } : v)),
];

/** What the Agents tab is for (UX plan §7.10, the Team sentence), with the words a founder meets here defined on first use. */
export const TEAM_AGENTS_EXPLAINER = {
  screenId: "team-agents",
  purpose: (
    <>
      Everyone who works here. Agents have skills 1–20 (their <Term id="rating">rating</Term>) that improve with <Term id="training">training</Term>.
    </>
  ),
  action: (
    <>
      Open an agent to see its skills and train it. Right-click a row, or use its … button, to change its <Term id="model">model</Term>, lend it to another department or let it go.
    </>
  ),
  watchFor: "An agent that is Down or Failing needs you: its row says what to reconnect or what went wrong.",
} as const;

/**
 * Column minimums (what each cell needs at 13 px, padding included) and how the extra width is shared. The rating
 * column holds the 1–20 figure and its band word ("16.5 Excellent"); the text columns truncate, so they give way.
 */
export const SQUAD_FIT: Record<string, ColumnFit> = {
  name: { min: 160, grow: 3 },
  role: { min: 104, grow: 2 },
  departments: { min: 96, grow: 1 },
  status: { min: 100, grow: 1 },
  currentTask: { min: 112, grow: 4 },
  form: { min: 76 },
  rating: { min: 120 },
  tools: { min: 132 },
  model: { min: 92 },
  wage: { min: 108 },
  latestUpdate: { min: 240, grow: 2 },
};

/** "12 agents · 9 healthy · 2 down · 1 idle" for the panel header. */
export function squadSummary(agents: readonly Pick<AgentRow, "status">[]): string {
  const counts = new Map<string, number>();
  for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const parts = [plural(agents.length, "agent")];
  for (const s of AGENT_STATUSES) {
    const n = counts.get(s);
    if (n) parts.push(`${n} ${STATUS_WORD[s].toLowerCase()}`);
  }
  return parts.join(" · ");
}

export function SquadScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate, currency } = useWidgetData();
  const { readOnly } = useModuleEnv();
  const { liveRefetchMs } = useTeamOptions();
  const guided = useGuided();
  const now = useNow();
  const agentsQuery = useAgents();
  // Pin to Home (audit #394): the agents are the gallery's team pulse widget.
  const pinMenu = usePinToHomeMenu({ key: "squad_pulse" });
  const departments = useDepartments();
  const live = useLiveAgentStatus(agentsQuery, { debounceMs: liveRefetchMs });
  const agents = useMemo(() => withLiveStatus(agentsQuery.data?.agents, live).filter((a) => !a.archivedAt), [agentsQuery.data, live]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const rows = useMemo(() => agents.map((a) => toSquadRow(a, currency)), [agents, currency]);
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance
  // is on (UX plan §7.10); a view the person left open still wins.
  const defaultViewId = guided ? SIMPLE_VIEW_ID : "general";
  const savedViews = useSavedViews("team.agents", TEAM_SQUAD_VIEWS, { defaultViewId });
  const [modelAgent, setModelAgent] = useState<AgentRow | null>(null);
  const [release, setRelease] = useState<AgentRow | null>(null);
  const [clone, setClone] = useState<AgentRow | null>(null);
  const [loan, setLoan] = useState<AgentRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const persona = useAgentPersona();
  const open = (agentId: string) => navigate(agentHref(businessId, agentId));
  const recruitHref = moduleTabHref(businessId, departments.data, "team", "recruitment");

  const columns = useMemo<DataTableColumn<SquadRow>[]>(() => {
    // Sized from SQUAD_FIT; the table shares its spare width by the specs' weights itself (DataTable `meta.grow`).
    const base = fitToGrow(squadColumns({
      now,
      displayName: (r) => persona.nameFor(r),
      onModelClick: (row) => {
        const a = byId.get(row.id);
        if (a) setModelAgent(a);
      },
      renderTask: (row) =>
        row.currentTask ? (
          <a
            href={taskHref(businessId, row.currentTask.id, departments.data)}
            className="entity-link block min-w-0 truncate"
            onClick={(e) => {
              e.preventDefault();
              navigate(taskHref(businessId, row.currentTask!.id, departments.data));
            }}
          >
            {row.currentTask.title}
          </a>
        ) : (
          <span className="text-tertiary">—</span>
        ),
    }), SQUAD_FIT);
    return base.map((col): DataTableColumn<SquadRow> => {
      const sized = col;
      if (col.id === "name") {
        return {
          ...sized,
          cell: ({ row }) => {
            const agent = byId.get(row.original.id);
            return <AgentCell businessId={businessId} agent={{ id: row.original.id, name: row.original.name, seed: row.original.seed, dept: row.original.dept, status: row.original.status, role: row.original.role, personaKey: row.original.personaKey }} details={agent ? agentEntity(businessId, agent, currency) : undefined} onOpen={open} />;
          },
        };
      }
      if (col.id === "status") {
        return {
          ...sized,
          cell: ({ row }) => <AgentStatusWordPill status={row.original.status} expectedReturnAt={row.original.expectedReturnAt} now={now} />,
          meta: { ...col.meta, filter: "select", filterOptions: AGENT_STATUSES.map((s) => ({ value: s, label: STATUS_WORD[s] })) },
        };
      }
      // No results yet reads as words, not five unlit plates (DESIGN §2: colour is never the only signal).
      if (col.id === "form") {
        return { ...sized, cell: ({ row }) => (row.original.form.length ? <FormCells form={row.original.form} name={`${row.original.name} form`} /> : <span className="text-small text-tertiary">None yet</span>) };
      }
      if (col.id === "departments") return { ...sized, header: "Departments" };
      return sized;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open`/`navigate` are stable per data source
  }, [businessId, byId, currency, now, persona]);

  const rowActions = (row: SquadRow): RowAction<SquadRow>[] => {
    const agent = byId.get(row.id);
    return [
      { id: "open", label: "Open profile", icon: ExternalLink, onSelect: () => open(row.id) },
      { id: "model", label: `Change model (${MODEL_LABELS[row.model]})`, icon: Cpu, onSelect: () => agent && setModelAgent(agent) },
      // One Chief of Staff per business: it is never duplicated, and the designated one is never let go.
      { id: "clone", label: "Duplicate…", icon: Copy, separatorBefore: true, disabled: agent ? isChiefOfStaffType(agent) : true, onSelect: () => agent && setClone(agent) },
      { id: "loan", label: "Lend to another department…", icon: ArrowLeftRight, onSelect: () => agent && setLoan(agent) },
      { id: "release", label: "Let go", icon: UserRoundMinus, variant: "danger", separatorBefore: true, disabled: agent ? isChiefOfStaff(agent) : true, onSelect: () => agent && setRelease(agent) },
    ];
  };

  const typeCount = modelAgent ? agents.filter((a) => agentTypeNoun(a) === agentTypeNoun(modelAgent)).length : 0;
  const refetch = () => agentsQuery.refetch();
  const liveNote = live.size ? `${plural(live.size, "live change")} applied ${formatRelative([...live.values()].map((l) => l.at).sort().at(-1)!, now)}` : null;

  return (
    <Screen name="team/squad">
      <Panel
        span={12}
        title="Agents"
        menu={pinMenu}
        flush
        loading={agentsQuery.isLoading && !agentsQuery.data}
        error={agentsQuery.error ? agentsQuery.error.message : undefined}
        onRetry={refetch}
        empty={agentsQuery.data && agents.length === 0 ? { icon: Users, title: "No agents yet", children: "The team table lists every agent with its status, form, rating, model and AI cost once the first one is hired. Hire from the catalog on the Recruitment tab.", action: { label: "Go to Recruitment", icon: UserRoundPlus, onClick: () => navigate(recruitHref) } } : undefined}
        meta={agents.length ? <span data-testid="squad-summary">{squadSummary(agents)}</span> : undefined}
        actions={
          <Button size="sm" icon={UserRoundPlus} onClick={() => navigate(recruitHref)} disabled={Boolean(readOnly)} title={readOnly}>
            Hire
          </Button>
        }
        footer={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/*
              The column heads defined once, under the table, while guidance is on (UX plan §7.10 "column heads that
              are terms become Terms"): the heads themselves sit inside the table's sort buttons, so the dotted words
              live here until DataTable renders a `meta.term` beside the sort control. The Form key (C2) is the first.
            */}
            {guided ? (
              <span data-testid="form-caption">
                <Term id="form">Form</Term>: the last five tasks.
              </span>
            ) : null}
            {guided ? (
              <span data-testid="column-terms">
                <Term id="rating">Rating</Term> is the 1–20 mean of the agent's skills. <Term id="model">Model</Term> is the AI it runs on.
              </span>
            ) : null}
            <span>
              <Term id="wage">AI cost</Term> is this month's model, sandbox and tool spend so far, in US dollars (Estimate). Status updates arrive live.
            </span>
            {liveNote ? <span data-testid="live-note">{liveNote}</span> : null}
            {notice ? (
              <span data-testid="model-notice" className="text-secondary">
                {notice}
              </span>
            ) : null}
          </span>
        }
      >
        {/* The per-screen intro (UX plan §6.2): inside the first panel's body, on surface-2, never floating; nothing with guidance off. */}
        <div className="px-panel-pad pt-panel-pad empty:hidden">
          <Explainer {...TEAM_AGENTS_EXPLAINER} />
        </div>
        <div className="min-w-0">
          <DataTable<SquadRow>
            aria-label="Agents"
            data={rows}
            columns={columns}
            {...savedViews}
            defaultViewId={defaultViewId}
            rowActions={rowActions}
            onRowOpen={(row) => open(row.id)}
            height={typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 264)}
            exportFileName="agents"
            className="border-0"
          />
        </div>
        <InlineError error={agentsQuery.error} className="px-panel-pad" />
      </Panel>

      <ModelChangeDialog
        agent={modelAgent}
        onOpenChange={(o) => !o && setModelAgent(null)}
        typeCount={typeCount}
        allCount={agents.length}
        onApplied={(result, modelKey) => {
          setNotice(describeModelSet(result, modelKey));
          refetch();
        }}
      />
      <ReleaseDialog agent={release} onOpenChange={(o) => !o && setRelease(null)} onReleased={refetch} />
      <CloneDialog agent={clone} onOpenChange={(o) => !o && setClone(null)} departments={departments.data} onCloned={(c) => { refetch(); setNotice(`${c.name} joined the team.`); }} />
      <LoanDialog agent={loan} onOpenChange={(o) => !o && setLoan(null)} departments={departments.data} onLoaned={(a, deptId, move) => { refetch(); setNotice(`${a.name} ${move ? "moved to" : "lent to"} ${departments.data?.find((d) => d.id === deptId)?.name ?? "another department"}${departmentId === deptId ? " (this one)" : ""}.`); }} />
    </Screen>
  );
}
