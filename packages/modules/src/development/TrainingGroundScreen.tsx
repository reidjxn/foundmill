"use client";
/**
 * Development › Training Ground (BUILD §6.3, §11.6; DESIGN §9): the split-screen of AgentTiles fed by `dev.tasks.list`
 * + `as:<sessionId>` streams with focus-aware throttling, the Formation view (task graph), the session scrubber
 * replay, Nudges and the per-tile controls (Pause/Resume/Reassign/Upgrade/Stop/Open in Claude Code). The focused
 * tile's strip offers the nudges that fit its agent (the persona's presets); after any nudge the tile shows the agent's
 * one-bubble acknowledgement in its own voice (no model call), for a few seconds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Rows3 } from "lucide-react";
import { TIERS } from "@foundmill/config";
import {
  AgentTile,
  Button,
  EmptyState,
  Explainer,
  GroundViewToggle,
  NudgeMenu,
  Panel,
  ProvenanceChip,
  SessionScrubber,
  ShoutMenu,
  SpecialistTile,
  TaskGraph,
  Term,
  TileGrid,
  cn,
  sessionLengthMs,
  useAgentPersona,
  useBuilderView,
  type AgentTileSession,
  type GroundView,
  type Nudge,
  type ScrubberSpeed,
  type Shout,
  type ShoutPreset,
  type TaskGraphNode,
  type TileControls,
  type TileGridItem,
} from "@foundmill/dugout";
import type { PlanTier } from "@foundmill/shared";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { BrowserSessions } from "./BrowserSessions";
import { OpenInClaudeCodeDialog, ReassignDialog, StopDialog } from "./dialogs";
import { TileNudgeAck, nudgeMenuPresets, nudgeShoutInput, useNudgePersona, type SentNudge } from "./nudges";
import { useDevScreenOptions } from "./options";
import { useNow } from "./clock";
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

/** How long a nudge's acknowledgement stays on the tile. */
export const NUDGE_ACK_MS = 6_000;

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
/** The line a first-timer reads above the tiles while guidance is on (UX plan §7.12); the Explainer's "what to do". */
export const LIVE_SESSIONS_LEDE = "Each tile is one agent on one task. Nudge to give advice; Pause to hold it.";
/** The department's intro, on its first tab while guidance is on (UX plan §7.10): the tile grid flexes under it. */
export const DEVELOPMENT_EXPLAINER = {
  screenId: "development/live-sessions",
  purpose: "The team building it. Watch work live, see the plan, review finished code.",
  action: LIVE_SESSIONS_LEDE,
  watchFor: "A tile that reads Waiting: that agent needs an answer from you in the Inbox.",
} as const;

/**
 * Loads what a session streamed before this tab subscribed (`dev.sessions.replay`) into its tile: the stream only
 * carries events published after the subscription, so without it a tile opened mid-session showed no output and a
 * stale phase until something new happened (TPD-35). One per visible tile; the focused tile's scrubber replays the same
 * events. A replay that read the stream and found it empty marks a running session as queued for a worker (SOAK-08).
 */
export function ReplaySeed({ sessionId, onReplay }: { sessionId: string; onReplay: (sessionId: string, events: readonly unknown[], opts: { streamEmpty: boolean }) => void }) {
  const replay = useWidgetQuery<SessionReplayResponse>("dev.sessions.replay", { sessionId });
  useEffect(() => {
    if (!replay.data) return;
    const events = replay.data.events ?? [];
    onReplay(sessionId, events, { streamEmpty: replay.data.source === "stream" && events.length === 0 });
  }, [sessionId, replay.data, onReplay]);
  return null;
}

