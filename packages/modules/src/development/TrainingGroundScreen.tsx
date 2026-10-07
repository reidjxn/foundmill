/**
 * Development › Training Ground (BUILD §6.3, §11.6; DESIGN §9): the split-screen of AgentTiles fed by `dev.tasks.list`
 * + `as:<sessionId>` streams with focus-aware throttling, the Formation view (task graph), the session scrubber
 * replay, Shouts and the per-tile controls (Pause/Resume/Reassign/Upgrade/Stop/Open in Claude Code).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Radio, Rows3 } from "lucide-react";
import { TIERS } from "@foundmill/config";
import {
  AgentTile,
  Button,
  GroundViewToggle,
  Panel,
  ProvenanceChip,
  SessionScrubber,
  ShoutMenu,
  SpecialistTile,
  TaskGraph,
  TileGrid,
  cn,
  sessionLengthMs,
  type AgentTileSession,
  type GroundView,
  type ScrubberSpeed,
  type Shout,
  type ShoutPreset,
  type TaskGraphNode,
  type TileControls,
  type TileGridItem,
} from "@foundmill/dugout";
import type { PlanTier } from "@foundmill/shared";
import { departmentForModule, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { OpenInClaudeCodeDialog, ReassignDialog, StopDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { concurrencyHint, isPlaceholderSessionId, openSessionsByTask, seedFromRows } from "./session-store";
import { InlineError, LIVE_TASK_STATUSES, Screen, liveTasks, taskHref, toTileAgent, useAction, useAgentIndex, useAgents } from "./shared";
import { specialistDataFromSession } from "./specialist-data";
import { useSessionStreams, type TileSource } from "./useSessionStreams";
import type { SessionReplayResponse, SessionsListResponse, TaskRow, TasksListResponse } from "./types";

/** Dugout shout preset keys → the API's preset labels (`dev.tasks.shout`). */
export const SHOUT_PRESET_LABELS: Record<ShoutPreset, string> = {
  focus_on_tests: "Focus on tests",
  simplify: "Simplify",
  ask_before_schema_changes: "Ask before schema changes",
  match_design_system: "Match the design system",
  hurry_up: "Hurry up",
};

export function shoutInput(shout: Shout, taskId?: string): Record<string, unknown> {
  const base: Record<string, unknown> = taskId ? { taskId } : {};
  return shout.preset ? { ...base, preset: SHOUT_PRESET_LABELS[shout.preset] } : { ...base, text: shout.text };
}

/** Task graph nodes from the task list and its edges (deps = tasks an edge points from). */
export function toGraphNodes(tasks: readonly TaskRow[], edges: readonly { fromTask: string; toTask: string }[], agentOf: (id: string | null | undefined) => TaskGraphNode["agent"], progressOf?: (task: TaskRow) => number | undefined): TaskGraphNode[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    deps: edges.filter((e) => e.toTask === t.id && ids.has(e.fromTask)).map((e) => e.fromTask),
    agent: agentOf(t.assigneeAgentId),
    progress: progressOf ? progressOf(t) : undefined,
    fileScope: t.fileScope,
    kind: t.kind,
  }));
}

const GRID_HEIGHT = "calc(100vh - 232px)";

