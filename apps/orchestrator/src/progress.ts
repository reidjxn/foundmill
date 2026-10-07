/**
 * Task progress (BUILD §11.6, AC-11.6.3). Never token-based:
 *
 *   progress = 0.2 * planStepsDone/planSteps + 0.5 * acceptanceTestsPassing/acceptanceTests + 0.2 * reviewPassed + 0.1 * merged
 *
 * Pure functions only (no Node imports) so workflow code, activities and the tests share one implementation. The
 * reducer turns the session event stream (`as:{sessionId}`) into the ring's state; the recorded sessions in
 * packages/sandbox drive the acceptance test for the formula.
 */
import type { SessionEventInput } from "@foundmill/events";
import type { TaskPhase } from "@foundmill/shared";

export interface ProgressInput {
  planStepsDone: number;
  planSteps: number;
  acceptanceTestsPassing: number;
  acceptanceTests: number;
  reviewPassed: boolean;
  merged: boolean;
}

export const PROGRESS_WEIGHTS = Object.freeze({ plan: 0.2, tests: 0.5, review: 0.2, merged: 0.1 });

/** The BUILD §11.6 formula, rounded to three decimals and clamped to [0, 1]. Empty denominators count as zero. */
export function computeProgress(p: ProgressInput): number {
  const plan = p.planSteps > 0 ? Math.min(1, Math.max(0, p.planStepsDone / p.planSteps)) : 0;
  const tests = p.acceptanceTests > 0 ? Math.min(1, Math.max(0, p.acceptanceTestsPassing / p.acceptanceTests)) : 0;
  const v = PROGRESS_WEIGHTS.plan * plan + PROGRESS_WEIGHTS.tests * tests + PROGRESS_WEIGHTS.review * (p.reviewPassed ? 1 : 0) + PROGRESS_WEIGHTS.merged * (p.merged ? 1 : 0);
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

export interface ProgressState extends ProgressInput {
  phase: TaskPhase | null;
  progress: number;
  /** ISO; an Estimate (median of similar tasks), never shown without the label. */
  etaAt: string | null;
  /** Last event timestamp folded in. */
  at: string | null;
}

export function initialProgress(init: Partial<ProgressInput> = {}): ProgressState {
  const base: ProgressInput = {
    planStepsDone: init.planStepsDone ?? 0,
    planSteps: init.planSteps ?? 0,
    acceptanceTestsPassing: init.acceptanceTestsPassing ?? 0,
    acceptanceTests: init.acceptanceTests ?? 0,
    reviewPassed: init.reviewPassed ?? false,
    merged: init.merged ?? false,
  };
  return { ...base, phase: null, progress: computeProgress(base), etaAt: null, at: null };
}

const PHASE_ORDER: readonly TaskPhase[] = ["planning", "implementing", "testing", "review", "merge", "done"];
const phaseIndex = (p: TaskPhase | null): number => (p ? PHASE_ORDER.indexOf(p) : -1);

/**
 * Fold one session event into the state. Rules:
 * - `progress` events are authoritative for the counters they carry (the recorder/SDK computed them).
 * - `test_result` with `acceptance: true` sets passing/total from the run.
 * - `phase_changed` moves the phase; entering `merge` implies review passed, entering `done` implies merged.
 * - a successful `merge_pr` tool call sets merged; a reviewer note containing "approved" sets reviewPassed.
 */
export function applySessionEvent(state: ProgressState, event: SessionEventInput): ProgressState {
  const next: ProgressState = { ...state, at: event.at ?? state.at };
  switch (event.kind) {
    case "progress": {
      next.planStepsDone = event.planStepsDone;
      next.planSteps = event.planSteps;
      next.acceptanceTestsPassing = event.acceptanceTestsPassing;
      next.acceptanceTests = event.acceptanceTests;
      next.reviewPassed = event.reviewPassed;
      next.merged = event.merged;
      if (event.etaAt !== undefined) next.etaAt = event.etaAt;
      break;
    }
    case "test_result": {
      if (event.acceptance) {
        const total = event.passed + event.failed + (event.skipped ?? 0);
        next.acceptanceTests = Math.max(state.acceptanceTests, total);
        next.acceptanceTestsPassing = Math.min(next.acceptanceTests, event.passed);
      }
      break;
    }
    case "phase_changed": {
      next.phase = event.to;
      if (phaseIndex(event.to) >= phaseIndex("merge")) next.reviewPassed = true;
      if (event.to === "done") {
        next.merged = true;
        if (next.planSteps > 0) next.planStepsDone = next.planSteps;
      }
      break;
    }
    case "tool_call": {
      if (event.status === "succeeded" && /merge_pr|merge_pull_request/i.test(event.tool)) next.merged = true;
      break;
    }
    case "note": {
      if (event.source === "reviewer" && /\bapproved?\b/i.test(event.text) && !/not approved|unapproved/i.test(event.text)) next.reviewPassed = true;
      break;
    }
    default:
      break;
  }
  next.progress = computeProgress(next);
  return next;
}

export function reduceSessionEvents(events: readonly SessionEventInput[], init: Partial<ProgressInput> = {}): ProgressState {
  return events.reduce(applySessionEvent, initialProgress(init));
}

/** Build the `progress` session event / `task.progressed` payload counters from a state. */
export function progressEventFrom(state: ProgressState, at: string): SessionEventInput {
  return {
    kind: "progress",
    at,
    progress: state.progress,
    planStepsDone: state.planStepsDone,
    planSteps: state.planSteps,
    acceptanceTestsPassing: state.acceptanceTestsPassing,
    acceptanceTests: state.acceptanceTests,
    reviewPassed: state.reviewPassed,
    merged: state.merged,
    etaAt: state.etaAt,
  };
}

/**
 * ETA (an Estimate): median duration of similar completed tasks, scaled by the remaining fraction; falls back to the
 * archetype prior when the business has no history. Returns null when progress is complete.
 */
export function estimateEta(input: { startedAtMs: number; nowMs: number; progress: number; medianDurationMs: number | null; priorDurationMs: number }): string | null {
  if (input.progress >= 1) return null;
  const expected = input.medianDurationMs ?? input.priorDurationMs;
  const elapsed = Math.max(0, input.nowMs - input.startedAtMs);
  const remainingByProgress = input.progress > 0 ? elapsed * ((1 - input.progress) / input.progress) : expected;
  const remaining = Math.max(60_000, Math.min(remainingByProgress, expected * 3));
  return new Date(input.nowMs + Math.round(remaining)).toISOString();
}

/** Median of a list (null when empty). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
