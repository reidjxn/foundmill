/**
 * Agent session streams `as:{sessionId}` (BUILD §8.2, §11.6; docs/ARCHITECTURE.md §5).
 *
 * The orchestrator publishes what an agent is doing while it works a task; the Training Ground tiles
 * render it live through apps/stream, and `readSessionEvents` replays it in order for the session
 * scrubber. Fields on the stream are `kind` and `json` (the full event), so apps/stream can route on
 * `kind` without parsing JSON. Progress is never token-based (BUILD §11.6 formula).
 */
import { z } from "zod";
import { TaskPhase, ValidationError } from "@founder-manager/shared";
import { DEFAULT_STREAM_MAXLEN, sessionStreamKey } from "./keys";
import { fieldsToObject, type StreamRedis } from "./redis";

const At = z.iso.datetime({ offset: true });

export const SESSION_EVENT_KINDS = [
  "tool_call",
  "stdout",
  "file_changed",
  "test_result",
  "phase_changed",
  "progress",
  "note",
] as const;
export const SessionEventKind = z.enum(SESSION_EVENT_KINDS);
export type SessionEventKind = z.infer<typeof SessionEventKind>;

/** A tool call made by the agent through the gateway (or a built-in sandbox tool). Args are summarised, never raw secrets. */
export const ToolCallEvent = z.object({
  kind: z.literal("tool_call"),
  at: At,
  callId: z.string().min(1),
  connectorKey: z.string().min(1).nullable().default(null),
  tool: z.string().min(1),
  status: z.enum(["started", "succeeded", "failed", "denied", "awaiting_approval"]),
  /** Short human-readable summary of the arguments (file path, query, recipient domain...). */
  argsSummary: z.string().max(500).default(""),
  resultSummary: z.string().max(1000).nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  costMinor: z.number().int().nonnegative().nullable().default(null),
  /** Gateway policy outcome when applicable. */
  policyOutcome: z.enum(["allow", "ask", "deny"]).nullable().default(null),
  approvalId: z.string().nullable().default(null),
  error: z.string().max(1000).nullable().default(null),
});

/** Terminal output chunk (xterm tile). */
export const StdoutEvent = z.object({
  kind: z.literal("stdout"),
  at: At,
  channel: z.enum(["stdout", "stderr"]).default("stdout"),
  text: z.string().max(64_000),
  /** Command the output belongs to, when known. */
  command: z.string().max(500).nullable().default(null),
});

/** A file in the agent's worktree changed (Diff tile). */
export const FileChangedEvent = z.object({
  kind: z.literal("file_changed"),
  at: At,
  path: z.string().min(1).max(1000),
  change: z.enum(["created", "modified", "deleted", "renamed"]),
  fromPath: z.string().max(1000).nullable().default(null),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  /** Unified diff for the Diff view; omitted for large/binary files. */
  diff: z.string().max(200_000).nullable().default(null),
});

/** A test run finished (acceptance tests drive progress). */
export const TestResultEvent = z.object({
  kind: z.literal("test_result"),
  at: At,
  suite: z.string().max(300).default(""),
  command: z.string().max(500).nullable().default(null),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  /** Whether these were the task's acceptance tests (they count towards progress) or the agent's own checks. */
  acceptance: z.boolean().default(false),
  /** Names of failing tests, capped. */
  failures: z.array(z.string().max(300)).max(50).default([]),
});

/** The task moved between phases (planning → implementing → testing → review → merge → done). */
export const PhaseChangedEvent = z.object({
  kind: z.literal("phase_changed"),
  at: At,
  from: TaskPhase.nullable(),
  to: TaskPhase,
  reason: z.string().max(500).nullable().default(null),
});

/** Progress ring update (BUILD §11.6 formula; never token-based). */
export const ProgressEvent = z
  .object({
    kind: z.literal("progress"),
    at: At,
    progress: z.number().min(0).max(1),
    planStepsDone: z.number().int().nonnegative(),
    planSteps: z.number().int().nonnegative(),
    acceptanceTestsPassing: z.number().int().nonnegative(),
    acceptanceTests: z.number().int().nonnegative(),
    reviewPassed: z.boolean(),
    merged: z.boolean(),
    /** Estimate; label "Estimate" in UI. */
    etaAt: At.nullable().default(null),
  })
  .refine((p) => p.planStepsDone <= p.planSteps, {
    message: "planStepsDone cannot exceed planSteps",
    path: ["planStepsDone"],
  })
  .refine((p) => p.acceptanceTestsPassing <= p.acceptanceTests, {
    message: "acceptanceTestsPassing cannot exceed acceptanceTests",
    path: ["acceptanceTestsPassing"],
  });

/** Free-text note from the agent, the system (loop detection, pause) or a founder Shout. */
export const NoteEvent = z.object({
  kind: z.literal("note"),
  at: At,
  level: z.enum(["info", "warn", "error"]).default("info"),
  source: z.enum(["agent", "system", "shout", "reviewer"]).default("agent"),
  text: z.string().min(1).max(4000),
});

