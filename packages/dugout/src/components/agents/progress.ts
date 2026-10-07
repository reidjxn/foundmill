/**
 * Session logic: the BUILD §11.6 progress formula, the reducer that turns an `as:{sessionId}` stream into tile
 * state (AC-11.6.3), the unified-diff splitter the Diff view feeds to Monaco, and small time helpers.
 * Everything is pure.
 */
import type { TaskPhase, TaskStatus } from "@foundmill/shared";
import { formatDuration } from "../../lib/format";
import type {
  AgentSessionEvent,
  AgentTileSession,
  FileChange,
  PlanStep,
  ProgressCounts,
  SessionNote,
  StdoutChunk,
  TestSummary,
  TileAgent,
  TileTask,
  ToolCallSummary,
} from "./types";

export const PROGRESS_WEIGHTS = { plan: 0.2, tests: 0.5, review: 0.2, merged: 0.1 } as const;

function ratio(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.min(1, Math.max(0, num / den));
}

/**
 * `progress = 0.2 * planStepsDone/planSteps + 0.5 * acceptanceTestsPassing/acceptanceTests + 0.2 * reviewPassed + 0.1 * merged`.
 * A task with no plan steps or no acceptance tests earns nothing for that term (never token-based).
 */
export function computeProgress(c: ProgressCounts): number {
  const value =
    PROGRESS_WEIGHTS.plan * ratio(c.planStepsDone, c.planSteps) +
    PROGRESS_WEIGHTS.tests * ratio(c.acceptanceTestsPassing, c.acceptanceTests) +
    PROGRESS_WEIGHTS.review * (c.reviewPassed ? 1 : 0) +
    PROGRESS_WEIGHTS.merged * (c.merged ? 1 : 0);
  return Math.round(value * 1000) / 1000;
}

export const EMPTY_COUNTS: ProgressCounts = {
  planStepsDone: 0,
  planSteps: 0,
  acceptanceTestsPassing: 0,
  acceptanceTests: 0,
  reviewPassed: false,
  merged: false,
};

export const EMPTY_TESTS: TestSummary = { passed: 0, failed: 0, skipped: 0, acceptance: null, lastAt: null };

/** Static facts the reducer cannot learn from the stream. */
export interface SessionSeed {
  id: string;
  agent: TileAgent;
  task: TileTask;
  startedAt: string;
  plan?: PlanStep[];
  tokens?: number;
  cost?: AgentTileSession["cost"];
  status?: TaskStatus;
  preview?: AgentTileSession["preview"];
}

/** An empty session: nothing has happened yet. */
export function emptySession(seed: SessionSeed): AgentTileSession {
  return {
    id: seed.id,
    agent: seed.agent,
    task: seed.task,
    status: seed.status ?? "running",
    phase: "planning",
    progress: 0,
    counts: { ...EMPTY_COUNTS, planSteps: seed.plan?.length ?? 0 },
    startedAt: seed.startedAt,
    endedAt: null,
    tokens: seed.tokens ?? 0,
    cost: seed.cost ?? { amountMinor: 0, currency: "EUR" },
    etaAt: null,
    lastNote: null,
    plan: seed.plan ? seed.plan.map((p) => ({ ...p })) : [],
    stdout: [],
    files: [],
    tests: { ...EMPTY_TESTS },
    toolCalls: [],
    notes: [],
    preview: seed.preview ?? {},
    awaitingApprovalId: null,
  };
}

const PHASE_ORDER: TaskPhase[] = ["planning", "implementing", "testing", "review", "merge", "done"];

/** Advance plan step states from the progress counts: the first `done` steps are done, the next one is active. */
export function syncPlanSteps(plan: PlanStep[], done: number): PlanStep[] {
  return plan.map((step, i) => {
    if (step.state === "skipped") return step;
    const next: PlanStep["state"] = i < done ? "done" : i === done ? "active" : "todo";
    return next === step.state ? step : { ...step, state: next };
  });
}

