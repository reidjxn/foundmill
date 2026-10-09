"use client";
/**
 * Team › Squad (BUILD §6.3, §11.9): the squad DataTable with the exact columns Agent, Role, Department(s), Status,
 * Current task, Form, Rating, Tools, Model, Wage, Latest update built from Dugout's squad cells, the five saved views
 * General / Health / Tools / Cost / Performance, right-click verbs (open profile, change model, clone, loan, release)
 * and live status: `agent.health_changed` flips the row within 2 s (AC-11.9.1).
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Copy, Cpu, ExternalLink, UserRoundMinus, UserRoundPlus, Users } from "lucide-react";
import { Avatar, Button, DataTable, EntityLink, MODEL_LABELS, Panel, SQUAD_VIEWS, formatRelative, squadColumns, type DataTableColumn, type RowAction, type SavedView, type SquadRow } from "@foundmill/dugout";
import { AGENT_STATUSES } from "@foundmill/shared/constants";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { CloneDialog, LoanDialog, ReleaseDialog } from "./dialogs";
import { ModelChangeDialog, describeModelSet } from "./ModelChangeDialog";
import { AgentStatusWordPill, InlineError, STATUS_WORD, Screen, agentEntity, agentHref, agentTypeNoun, taskHref, toSquadRow, useAgents, useLiveAgentStatus, useNow, useTeamOptions, withLiveStatus } from "./shared";
import type { AgentRow } from "./types";

/** The five BUILD §11.9 views, with Wage and Tools reachable from General through the column chooser. */
export const TEAM_SQUAD_VIEWS: SavedView[] = SQUAD_VIEWS;

/** "12 agents · 9 healthy · 2 down · 1 idle" for the toolbar. */
export function squadSummary(agents: readonly Pick<AgentRow, "status">[]): string {
  const counts = new Map<string, number>();
  for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const parts = [`${agents.length} ${agents.length === 1 ? "agent" : "agents"}`];
  for (const s of AGENT_STATUSES) {
    const n = counts.get(s);
    if (n) parts.push(`${n} ${STATUS_WORD[s].toLowerCase()}`);
  }
  return parts.join(" · ");
}