export const SessionEvent = z.discriminatedUnion("kind", [
  ToolCallEvent,
  StdoutEvent,
  FileChangedEvent,
  TestResultEvent,
  PhaseChangedEvent,
  ProgressEvent,
  NoteEvent,
]);
export type SessionEvent = z.output<typeof SessionEvent>;
export type SessionEventInput = z.input<typeof SessionEvent>;

/** Input where `at` may be omitted (filled with now). */
export type SessionEventDraft = SessionEventInput extends infer U
  ? U extends { at: string }
    ? Omit<U, "at"> & { at?: string }
    : never
  : never;

export type SessionEventOf<K extends SessionEventKind> = Extract<SessionEvent, { kind: K }>;

/** BUILD §11.6: progress = 0.2·plan + 0.5·acceptance + 0.2·review + 0.1·merged. */
export function computeProgress(p: {
  planStepsDone: number;
  planSteps: number;
  acceptanceTestsPassing: number;
  acceptanceTests: number;
  reviewPassed: boolean;
  merged: boolean;
}): number {
  const plan = p.planSteps > 0 ? p.planStepsDone / p.planSteps : 0;
  const tests = p.acceptanceTests > 0 ? p.acceptanceTestsPassing / p.acceptanceTests : 0;
  const v = 0.2 * plan + 0.5 * tests + 0.2 * (p.reviewPassed ? 1 : 0) + 0.1 * (p.merged ? 1 : 0);
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

export function parseSessionEvent(raw: unknown): SessionEvent {
  const r = SessionEvent.safeParse(raw);
  if (!r.success)
    throw new ValidationError(`Invalid session event: ${z.prettifyError(r.error)}`, r.error.issues);
  return r.data;
}

export interface PublishSessionEventOptions {
  /** XADD MAXLEN ~ (default 100 000). */
  maxLen?: number;
}

/**
 * Validate and append one event to `as:{sessionId}`. Returns the stream entry id (usable as a replay cursor).
 * `at` defaults to now.
 */
export async function publishSessionEvent(
  redis: StreamRedis,
  sessionId: string,
  event: SessionEventDraft,
  opts: PublishSessionEventOptions = {},
): Promise<string> {
  if (!sessionId) throw new ValidationError("sessionId is required");
  const parsed = parseSessionEvent({ at: new Date().toISOString(), ...event });
  const id = await redis.xadd(
    sessionStreamKey(sessionId),
    "MAXLEN",
    "~",
    Math.max(1, opts.maxLen ?? DEFAULT_STREAM_MAXLEN),
    "*",
    "kind",
    parsed.kind,
    "json",
    JSON.stringify(parsed),
  );
  if (id === null)
    throw new Error(`publishSessionEvent: XADD returned null for ${sessionStreamKey(sessionId)}`);
  return id;
}

export interface SessionStreamRecord {
  /** Stream entry id; pass as `after` to continue a replay. */
  id: string;
  event: SessionEvent;
}

export interface ReadSessionEventsOptions {
  /** Exclusive lower bound (an id from a previous read). Default: from the start. */
  after?: string;
  /** Inclusive upper bound. Default: to the end. */
  until?: string;
  /** Maximum records to return. Default: all retained. */
  limit?: number;
  /** XRANGE page size (default 500). */
  pageSize?: number;
  /** Only these kinds (filtering happens client-side; ids stay comparable). */
  kinds?: readonly SessionEventKind[];
}

/**
 * Replay a session's events in stream order. Entries whose `json` no longer parses are skipped (and
 * reported through `onInvalid`), so a schema change never breaks replay of old recordings.
 */
export async function readSessionEvents(
  redis: StreamRedis,
  sessionId: string,
  opts: ReadSessionEventsOptions = {},
  onInvalid?: (id: string, err: unknown) => void,
): Promise<SessionStreamRecord[]> {
  const key = sessionStreamKey(sessionId);
  const pageSize = Math.max(1, opts.pageSize ?? 500);
  const kinds = opts.kinds ? new Set<string>(opts.kinds) : null;
  const out: SessionStreamRecord[] = [];
  let start = opts.after ? `(${opts.after}` : "-";
  const end = opts.until ?? "+";
  for (;;) {
    const page = await redis.xrange(key, start, end, "COUNT", pageSize);
    if (page.length === 0) break;
    for (const [id, fields] of page) {
      const f = fieldsToObject(fields);
      if (kinds && !kinds.has(f.kind ?? "")) continue;
      try {
        out.push({ id, event: parseSessionEvent(JSON.parse(f.json ?? "")) });
      } catch (err) {
        onInvalid?.(id, err);
      }
      if (opts.limit !== undefined && out.length >= opts.limit) return out;
    }
    if (page.length < pageSize) break;
    start = `(${page[page.length - 1]![0]}`;
  }
  return out;
}

/** Number of entries retained for a session (for the scrubber's total). */
export async function sessionEventCount(redis: StreamRedis, sessionId: string): Promise<number> {
  return redis.xlen(sessionStreamKey(sessionId));
}
