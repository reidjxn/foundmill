/**
 * Development › Plan (BUILD §6.3, §11.6): the task graph as a DataTable with saved views and right-click verbs, a
 * dependency view (TaskGraph) for the selected task, and the planner trigger (`dev.tasks.plan` from a roadmap item or
 * a goal).
 */
import { useId, useMemo, useState } from "react";
import { ArrowUpCircle, Bot, ExternalLink, ListTree, Network, Pause, Play, Square, Wand2 } from "lucide-react";
import { Avatar, Button, Chip, DataTable, EntityLink, Field, KeyValueList, Panel, ProgressRing, ProvenanceChip, TaskGraph, Textarea, SimpleSelect, formatDate, formatRelative, type DataTableColumn, type RowAction, type SavedView } from "@foundmill/dugout";
import type { TaskStatus } from "@foundmill/shared";
import { departmentForModule, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { OpenInClaudeCodeDialog, ReassignDialog, StopDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { InlineError, Screen, TaskStatusPill, agentBranch, agentHref, progressValue, toDate, toTileAgent, useAction, useAgentIndex, useAgents } from "./shared";
import { toGraphNodes } from "./TrainingGroundScreen";
import type { AgentRow, PlanResponse, RoadmapListResponse, TaskRow, TasksListResponse } from "./types";

export interface PlanRow extends TaskRow {
  agentName: string;
  agent: AgentRow | undefined;
  dependsOn: string[];
  blocks: string[];
  progressNumber: number;
  startedDate: Date | null;
}

export const PLAN_VIEWS: SavedView[] = [
  { id: "all", name: "All tasks", builtIn: true, columns: ["title", "status", "kind", "agentName", "progressNumber", "dependsOn", "priority", "startedDate"], sort: [{ id: "priority", desc: true }], filters: [] },
  { id: "ready", name: "Ready to start", builtIn: true, columns: ["title", "kind", "agentName", "dependsOn", "priority"], sort: [{ id: "priority", desc: true }], filters: [{ id: "f-ready", field: "status", op: "in", value: ["ready", "planned"] }] },
  { id: "in-progress", name: "In progress", builtIn: true, columns: ["title", "status", "agentName", "progressNumber", "startedDate"], sort: [{ id: "startedDate", desc: true }], filters: [{ id: "f-live", field: "status", op: "in", value: ["running", "paused", "blocked", "review", "merging"] }] },
  { id: "blocked", name: "Blocked", builtIn: true, columns: ["title", "agentName", "dependsOn", "progressNumber"], sort: [], filters: [{ id: "f-blocked", field: "status", op: "eq", value: "blocked" }] },
  { id: "done", name: "Done", builtIn: true, columns: ["title", "agentName", "kind", "startedDate"], sort: [{ id: "startedDate", desc: true }], filters: [{ id: "f-done", field: "status", op: "in", value: ["done", "failed", "stopped"] }] },
];

const STATUS_OPTIONS = (["planned", "ready", "running", "paused", "blocked", "review", "merging", "done", "failed", "stopped"] as TaskStatus[]).map((s) => ({ value: s, label: s }));
const KIND_OPTIONS = ["code", "research", "channel", "specialist", "legal", "finance", "ops"].map((k) => ({ value: k, label: k }));

export function toPlanRows(tasks: readonly TaskRow[], edges: readonly { fromTask: string; toTask: string }[], agents: Map<string, AgentRow>): PlanRow[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return tasks.map((t) => {
    const agent = t.assigneeAgentId ? agents.get(t.assigneeAgentId) : undefined;
    return {
      ...t,
      agent,
      agentName: agent?.name ?? (t.assigneeAgentId ? "Agent" : "Unassigned"),
      dependsOn: edges.filter((e) => e.toTask === t.id).map((e) => titles.get(e.fromTask) ?? e.fromTask),
      blocks: edges.filter((e) => e.fromTask === t.id).map((e) => titles.get(e.toTask) ?? e.toTask),
      progressNumber: Math.round(progressValue(t.progress) * 100),
      startedDate: toDate(t.startedAt),
    };
  });
}

export function PlanScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { limit: 500 });
  const roadmap = useWidgetQuery<RoadmapListResponse>("product.roadmap.list", {});
  const agents = useAgents();
  const departments = useDepartments();
  const deptSlug = departmentForModule(departments.data, "development")?.slug ?? "development";
  const agentIndex = useAgentIndex(agents.data?.agents);
  const action = useAction();
  const planner = useAction();
  useBusinessEvents(() => tasks.refetch(), ["task.started", "task.completed", "task.blocked", "pr.merged"]);

  const rows = useMemo(() => toPlanRows(tasks.data?.items ?? [], tasks.data?.edges ?? [], agentIndex), [tasks.data, agentIndex]);
  const initialTask = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("task") : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialTask);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const [reassign, setReassign] = useState<PlanRow | null>(null);
  const [stop, setStop] = useState<PlanRow | null>(null);
  const [claudeCode, setClaudeCode] = useState<PlanRow | null>(null);

  // Planner trigger.
  const id = useId();
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

  const runTask = (path: string, task: TaskRow, extra: Record<string, unknown> = {}) => action.run(path, { taskId: task.id, ...extra }, { key: `${path}:${task.id}`, then: () => tasks.refetch() });

  const columns = useMemo<DataTableColumn<PlanRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Task",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body-strong">{row.original.title}</span>
            {row.original.priority && row.original.priority >= 10 ? <Chip tone="warn">Hard</Chip> : null}
          </span>
        ),
      },
      { id: "status", accessorKey: "status", header: "Status", meta: { filter: "select", filterOptions: STATUS_OPTIONS }, cell: ({ row }) => <TaskStatusPill status={row.original.status} /> },
      { id: "kind", accessorKey: "kind", header: "Kind", meta: { filter: "select", filterOptions: KIND_OPTIONS } },
      {
        id: "agentName",
        accessorKey: "agentName",
        header: "Agent",
        cell: ({ row }) => {
          const a = row.original.agent;
          if (!a) return <span className="text-secondary">{row.original.agentName}</span>;
          const tile = toTileAgent(a, a.id);
          return (
            <span className="flex items-center gap-1.5">
              <Avatar size={20} name={a.name} agent={{ seed: tile.seed, dept: tile.dept }} status={a.status} />
              <EntityLink entity={{ id: a.id, kind: "agent", name: a.name, href: agentHref(businessId, a.id) }} hideIcon hoverCard={false} />
            </span>
          );
        },
      },
      {
        id: "progressNumber",
        accessorKey: "progressNumber",
        header: "Progress",
        meta: { numeric: true, label: "Progress %" },
        cell: ({ row }) => (
          <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
            <ProgressRing value={row.original.progressNumber / 100} size={14} tone={row.original.status === "failed" ? "bad" : row.original.status === "done" ? "good" : "kit"} label={`Progress ${row.original.progressNumber}%`} />
            {row.original.progressNumber}%
          </span>
        ),
      },
      { id: "dependsOn", accessorFn: (r) => r.dependsOn.join(", "), header: "Depends on", meta: { label: "Depends on" }, cell: ({ row }) => (row.original.dependsOn.length ? <span className="truncate text-secondary" title={row.original.dependsOn.join(", ")}>{row.original.dependsOn.join(", ")}</span> : <span className="text-secondary">—</span>) },
      { id: "priority", accessorKey: "priority", header: "Priority", meta: { numeric: true } },
      { id: "startedDate", accessorFn: (r) => r.startedDate?.getTime() ?? 0, header: "Started", meta: { filter: "date", label: "Started" }, cell: ({ row }) => (row.original.startedDate ? <span title={formatDate(row.original.startedDate)}>{formatRelative(row.original.startedDate, options.now ?? new Date())}</span> : <span className="text-secondary">—</span>) },
    ],
    [businessId, options.now],
  );

  const rowActions = (row: PlanRow): RowAction<PlanRow>[] => {
    const live = row.status === "running";
    const over = row.status === "done";
    return [
      { id: "deps", label: "Show dependencies", icon: Network, onSelect: (r) => setSelectedId(r.id) },
      { id: "start", label: "Start", icon: Play, disabled: !(row.status === "planned" || row.status === "ready" || row.status === "stopped" || row.status === "failed") || !row.assigneeAgentId, onSelect: (r) => void runTask("dev.tasks.start", r), separatorBefore: true },
      { id: "pause", label: "Pause", icon: Pause, disabled: !live, onSelect: (r) => void runTask("dev.tasks.pause", r) },
      { id: "resume", label: "Resume", icon: Play, disabled: row.status !== "paused", onSelect: (r) => void runTask("dev.tasks.resume", r) },
      { id: "reassign", label: "Reassign", icon: Bot, disabled: over, onSelect: (r) => setReassign(r) },
      { id: "upgrade", label: "Upgrade to Opus", icon: ArrowUpCircle, disabled: over || row.agent?.modelKey === "opus", onSelect: (r) => void runTask("dev.tasks.upgradeModel", r) },
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
      <Panel
        span={8}
        title="Task graph"
        flush
        loading={tasks.isLoading}
        error={tasks.error ? tasks.error.message : undefined}
        onRetry={tasks.refetch}
        actions={
          <span className="text-small text-secondary tabular-nums" data-testid="plan-counts">
            {(counts.running ?? 0) + (counts.paused ?? 0) + (counts.blocked ?? 0) + (counts.review ?? 0) + (counts.merging ?? 0)} in progress · {counts.ready ?? 0} ready · {counts.done ?? 0} done
          </span>
        }
        footer={action.error ? <InlineError error={action.error} /> : <span>Right-click a task for Start, Pause, Reassign, Upgrade, Stop and Open in Claude Code. Enter shows its dependencies.</span>}
      >
        <DataTable<PlanRow>
          data={rows}
          columns={columns}
          views={PLAN_VIEWS}
          defaultViewId="all"
          rowActions={rowActions}
          onRowOpen={(r) => setSelectedId(r.id)}
          onRowClick={(r) => setSelectedId(r.id)}
          selectedIds={selected ? [selected.id] : []}
          height={520}
          exportFileName="tasks"
          empty={{ icon: ListTree, children: "No tasks yet. Pick a roadmap item or write a goal on the right and the Planner builds the task graph." }}
          aria-label="Tasks"
        />
      </Panel>

      <Panel span={4} title="Plan from the roadmap" footer={<span className="inline-flex items-center gap-1">Planner cost is metered per run <ProvenanceChip kind="estimate" /></span>}>
        <div className="flex flex-col gap-3">
          <Field htmlFor={`${id}-roadmap`} label="Roadmap item">
            <SimpleSelect id={`${id}-roadmap`} aria-label="Roadmap item" options={roadmapOptions} value={roadmapItemId || undefined} onValueChange={setRoadmapItemId} placeholder={roadmap.isLoading ? "Loading roadmap…" : roadmapOptions.length ? "Choose an item" : "No roadmap items yet"} disabled={!roadmapOptions.length} />
          </Field>
          <Field htmlFor={`${id}-goal`} label="Goal" hint="Optional with a roadmap item; required without one.">
            <Textarea id={`${id}-goal`} rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ship a bundle picker on the product page with Playwright coverage." maxLength={4000} />
          </Field>
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={Wand2} disabled={!canPlan} loading={planner.pending === "plan"} onClick={runPlan}>
              Build task graph
            </Button>
            {planned ? (
              <span className="text-small text-secondary tabular-nums" role="status">
                Planned {planned.tasks.length} tasks
              </span>
            ) : null}
          </div>
          <InlineError error={planner.error} />
        </div>
      </Panel>

      <Panel
        span={12}
        title={selected ? `Dependencies · ${selected.title}` : "Dependencies"}
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
          <div className="grid grid-cols-[1fr_320px] gap-px">
            <TaskGraph nodes={graphNodes} selectedId={selected.id} onSelect={(tid) => setSelectedId(tid)} height={360} aria-label={`Dependencies of ${selected.title}`} />
            <div className="bg-panel p-panel-pad">
              <KeyValueList
                layout="stacked"
                items={[
                  { label: "Status", value: <TaskStatusPill status={selected.status} /> },
                  { label: "Agent", value: selected.agentName },
                  { label: "Branch", value: selected.kind === "code" ? agentBranch(selected.id) : "—", mono: true },
                  { label: "Depends on", value: selected.dependsOn.length ? selected.dependsOn.join(", ") : "Nothing" },
                  { label: "Unblocks", value: selected.blocks.length ? selected.blocks.join(", ") : "Nothing" },
                  { label: "File scope", value: selected.fileScope?.length ? selected.fileScope.join(", ") : "Not set", mono: !!selected.fileScope?.length },
                  { label: "Acceptance", value: selected.acceptance?.length ? `${selected.acceptance.length} criteria` : "None recorded" },
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={Play} disabled={!(selected.status === "planned" || selected.status === "ready") || !selected.assigneeAgentId} loading={action.pending === `dev.tasks.start:${selected.id}`} onClick={() => void runTask("dev.tasks.start", selected)}>
                  Start
                </Button>
                <Button size="sm" icon={ExternalLink} onClick={() => setClaudeCode(selected)}>
                  Open in Claude Code
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate(routes.department(businessId, deptSlug, "training-ground"))}>
                  Training Ground
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Panel>

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
