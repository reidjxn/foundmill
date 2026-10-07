"use client";
/**
 * Development › Specialists (BUILD §6.3, §11.6): a grid of SpecialistTiles, one per task of kind "specialist",
 * showing the RFQ funnel, quote table, sample tracker and shipments instead of a terminal. Data comes from the
 * specialist session's stream (structured `specialist:` notes, see specialist-data.ts).
 */
import { useCallback, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Chip, Panel, ShoutMenu, SpecialistTile, TileGrid, type AgentTileSession, type TileControls, type TileGridItem } from "@foundmill/dugout";
import { departmentForModule, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { OpenInClaudeCodeDialog, ReassignDialog, StopDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { latestSessionsByTask, seedFromRows } from "./session-store";
import { InlineError, OVER_TASK_STATUSES, Screen, taskHref, toDate, toTileAgent, useAction, useAgentIndex, useAgents } from "./shared";
import { hasSpecialistData, specialistDataFromSession } from "./specialist-data";
import { shoutInput } from "./TrainingGroundScreen";
import { useSessionStreams, type TileSource } from "./useSessionStreams";
import type { SessionsListResponse, TaskRow, TasksListResponse } from "./types";

const GRID_HEIGHT = "calc(100vh - 232px)";

/** Specialist tasks: live ones first, then the most recent finished ones (their last session's facts still show). */
export function specialistTasks(tasks: readonly TaskRow[] | undefined): TaskRow[] {
  return (tasks ?? [])
    .filter((t) => t.kind === "specialist" && t.status !== "planned")
    .slice()
    .sort((a, b) => {
      const ao = OVER_TASK_STATUSES.includes(a.status) ? 1 : 0;
      const bo = OVER_TASK_STATUSES.includes(b.status) ? 1 : 0;
      return ao - bo || (toDate(b.startedAt)?.getTime() ?? 0) - (toDate(a.startedAt)?.getTime() ?? 0) || a.title.localeCompare(b.title);
    });
}

export function SpecialistsScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { kind: "specialist", limit: 200 });
  const sessions = useWidgetQuery<SessionsListResponse>("dev.sessions.list", { limit: 200 });
  const agents = useAgents();
  const departments = useDepartments();
  const agentIndex = useAgentIndex(agents.data?.agents);
  const action = useAction();
  const refetchAll = useCallback(() => {
    tasks.refetch();
    sessions.refetch();
  }, [tasks, sessions]);
  useBusinessEvents(() => refetchAll(), ["task.started", "task.completed", "task.blocked"]);

  const deptSlug = departmentForModule(departments.data, "development")?.slug;
  const byTask = useMemo(() => latestSessionsByTask(sessions.data?.items), [sessions.data]);
  const list = useMemo(() => specialistTasks(tasks.data?.items), [tasks.data]);
  const sources = useMemo<TileSource[]>(
    () =>
      list.map((task) => {
        const session = byTask.get(task.id) ?? null;
        const agent = toTileAgent(agentIndex.get(task.assigneeAgentId ?? ""), task.assigneeAgentId);
        return { seed: seedFromRows({ task, session, agent, taskHref: taskHref(businessId, deptSlug, task.id) }), task, session };
      }),
    [list, byTask, agentIndex, businessId, deptSlug],
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const streams = useSessionStreams(sources, focusedId, { flushMs: options.flushMs });
  const taskOf = useCallback((sessionId: string) => sources.find((s) => s.seed.id === sessionId)?.task ?? null, [sources]);

  const [reassign, setReassign] = useState<string | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [claudeCode, setClaudeCode] = useState<string | null>(null);
  const runTask = (path: string, sessionId: string, extra: Record<string, unknown> = {}) => {
    const task = taskOf(sessionId);
    if (!task) return Promise.resolve(undefined);
    return action.run(path, { taskId: task.id, ...extra }, { key: `${path}:${task.id}`, then: refetchAll });
  };
  const controls: TileControls = {
    onPause: (id) => void runTask("dev.tasks.pause", id),
    onResume: (id) => void runTask("dev.tasks.resume", id),
    onShout: (id, shout) => {
      const task = taskOf(id);
      if (task) void action.run("dev.tasks.shout", shoutInput(shout, task.id), { key: `shout:${task.id}` });
    },
    onReassign: (id) => setReassign(id),
    onUpgradeModel: (id) => void runTask("dev.tasks.upgradeModel", id),
    onStop: (id) => setStop(id),
    onOpenInClaudeCode: (id) => setClaudeCode(id),
  };

  const items = useMemo<(TileGridItem & { session: AgentTileSession })[]>(
    () => streams.sessions.map((s) => ({ id: s.id, label: `${s.agent.name}: ${s.task.title}`, avatar: { name: s.agent.name, seed: s.agent.seed, dept: s.agent.dept, status: s.agent.status }, session: s })),
    [streams.sessions],
  );
  const withData = items.filter((i) => hasSpecialistData(specialistDataFromSession(i.session))).length;
  const running = list.filter((t) => t.status === "running").length;
  const reassignTask = reassign ? taskOf(reassign) : null;
  const stopTask = stop ? taskOf(stop) : null;
  const claudeTask = claudeCode ? taskOf(claudeCode) : null;

  return (
    <Screen name="development/specialists" className="h-full">
      <Panel
        span={12}
        title="Specialists"
        flush
        className="h-full"
        bodyClassName="flex min-h-0 flex-col"
        loading={tasks.isLoading || (sessions.isLoading && !sessions.data)}
        error={tasks.error ? tasks.error.message : sessions.error ? sessions.error.message : undefined}
        onRetry={refetchAll}
        empty={tasks.data && list.length === 0 ? { icon: FlaskConical, title: "No specialists at work", children: "Sourcing, formulation, certification, packaging, quality, logistics and costing specialists show their RFQ funnel, quotes, samples and shipments here once a specialist task starts. Hire one from the Team tab or plan a task on the Plan tab.", action: { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug ?? "development", "plan")) } } : undefined}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-small text-secondary tabular-nums" data-testid="specialist-counts">
              {list.length} specialists · {running} running · {withData} reporting
            </span>
            <Chip tone="warn">Human gate on every purchase order</Chip>
            <ShoutMenu target="all specialists" labelled disabled={running === 0} onShout={(shout) => void action.run("dev.tasks.shout", shoutInput(shout), { key: "shout:all" })} />
          </div>
        }
        footer={action.error ? <InlineError error={action.error} /> : <span>Quotes are extracted through the quarantined reader; prices and landed costs are estimates until a supplier confirms them.</span>}
      >
        <div className="flex min-h-0 flex-col" style={{ height: GRID_HEIGHT, minHeight: 480 }}>
          <TileGrid
            items={items}
            focusedId={focusedId}
            onFocusedChange={setFocusedId}
            aria-label="Specialist tiles"
            className="min-h-0 flex-1"
            renderTile={(item, ctx) => <SpecialistTile session={item.session} data={specialistDataFromSession(item.session)} focused={ctx.focused} compact={ctx.compact} controls={controls} now={options.now} onFocus={(id) => setFocusedId(id)} onOpenTask={(task) => task.href && navigate(task.href)} />}
          />
        </div>
      </Panel>

      <ReassignDialog
        open={!!reassign}
        onOpenChange={(o) => !o && setReassign(null)}
        taskTitle={reassignTask?.title ?? ""}
        currentAgentId={reassignTask?.assigneeAgentId}
        agents={agents.data?.agents ?? []}
        pending={!!reassign && action.pending === `dev.tasks.reassign:${reassignTask?.id}`}
        error={reassign ? action.error : null}
        onConfirm={(agentId) => reassign && void runTask("dev.tasks.reassign", reassign, { agentId }).then((r) => r !== undefined && setReassign(null))}
      />
      <StopDialog open={!!stop} onOpenChange={(o) => !o && setStop(null)} taskTitle={stopTask?.title ?? ""} pending={!!stop && action.pending === `dev.tasks.stop:${stopTask?.id}`} error={stop ? action.error : null} onConfirm={() => stop && void runTask("dev.tasks.stop", stop).then((r) => r !== undefined && setStop(null))} />
      <OpenInClaudeCodeDialog taskId={claudeTask?.id ?? null} taskTitle={claudeTask?.title} onOpenChange={(o) => !o && setClaudeCode(null)} />
    </Screen>
  );
}
