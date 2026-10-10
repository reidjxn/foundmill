/**
 * Pure session logic for the Training Ground: turning task/session/agent rows into Dugout tile seeds, reading
 * `as:<sessionId>` stream frames into `AgentSessionEvent`s, and the focus-aware throttle (ARCHITECTURE §12: unfocused
 * tiles see at most four bursts per second; the focused tile sees every event as it arrives).
 */
import { AGENT_SESSION_EVENT_KINDS, emptySession, type AgentSessionEvent, type AgentTileSession, type SessionSeed, type TileAgent } from "@foundmill/dugout";
import type { TaskPhase, TaskStatus } from "@foundmill/shared";
import { agentBranch, progressValue, toIso } from "./shared";
import type { SessionRow, TaskRow } from "./types";

/** Bursts per second an unfocused tile receives (apps/stream protocol `UNFOCUSED_BURSTS_PER_SECOND`). */
export const UNFOCUSED_BURSTS_PER_SECOND = 4;
export const UNFOCUSED_FLUSH_MS = Math.round(1000 / UNFOCUSED_BURSTS_PER_SECOND);

/** Tile id when a task has no open session yet (nothing to subscribe to; the tile shows the task's stored state). */
export const placeholderSessionId = (taskId: string) => `task:${taskId}`;
export const isPlaceholderSessionId = (id: string) => id.startsWith("task:");

const KINDS = new Set<string>(AGENT_SESSION_EVENT_KINDS);

/**
 * Read a stream frame as a session event. Accepts the event object itself, the relay's raw `{ kind, json }` field
 * pair (json is the serialised event) and the `{ ch, e }` frame; returns null for anything else (pong, errors,
 * platform events).
 */
