/**
 * Skill rating calibration (BUILD §11.10 "Scoring").
 *
 * - Tested rating: `1 + 19 * calibrate(meanScore)`, rounded, clamped 1–20. `calibrate` is a monotone piecewise-linear
 *   curve through the anchors below, set so a reference generalist template (mean score 0.55 on its test set) scores
 *   exactly 10, and 20 is reserved for consistently flawless results (mean ≥ 0.985).
 * - Proven rating: live outcomes mapped to 1–20.
 * - Displayed rating: `w * proven + (1 - w) * tested`, `w = n / (n + 20)` where n is the number of live tasks that
 *   exercised the skill (AC-11.10.3).
 * - Potential: best tested score reached with the current model and tools across the last 5 training runs.
 */

export interface CalibrationAnchor {
  /** Mean grader score for a skill's test set, 0–1. */
  meanScore: number;
  /** Calibrated position on the 1–20 scale, 0–1 (rating = 1 + 19 * value). */
  value: number;
}

/** Rating → calibrated value helper so anchors read as ratings. */
const r = (rating: number): number => (rating - 1) / 19;

/** Mean score of the reference generalist template on its own test set; it must land on rating 10. */
export const REFERENCE_GENERALIST_MEAN_SCORE = 0.55;

/** Mean score from which rating 20 is reachable ("consistently flawless"). */
export const FLAWLESS_MEAN_SCORE = 0.985;

export const CALIBRATION_ANCHORS: readonly CalibrationAnchor[] = Object.freeze([
  { meanScore: 0.0, value: r(1) },
  { meanScore: 0.25, value: r(3) },
  { meanScore: 0.4, value: r(6) },
  { meanScore: REFERENCE_GENERALIST_MEAN_SCORE, value: r(10) },
  { meanScore: 0.7, value: r(13) },
  { meanScore: 0.82, value: r(16) },
  { meanScore: 0.92, value: r(18) },
  { meanScore: 0.97, value: r(19) },
  { meanScore: FLAWLESS_MEAN_SCORE, value: r(20) },
  { meanScore: 1.0, value: r(20) },
]);

export const MIN_RATING = 1;
export const MAX_RATING = 20;
/** The `+20` in the blend weight: how many live tasks it takes for proven to count half. */
export const BLEND_HALF_LIFE_TASKS = 20;
export const POTENTIAL_WINDOW_RUNS = 5;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Piecewise-linear interpolation through the anchors; monotone non-decreasing; input clamped to [0, 1]. */
export function calibrate(meanScore: number): number {
  if (!Number.isFinite(meanScore)) throw new RangeError(`meanScore must be a finite number, got ${meanScore}`);
  const x = clamp(meanScore, 0, 1);
  const anchors = CALIBRATION_ANCHORS;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!;
    const b = anchors[i]!;
    if (x <= b.meanScore) {
      if (b.meanScore === a.meanScore) return b.value;
      const t = (x - a.meanScore) / (b.meanScore - a.meanScore);
      return a.value + t * (b.value - a.value);
    }
  }
  return anchors[anchors.length - 1]!.value;
}

/** Tested rating from a mean grader score: `1 + 19 * calibrate(mean)`, rounded and clamped to 1–20. */
export function ratingFromTested(meanScore: number): number {
  return clamp(Math.round(1 + 19 * calibrate(meanScore)), MIN_RATING, MAX_RATING);
}

/** Mean of per-task scores (each 0–1). Empty input → 0. */
export function meanScore(taskScores: readonly number[]): number {
  if (taskScores.length === 0) return 0;
  let sum = 0;
  for (const s of taskScores) {
    if (!Number.isFinite(s) || s < 0 || s > 1) throw new RangeError(`task score out of range: ${s}`);
    sum += s;
  }
  return sum / taskScores.length;
}

/** Live outcomes that feed the proven rating (BUILD §11.10 "task success, review findings, approvals rejected, reply/merge outcomes"). */
export interface LiveOutcomes {
  /** Tasks exercising the skill that completed successfully / total. */
  taskSuccessRate: number;
  /** Mean review findings per task (0 = clean). */
  reviewFindingsPerTask: number;
  /** Share of the agent's approval requests the founder rejected, 0–1. */
  approvalsRejectedRate: number;
  /** Reply rate (outbound) or merge rate (code) for the skill's deliverables, 0–1. */
  replyOrMergeRate: number;
}