/** Apply one event to a session (immutable). */
export function applySessionEvent(session: AgentTileSession, event: AgentSessionEvent): AgentTileSession {
  switch (event.kind) {
    case "stdout": {
      const chunk: StdoutChunk = { at: event.at, channel: event.channel ?? "stdout", text: event.text, command: event.command ?? null };
      return { ...session, stdout: [...session.stdout, chunk] };
    }
    case "file_changed": {
      const change: FileChange = {
        path: event.path,
        change: event.change,
        fromPath: event.fromPath ?? null,
        additions: event.additions ?? 0,
        deletions: event.deletions ?? 0,
        diff: event.diff ?? null,
        at: event.at,
      };
      const idx = session.files.findIndex((f) => f.path === event.path);
      const files = idx >= 0 ? session.files.map((f, i) => (i === idx ? change : f)) : [...session.files, change];
      return { ...session, files };
    }
    case "test_result": {
      const acceptance = event.acceptance
        ? { passed: event.passed, failed: event.failed, failures: event.failures ?? [] }
        : session.tests.acceptance;
      return {
        ...session,
        tests: { passed: event.passed, failed: event.failed, skipped: event.skipped ?? 0, acceptance, lastAt: event.at },
      };
    }
    case "phase_changed": {
      const status: TaskStatus = event.to === "done" ? "done" : event.to === "review" ? "review" : event.to === "merge" ? "merging" : session.status === "paused" || session.status === "blocked" ? session.status : "running";
      return { ...session, phase: event.to, status, endedAt: event.to === "done" ? event.at : session.endedAt };
    }
    case "progress": {
      const counts: ProgressCounts = {
        planStepsDone: event.planStepsDone,
        planSteps: event.planSteps,
        acceptanceTestsPassing: event.acceptanceTestsPassing,
        acceptanceTests: event.acceptanceTests,
        reviewPassed: event.reviewPassed,
        merged: event.merged,
      };
      return {
        ...session,
        counts,
        progress: computeProgress(counts),
        etaAt: event.etaAt ?? session.etaAt,
        plan: syncPlanSteps(session.plan, event.planStepsDone),
      };
    }
    case "tool_call": {
      const summary: ToolCallSummary = {
        callId: event.callId,
        tool: event.tool,
        connectorKey: event.connectorKey ?? null,
        status: event.status,
        argsSummary: event.argsSummary ?? "",
        at: event.at,
        approvalId: event.approvalId ?? null,
      };
      const idx = session.toolCalls.findIndex((c) => c.callId === event.callId);
      const toolCalls = idx >= 0 ? session.toolCalls.map((c, i) => (i === idx ? summary : c)) : [...session.toolCalls, summary];
      const cost = event.costMinor ? { ...session.cost, amountMinor: session.cost.amountMinor + event.costMinor } : session.cost;
      let status = session.status;
      let awaiting = session.awaitingApprovalId;
      if (event.status === "awaiting_approval") {
        status = "blocked";
        awaiting = event.approvalId ?? summary.callId;
      } else if (awaiting && (awaiting === event.approvalId || awaiting === event.callId) && event.status !== "started") {
        status = status === "blocked" ? "running" : status;
        awaiting = null;
      }
      return { ...session, toolCalls, cost, status, awaitingApprovalId: awaiting };
    }
    case "note": {
      const note: SessionNote = { at: event.at, level: event.level ?? "info", source: event.source ?? "agent", text: event.text };
      let status = session.status;
      const lower = event.text.toLowerCase();
      if (event.source === "system") {
        if (lower.startsWith("paused")) status = "paused";
        else if (lower.startsWith("resumed")) status = "running";
        else if (lower.startsWith("stopped")) status = "stopped";
        else if (event.level === "error" && (lower.includes("loop detected") || lower.startsWith("failed"))) status = "failed";
      }
      return { ...session, notes: [...session.notes, note], lastNote: note, status, endedAt: status === "stopped" || status === "failed" ? event.at : session.endedAt };
    }
  }
}

/** Fold a whole stream (ordered by time) into tile state. */
export function reduceSessionEvents(seed: SessionSeed, events: readonly AgentSessionEvent[]): AgentTileSession {
  let s = emptySession(seed);
  for (const e of events) s = applySessionEvent(s, e);
  return s;
}

/** Events at or before `position` ms after `startedAt`: what a replay at that scrubber position has seen. */
export function eventsUntil(events: readonly AgentSessionEvent[], startedAt: string, positionMs: number): AgentSessionEvent[] {
  const start = Date.parse(startedAt);
  const cutoff = start + positionMs;
  return events.filter((e) => Date.parse(e.at) <= cutoff);
}

export function phaseIndex(phase: TaskPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

/** Elapsed label, frozen at `endedAt` when the session is over. */
export function elapsedLabel(session: Pick<AgentTileSession, "startedAt" | "endedAt">, now: Date | number = Date.now()): string {
  const end = session.endedAt ? Date.parse(session.endedAt) : typeof now === "number" ? now : now.getTime();
  return formatDuration(Math.max(0, end - Date.parse(session.startedAt)));
}

/** "ETA 4m 10s" style remaining-time label; null when unknown or passed. */
export function etaLabel(etaAt: string | null, now: Date | number = Date.now()): string | null {
  if (!etaAt) return null;
  const n = typeof now === "number" ? now : now.getTime();
  const remaining = Date.parse(etaAt) - n;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "overdue";
  return formatDuration(remaining);
}

// ---------------------------------------------------------------------------------------------------------------------
// Unified diff → original/modified texts for Monaco's DiffEditor
// ---------------------------------------------------------------------------------------------------------------------

export interface SplitDiff {
  original: string;
  modified: string;
  /** Line count of each side. */
  additions: number;
  deletions: number;
}

/**
 * Rebuild the two sides of a unified diff from its hunks. Context lines go to both sides, `-` to the original,
 * `+` to the modified; hunk headers are dropped (Monaco computes its own alignment). Lines outside hunks
 * (`---`/`+++`/`diff --git`/`index`) are ignored.
 */
export function splitUnifiedDiff(diff: string): SplitDiff {
  const original: string[] = [];
  const modified: string[] = [];
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("\\ No newline")) continue;
    if (raw.startsWith("+")) {
      modified.push(raw.slice(1));
      additions++;
    } else if (raw.startsWith("-")) {
      original.push(raw.slice(1));
      deletions++;
    } else if (raw.startsWith(" ")) {
      original.push(raw.slice(1));
      modified.push(raw.slice(1));
    } else if (raw === "") {
      // A blank context line without the leading space (common in hand-written diffs).
      original.push("");
      modified.push("");
    } else if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ")) {
      inHunk = false;
    }
  }
  // Trim a trailing blank produced by the final newline.
  if (original.length && original[original.length - 1] === "" && modified.length && modified[modified.length - 1] === "") {
    original.pop();
    modified.pop();
  }
  return { original: original.join("\n"), modified: modified.join("\n"), additions, deletions };
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  go: "go",
  rs: "rust",
};

/** Monaco language id from a file path; "plaintext" when unknown. */
export function languageForPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  if (base === "Dockerfile") return "dockerfile";
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}
