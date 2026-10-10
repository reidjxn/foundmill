"use client";
/**
 * Logs tab (BUILD §11.10 "History and logs", §11.6 replay): the agent's sessions as a DataTable (start, duration,
 * model, tokens, cost, outcome, task) and a replay of the selected one. `dev.sessions.replay` returns the recorded
 * events (the `as:{sessionId}` stream when Redis holds it, else the mock sandbox recording placed on the session's
 * timeline) and names the channel; live sessions keep appending from the stream. Everything is reduced with Dugout's
 * session reducer into an AgentTile behind a SessionScrubber.
 */
import { useQuery } from "@tanstack/react-query";
import { Play, ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENT_SESSION_EVENT_KINDS, AgentTile, Chip, DataTable, EmptyState, ModelChip, Panel, SessionScrubber, StatusPill, eventsUntil, formatDateTime, formatDuration, formatMoney, formatTokens, reduceSessionEvents, type AgentSessionEvent, type DataTableColumn, type SavedView, type ScrubberSpeed, type SessionSeed } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useStreamSubscription } from "@/lib/stream-client";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import type { TabProps } from "./AgentProfileScreen";
import { OUTCOME_TONE, departmentColour, outcomeWord, sessionRows, type SessionRow } from "./logic";

const VIEWS: SavedView[] = [
  { id: "recent", name: "Recent", builtIn: true, columns: ["startedAt", "duration", "model", "tokens", "cost", "outcome", "task"], sort: [{ id: "startedAt", desc: true }], filters: [] },
  { id: "cost", name: "Cost", builtIn: true, columns: ["startedAt", "model", "tokens", "cost"], sort: [{ id: "cost", desc: true }], filters: [] },
  { id: "failures", name: "Failures", builtIn: true, columns: ["startedAt", "duration", "outcome", "task"], sort: [{ id: "startedAt", desc: true }], filters: [{ id: "f1", field: "outcome", op: "in", value: ["failure", "failed", "stopped"] }] },
];

/** Accept only frames that look like a session event; anything else on the channel is ignored. */
/** Replayed events then live ones, deduplicated by time + kind + payload, kept in time order. */
export function mergeSessionEvents(existing: readonly AgentSessionEvent[], incoming: readonly AgentSessionEvent[]): AgentSessionEvent[] {
  if (incoming.length === 0) return [...existing];
  const seen = new Set(existing.map((e) => JSON.stringify(e)));
  const out = [...existing];
  for (const e of incoming) {
    const key = JSON.stringify(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * Why a replay is empty, for the founder. The api's reason is an internal message (a Redis client error, a missing
 * recording key); it is never shown as is.
 */
export function replayReasonCopy(reason: string | null | undefined): string {
  if (!reason) return "This session left no recording. The figures above come from the session itself.";
  if (/stream|redis|offline|writeable|ECONN|connect/i.test(reason)) return "The live recording service is offline, so this session cannot be replayed right now. The figures above come from the session itself.";
  return "This session left no recording to replay. The figures above come from the session itself.";
}

export function readSessionEvent(raw: unknown): AgentSessionEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const inner = typeof o.json === "string" ? safeParse(o.json) : o;
  if (!inner || typeof inner !== "object") return null;
  const e = inner as Record<string, unknown>;
  if (typeof e.kind !== "string" || !(AGENT_SESSION_EVENT_KINDS as readonly string[]).includes(e.kind) || typeof e.at !== "string") return null;
  return e as unknown as AgentSessionEvent;
}
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function LogsTab({ businessId, profile }: TabProps) {
  const rows = useMemo(() => sessionRows(profile.sessions), [profile.sessions]);
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const [views, setViews] = useState<SavedView[]>(VIEWS);

  const columns = useMemo<DataTableColumn<SessionRow>[]>(
    () => [
      { id: "startedAt", accessorKey: "startedAt", header: "Started", size: 160, cell: ({ getValue }) => <span className="tabular-nums">{formatDateTime(getValue() as string)}</span>, meta: { locked: true, filter: "date" } },
      { id: "duration", accessorKey: "durationMs", header: "Duration", size: 100, cell: ({ getValue }) => formatDuration(getValue() as number), meta: { numeric: true } },
      { id: "model", accessorKey: "model", header: "Model", size: 100, cell: ({ row }) => <ModelChip model={row.original.model} />, meta: { filter: "select", filterOptions: ["opus", "sonnet", "haiku"].map((v) => ({ value: v, label: v })) } },
      // The header says "Tokens": the cell is the figure alone, so it never truncates ("449K toke…").
      { id: "tokens", accessorKey: "tokens", header: "Tokens", size: 100, cell: ({ getValue }) => <span className="tabular-nums">{formatTokens(getValue() as number).replace(/\s*tokens?$/i, "")}</span>, meta: { numeric: true } },
      { id: "cost", accessorKey: "costMinor", header: "Cost", size: 100, cell: ({ row }) => <span className="inline-flex items-center gap-1">{formatMoney({ amountMinor: row.original.costMinor, currency: row.original.currency })}</span>, meta: { numeric: true, csv: (r) => r.costMinor / 100 } },
      { id: "outcome", accessorKey: "outcome", header: "Outcome", size: 130, cell: ({ row }) => <StatusPill tone={OUTCOME_TONE[row.original.outcome] ?? "neutral"} pulse={row.original.live}>{row.original.live ? "Running" : outcomeWord(row.original.outcome)}</StatusPill>, meta: { filter: "select", filterOptions: Object.keys(OUTCOME_TONE).map((v) => ({ value: v, label: outcomeWord(v) })) } },
      { id: "task", accessorKey: "taskId", header: "Task", size: 140, cell: ({ getValue }) => (getValue() ? <span className="font-mono text-mono text-secondary">{String(getValue()).slice(0, 8)}</span> : <span className="text-secondary">—</span>) },
    ],
    [],
  );

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-logs">
      <Panel title="Sessions" span={12} flush empty={rows.length === 0 ? { icon: ScrollText, children: "Every session this agent runs is listed here with its replay. Sessions start when Continue dispatches a task to it." } : undefined} footer="Click a session to replay it below. Live sessions stream as they run.">
        <DataTable<SessionRow> aria-label="Sessions" data={rows} columns={columns} views={views} onViewsChange={setViews} defaultViewId="recent" onRowClick={(r) => setSelectedId(r.id)} onRowOpen={(r) => setSelectedId(r.id)} selectedIds={selectedId ? [selectedId] : []} height={Math.min(360, Math.max(160, rows.length * 28 + 48))} exportFileName={`${profile.agent.name}-sessions`} className="border-0" />
      </Panel>
      {selected ? <ReplayPanel businessId={businessId} profile={profile} session={selected} /> : null}
    </div>
  );
}

