"use client";
/**
 * Development › Plan (BUILD §6.3, §11.6): the tasks as a DataTable with saved views, a Run column (running, run now,
 * runs after another task) and right-click verbs, a dependency view (TaskGraph) for the selected task, and the optional
 * "plan something sooner" trigger (`dev.tasks.plan` from a roadmap item or a goal). The team plans the roadmap's Now
 * items into tasks on its own, cycle by cycle; nobody has to build a task graph.
 */
import { useId, useMemo, useRef, useState } from "react";
import { ArrowUpCircle, Bot, ChevronRight, ExternalLink, ListTree, Network, Pause, Play, Radio, Square } from "lucide-react";
import { Avatar, BuilderOnly, Button, Chip, DataTable, EntityLink, useAgentPersona, Field, GenerateControl, KeyValueList, Panel, ProgressRing, ProvenanceChip, STRONGEST_MODEL_LABEL, TASK_STATUS_META, TaskGraph, TaskResult, TaskRunState, Term, Textarea, SimpleSelect, useTerm, canStartTask, taskRunInfo, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import type { TaskStatus } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useBusinessStage } from "../stage";
import { useSavedViews } from "@foundmill/widgets/shared/saved-views";
import { RelativeDateText } from "../dates";
import { fitColumns, fitToGrow, humanise, plural, type ColumnFit } from "../fit";
import type { ModuleScreenProps } from "../registry";
import { OpenInClaudeCodeDialog, ReassignDialog, StopDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { InlineError, SIMPLE_VIEW_ID, Screen, TaskStatusPill, agentBranch, agentHref, progressValue, toDate, toTileAgent, useAction, useAgentIndex, useAgents, useDefaultViewId, useDevDepartment } from "./shared";
import { toGraphNodes } from "./TrainingGroundScreen";
import type { AgentRow, PlanResponse, RoadmapListResponse, TaskGetResponse, TaskRow, TasksListResponse } from "./types";

export interface PlanRow extends TaskRow {
  agentName: string;
  agent: AgentRow | undefined;
  dependsOn: string[];
  /** Titles of the dependencies whose task is not done yet, in edge order: what this task still waits for. */
  waitingOn: string[];
  blocks: string[];
  progressNumber: number;
  startedDate: Date | null;
}

export const PLAN_VIEWS: SavedView[] = [
  // Every built-in view fits the Plan panel at 1280 (668 px) with its columns at their minimum widths (PLAN_FIT), so no
  // column hides past the panel's edge; Started, Depends on and Priority stay in the column chooser and other views.
  // Simple (UX plan §7.10): Task, Run, Status, Agent, Progress; the table opens on it while guidance is on. The 44 px Run
  // column follows Task in every view (a view saved before it existed gets it too: `withRunColumn`).
  { id: SIMPLE_VIEW_ID, name: "Simple", builtIn: true, columns: ["title", "run", "status", "agentName", "progressNumber"], sort: [{ id: "priority", desc: true }], filters: [] },
  { id: "all", name: "All tasks", builtIn: true, columns: ["title", "run", "status", "kind", "agentName", "progressNumber"], sort: [{ id: "priority", desc: true }], filters: [] },
  { id: "ready", name: "Ready to start", builtIn: true, columns: ["title", "run", "agentName", "dependsOn", "priority"], sort: [{ id: "priority", desc: true }], filters: [{ id: "f-ready", field: "status", op: "in", value: ["ready", "planned"] }] },
  { id: "in-progress", name: "In progress", builtIn: true, columns: ["title", "run", "status", "agentName", "progressNumber", "startedDate"], sort: [{ id: "startedDate", desc: true }], filters: [{ id: "f-live", field: "status", op: "in", value: ["running", "paused", "blocked", "review", "merging"] }] },
  { id: "blocked", name: "Blocked", builtIn: true, columns: ["title", "run", "agentName", "dependsOn", "progressNumber"], sort: [], filters: [{ id: "f-blocked", field: "status", op: "eq", value: "blocked" }] },
  { id: "done", name: "Done", builtIn: true, columns: ["title", "run", "agentName", "kind", "startedDate"], sort: [{ id: "startedDate", desc: true }], filters: [{ id: "f-done", field: "status", op: "in", value: ["done", "failed", "stopped"] }] },
];

const STATUS_OPTIONS = (["planned", "ready", "running", "paused", "blocked", "review", "merging", "done", "failed", "stopped"] as TaskStatus[]).map((s) => ({ value: s, label: TASK_STATUS_META[s].word }));

/** Task kinds in words (the API sends keys). */
export const KIND_LABELS: Record<string, string> = { code: "Code", research: "Research", channel: "Channel", specialist: "Specialist", legal: "Legal", finance: "Finance", ops: "Operations" };
export const kindLabel = (kind: string | null | undefined): string => (kind ? (KIND_LABELS[kind] ?? humanise(kind)) : "—");
const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Column minimums (what each cell needs, padding included) and how the extra width is shared. In "All tasks" the
 * first six (Task, Run, Status, Kind, Agent, Progress) and the "…" column fill the 668 px panel at 1280 and 1440;
 * Started, Depends on and Priority follow behind the scroll cue.
 */
export const PLAN_FIT: Record<string, ColumnFit> = {
  title: { min: 180, grow: 5 },
  run: { min: 44 },
  status: { min: 108 },
  kind: { min: 84 },
  agentName: { min: 116, grow: 2 },
  progressNumber: { min: 88 },
  startedDate: { min: 104 },
  dependsOn: { min: 220, grow: 1 },
  priority: { min: 88 },
};

export function toPlanRows(tasks: readonly TaskRow[], edges: readonly { fromTask: string; toTask: string }[], agents: Map<string, AgentRow>, nameFor: (agent: AgentRow) => string = (a) => a.name): PlanRow[] {
  // `nameFor` names the agent as the cell shows it (the persona label under the reader's preference), so sort, filter and
  // CSV match what is shown (One name everywhere, Nov 8, 2026).
  // Dependencies are named the way the founder reads them (0070): the founder title when there is one.
  const titles = new Map(tasks.map((t) => [t.id, t.founderTitle ?? t.title]));
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  return tasks.map((t) => {
    const agent = t.assigneeAgentId ? agents.get(t.assigneeAgentId) : undefined;
    return {
      ...t,
      agent,
      agentName: agent ? nameFor(agent) : t.assigneeAgentId ? "Agent" : "Unassigned",
      dependsOn: edges.filter((e) => e.toTask === t.id).map((e) => titles.get(e.fromTask) ?? e.fromTask),
      // A dependency is open while its task is not done; one the list does not hold cannot be waited on.
      waitingOn: edges.filter((e) => e.toTask === t.id && titles.has(e.fromTask) && !done.has(e.fromTask)).map((e) => titles.get(e.fromTask)!),
      blocks: edges.filter((e) => e.fromTask === t.id).map((e) => titles.get(e.toTask) ?? e.toTask),
      progressNumber: Math.round(progressValue(t.progress) * 100),
      startedDate: toDate(t.startedAt),
    };
  });
}

/** Puts the Run column right after Task in a view that lacks it (a view saved before the column existed). */
export function withRunColumn(views: readonly SavedView[]): SavedView[] {
  return views.map((v) => {
    if (v.columns.includes("run")) return v;
    const at = v.columns.indexOf("title");
    return { ...v, columns: [...v.columns.slice(0, at + 1), "run", ...v.columns.slice(at + 1)] };
  });
}

/** The statuses a task can have a saved result in: it finished, or stopped after the agent reported. */
const RESULT_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["done", "review", "merging", "blocked", "failed", "stopped"]);