export function SquadScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate, currency = "EUR" } = useWidgetData();
  const { liveRefetchMs } = useTeamOptions();
  const now = useNow();
  const agentsQuery = useAgents();
  const departments = useDepartments();
  const live = useLiveAgentStatus(agentsQuery, { debounceMs: liveRefetchMs });
  const agents = useMemo(() => withLiveStatus(agentsQuery.data?.agents, live).filter((a) => !a.archivedAt), [agentsQuery.data, live]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const rows = useMemo(() => agents.map((a) => toSquadRow(a, currency)), [agents, currency]);
  const [views, setViews] = useState<SavedView[]>(TEAM_SQUAD_VIEWS);
  const [modelAgent, setModelAgent] = useState<AgentRow | null>(null);
  const [release, setRelease] = useState<AgentRow | null>(null);
  const [clone, setClone] = useState<AgentRow | null>(null);
  const [loan, setLoan] = useState<AgentRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (agentId: string) => navigate(agentHref(businessId, agentId));
  const teamDept = departmentForModule(departments.data, "team");
  const recruitHref = routes.department(businessId, teamDept?.slug ?? "team", "recruitment");

  const columns = useMemo<DataTableColumn<SquadRow>[]>(() => {
    const base = squadColumns({
      now,
      onModelClick: (row) => {
        const a = byId.get(row.id);
        if (a) setModelAgent(a);
      },
      renderTask: (row) =>
        row.currentTask ? (
          <a
            href={taskHref(businessId, row.currentTask.id)}
            className="entity-link truncate"
            onClick={(e) => {
              e.preventDefault();
              navigate(taskHref(businessId, row.currentTask!.id));
            }}
          >
            {row.currentTask.title}
          </a>
        ) : (
          <span className="text-secondary">—</span>
        ),
    });
    return base.map((col) => {
      if (col.id === "name") {
        return {
          ...col,
          cell: ({ row }) => {
            const agent = byId.get(row.original.id);
            return (
              <span className="inline-flex min-w-0 items-center gap-2">
                <Avatar size={24} name={row.original.name} agent={{ seed: row.original.seed, dept: row.original.dept }} status={row.original.status} />
                <EntityLink entity={{ id: row.original.id, kind: "agent", name: row.original.name, href: agentHref(businessId, row.original.id) }} details={agent ? agentEntity(businessId, agent, currency) : undefined} hideIcon className="text-body-strong" onOpen={(e) => open(e.id)} onVerb={(verb, e) => verb === "open_profile" && open(e.id)} />
              </span>
            );
          },
        };
      }
      if (col.id === "status") {
        return {
          ...col,
          cell: ({ row }) => <AgentStatusWordPill status={row.original.status} expectedReturnAt={row.original.expectedReturnAt} now={now} />,
          meta: { ...col.meta, filter: "select", filterOptions: AGENT_STATUSES.map((s) => ({ value: s, label: STATUS_WORD[s] })) },
        };
      }
      if (col.id === "departments") return { ...col, header: "Department(s)" };
      return col;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open`/`navigate` are stable per data source
  }, [businessId, byId, currency, now]);

  const rowActions = (row: SquadRow): RowAction<SquadRow>[] => {
    const agent = byId.get(row.id);
    return [
      { id: "open", label: "Open profile", icon: ExternalLink, onSelect: () => open(row.id) },
      { id: "model", label: `Change model (${MODEL_LABELS[row.model]})`, icon: Cpu, onSelect: () => agent && setModelAgent(agent) },
      { id: "clone", label: "Clone…", icon: Copy, separatorBefore: true, onSelect: () => agent && setClone(agent) },
      { id: "loan", label: "Loan to department…", icon: ArrowLeftRight, onSelect: () => agent && setLoan(agent) },
      { id: "release", label: "Release", icon: UserRoundMinus, variant: "danger", separatorBefore: true, disabled: agent ? agent.agentType === "chief_of_staff" : true, onSelect: () => agent && setRelease(agent) },
    ];
  };

  const typeCount = modelAgent ? agents.filter((a) => agentTypeNoun(a) === agentTypeNoun(modelAgent)).length : 0;
  const refetch = () => agentsQuery.refetch();
  const liveNote = live.size ? `${live.size} live ${live.size === 1 ? "change" : "changes"} applied ${formatRelative([...live.values()].map((l) => l.at).sort().at(-1)!, now)}` : null;

  return (
    <Screen name="team/squad">
      <Panel
        span={12}
        title="Agents"
        flush
        loading={agentsQuery.isLoading && !agentsQuery.data}
        error={agentsQuery.error ? agentsQuery.error.message : undefined}
        onRetry={refetch}
        empty={agentsQuery.data && agents.length === 0 ? { icon: Users, title: "No agents yet", children: "The team table lists every agent with its status, form, rating, model and wage once the first one is hired. Hire from the catalogue on the Recruitment tab.", action: { label: "Go to Recruitment", icon: UserRoundPlus, onClick: () => navigate(recruitHref) } } : undefined}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-small text-secondary tabular-nums" data-testid="squad-summary">
              {squadSummary(agents)}
            </span>
            <Button size="sm" icon={UserRoundPlus} onClick={() => navigate(recruitHref)}>
              Hire
            </Button>
          </div>
        }
        footer={
          <span className="flex items-center gap-2">
            <span>Wage is this month's cost estimate: tokens, sandbox minutes and tool calls. Status updates arrive live.</span>
            {liveNote ? <span data-testid="live-note">{liveNote}</span> : null}
            {notice ? <span data-testid="model-notice">{notice}</span> : null}
          </span>
        }
      >
        <DataTable<SquadRow>
          aria-label="Agents"
          data={rows}
          columns={columns}
          views={views}
          onViewsChange={setViews}
          defaultViewId="general"
          rowActions={rowActions}
          onRowOpen={(row) => open(row.id)}
          height={typeof window === "undefined" ? 480 : Math.max(320, window.innerHeight - 264)}
          exportFileName="squad"
          className="border-0"
        />
        <InlineError error={agentsQuery.error} className="px-panel-pad" />
      </Panel>

      <ModelChangeDialog
        agent={modelAgent}
        onOpenChange={(o) => !o && setModelAgent(null)}
        typeCount={typeCount}
        allCount={agents.length}
        currency={currency}
        onApplied={(result, modelKey) => {
          setNotice(describeModelSet(result, modelKey));
          refetch();
        }}
      />
      <ReleaseDialog agent={release} onOpenChange={(o) => !o && setRelease(null)} onReleased={refetch} />
      <CloneDialog agent={clone} onOpenChange={(o) => !o && setClone(null)} departments={departments.data} onCloned={(c) => { refetch(); setNotice(`${c.name} joined the team.`); }} />
      <LoanDialog agent={loan} onOpenChange={(o) => !o && setLoan(null)} departments={departments.data} onLoaned={(a, deptId, move) => { refetch(); setNotice(`${a.name} ${move ? "moved to" : "on loan to"} ${departments.data?.find((d) => d.id === deptId)?.name ?? "another department"}${departmentId === deptId ? " (this one)" : ""}.`); }} />
    </Screen>
  );
}