export function TrainingGroundScreen({ businessId, subView }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { status: [...LIVE_TASK_STATUSES], limit: 200 });
  const sessions = useWidgetQuery<SessionsListResponse>("dev.sessions.list", { openOnly: true, limit: 200 });
  const agents = useAgents();
  const plan = useWidgetQuery<{ tier: PlanTier }>("billing.plan", {});
  const departments = useDepartments();
  // Builder view off (Working now): tiles only. The Task graph sub-view, the replay scrubber, terminals and diffs are the
  // builder's; each tile keeps its agent, the task in the founder's words, progress, elapsed, the cost Estimate and Nudge.
  const builder = useBuilderView();
  const [chosenView, setView] = useState<GroundView>(subView === "formation" ? "formation" : "tiles");
  const view: GroundView = builder ? chosenView : "tiles";
  const graph = useWidgetQuery<TasksListResponse>("dev.tasks.list", { limit: 500 }, { enabled: view === "formation" });
  const action = useAction();

  const refetchAll = useCallback(() => {
    tasks.refetch();
    sessions.refetch();
  }, [tasks, sessions]);
  useBusinessEvents(() => refetchAll(), ["task.started", "task.completed", "task.blocked", "pr.merged", "task.progressed"]);

  const agentIndex = useAgentIndex(agents.data?.agents);
  // Agents named under the reader's preference, in the rows' name fields too (One name everywhere).
  const persona = useAgentPersona();
  const deptSlug = departmentForModule(departments.data, "development")?.slug;
  const openByTask = useMemo(() => openSessionsByTask(sessions.data?.items), [sessions.data]);
  const live = useMemo(() => liveTasks(tasks.data?.items), [tasks.data]);

  const sources = useMemo<TileSource[]>(
    () =>
      live.map((task) => {
        const session = openByTask.get(task.id) ?? null;
        const agent = toTileAgent(agentIndex.get(task.assigneeAgentId ?? ""), task.assigneeAgentId);
        const seed = seedFromRows({ task, session, agent, taskHref: taskHref(businessId, deptSlug, task.id) });
        // The founder's title (0070) on the tile while Builder view is off; the builder reads the task's own.
        return { seed: builder || !task.founderTitle ? seed : { ...seed, task: { ...seed.task, title: task.founderTitle } }, task, session };
      }),
    [live, openByTask, agentIndex, businessId, deptSlug, builder],
  );

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const streams = useSessionStreams(sources, focusedId, { flushMs: options.flushMs });
  const taskOf = useCallback((sessionId: string) => sources.find((s) => s.seed.id === sessionId)?.task ?? null, [sources]);

  // Replay (scrubber) for the focused tile. Every tile's recorded events are loaded by its ReplaySeed below.
  const [replay, setReplay] = useState<{ position: number; playing: boolean; speed: ScrubberSpeed; live: boolean }>({ position: 0, playing: false, speed: 1, live: true });
  useEffect(() => {
    setReplay({ position: 0, playing: false, speed: 1, live: true });
  }, [focusedId]);
  const focusedSource = focusedId ? sources.find((s) => s.seed.id === focusedId) ?? null : null;
  const focusedEvents = focusedId ? streams.eventsFor(focusedId) : [];
  // Elapsed and ETA tick every second while something is live (VSOAK2-X1); a queued session has no clock.
  const ticking = streams.sessions.some((s) => !s.queued && (s.status === "running" || s.status === "review" || s.status === "merging"));
  const now = useNow({ enabled: ticking, fixed: options.now });
  const focusedLength = focusedSource ? sessionLengthMs(focusedEvents, focusedSource.seed.startedAt, streams.byId.get(focusedSource.seed.id)?.endedAt ?? null, now) : 0;
  const replaySession = builder && focusedId && !replay.live ? streams.replayAt(focusedId, replay.position) : null;

  // Dialogs.
  const [reassign, setReassign] = useState<string | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [claudeCode, setClaudeCode] = useState<string | null>(null);

  const runTask = (path: string, sessionId: string, extra: Record<string, unknown> = {}) => {
    const task = taskOf(sessionId);
    if (!task) return Promise.resolve(undefined);
    return action.run(path, { taskId: task.id, ...extra }, { key: `${path}:${task.id}`, then: refetchAll });
  };

  // Nudges: the tile shows the agent's one-bubble acknowledgement for a few seconds after the nudge reaches the session.
  const [acks, setAcks] = useState<Record<string, SentNudge>>({});
  const nonce = useRef(0);
  const acknowledge = useCallback((sessionId: string, agentId: string | null, text: string) => {
    const n = ++nonce.current;
    setAcks((a) => ({ ...a, [sessionId]: { agentId, text, nonce: n } }));
    setTimeout(() => setAcks((a) => (a[sessionId]?.nonce === n ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== sessionId)) : a)), NUDGE_ACK_MS);
  }, []);
  const sendNudge = (sessionId: string, input: Record<string, unknown>, text: string) => {
    const task = taskOf(sessionId);
    if (!task) return;
    // The agent's "Noted." appears only when the nudge reached the session; otherwise the screen says it did not.
    void action.run("dev.tasks.shout", { ...input, taskId: task.id }, { key: `shout:${task.id}`, then: (_result, delivery) => delivery && delivery.delivered === delivery.total && delivery.total > 0 && acknowledge(sessionId, task.assigneeAgentId ?? null, text) });
  };
  const focusedAgentId = focusedSource?.task.assigneeAgentId ?? null;
  const focusedPersona = useNudgePersona(focusedAgentId).persona;

  const controls: TileControls = {
    onPause: (id) => void runTask("dev.tasks.pause", id),
    onResume: (id) => void runTask("dev.tasks.resume", id),
    onShout: (id, shout) => sendNudge(id, shoutInput(shout), shout.text),
    onReassign: (id) => setReassign(id),
    onUpgradeModel: (id) => void runTask("dev.tasks.upgradeModel", id),
    onStop: (id) => setStop(id),
    onOpenInClaudeCode: (id) => setClaudeCode(id),
  };

  const items = useMemo<(TileGridItem & { session: AgentTileSession })[]>(
    () => streams.sessions.map((s) => ({ id: s.id, label: `${persona.labelFor(s.agent)}: ${s.task.title}`, avatar: { name: s.agent.name, seed: s.agent.seed, dept: s.agent.dept, status: s.agent.status, role: s.agent.role, personaKey: s.agent.personaKey }, session: s })),
    [streams.sessions, persona],
  );

  const tier = plan.data?.tier;
  const limit = tier ? TIERS[tier].maxConcurrentAgents : 16;
  // Started sessions no worker has picked up yet are queued, not running.
  const queued = streams.sessions.filter((s) => s.queued && s.status === "running").length;
  const running = live.filter((t) => t.status === "running").length - queued;
  const replayIds = useMemo(() => sources.map((s) => s.seed.id).filter((id) => !isPlaceholderSessionId(id)), [sources]);
  const ingest = streams.ingest;

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
  // Nobody at work: the empty state sits in the body under the department's intro (the intro is for first-timers,
  // who meet this tab before any task has started), never in place of it.
  const nobody = !!tasks.data && live.length === 0;

  return (
    <Screen name="development/training-ground" className="h-full">
      {replayIds.map((id) => (
        <ReplaySeed key={id} sessionId={id} onReplay={ingest} />
      ))}
      <Panel
        span={12}
        title={builder ? <Term id="session">Live sessions</Term> : "Working now"}
        flush
        className="h-full"
        bodyClassName="flex min-h-0 flex-col"
        loading={tasks.isLoading || (sessions.isLoading && !sessions.data)}
        error={tasks.error ? tasks.error.message : sessions.error ? sessions.error.message : undefined}
        onRetry={refetchAll}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-small text-secondary tabular-nums" data-testid="ground-counts">
              {live.length} live · {running} running{queued ? ` · ${queued} queued` : ""}
            </span>
            {builder ? <GroundViewToggle value={view} onChange={setView} /> : null}
            <ShoutMenu target="all agents" labelled onShout={(shout) => void action.run("dev.tasks.shout", shoutInput(shout), { key: "shout:all" })} disabled={running === 0} />
          </div>
        }
        footer={
          <span className="flex items-center gap-2 tabular-nums">
            {concurrencyHint(limit, running)}
            {!plan.data ? <ProvenanceChip kind="estimate" /> : null}
            {action.error ? <InlineError error={action.error} /> : null}
            {action.notice ? (
              <span role="status" className="text-secondary" data-testid="ground-notice">
                {action.notice}
              </span>
            ) : null}
            {action.pending?.startsWith("shout") ? <span className="text-secondary">Sending nudge…</span> : null}
          </span>
        }
      >
        <BrowserSessions />
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
              aria-label="Task graph by status"
            />
            {graph.isLoading ? <p className="mt-2 text-small text-secondary">Loading the task graph…</p> : null}
            {graph.data && graphNodes.length === 0 ? <p className="mt-2 text-small text-secondary">No tasks yet. Plan work from the roadmap on the Plan tab.</p> : null}
          </div>
        ) : nobody ? (
          <div className="flex min-h-0 flex-col">
            <Explainer {...DEVELOPMENT_EXPLAINER} className="m-panel-pad shrink-0" />
            <EmptyState icon={Radio} title="No agents are working right now" action={{ label: "Go to Plan", onClick: () => navigate(planHref) }} className="py-6">
              Tiles appear here as soon as a task starts. Plan work from the roadmap or start a ready task on the Plan tab.
            </EmptyState>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col" style={{ height: GRID_HEIGHT, minHeight: 480 }}>
            {/* The department's intro while guidance is on; the grid flexes under it (UX plan §7.10, §7.12). */}
            <Explainer {...DEVELOPMENT_EXPLAINER} className="m-panel-pad mb-0 shrink-0" />
            <TileGrid
              items={items}
              focusedId={focusedId}
              onFocusedChange={setFocusedId}
              aria-label="Agent tiles"
              className="min-h-0 flex-1"
              renderTile={(item, ctx) => {
                const session = ctx.focused && replaySession ? replaySession : item.session;
                const common = { session, focused: ctx.focused, compact: ctx.compact, controls, now, onFocus: (id: string) => setFocusedId(id), onOpenTask: (task: { href?: string }) => task.href && navigate(task.href) };
                const tile = session.task.kind === "specialist" ? <SpecialistTile {...common} data={specialistDataFromSession(session)} /> : <AgentTile {...common} terminalRenderer={options.terminalRenderer} diffEngine={options.diffEngine} />;
                const ack = acks[item.id];
                if (!ack) return tile;
                return (
                  <div className="relative flex h-full min-h-0 flex-col">
                    {tile}
                    <TileNudgeAck sent={ack} fallback={{ name: session.agent.name, seed: session.agent.seed, dept: session.agent.dept }} className="pointer-events-none absolute inset-x-2 bottom-8 z-10" />
                  </div>
                );
              }}
            />
            {focusedSource ? (
              <div className="flex shrink-0 items-center gap-2 border-t border-subtle bg-panel pr-2">
                {/* The replay of the agent's screen is Builder view's; off, the strip carries the Nudge alone. */}
                {builder ? (
                  <>
                    <SessionScrubber
                      className={cn("min-w-0 flex-1 border-t-0")}
                      events={focusedEvents}
                      startedAt={focusedSource.seed.startedAt}
                      endedAt={streams.byId.get(focusedSource.seed.id)?.endedAt ?? null}
                      now={now}
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
                  </>
                ) : (
                  <span className="min-w-0 flex-1 py-1" />
                )}
                <NudgeMenu
                  target={focusedPersona?.name ?? focusedSource.seed.agent.name}
                  presets={nudgeMenuPresets(focusedPersona)}
                  labelled
                  disabled={focusedSource.task.status !== "running"}
                  onNudge={(n: Nudge) => focusedId && sendNudge(focusedId, nudgeShoutInput(n, focusedPersona), n.text)}
                />
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