export function TrainingGroundScreen({ businessId, subView }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { status: [...LIVE_TASK_STATUSES], limit: 200 });
  const sessions = useWidgetQuery<SessionsListResponse>("dev.sessions.list", { openOnly: true, limit: 200 });
  const agents = useAgents();
  const plan = useWidgetQuery<{ tier: PlanTier }>("billing.plan", {});
  const departments = useDepartments();
  const [view, setView] = useState<GroundView>(subView === "formation" ? "formation" : "tiles");
  const graph = useWidgetQuery<TasksListResponse>("dev.tasks.list", { limit: 500 }, { enabled: view === "formation" });
  const action = useAction();

  const refetchAll = useCallback(() => {
    tasks.refetch();
    sessions.refetch();
  }, [tasks, sessions]);
  useBusinessEvents(() => refetchAll(), ["task.started", "task.completed", "task.blocked", "pr.merged", "task.progressed"]);

  const agentIndex = useAgentIndex(agents.data?.agents);
  const deptSlug = departmentForModule(departments.data, "development")?.slug;
  const openByTask = useMemo(() => openSessionsByTask(sessions.data?.items), [sessions.data]);
  const live = useMemo(() => liveTasks(tasks.data?.items), [tasks.data]);

  const sources = useMemo<TileSource[]>(
    () =>
      live.map((task) => {
        const session = openByTask.get(task.id) ?? null;
        const agent = toTileAgent(agentIndex.get(task.assigneeAgentId ?? ""), task.assigneeAgentId);
        return { seed: seedFromRows({ task, session, agent, taskHref: taskHref(businessId, deptSlug, task.id) }), task, session };
      }),
    [live, openByTask, agentIndex, businessId, deptSlug],
  );

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const streams = useSessionStreams(sources, focusedId, { flushMs: options.flushMs });
  const taskOf = useCallback((sessionId: string) => sources.find((s) => s.seed.id === sessionId)?.task ?? null, [sources]);

  // Replay (scrubber) for the focused tile.
  const [replay, setReplay] = useState<{ position: number; playing: boolean; speed: ScrubberSpeed; live: boolean }>({ position: 0, playing: false, speed: 1, live: true });
  useEffect(() => {
    setReplay({ position: 0, playing: false, speed: 1, live: true });
  }, [focusedId]);
  const focusedSource = focusedId ? sources.find((s) => s.seed.id === focusedId) ?? null : null;
  const replayQuery = useWidgetQuery<SessionReplayResponse>("dev.sessions.replay", { sessionId: focusedId ?? "" }, { enabled: !!focusedId && !isPlaceholderSessionId(focusedId) });
  useEffect(() => {
    if (focusedId && replayQuery.data?.events?.length) streams.ingest(focusedId, replayQuery.data.events);
  }, [focusedId, replayQuery.data, streams]);
  const focusedEvents = focusedId ? streams.eventsFor(focusedId) : [];
  const now = options.now ?? new Date();
  const focusedLength = focusedSource ? sessionLengthMs(focusedEvents, focusedSource.seed.startedAt, streams.byId.get(focusedSource.seed.id)?.endedAt ?? null, now) : 0;
  const replaySession = focusedId && !replay.live ? streams.replayAt(focusedId, replay.position) : null;

  // Dialogs.
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

  const tier = plan.data?.tier;
  const limit = tier ? TIERS[tier].maxConcurrentAgents : 16;
  const running = live.filter((t) => t.status === "running").length;

  const graphNodes = useMemo(() => {
    const rows = graph.data?.items ?? [];
    return toGraphNodes(
      rows,
      graph.data?.edges ?? [],
      (id) => {
        const a = id ? agentIndex.get(id) : undefined;
        return a ? { id: a.id, name: a.name, seed: a.avatarSeed || a.id, dept: toTileAgent(a, a.id).dept } : null;
      },
      (t) => {
        const liveSession = sources.find((s) => s.task.id === t.id);
        const s = liveSession ? streams.byId.get(liveSession.seed.id) : undefined;
        return s ? s.progress : t.status === "done" ? 1 : undefined;
      },
    );
  }, [graph.data, agentIndex, sources, streams.byId]);

  const planHref = routes.department(businessId, deptSlug ?? "development", "plan");
  const reassignTask = reassign ? taskOf(reassign) : null;
  const stopTask = stop ? taskOf(stop) : null;
  const claudeTask = claudeCode ? taskOf(claudeCode) : null;

  return (
    <Screen name="development/training-ground" className="h-full">
      <Panel
        span={12}
        title="Training Ground"
        flush
        className="h-full"
        bodyClassName="flex min-h-0 flex-col"
        loading={tasks.isLoading || (sessions.isLoading && !sessions.data)}
        error={tasks.error ? tasks.error.message : sessions.error ? sessions.error.message : undefined}
        onRetry={refetchAll}
        empty={tasks.data && live.length === 0 ? { icon: Radio, title: "No agents are working right now", children: "Tiles appear here as soon as a task starts. Plan work from the roadmap or start a ready task on the Plan tab.", action: { label: "Go to Plan", onClick: () => navigate(planHref) } } : undefined}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-small text-secondary tabular-nums" data-testid="ground-counts">
              {live.length} live · {running} running
            </span>
            <GroundViewToggle value={view} onChange={setView} />
            <ShoutMenu target="all agents" labelled onShout={(shout) => void action.run("dev.tasks.shout", shoutInput(shout), { key: "shout:all" })} disabled={running === 0} />
          </div>
        }
        footer={
          <span className="flex items-center gap-2 tabular-nums">
            {concurrencyHint(limit, running)}
            {!plan.data ? <ProvenanceChip kind="estimate" /> : null}
            {action.error ? <InlineError error={action.error} /> : null}
            {action.pending?.startsWith("shout") ? <span className="text-secondary">Sending shout…</span> : null}
          </span>
        }
      >
        {view === "formation" ? (
          <div className="p-panel-pad">
            <TaskGraph
              nodes={graphNodes}
              height={520}
              selectedId={focusedSource?.task.id ?? null}
              onSelect={(taskId) => {
                const source = sources.find((s) => s.task.id === taskId);
                if (source) {
                  setFocusedId(source.seed.id);
                  setView("tiles");
                } else navigate(`${planHref}?task=${taskId}`);
              }}
              aria-label="Formation: task graph by status"
            />
            {graph.isLoading ? <p className="mt-2 text-small text-secondary">Loading the task graph…</p> : null}
            {graph.data && graphNodes.length === 0 ? <p className="mt-2 text-small text-secondary">No tasks yet. Plan work from the roadmap on the Plan tab.</p> : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col" style={{ height: GRID_HEIGHT, minHeight: 480 }}>
            <TileGrid
              items={items}
              focusedId={focusedId}
              onFocusedChange={setFocusedId}
              aria-label="Agent tiles"
              className="min-h-0 flex-1"
              renderTile={(item, ctx) => {
                const session = ctx.focused && replaySession ? replaySession : item.session;
                const common = { session, focused: ctx.focused, compact: ctx.compact, controls, now: options.now, onFocus: (id: string) => setFocusedId(id), onOpenTask: (task: { href?: string }) => task.href && navigate(task.href) };
                if (session.task.kind === "specialist") return <SpecialistTile {...common} data={specialistDataFromSession(session)} />;
                return <AgentTile {...common} terminalRenderer={options.terminalRenderer} diffEngine={options.diffEngine} />;
              }}
            />
            {focusedSource ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-subtle bg-panel pr-2">
                <SessionScrubber
                  className={cn("min-w-0 flex-1 border-t-0")}
                  events={focusedEvents}
                  startedAt={focusedSource.seed.startedAt}
                  endedAt={streams.byId.get(focusedSource.seed.id)?.endedAt ?? null}
                  now={options.now}
                  position={replay.live ? focusedLength : replay.position}
                  onPositionChange={(position) => setReplay((r) => ({ ...r, position, live: false }))}
                  playing={replay.playing}
                  onPlayingChange={(playing) => setReplay((r) => ({ ...r, playing, live: false, position: r.live ? 0 : r.position }))}
                  speed={replay.speed}
                  onSpeedChange={(speed) => setReplay((r) => ({ ...r, speed }))}
                  label={`Replay of ${focusedSource.seed.agent.name}`}
                />
                <Button size="sm" variant={replay.live ? "default" : "primary"} icon={Rows3} disabled={replay.live} onClick={() => setReplay((r) => ({ ...r, live: true, playing: false }))}>
                  {replay.live ? "Live" : "Back to live"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
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
      <StopDialog
        open={!!stop}
        onOpenChange={(o) => !o && setStop(null)}
        taskTitle={stopTask?.title ?? ""}
        pending={!!stop && action.pending === `dev.tasks.stop:${stopTask?.id}`}
        error={stop ? action.error : null}
        onConfirm={() => stop && void runTask("dev.tasks.stop", stop).then((r) => r !== undefined && setStop(null))}
      />
      <OpenInClaudeCodeDialog taskId={claudeTask?.id ?? null} taskTitle={claudeTask?.title} onOpenChange={(o) => !o && setClaudeCode(null)} />
    </Screen>
  );
}