export function readSessionEvent(raw: unknown): AgentSessionEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("e" in obj && obj.e && typeof obj.e === "object" && !("kind" in obj)) return readSessionEvent(obj.e);
  if (typeof obj.json === "string" && typeof obj.kind === "string" && !("at" in obj)) {
    try {
      return readSessionEvent(JSON.parse(obj.json) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof obj.kind !== "string" || !KINDS.has(obj.kind)) return null;
  const at = obj.at instanceof Date ? obj.at.toISOString() : typeof obj.at === "string" ? obj.at : null;
  if (!at) return null;
  return { ...(obj as object), at } as AgentSessionEvent;
}

export interface TileSeedInput {
  task: TaskRow;
  session: SessionRow | null | undefined;
  agent: TileAgent;
  taskHref?: string;
  /** The business's currency: sessions carry no currency of their own, so their cost is shown in it. */
  currency?: string;
}

/** The longest brief a tile shows (about three lines of a tile's empty state). */
export const GOAL_LINE_MAX = 200;

/**
 * A task's goal as plain text for a tile (its brief): the first paragraph that is not a heading, markdown marks
 * removed. A paragraph longer than GOAL_LINE_MAX keeps its whole sentences up to that length, else its words with an
 * ellipsis. Undefined when the goal is empty.
 */
export function goalLine(goalMd: string | null | undefined): string | undefined {
  const para = (goalMd ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^\s*#{1,6}\s.*$/gm, "").replace(/^\s*([-*+>]|\d+\.)\s+/gm, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!para) return undefined;
  if (para.length <= GOAL_LINE_MAX) return para;
  const head = para.slice(0, GOAL_LINE_MAX + 1);
  // The last sentence end (a stop followed by a space and a capital) within the limit.
  let end = -1;
  for (const m of head.matchAll(/[.!?](?=\s+[A-Z0-9])/g)) end = m.index ?? end;
  if (end >= 40) return head.slice(0, end + 1);
  return `${head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : GOAL_LINE_MAX).replace(/[\s,;:]+$/, "")}…`;
}

/** The static facts a tile needs, from the task row, its open session (if any) and the agent row. */
export function seedFromRows({ task, session, agent, taskHref, currency: businessCurrency }: TileSeedInput): SessionSeed {
  const tokens = session ? (session.tokensIn ?? 0) + (session.tokensOut ?? 0) : 0;
  const currency = session?.currency ?? businessCurrency ?? "EUR";
  return {
    id: session?.id ?? placeholderSessionId(task.id),
    agent: session?.modelKey ? { ...agent, model: session.modelKey } : agent,
    task: { id: task.id, title: task.title, href: taskHref, kind: task.kind, branch: task.kind === "code" ? agentBranch(task.id) : undefined, goal: goalLine(task.goalMd) },
    startedAt: toIso(session?.startedAt ?? task.startedAt ?? task.createdAt),
    tokens,
    cost: { amountMinor: session?.costMinor ?? 0, currency },
    status: task.status,
  };
}

const PHASE_FOR_STATUS: Partial<Record<TaskStatus, TaskPhase>> = { review: "review", merging: "merge", done: "done" };

/**
 * A tile before any stream event: the seed plus what the task row already knows (status, stored progress, phase,
 * ETA, end time), so a tile is never blank while the stream warms up or when the session has already ended.
 */
export function baseSession(seed: SessionSeed, task: TaskRow, session?: SessionRow | null): AgentTileSession {
  const s = emptySession(seed);
  const phase = task.phase ?? PHASE_FOR_STATUS[task.status] ?? (task.status === "running" || task.status === "paused" || task.status === "blocked" ? "implementing" : "planning");
  const endedAt = session?.endedAt ? toIso(session.endedAt) : task.endedAt ? toIso(task.endedAt) : null;
  return {
    ...s,
    status: task.status,
    phase,
    progress: progressValue(task.progress),
    etaAt: task.eta ? toIso(task.eta) : null,
    endedAt: task.status === "done" || task.status === "failed" || task.status === "stopped" ? endedAt : null,
  };
}

/** Most recent open session per task (the list is newest first; the first open one wins). */
export function openSessionsByTask(sessions: readonly SessionRow[] | undefined): Map<string, SessionRow> {
  const map = new Map<string, SessionRow>();
  for (const s of sessions ?? []) {
    if (!s.taskId || s.endedAt) continue;
    const prev = map.get(s.taskId);
    if (!prev || new Date(s.startedAt).getTime() > new Date(prev.startedAt).getTime()) map.set(s.taskId, s);
  }
  return map;
}

/** Latest session per task, open or not (for replay and the Specialists tab). */
export function latestSessionsByTask(sessions: readonly SessionRow[] | undefined): Map<string, SessionRow> {
  const map = new Map<string, SessionRow>();
  for (const s of sessions ?? []) {
    if (!s.taskId) continue;
    const prev = map.get(s.taskId);
    if (!prev || new Date(s.startedAt).getTime() > new Date(prev.startedAt).getTime()) map.set(s.taskId, s);
  }
  return map;
}

/* ---------- Throttle ---------- */

export interface ThrottleOptions {
  /** ms between flushes for unfocused sessions (default 250 = 4 bursts/s). */
  flushMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Focus-aware event throttle. Events for the focused session are delivered at once; the rest queue per session and
 * are delivered in one burst per session at most every `flushMs`. Order within a session is preserved.
 */
export class SessionThrottle {
  private queues = new Map<string, AgentSessionEvent[]>();
  private timer: unknown = null;
  private focusedId: string | null = null;
  private readonly flushMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly deliver: (sessionId: string, events: AgentSessionEvent[]) => void,
    opts: ThrottleOptions = {},
  ) {
    this.flushMs = opts.flushMs ?? UNFOCUSED_FLUSH_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The focused session: its queued events are flushed immediately and later ones bypass the queue. */
  focus(sessionId: string | null): void {
    this.focusedId = sessionId;
    if (sessionId) {
      const q = this.queues.get(sessionId);
      if (q && q.length) {
        this.queues.delete(sessionId);
        this.deliver(sessionId, q);
      }
    }
  }

  push(sessionId: string, event: AgentSessionEvent): void {
    if (sessionId === this.focusedId) {
      this.deliver(sessionId, [event]);
      return;
    }
    const q = this.queues.get(sessionId) ?? [];
    q.push(event);
    this.queues.set(sessionId, q);
    if (this.timer === null) this.timer = this.setTimer(() => this.flush(), this.flushMs);
  }

  /** Deliver every queued burst now. */
  flush(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const queued = [...this.queues.entries()];
    this.queues.clear();
    for (const [id, events] of queued) if (events.length) this.deliver(id, events);
  }

  /** Queued events per session (tests and the overflow strip badge). */
  pending(sessionId: string): number {
    return this.queues.get(sessionId)?.length ?? 0;
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.queues.clear();
  }
}

/** Largest squad the founder's plan and key support (BUILD §11.6: tier limit, default 16, max 64). */
export function concurrencyHint(limit: number, running: number): string {
  const n = Math.max(1, Math.min(64, Math.round(limit)));
  return `${running} of ${n} running · ${n} is the largest team your key supports`;
}
