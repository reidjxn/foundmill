/**
 * Match Day frame schedule (BUILD §11.4 "Replay stages", AC-11.4.3).
 *
 * A pure function of the journey record, its touches and the chosen speed: the same record always produces the
 * same frames (no clock, no randomness, order-independent input). The stage component only reads the clock and
 * looks up what the schedule says is on screen at that millisecond.
 */
import { hashSeed } from "../../../lib/seed";
import type { CommentaryLine, Journey, Touch } from "../types";

export const STAGE_ORDER = ["team_sheet", "kick_off", "match", "rails", "goal", "full_time"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<StageName, string> = {
  team_sheet: "Team sheet",
  kick_off: "Kick-off",
  match: "Match",
  rails: "Rails",
  goal: "Goal",
  full_time: "Full time",
};

export const REPLAY_SPEEDS = ["full", "highlights", "instant"] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
export const REPLAY_SPEED_LABELS: Record<ReplaySpeed, string> = { full: "Full match", highlights: "Highlights", instant: "Instant" };

/** Stage budgets in ms. Full 54 s (45–60), Highlights 12.5 s (10–15), Instant 0 (BUILD §11.4 "Speed"). */
export const SPEED_BUDGETS: Record<ReplaySpeed, Record<StageName, number>> = {
  full: { team_sheet: 6000, kick_off: 4000, match: 32000, rails: 8000, goal: 4000, full_time: 0 },
  highlights: { team_sheet: 2000, kick_off: 1000, match: 6500, rails: 1500, goal: 1500, full_time: 0 },
  instant: { team_sheet: 0, kick_off: 0, match: 0, rails: 0, goal: 0, full_time: 0 },
};

/** How many touches a Highlights replay keeps (captain, first, last and the heaviest in between). */
export const HIGHLIGHT_TOUCHES = 6;

export interface StageWindow {
  stage: StageName;
  startMs: number;
  endMs: number;
}

export type ReplayFrame =
  | { at: number; kind: "stage"; stage: StageName }
  | { at: number; kind: "touch"; stage: "match"; touchId: string; touchIndex: number }
  | { at: number; kind: "commentary"; stage: "match"; commentaryIndex: number; touchId: string | null };

export interface ReplaySchedule {
  speed: ReplaySpeed;
  durationMs: number;
  stages: StageWindow[];
  frames: ReplayFrame[];
  /** Touch ids in replay order (a subset in Highlights). */
  touchIds: string[];
  /** Commentary lines in replay order (highlight lines only in Highlights). */
  commentary: CommentaryLine[];
  /** FNV-1a over the frames; equal hashes mean equal replays. */
  hash: string;
}

function asCommentary(raw: unknown[]): CommentaryLine[] {
  const out: CommentaryLine[] = [];
  for (const line of raw) {
    if (typeof line === "string") out.push({ text: line });
    else if (line && typeof line === "object" && typeof (line as { text?: unknown }).text === "string") {
      const l = line as { text: string; touchId?: unknown; highlight?: unknown };
      out.push({ text: l.text, touchId: typeof l.touchId === "string" ? l.touchId : null, highlight: l.highlight === true });
    }
  }
  return out;
}

/** The touches the replay shows, in time order (ties broken by id so shuffled input cannot change the order). */
export function selectReplayTouches(journey: Journey, touches: readonly Touch[], speed: ReplaySpeed): Touch[] {
  const allowed = journey.touchIds.length > 0 ? new Set(journey.touchIds) : null;
  const sorted = touches
    .filter((t) => !allowed || allowed.has(t.id))
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  if (speed !== "highlights" || sorted.length <= HIGHLIGHT_TOUCHES) return sorted;
  const keep = new Set<string>();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first) keep.add(first.id);
  if (last) keep.add(last.id);
  if (journey.captain) keep.add(journey.captain.touchId);
  const byWeight = sorted.slice().sort((a, b) => (journey.weights[b.id] ?? 0) - (journey.weights[a.id] ?? 0) || a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  for (const t of byWeight) {
    if (keep.size >= HIGHLIGHT_TOUCHES) break;
    keep.add(t.id);
  }
  return sorted.filter((t) => keep.has(t.id));
}

/**
 * Positions of touches inside the match window: gaps between real timestamps are log-compressed (a 3-week silence
 * does not become 90 % of the match) with a minimum spacing, so short bursts stay legible.
 */
export function matchPositions(times: readonly number[], matchMs: number): number[] {
  if (times.length === 0) return [];
  if (matchMs <= 0) return times.map(() => 0);
  const weights: number[] = [0.35];
  for (let i = 1; i < times.length; i++) {
    const gapH = Math.max(0, ((times[i] as number) - (times[i - 1] as number)) / 3_600_000);
    weights.push(0.35 + Math.log1p(gapH));
  }
  // Leave room after the last touch so the closer breathes before the rails.
  const tail = 0.6;
  const total = weights.reduce((s, w) => s + w, 0) + tail;
  let acc = 0;
  return weights.map((w) => {
    acc += w;
    return Math.round((acc / total) * matchMs);
  });
}

export function buildReplaySchedule(journey: Journey, touches: readonly Touch[], speed: ReplaySpeed): ReplaySchedule {
  const budgets = SPEED_BUDGETS[speed];
  const stages: StageWindow[] = [];
  let cursor = 0;
  for (const stage of STAGE_ORDER) {
    const ms = budgets[stage];
    stages.push({ stage, startMs: cursor, endMs: cursor + ms });
    cursor += ms;
  }
  const durationMs = cursor;
  const frames: ReplayFrame[] = stages.map((s) => ({ at: s.startMs, kind: "stage", stage: s.stage }));

  const shown = selectReplayTouches(journey, touches, speed);
  const match = stages.find((s) => s.stage === "match") as StageWindow;
  const matchMs = match.endMs - match.startMs;
  const positions = matchPositions(
    shown.map((t) => Date.parse(t.occurredAt)),
    matchMs,
  );
  shown.forEach((t, i) => frames.push({ at: match.startMs + (positions[i] ?? 0), kind: "touch", stage: "match", touchId: t.id, touchIndex: i }));

  const allCommentary = asCommentary(journey.commentary);
  const shownIds = new Set(shown.map((t) => t.id));
  const commentary = allCommentary.filter((c) => (speed === "highlights" ? c.highlight || (c.touchId && shownIds.has(c.touchId)) : true));
  const touchAt = new Map<string, number>();
  frames.forEach((f) => {
    if (f.kind === "touch") touchAt.set(f.touchId, f.at);
  });
  const unanchored = commentary.filter((c) => !c.touchId || !touchAt.has(c.touchId)).length;
  let unanchoredIndex = 0;
  commentary.forEach((c, i) => {
    let at: number;
    if (c.touchId && touchAt.has(c.touchId)) at = (touchAt.get(c.touchId) as number) + Math.min(250, Math.round(matchMs * 0.01));
    else {
      unanchoredIndex += 1;
      at = match.startMs + Math.round((matchMs * unanchoredIndex) / (unanchored + 1));
    }
    frames.push({ at, kind: "commentary", stage: "match", commentaryIndex: i, touchId: c.touchId ?? null });
  });

  const order: Record<ReplayFrame["kind"], number> = { stage: 0, touch: 1, commentary: 2 };
  frames.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind] || frameKey(a).localeCompare(frameKey(b)));
  const hash = hashSeed(frames.map((f) => `${f.at}:${frameKey(f)}`).join("|")).toString(16).padStart(8, "0");
  return { speed, durationMs, stages, frames, touchIds: shown.map((t) => t.id), commentary, hash };
}

