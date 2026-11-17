"use client";
/**
 * Team › Agents (BUILD §6.3, §11.9): the team DataTable with the exact columns Agent, Role, Department(s), Status,
 * Current task, Form, Rating /20, Tools, Model, AI cost, Latest update built from Dugout's team cells, the five saved
 * views General / Health / Tools / Cost / Performance, right-click verbs (open profile, change model, duplicate, lend,
 * let go) and live status: `agent.health_changed` flips the row within 2 s (AC-11.9.1).
 *
 * Leads first (founder, 2026-11-08): the Chief of Staff pinned first, then the leads in department order, each with a
 * "+N specialists" expander (collapsed by default) over its specialists, indented. Sorting orders each level; a filter
 * keeps a lead whose specialist matches and opens it; saved views keep their shape (expansion is never saved); the CSV
 * is flat with a "Reports to" column. Background helpers are not rows: one line under the table says they run and
 * opens their read-only list.
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Copy, Cpu, ExternalLink, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Button, DataTable, Explainer, FormCells, MODEL_LABELS, Panel, SQUAD_VIEWS, Term, formatRelative, squadColumns, useAgentPersona, useBuilderView, useGuided, type DataTableColumn, type RowAction, type SavedView, type SquadRow } from "@foundmill/dugout";
import { AGENT_STATUSES } from "@foundmill/shared/constants";
import { startingTeam } from "@foundmill/shared/starting-team";
import { teamCaption, teamTree, type TeamTree } from "@foundmill/shared/team-tiers";
import { needsAttention } from "@foundmill/widgets/shared/health";
import { moduleTabHref, useDepartments } from "@foundmill/widgets/shared/departments";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { usePinToHomeMenu } from "@foundmill/widgets/shared/pin";
import { useModuleEnv } from "../env";
import { fitToGrow, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { BackgroundHelpersLine } from "./BackgroundHelpers";
import { CloneDialog, LoanDialog, ReleaseDialog } from "./dialogs";
import { ModelChangeDialog, describeModelSet } from "./ModelChangeDialog";
import { AgentCell, AgentStatusWordPill, InlineError, STATUS_WORD, Screen, agentEntity, agentHref, agentTypeNoun, isChiefOfStaff, isChiefOfStaffType, taskHref, toSquadRow, useAgents, useLiveAgentStatus, useNow, useTeamOptions, withLiveStatus } from "./shared";
import type { AgentRow } from "./types";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";

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

/**
 * The views with Builder view off (docs/DESIGN.md): Simple reads Agent, Status, Current task, Latest update (the rating
 * is Builder view's); Form, Rating, Tools and Model drop out of every view and the Health, Tools and Performance views
 * are not offered (DataTable `builderOnly`).
 */
export const FOUNDER_SIMPLE_COLUMNS = ["name", "status", "currentTask", "latestUpdate"];
export function teamSquadViews(builder: boolean): SavedView[] {
  return builder ? TEAM_SQUAD_VIEWS : TEAM_SQUAD_VIEWS.map((v) => (v.id === SIMPLE_VIEW_ID ? { ...v, columns: FOUNDER_SIMPLE_COLUMNS, sort: [] } : v));
}

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

/**
 * "Chief of Staff · 6 leads · 23 specialists · 2 need you" for the panel header: the tiers the founder sees (background
 * helpers are not in it), and how many of them are failing, down or degraded.
 */
export function squadSummary(agents: readonly AgentRow[], departments?: readonly DepartmentRow[] | null): string {
  const tree = teamTree(agents, departments);
  return teamCaption(tree.counts, tree.visible.filter((a) => needsAttention(a.status)).length);
}

/** "+3 specialists": the words on a lead row's expander. */
export function specialistsLabel(count: number): string {
  return `+${count} ${count === 1 ? "specialist" : "specialists"}`;
}

/**
 * The table's rows: the Chief of Staff and each lead as a top-level row, its specialists as `reports`. `reportsTo` is
 * who each one reports to in words (the CSV's "Reports to"), named as the table names agents.
 */