export function PlanScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { limit: 500 });
  const roadmap = useWidgetQuery<RoadmapListResponse>("product.roadmap.list", {});
  const agents = useAgents();
  const deptSlug = useDevDepartment(departmentId)?.slug ?? "development";
  const agentIndex = useAgentIndex(agents.data?.agents);
  const persona = useAgentPersona();
  const action = useAction();
  const planner = useAction();
  // Saved per person, business and table (audit #204): they come back after a reload. Simple opens first while guidance is on.
  const defaultViewId = useDefaultViewId("all");
  const planViews = useSavedViews("development.plan", PLAN_VIEWS, { defaultViewId });
  const viewsWithRun = useMemo(() => withRunColumn(planViews.views), [planViews.views]);
  const savedViews = { ...planViews, views: viewsWithRun };
  useBusinessEvents(() => {
    tasks.refetch();
    if (hasResult) detail.refetch();
  }, ["task.started", "task.completed", "task.blocked", "pr.merged", "product.signoff_decided"]);
  // Building starts when the founder has signed off the specification and the roadmap (founder, 2026-10-18).
  const stage = useBusinessStage();
  // No orchestrator reachable (first-time founder report, Nov 8, 2026): Start is off and the banner says why, instead of
  // "The orchestrator did not take the session" after every press.
  const startsBlocked = stage.orchestratorDown;

  const rows = useMemo(() => toPlanRows(tasks.data?.items ?? [], tasks.data?.edges ?? [], agentIndex, persona.labelFor), [tasks.data, agentIndex, persona]);
  const initialTask = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("task") : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialTask);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  // The selected task's saved result (WP-05 T7): read only for a task that has finished or stopped, where one can exist.
  const hasResult = !!selected && RESULT_STATUSES.has(selected.status);
  const detail = useWidgetQuery<TaskGetResponse>("dev.tasks.get", { taskId: selected?.id ?? "" }, { enabled: hasResult });
  const report = hasResult ? (detail.data?.report ?? null) : null;
  const [reassign, setReassign] = useState<PlanRow | null>(null);
  const [stop, setStop] = useState<PlanRow | null>(null);
  const [claudeCode, setClaudeCode] = useState<PlanRow | null>(null);

  // Planner trigger.
  const id = useId();
  // A Term renders a button, which must not sit inside the <label>: the definition goes in the Field's help tip.
  const roadmapTerm = useTerm("roadmap");
  const [roadmapItemId, setRoadmapItemId] = useState<string>("");
  const [goal, setGoal] = useState("");
  const [planned, setPlanned] = useState<PlanResponse | null>(null);
  const roadmapOptions = (roadmap.data?.items ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((i) => ({ value: i.id, label: i.horizon ? `${i.title} · ${i.horizon}` : i.title }));
  const canPlan = !!roadmapItemId || goal.trim().length > 0;
  const runPlan = () =>
    void planner.run<PlanResponse>("dev.tasks.plan", roadmapItemId ? { roadmapItemId, ...(goal.trim() ? { goal: goal.trim() } : {}) } : { goal: goal.trim() }, {
      key: "plan",
      then: (r) => {
        setPlanned(r);
        setGoal("");
        tasks.refetch();
      },
    });

  // Each column at its minimum; the table shares the spare width by PLAN_FIT's weights itself (DataTable `meta.grow`).
  const sizes = useMemo(() => fitColumns(null, PLAN_FIT, []), []);

  const runTask = (path: string, task: TaskRow, extra: Record<string, unknown> = {}) => action.run(path, { taskId: task.id, ...extra }, { key: `${path}:${task.id}`, then: () => tasks.refetch() });

  // The Run cell reads the current handler and busy key through a ref, so the column definitions stay stable.
  const live = useRef({ runTask, pending: action.pending, startsBlocked });
  live.current = { runTask, pending: action.pending, startsBlocked };

  const columns = useMemo<DataTableColumn<PlanRow>[]>(
    () => fitToGrow<PlanRow>([
      {
        id: "title",
        accessorKey: "title",
        header: "Task",
        size: sizes.title,
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            {/* The founder's title first (0070); the agents' technical title underneath, for anyone matching it to the code. */}
            <span className="flex min-w-0 flex-col">
              <span className="min-w-0 truncate text-body-strong" title={row.original.founderTitle ?? row.original.title}>
                {row.original.founderTitle ?? row.original.title}
              </span>
              {row.original.founderTitle && row.original.founderTitle !== row.original.title ? (
                // The agents' technical title is Builder view's.
                <BuilderOnly>
                  <span className="min-w-0 truncate text-small text-tertiary" title={row.original.title} data-technical-title>
                    {row.original.title}
                  </span>
                </BuilderOnly>
              ) : null}
            </span>
            {row.original.priority && row.original.priority >= 10 ? (
              <Chip tone="warn" className="shrink-0">
                High priority
              </Chip>
            ) : null}
          </span>
        ),
      },
      {
        id: "run",
        accessorFn: (r) => taskRunInfo(r.status, r.waitingOn).label,
        header: "Run",
        size: sizes.run,
        minSize: sizes.run,
        maxSize: sizes.run,
        enableSorting: false,
        enableResizing: false,
        meta: { locked: true, filter: false, align: "center", label: "Run" },
        cell: ({ row }) => (
          <TaskRunState
            status={row.original.status}
            waitingOn={row.original.waitingOn}
            onRun={live.current.startsBlocked ? undefined : () => void live.current.runTask("dev.tasks.start", row.original)}
            onResume={live.current.startsBlocked ? undefined : () => void live.current.runTask("dev.tasks.resume", row.original)}
            pending={live.current.pending === `dev.tasks.start:${row.original.id}` || live.current.pending === `dev.tasks.resume:${row.original.id}`}
          />
        ),
      },
      { id: "status", accessorKey: "status", header: "Status", size: sizes.status, meta: { filter: "select", filterOptions: STATUS_OPTIONS }, cell: ({ row }) => <TaskStatusPill status={row.original.status} /> },
      { id: "kind", accessorFn: (r) => r.kind ?? "", header: "Kind", size: sizes.kind, meta: { filter: "select", filterOptions: KIND_OPTIONS, csv: (r) => kindLabel(r.kind) }, cell: ({ row }) => <span className="text-secondary">{kindLabel(row.original.kind)}</span> },
      {
        id: "agentName",
        accessorKey: "agentName",
        header: "Agent",
        size: sizes.agentName,
        cell: ({ row }) => {
          const a = row.original.agent;
          if (!a) return <span className="text-secondary">{row.original.agentName}</span>;
          const tile = toTileAgent(a, a.id);
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar size={20} name={a.name} agent={{ seed: tile.seed, dept: tile.dept, personaKey: tile.personaKey, layer: a.layer }} status={a.status} />
              <EntityLink entity={{ id: a.id, kind: "agent", name: a.name, href: agentHref(businessId, a.id) }} display={row.original.agentName} hideIcon hoverCard={false} className="min-w-0 truncate" />
            </span>
          );
        },
      },
      {
        id: "progressNumber",
        accessorKey: "progressNumber",
        header: "Progress",
        size: sizes.progressNumber,
        meta: { numeric: true, label: "Progress %" },
        cell: ({ row }) => (
          <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
            <ProgressRing value={row.original.progressNumber / 100} size={14} tone={row.original.status === "failed" ? "bad" : row.original.status === "done" ? "good" : "kit"} label={`Progress ${row.original.progressNumber}%`} />
            {row.original.progressNumber}%
          </span>
        ),
      },
      { id: "startedDate", accessorFn: (r) => r.startedDate?.getTime() ?? 0, header: "Started", size: sizes.startedDate, meta: { filter: "date", label: "Started" }, cell: ({ row }) => (row.original.startedDate ? <RelativeDateText className="text-secondary" value={row.original.startedDate} now={options.now ?? new Date()} /> : <span className="text-tertiary">—</span>) },
      { id: "dependsOn", accessorFn: (r) => r.dependsOn.join(", "), header: "Depends on", size: sizes.dependsOn, meta: { label: "Depends on" }, cell: ({ row }) => (row.original.dependsOn.length ? <span className="block min-w-0 truncate text-secondary" title={row.original.dependsOn.join(", ")}>{row.original.dependsOn.join(", ")}</span> : <span className="text-tertiary">—</span>) },
      { id: "priority", accessorKey: "priority", header: "Priority", size: sizes.priority, meta: { numeric: true } },
    ], PLAN_FIT),
    [businessId, options.now, sizes],
  );

  const rowActions = (row: PlanRow): RowAction<PlanRow>[] => {
    const live = row.status === "running";
    const over = row.status === "done";
    return [
      { id: "deps", label: "Show dependencies", icon: Network, onSelect: (r) => setSelectedId(r.id) },
      { id: "start", label: "Start", icon: Play, disabled: startsBlocked || !canStartTask(row.status, row.waitingOn), onSelect: (r) => void runTask("dev.tasks.start", r), separatorBefore: true },
      { id: "pause", label: "Pause", icon: Pause, disabled: !live, onSelect: (r) => void runTask("dev.tasks.pause", r) },
      { id: "resume", label: "Resume", icon: Play, disabled: row.status !== "paused", onSelect: (r) => void runTask("dev.tasks.resume", r) },
      { id: "reassign", label: "Reassign", icon: Bot, disabled: over, onSelect: (r) => setReassign(r) },
      { id: "upgrade", label: STRONGEST_MODEL_LABEL, icon: ArrowUpCircle, disabled: over || row.agent?.modelKey === "opus", onSelect: (r) => void runTask("dev.tasks.upgradeModel", r) },
      { id: "claude", label: "Open in Claude Code", icon: ExternalLink, onSelect: (r) => setClaudeCode(r), separatorBefore: true },
      { id: "stop", label: "Stop and discard", icon: Square, variant: "danger", disabled: over || row.status === "stopped", onSelect: (r) => setStop(r) },
    ];
  };

  const graphNodes = useMemo(() => {
    if (!selected) return [];
    const all = tasks.data?.items ?? [];
    const edges = tasks.data?.edges ?? [];
    const related = new Set<string>([selected.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) {
        if (related.has(e.toTask) && !related.has(e.fromTask)) {
          related.add(e.fromTask);
          grew = true;
        }
        if (related.has(e.fromTask) && !related.has(e.toTask)) {
          related.add(e.toTask);
          grew = true;
        }
      }
    }
    return toGraphNodes(
      all.filter((t) => related.has(t.id)),
      edges,
      (aid) => {
        const a = aid ? agentIndex.get(aid) : undefined;
        return a ? { id: a.id, name: a.name, seed: a.avatarSeed || a.id, dept: toTileAgent(a, a.id).dept } : null;
      },
      (t) => progressValue(t.progress),
    );
  }, [selected, tasks.data, agentIndex]);

  const counts = tasks.data?.counts ?? {};

  return (
    <Screen name="development/plan">
      {startsBlocked ? (
        <Panel span={12} title="Tasks cannot start right now" help="The orchestrator is the service that runs the team's work: every round of work and every task session goes through it." data-testid="plan-orchestrator-banner">
          <p className="text-body text-secondary">
            The orchestrator is not reachable from this server, so no task can start and a press of Continue writes one note in its place. Start comes back by itself once it is reachable again. If you run this server yourself, start the orchestrator; otherwise, whoever runs it has to.
          </p>
        </Panel>
      ) : null}
      {stage.stage === "awaiting_signoff" || stage.stage === "drafting" ? (
        <Panel span={12} title="Building starts on your sign-off" help="The specification is the written description of what the product is and does. Your sign-off is your yes on it and the roadmap, which lets the team build from them." data-testid="plan-stage-banner" data-product-stage={stage.stage}>
          <p className="text-body text-secondary">
            {stage.stage === "drafting" ? "The specification and roadmap are being drafted. " : "Building starts when the specification and the roadmap are signed off. "}
            <button type="button" className="text-link hover:underline focus-visible:outline-2 focus-visible:outline-link" onClick={() => navigate(routes.inbox(businessId))}>
              Open the Inbox
            </button>
          </p>
        </Panel>
      ) : null}
      <Panel
        span={8}
        title="Tasks"
        flush
        loading={tasks.isLoading}
        error={tasks.error ? tasks.error.message : undefined}
        onRetry={tasks.refetch}
        meta={
          <span data-testid="plan-counts">
            {(counts.running ?? 0) + (counts.paused ?? 0) + (counts.blocked ?? 0) + (counts.review ?? 0) + (counts.merging ?? 0)} in progress · {counts.ready ?? 0} ready · {counts.done ?? 0} done
          </span>
        }
        footer={action.error ? <InlineError error={action.error} /> : <span>Use the … button or right-click a task for Start, Pause, Reassign, {STRONGEST_MODEL_LABEL.toLowerCase()}, Stop and Open in Claude Code. Enter shows its dependencies.</span>}
      >
        <div className="min-w-0">
          <DataTable<PlanRow>
            data={rows}
            columns={columns}
            {...savedViews}
            defaultViewId={defaultViewId}
            rowActions={rowActions}
            onRowOpen={(r) => setSelectedId(r.id)}
            onRowClick={(r) => setSelectedId(r.id)}
            selectedIds={selected ? [selected.id] : []}
            height={520}
            exportFileName="tasks"
            empty={{
              icon: ListTree,
              children: (
                <>
                  No tasks yet. The team plans the roadmap into tasks on its own, cycle by cycle. To plan something sooner, use the panel on the right.
                </>
              ),
            }}
            aria-label="Tasks"
          />
        </div>
      </Panel>

      <Panel
        span={4}
        title="Plan something sooner"
        glow="brand"
        footer={
          <span className="inline-flex items-center gap-1">
            <Term id="planner">Planner</Term> cost is metered per run <ProvenanceChip kind="estimate" />
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-small text-secondary" data-testid="plan-sooner-hint">
            The team plans the roadmap&apos;s Now items into tasks on its own, cycle by cycle. Use this to plan one item or an objective ahead of that.
          </p>
          <Field htmlFor={`${id}-roadmap`} label="Roadmap item" help={roadmapTerm?.short} helpLearn={roadmapTerm?.learn}>
            <SimpleSelect id={`${id}-roadmap`} aria-label="Roadmap item" options={roadmapOptions} value={roadmapItemId || undefined} onValueChange={setRoadmapItemId} placeholder={roadmap.isLoading ? "Loading roadmap…" : roadmapOptions.length ? "Choose an item" : "No roadmap items yet"} disabled={!roadmapOptions.length} />
          </Field>
          <Field htmlFor={`${id}-goal`} label="Objective" hint="Optional with a roadmap item; required without one. Sent to the Planner as its goal.">
            <Textarea id={`${id}-goal`} rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should be true when it is done, e.g. customers can pause their subscription from the account page." maxLength={4000} />
          </Field>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* A real model call (the Planner): the generate control, running while the plan is drafted. */}
            <GenerateControl size="md" label="Plan the tasks" runningLabel="Planning the tasks" running={planner.pending === "plan"} disabled={!canPlan} onGenerate={runPlan} />
            {planned ? (
              <span className="text-small text-secondary tabular-nums" role="status">
                Planned {plural(planned.tasks.length, "task")}
              </span>
            ) : null}
          </div>
          <InlineError error={planner.error} />
        </div>
      </Panel>

      <Panel
        span={12}
        title={selected ? `Dependencies · ${selected.title}` : "Dependencies"}
        help="What must finish before a task can start, and what that task unblocks when it is done."
        flush
        empty={!selected ? { icon: Network, children: "Select a task (click or Enter) to see what it depends on and what it unblocks." } : undefined}
        actions={
          selected ? (
            <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
              Clear
            </Button>
          ) : undefined
        }
      >
        {selected ? (
          <div className="flex gap-px">
            <div className="min-w-0 flex-1">
              <TaskGraph nodes={graphNodes} selectedId={selected.id} onSelect={(tid) => setSelectedId(tid)} height={360} aria-label={`Dependencies of ${selected.title}`} />
            </div>
            <div className="w-80 shrink-0 bg-panel p-panel-pad">
              <KeyValueList
                layout="stacked"
                items={[
                  { label: "Status", value: <TaskStatusPill status={selected.status} /> },
                  {
                    label: "Next",
                    value: (
                      <TaskRunState
                        variant="text"
                        status={selected.status}
                        waitingOn={selected.waitingOn}
                        onRun={() => void runTask("dev.tasks.start", selected)}
                        onResume={() => void runTask("dev.tasks.resume", selected)}
                        pending={action.pending === `dev.tasks.start:${selected.id}` || action.pending === `dev.tasks.resume:${selected.id}`}
                      />
                    ),
                  },
                  { label: "Agent", value: selected.agentName },
                  { label: "Kind", value: kindLabel(selected.kind) },
                  { label: "Depends on", value: selected.dependsOn.length ? selected.dependsOn.join(", ") : "Nothing" },
                  { label: "Unblocks", value: selected.blocks.length ? selected.blocks.join(", ") : "Nothing" },
                  { label: <Term id="acceptance">Acceptance</Term>, value: selected.acceptance?.length ? `${selected.acceptance.length} criteria` : "None recorded" },
                ]}
              />
              {/* The plumbing (branch, file scope) behind a disclosure: the business facts above read first (UX plan §7.12).
                  Builder view's: with it off there is no Technical disclosure at all. */}
              <BuilderOnly>
              <details className="group/detail mt-2 text-small" data-testid="task-technical">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-secondary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden">
                  <ChevronRight size={14} aria-hidden className="transition-transform duration-overlay ease-out group-open/detail:rotate-90" />
                  Technical
                </summary>
                <div className="mt-1.5">
                  <KeyValueList
                    layout="stacked"
                    dense
                    items={[
                      { label: <Term id="branch">Branch</Term>, value: selected.kind === "code" ? agentBranch(selected.id) : "—", mono: true },
                      { label: "File scope", value: selected.fileScope?.length ? selected.fileScope.join(", ") : "Not set", mono: !!selected.fileScope?.length },
                    ]}
                  />
                </div>
              </details>
              </BuilderOnly>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={Play} disabled={startsBlocked || !canStartTask(selected.status, selected.waitingOn)} loading={action.pending === `dev.tasks.start:${selected.id}`} onClick={() => void runTask("dev.tasks.start", selected)}>
                  Start
                </Button>
                <Button size="sm" icon={ExternalLink} onClick={() => setClaudeCode(selected)}>
                  Open in Claude Code
                </Button>
                <Button size="sm" variant="ghost" icon={Radio} onClick={() => navigate(routes.department(businessId, deptSlug, "training-ground"))}>
                  Live sessions
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Panel>

      {selected && report ? (
        <Panel span={12} title="Result" help="What the agent found or made, saved when it finished this task." meta={<>Saved <RelativeDateText value={new Date(report.createdAt)} /></>} data-testid="task-result">
          <TaskResult className="max-w-reading" title={report.title} bodyMd={report.bodyMd} sources={report.sources} simulated={report.simulated} />
        </Panel>
      ) : null}

      <ReassignDialog
        open={!!reassign}
        onOpenChange={(o) => !o && setReassign(null)}
        taskTitle={reassign?.title ?? ""}
        currentAgentId={reassign?.assigneeAgentId}
        agents={agents.data?.agents ?? []}
        pending={!!reassign && action.pending === `dev.tasks.reassign:${reassign.id}`}
        error={reassign ? action.error : null}
        onConfirm={(agentId) => reassign && void runTask("dev.tasks.reassign", reassign, { agentId }).then((r) => r !== undefined && setReassign(null))}
      />
      <StopDialog open={!!stop} onOpenChange={(o) => !o && setStop(null)} taskTitle={stop?.title ?? ""} pending={!!stop && action.pending === `dev.tasks.stop:${stop.id}`} error={stop ? action.error : null} onConfirm={() => stop && void runTask("dev.tasks.stop", stop).then((r) => r !== undefined && setStop(null))} />
      <OpenInClaudeCodeDialog taskId={claudeCode?.id ?? null} taskTitle={claudeCode?.title} onOpenChange={(o) => !o && setClaudeCode(null)} />
    </Screen>
  );
}