function frameKey(f: ReplayFrame): string {
  if (f.kind === "stage") return `s:${f.stage}`;
  if (f.kind === "touch") return `t:${f.touchIndex}:${f.touchId}`;
  return `c:${f.commentaryIndex}`;
}

/** The stage on screen at `timeMs`. Past the end (or for Instant) it is full time. */
export function stageAt(schedule: ReplaySchedule, timeMs: number): StageName {
  if (schedule.durationMs === 0 || timeMs >= schedule.durationMs) return "full_time";
  let current: StageName = "team_sheet";
  for (const s of schedule.stages) if (s.startMs <= timeMs && s.endMs > s.startMs) current = s.stage;
  return current;
}

/** Touch ids whose frame has played by `timeMs` (all of them once the match is over). */
export function touchesPlayedBy(schedule: ReplaySchedule, timeMs: number): string[] {
  const out: string[] = [];
  for (const f of schedule.frames) if (f.kind === "touch" && (f.at <= timeMs || schedule.durationMs === 0)) out.push(f.touchId);
  return out;
}

/** Commentary indices visible by `timeMs`. */
export function commentaryShownBy(schedule: ReplaySchedule, timeMs: number): number[] {
  const out: number[] = [];
  for (const f of schedule.frames) if (f.kind === "commentary" && (f.at <= timeMs || schedule.durationMs === 0)) out.push(f.commentaryIndex);
  return out;
}

export function stageWindow(schedule: ReplaySchedule, stage: StageName): StageWindow {
  return schedule.stages.find((s) => s.stage === stage) as StageWindow;
}

/** mm:ss for the scrubber. */
export function formatReplayClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