export const PROVEN_WEIGHTS = Object.freeze({ taskSuccess: 0.5, reviewFindings: 0.2, approvalsRejected: 0.15, replyOrMerge: 0.15 });
/** Review findings per task at which that component bottoms out. */
export const REVIEW_FINDINGS_SATURATION = 3;

/** Composite 0–1 score from live outcomes; linear mapping to 1–20 (live results are already on the real scale, so no curve). */
export function provenScore(outcomes: LiveOutcomes): number {
  const success = clamp(outcomes.taskSuccessRate, 0, 1);
  const findings = 1 - clamp(outcomes.reviewFindingsPerTask / REVIEW_FINDINGS_SATURATION, 0, 1);
  const approvals = 1 - clamp(outcomes.approvalsRejectedRate, 0, 1);
  const reply = clamp(outcomes.replyOrMergeRate, 0, 1);
  const w = PROVEN_WEIGHTS;
  return w.taskSuccess * success + w.reviewFindings * findings + w.approvalsRejected * approvals + w.replyOrMerge * reply;
}

export function ratingFromProven(outcomes: LiveOutcomes): number {
  return clamp(Math.round(1 + 19 * provenScore(outcomes)), MIN_RATING, MAX_RATING);
}

/** `w = n / (n + 20)`. n < 0 is treated as 0. */
export function blendWeight(liveTaskCount: number): number {
  const n = Math.max(0, Math.floor(liveTaskCount));
  return n / (n + BLEND_HALF_LIFE_TASKS);
}

/** Displayed rating: `w * proven + (1 - w) * tested`, rounded and clamped. With n = 0 the displayed rating is the tested rating. */
export function blendDisplayed(tested: number, proven: number, liveTaskCount: number): number {
  const w = blendWeight(liveTaskCount);
  const t = clamp(tested, MIN_RATING, MAX_RATING);
  const p = clamp(proven, MIN_RATING, MAX_RATING);
  return clamp(Math.round(w * p + (1 - w) * t), MIN_RATING, MAX_RATING);
}

/** Exact (unrounded) blend for charts and tests. */
export function blendDisplayedExact(tested: number, proven: number, liveTaskCount: number): number {
  const w = blendWeight(liveTaskCount);
  return w * proven + (1 - w) * tested;
}

/** Hover text: "Tested 15 · Proven 13 · 42 tasks". */
export function describeRating(tested: number, proven: number | null, liveTaskCount: number): string {
  const parts = [`Tested ${Math.round(tested)}`];
  if (proven !== null && liveTaskCount > 0) parts.push(`Proven ${Math.round(proven)}`);
  parts.push(`${liveTaskCount} ${liveTaskCount === 1 ? "task" : "tasks"}`);
  return parts.join(" · ");
}

export interface TrainingRunSkillResult {
  tested: number;
  /** Model and tools the run used; potential only counts runs with the current configuration. */
  modelKey: string;
  toolsHash: string;
  completedAt: Date | string;
}

/**
 * Potential: best tested score reached with the current model + tools across the last 5 training runs. Falls back to the
 * current tested rating when no matching run exists; never below the current tested rating.
 */
export function potentialRating(
  currentTested: number,
  runs: readonly TrainingRunSkillResult[],
  current: { modelKey: string; toolsHash: string },
  window: number = POTENTIAL_WINDOW_RUNS,
): number {
  const matching = runs
    .filter((x) => x.modelKey === current.modelKey && x.toolsHash === current.toolsHash)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, window);
  const best = matching.reduce((m, x) => Math.max(m, x.tested), currentTested);
  return clamp(Math.round(best), MIN_RATING, MAX_RATING);
}

/** Rating colour band for the UI (tokens --rating-1..4): 1-5, 6-10, 11-15, 16-20. */
export function ratingBand(rating: number): 1 | 2 | 3 | 4 {
  const x = clamp(Math.round(rating), MIN_RATING, MAX_RATING);
  if (x <= 5) return 1;
  if (x <= 10) return 2;
  if (x <= 15) return 3;
  return 4;
}

/** Highlight threshold for training results: drops of more than this many points are flagged (BUILD §11.10). */
export const DROP_HIGHLIGHT_POINTS = 1;
export function isSignificantDrop(oldRating: number, newRating: number): boolean {
  return oldRating - newRating > DROP_HIGHLIGHT_POINTS;
}
