"use client";
/**
 * Development › Specialists (BUILD §6.3, §11.6): a grid of SpecialistTiles, one per task of kind "specialist",
 * showing the RFQ funnel, quote table, sample tracker and shipments instead of a terminal. Data comes from the
 * specialist session's stream (structured `specialist:` notes, see specialist-data.ts).
 *
 * Live specialists and any with supplier records get a tile. Finished ones (done, failed, stopped) that left no records
 * collapse into one message with a compact list (never a wall of identical empty tiles); tasks that have not started
 * yet are listed apart, never as finished; a record arriving moves its tile into the grid. The header counts the
 * specialists (people) and their tasks separately.
 */
import { useCallback, useMemo, useState } from "react";
import { FlaskConical, ShieldCheck } from "lucide-react";
import { AgentName, Avatar, useAgentPersona, Chip, Icon, MiniTable, Panel, ShoutMenu, SpecialistTile, Term, TileGrid, formatDuration, formatMoney, type AgentTileSession, type TileControls, type TileGridItem } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { plural } from "../fit";
import type { DeptColourToken } from "@foundmill/shared";
import type { ModuleScreenProps } from "../registry";
import { useNow } from "./clock";
import { OpenInClaudeCodeDialog, ReassignDialog, StopDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { isPlaceholderSessionId, latestSessionsByTask, seedFromRows } from "./session-store";
import { InlineError, OVER_TASK_STATUSES, Screen, TaskStatusPill, isLiveStatus, taskHref, toDate, toTileAgent, useAction, useAgentIndex, useAgents, useDevDepartment } from "./shared";
import { hasSpecialistData, specialistDataFromSession } from "./specialist-data";
import { ReplaySeed, shoutInput } from "./TrainingGroundScreen";
import { useSessionStreams, type TileSource } from "./useSessionStreams";
import type { SessionsListResponse, TaskRow, TasksListResponse } from "./types";

const GRID_HEIGHT = "calc(100vh - 232px)";
/** The grid's height when the finished list sits under it. */
const GRID_WITH_LIST_PX = 440;

/** Static classes so Tailwind emits every tone. */
const HALO_TONE: Record<DeptColourToken, string> = { "dept-1": "tone-dept-1", "dept-2": "tone-dept-2", "dept-3": "tone-dept-3", "dept-4": "tone-dept-4", "dept-5": "tone-dept-5", "dept-6": "tone-dept-6", "dept-7": "tone-dept-7", "dept-8": "tone-dept-8" };

type SpecialistItem = TileGridItem & { session: AgentTileSession };

/** How long a finished session ran ("2h 20m"); null while it has no end. */
function ranFor(s: Pick<AgentTileSession, "startedAt" | "endedAt">): string | null {
  const start = toDate(s.startedAt);
  const end = toDate(s.endedAt);
  return start && end && end > start ? formatDuration(end.getTime() - start.getTime()) : null;
}

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

export function SpecialistsScreen({ businessId, departmentId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const tasks = useWidgetQuery<TasksListResponse>("dev.tasks.list", { kind: "specialist", limit: 200 });
  const sessions = useWidgetQuery<SessionsListResponse>("dev.sessions.list", { limit: 200 });
  const agents = useAgents();
  const dept = useDevDepartment(departmentId);
  const agentIndex = useAgentIndex(agents.data?.agents);
  // Agents named under the reader's preference, in the rows' name fields too (One name everywhere).
  const persona = useAgentPersona();
  const action = useAction();
  const refetchAll = useCallback(() => {
    tasks.refetch();
    sessions.refetch();
  }, [tasks, sessions]);
  useBusinessEvents(() => refetchAll(), ["task.started", "task.completed", "task.blocked"]);

  const deptSlug = dept?.slug;
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

  const items = useMemo<(SpecialistItem & { hasData: boolean })[]>(
    () => streams.sessions.map((s) => ({ id: s.id, label: `${persona.labelFor(s.agent)}: ${s.task.title}`, avatar: { name: s.agent.name, seed: s.agent.seed, dept: s.agent.dept, status: s.agent.status, role: s.agent.role, personaKey: s.agent.personaKey }, session: s, hasData: hasSpecialistData(specialistDataFromSession(s)) })),
    [streams.sessions, persona],
  );
  const tiles = useMemo(() => items.filter((i) => i.hasData || isLiveStatus(i.session.status)), [items]);
  // Finished means over (done, failed, stopped). A ready task that never started is not finished: it waits (AC-11).
  const quiet = useMemo(() => items.filter((i) => !i.hasData && OVER_TASK_STATUSES.includes(i.session.status)), [items]);
  const waiting = useMemo(() => items.filter((i) => !i.hasData && !isLiveStatus(i.session.status) && !OVER_TASK_STATUSES.includes(i.session.status)), [items]);
  const withData = items.filter((i) => i.hasData).length;
  const running = list.filter((t) => t.status === "running").length;
  // The header counts people and their tasks apart: 30 tasks may be the work of 4 specialists (TPD-22).
  const specialists = useMemo(() => new Set(list.map((t) => t.assigneeAgentId).filter((id): id is string => Boolean(id))).size, [list]);
  const ticking = streams.sessions.some((s) => !s.queued && isLiveStatus(s.status));
  const now = useNow({ enabled: ticking, fixed: options.now });
  const replayIds = useMemo(() => sources.map((s) => s.seed.id).filter((id) => !isPlaceholderSessionId(id)), [sources]);
  const reassignTask = reassign ? taskOf(reassign) : null;
  const stopTask = stop ? taskOf(stop) : null;
  const claudeTask = claudeCode ? taskOf(claudeCode) : null;

  return (
    <Screen name="development/specialists" className="h-full">
      {/* What each session already reported (its specialist notes) loads with the page, not only from new events. */}
      {replayIds.map((id) => (
        <ReplaySeed key={id} sessionId={id} onReplay={streams.ingest} />
      ))}
      <Panel
        span={12}
        title="Specialists"
        flush
        className="h-full"
        bodyClassName="flex min-h-0 flex-col"
        loading={tasks.isLoading || (sessions.isLoading && !sessions.data)}
        error={tasks.error ? tasks.error.message : sessions.error ? sessions.error.message : undefined}
        onRetry={refetchAll}
        empty={tasks.data && list.length === 0 ? { icon: FlaskConical, title: "No specialists at work", children: "Sourcing, formulation, certification, packaging, quality, logistics and costing specialists show their quote requests, quotes, samples and shipments here once a specialist task starts. Hire one from the Team tab or plan a task on the Plan tab.", action: { label: "Go to Plan", onClick: () => navigate(routes.department(businessId, deptSlug ?? "development", "plan")) } } : undefined}
        meta={
          list.length ? (
            <span data-testid="specialist-counts">
              {plural(specialists, "specialist")} · {plural(list.length, "task")} · {running} running · {withData} reporting
            </span>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Chip tone="warn" icon={ShieldCheck}>
              Human gate on every purchase order
            </Chip>
            <ShoutMenu target="all specialists" labelled disabled={running === 0} onShout={(shout) => void action.run("dev.tasks.shout", shoutInput(shout), { key: "shout:all" })} />
          </div>
        }
        footer={action.error ? <InlineError error={action.error} /> : action.notice ? <span role="status">{action.notice}</span> : <span>Prices are read from supplier emails and are estimates until a supplier confirms them.</span>}
      >
        {tiles.length ? (
          <div className="flex min-h-0 flex-col" style={quiet.length ? { height: GRID_WITH_LIST_PX } : { height: GRID_HEIGHT, minHeight: 480 }}>
            <TileGrid
              items={tiles}
              focusedId={focusedId}
              onFocusedChange={setFocusedId}
              aria-label="Specialist tiles"
              className="min-h-0 flex-1"
              renderTile={(item, ctx) => <SpecialistTile session={item.session} data={specialistDataFromSession(item.session)} focused={ctx.focused} compact={ctx.compact} controls={controls} now={now} onFocus={(id) => setFocusedId(id)} onOpenTask={(task) => task.href && navigate(task.href)} />}
            />
          </div>
        ) : null}
        {waiting.length ? (
          <section aria-label="Not started yet" className={tiles.length || quiet.length ? "border-t border-line" : undefined} data-testid="specialists-waiting">
            <div className="flex min-w-0 flex-col gap-0.5 px-panel-pad pb-2 pt-3">
              <p className="text-body-strong">{waiting.length === 1 ? "1 specialist task has not started yet" : `${waiting.length} specialist tasks have not started yet`}</p>
              <p className="text-small text-secondary">They are queued for the next <Term id="cycle">round of work</Term>. A tile appears here as soon as one starts.</p>
            </div>
            <MiniTable<SpecialistItem>
              aria-label="Specialist tasks not started"
              className="mx-panel-pad mb-panel-pad"
              rows={waiting}
              getRowKey={(i) => i.id}
              onRowClick={(i) => i.session.task.href && navigate(i.session.task.href)}
              columns={[
                {
                  id: "agent",
                  header: "Specialist",
                  width: 260,
                  cell: (i) => (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar size={20} name={i.session.agent.name} agent={{ seed: i.session.agent.seed, dept: i.session.agent.dept, personaKey: i.session.agent.personaKey }} status={i.session.agent.status} />
                      <span className="min-w-0 truncate" title={i.session.agent.name}>
                        <AgentName agent={i.session.agent} />
                      </span>
                    </span>
                  ),
                },
                { id: "task", header: "Task", cell: (i) => <span className="text-secondary">{i.session.task.title}</span> },
                { id: "status", header: "Status", numeric: true, cell: (i) => <TaskStatusPill status={i.session.status} /> },
              ]}
            />
          </section>
        ) : null}
        {quiet.length ? (
          <section aria-label="Finished without supplier records" className={tiles.length ? "border-t border-line" : undefined} data-testid="specialists-quiet">
            <div className="flex items-start gap-3 px-panel-pad pb-2 pt-3">
              <span className={`icon-halo size-control-md ${HALO_TONE[dept?.colourToken ?? "dept-2"]}`} aria-hidden>
                <Icon icon={FlaskConical} size={16} />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-body-strong">{quiet.length === 1 ? "1 finished specialist task left no supplier records" : `${quiet.length} finished specialist tasks left no supplier records`}</p>
                <p className="text-small text-secondary">Quote requests, quotes, samples and shipments fill in from a specialist's notes as requests go out and suppliers reply. These sessions ended before any arrived; open a task to read what happened.</p>
              </div>
            </div>
            <MiniTable<SpecialistItem>
              aria-label="Finished specialist tasks"
              className="mx-panel-pad mb-panel-pad"
              rows={quiet}
              getRowKey={(i) => i.id}
              onRowClick={(i) => i.session.task.href && navigate(i.session.task.href)}
              columns={[
                {
                  id: "agent",
                  header: "Specialist",
                  width: 260,
                  cell: (i) => (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar size={20} name={i.session.agent.name} agent={{ seed: i.session.agent.seed, dept: i.session.agent.dept, personaKey: i.session.agent.personaKey }} status={i.session.agent.status} />
                      <span className="min-w-0 truncate" title={i.session.agent.name}>
                        <AgentName agent={i.session.agent} />
                      </span>
                    </span>
                  ),
                },
                { id: "task", header: "Task", cell: (i) => <span className="text-secondary">{i.session.task.title}</span> },
                { id: "status", header: "Status", numeric: true, cell: (i) => <TaskStatusPill status={i.session.status} /> },
                { id: "ran", header: "Ran for", numeric: true, cell: (i) => ranFor(i.session) ?? <span className="text-tertiary">—</span> },
                // Session costs are metered estimates until the month's invoice closes (the tiles say so too).
                { id: "cost", header: "Cost (estimate)", numeric: true, cell: (i) => formatMoney(i.session.cost) },
              ]}
            />
          </section>
        ) : null}
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