function ReplayPanel({ businessId, profile, session }: { businessId: string; profile: TabProps["profile"]; session: SessionRow }) {
  const trpc = useTRPC();
  const replayQ = useQuery(trpc.dev.sessions.replay.queryOptions({ businessId, sessionId: session.id }, { staleTime: 30_000, retry: false }));
  const [events, setEvents] = useState<AgentSessionEvent[]>([]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ScrubberSpeed>(1);
  const [key, setKey] = useState(session.id);
  if (key !== session.id) {
    // New session selected: reset the collected events (render-time reset keeps the hooks order stable).
    setKey(session.id);
    setEvents([]);
    setPosition(0);
    setPlaying(false);
  }
  const channel = replayQ.data?.channel ?? `as:${session.id}`;
  // The recorded events seed the replay; the stream only adds to a live session.
  const recorded = replayQ.data?.events;
  useEffect(() => {
    if (!recorded) return;
    const parsed = recorded.map(readSessionEvent).filter((e): e is AgentSessionEvent => e !== null);
    setEvents((prev) => mergeSessionEvents(prev, parsed));
  }, [recorded]);
  const onEvent = useCallback((raw: unknown) => {
    const e = readSessionEvent(raw);
    if (e) setEvents((prev) => mergeSessionEvents(prev, [e]));
  }, []);
  useStreamSubscription(channel, onEvent, { enabled: !!replayQ.data && replayQ.data.live });

  const seed = useMemo<SessionSeed>(
    () => ({
      id: session.id,
      agent: { id: profile.agent.id, name: profile.agent.name, seed: profile.agent.avatarSeed || profile.agent.id, dept: departmentColour(profile), status: profile.agent.status, model: session.model, role: profile.agent.role },
      task: { id: session.taskId ?? session.id, title: session.taskId ? `Task ${session.taskId.slice(0, 8)}` : "Session without a task", href: session.taskId ? routes.agent(businessId, profile.agent.id, "logs") : undefined },
      startedAt: session.startedAt,
      tokens: session.tokens,
    }),
    [session, profile, businessId],
  );
  // Live sessions follow the newest event; recorded replays obey the scrubber.
  const effectivePosition = session.live && !playing && position === 0 ? Number.MAX_SAFE_INTEGER : position;
  const tile = useMemo(() => reduceSessionEvents(seed, eventsUntil(events, session.startedAt, effectivePosition)), [seed, events, session.startedAt, effectivePosition]);

  return (
    <Panel
      title={`Replay · ${formatDateTime(session.startedAt)}`}
      span={12}
      flush
      actions={
        <span className="inline-flex items-center gap-2">
          {session.live ? <Chip tone="info">Live</Chip> : <Chip tone="neutral">{events.length} events</Chip>}
          {replayQ.data?.source === "recording" && replayQ.data.recording ? <Chip tone="neutral">Recording · {replayQ.data.recording.title}</Chip> : replayQ.data?.source === "stream" ? <Chip tone="neutral">From the stream</Chip> : null}
        </span>
      }
      error={replayQ.error ? errorMessage(replayQ.error) : undefined}
      onRetry={() => void replayQ.refetch()}
      data-testid="session-replay"
    >
      {events.length === 0 ? (
        <EmptyState icon={Play} className="py-8">
          {replayQ.isLoading ? "Loading the recording…" : session.live ? "Waiting for the first event on this session's stream." : replayReasonCopy(replayQ.data?.reason)}
        </EmptyState>
      ) : (
        <div className="flex flex-col">
          <div className="h-[420px]">
            <AgentTile session={tile} focused diffEngine="local" />
          </div>
          <SessionScrubber events={events} startedAt={session.startedAt} endedAt={session.endedAt} position={Math.min(position, Number.MAX_SAFE_INTEGER)} onPositionChange={setPosition} playing={playing} onPlayingChange={setPlaying} speed={speed} onSpeedChange={setSpeed} label={`Replay of ${profile.agent.name}`} />
        </div>
      )}
    </Panel>
  );
}