export function squadTreeRows(tree: TeamTree<AgentRow>, currency: string, nameOf: (agent: AgentRow) => string, founder = "You"): SquadRow[] {
  const byId = new Map(tree.visible.map((a) => [a.id, a]));
  const reportsTo = (a: AgentRow) => {
    const parent = tree.parentOf.get(a.id);
    const agent = parent ? byId.get(parent) : undefined;
    return agent ? nameOf(agent) : founder;
  };
  const row = (a: AgentRow): SquadRow => ({ ...toSquadRow(a, currency), tier: tree.tierOf.get(a.id) as SquadRow["tier"], reportsTo: reportsTo(a) });
  return tree.groups.map((g) => ({ ...row(g.agent), reports: g.specialists.length ? g.specialists.map(row) : undefined }));
}

/** What the first-week view reads from `today.get`: `firstWeek` is not null only in a project's first days. */
interface TodayFirstWeek {
  firstWeek?: unknown | null;
}

/**
 * The first week's rows (WP-04 T4; founder decision 2: everyone is hired, the starting team is shown): the starting
 * agents (`STARTING_TEAM_TEMPLATE_KEYS`, by agent type) and any agent with a current task, in the list's own order.
 */
export function firstWeekAgents(agents: readonly AgentRow[]): AgentRow[] {
  const { starting } = startingTeam(agents.map((a) => ({ templateKey: a.agentType ?? "", agent: a })));
  const shown = new Set(starting.map((s) => s.agent.id));
  return agents.filter((a) => shown.has(a.id) || Boolean(a.currentTask));
}

export const FIRST_WEEK_WORDS = {
  caption: "Showing who is working this week",
  showAll: (n: number) => `Show all ${n}`,
} as const;

/** The Chief of Staff's row stays first whatever the sort. */
const isChiefRow = (r: SquadRow) => r.tier === "chief";
/** The CSV is flat; this column keeps the shape the table shows. */
const REPORTS_TO_EXPORT = [{ header: "Reports to", value: (r: SquadRow) => r.reportsTo ?? "" }];

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
  const persona = useAgentPersona();
  // Leads first: the tiers and reporting lines from what is stored (packages/shared team-tiers).
  const tree = useMemo(() => teamTree(agents, departments.data), [agents, departments.data]);
  // The first week (WP-04 T4): the starting team and whoever has work, until "Show all". A reader without Today, or a
  // read still loading, sees everyone.
  const today = useWidgetQuery<TodayFirstWeek>("today.get", {});
  const [showAll, setShowAll] = useState(false);
  const firstWeekRows = useMemo(() => firstWeekAgents(tree.visible), [tree.visible]);
  const narrowed = !showAll && today.data?.firstWeek != null && firstWeekRows.length < tree.visible.length;
  const shownTree = useMemo(() => (narrowed ? teamTree([...firstWeekRows, ...tree.background], departments.data) : tree), [narrowed, firstWeekRows, tree, departments.data]);
  const rows = useMemo(() => squadTreeRows(shownTree, currency, (a) => persona.labelFor(a)), [shownTree, currency, persona]);
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance
  // is on (UX plan §7.10); a view the person left open still wins.
  const defaultViewId = guided ? SIMPLE_VIEW_ID : "general";
  const builder = useBuilderView();
  const builtInViews = useMemo(() => teamSquadViews(builder), [builder]);
  const savedViews = useSavedViews("team.agents", builtInViews, { defaultViewId });
  const [modelAgent, setModelAgent] = useState<AgentRow | null>(null);
  const [release, setRelease] = useState<AgentRow | null>(null);
  const [clone, setClone] = useState<AgentRow | null>(null);
  const [loan, setLoan] = useState<AgentRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        meta={agents.length ? <span data-testid="squad-summary">{teamCaption(tree.counts, tree.visible.filter((a) => needsAttention(a.status)).length)}</span> : undefined}
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
            <BackgroundHelpersLine businessId={businessId} helpers={tree.background} now={now} />
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
        {narrowed ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-panel-pad pt-panel-pad" data-testid="squad-first-week">
            <span className="text-small text-secondary">{FIRST_WEEK_WORDS.caption}</span>
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)} data-testid="squad-show-all">
              {FIRST_WEEK_WORDS.showAll(tree.visible.length)}
            </Button>
          </div>
        ) : null}
        <div className="min-w-0">
          <DataTable<SquadRow>
            aria-label="Agents"
            data={rows}
            columns={columns}
            {...savedViews}
            defaultViewId={defaultViewId}
            getSubRows={(r) => r.reports}
            subRowsLabel={(_r, n) => specialistsLabel(n)}
            isPinnedRow={isChiefRow}
            exportColumns={REPORTS_TO_EXPORT}
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
