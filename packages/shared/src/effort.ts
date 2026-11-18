/**
 * Show the work (WP-14 T5; the founder's brief of Nov 17, 2026, A10): the team's effort as counts, said beside its
 * results in the day's digest (./note-budget) and the weekly review (./morning-brief). Every count is a count of
 * records that exist (events the services wrote), never an estimate, and a kind with nothing counted is left out.
 *
 * - quality checks: design checks that looked at real screenshots (`task.design_checked`, reviewed or measured);
 * - sources read: sources the team read and scored (`source.scored`, status `scored`);
 * - posts drafted: posts the team wrote for the founder to share (`post.drafted`);
 * - pieces of work finished: `task.completed`;
 * - changes added to the product: `pr.merged`;
 * - releases shipped: production deploys (`deploy.succeeded`).
 * Anything simulated is left out (`isSimulatedEvent`, and a design check that was simulated or never saw the pages).
 *
 * Steps behind a result (step 3): a finished piece of work that took minutes says what was done on the way, from the
 * task's own last progress record: plan steps, checks passed, the review, the merge.
 *
 * Pure, no Zod: browser code may import this from "@foundmill/shared/effort".
 */
import { countOf, formatCount } from "./copy";
import { isSimulatedEvent, type BriefEventLike } from "./morning-brief";

/** The events effort is counted from. `task.progressed` is read only for the steps behind a result. */
export const EFFORT_EVENT_TYPES = ["task.design_checked", "source.scored", "post.drafted", "task.completed", "pr.merged", "deploy.succeeded"] as const;
export const EFFORT_STEP_EVENT_TYPES = ["task.progressed"] as const;

export interface EffortCounts {
  qualityChecks: number;
  sourcesRead: number;
  postsDrafted: number;
  tasksDone: number;
  changesMerged: number;
  releasesShipped: number;
}

export const NO_EFFORT: EffortCounts = Object.freeze({ qualityChecks: 0, sourcesRead: 0, postsDrafted: 0, tasksDone: 0, changesMerged: 0, releasesShipped: 0 });

type EffortEvent = Pick<BriefEventLike, "type" | "occurredAt" | "actor" | "payload">;

const field = (payload: Record<string, unknown>, key: string): unknown => payload[key];
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Whether one event is effort that really happened, and of which kind. */
function effortKindOf(e: EffortEvent): keyof EffortCounts | null {
  if (isSimulatedEvent(e)) return null;
  switch (e.type) {
    case "task.design_checked": {
      const status = (field(e.payload, "result") as { status?: unknown } | undefined)?.status;
      return status === "reviewed" || status === "measured" ? "qualityChecks" : null;
    }
    case "source.scored":
      return field(e.payload, "status") === "scored" ? "sourcesRead" : null;
    case "post.drafted":
      return "postsDrafted";
    case "task.completed":
      return "tasksDone";
    case "pr.merged":
      return "changesMerged";
    case "deploy.succeeded":
      return field(e.payload, "environment") === "production" ? "releasesShipped" : null;
    default:
      return null;
  }
}

/** The effort in [since, now], counted from the events given. */
export function effortCounts(events: readonly EffortEvent[], since: Date, now: Date): EffortCounts {
  const counts = { ...NO_EFFORT };
  for (const e of events) {
    const at = e.occurredAt.getTime();
    if (at < since.getTime() || at > now.getTime()) continue;
    const kind = effortKindOf(e);
    if (kind) counts[kind] += 1;
  }
  return counts;
}

const andList = (parts: readonly string[]): string => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * "Your team ran 14 quality checks, read 3 sources and finished 5 pieces of work." A count of zero is left out; null
 * when nothing was counted.
 */
export function effortSentence(c: EffortCounts): string | null {
  const parts = [
    c.qualityChecks > 0 ? `ran ${countOf(c.qualityChecks, "quality check")}` : null,
    c.sourcesRead > 0 ? `read ${countOf(c.sourcesRead, "source")}` : null,
    c.postsDrafted > 0 ? `drafted ${countOf(c.postsDrafted, "post")}` : null,
    c.tasksDone > 0 ? `finished ${countOf(c.tasksDone, "piece", "pieces")} of work` : null,
    c.changesMerged > 0 ? `added ${countOf(c.changesMerged, "change")} to your product` : null,
    c.releasesShipped > 0 ? `shipped ${countOf(c.releasesShipped, "release")}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `Your team ${andList(parts)}.` : null;
}

/** A result shows its steps only when it took at least this long. */
export const RESULT_STEPS_MIN_MS = 2 * 60 * 1000;
/** At most this many results show their steps in one digest. */
export const RESULT_STEPS_MAX = 3;

/** One finished piece of work, with its own last progress record. */
export interface ResultStepsFacts {
  title: string;
  durationMs: number;
  planStepsDone: number;
  planSteps: number;
  checksPassing: number;
  checks: number;
  reviewed: boolean;
  merged: boolean;
}

const minutesWords = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return countOf(minutes, "minute");
  const hours = Math.round(minutes / 6) / 10;
  return `${hours.toLocaleString("en-US")} ${hours === 1 ? "hour" : "hours"}`;
};

/**
 * "“Booking form” took 12 minutes: 4 of 4 plan steps, 6 of 6 checks passed, reviewed, added to your product." Null when
 * the work took less than `RESULT_STEPS_MIN_MS`, or when no step was recorded (nothing is made up to fill the line).
 */
export function resultStepsLine(f: ResultStepsFacts): string | null {
  if (f.durationMs < RESULT_STEPS_MIN_MS) return null;
  const steps = [
    f.planSteps > 0 ? `${formatCount(Math.min(f.planStepsDone, f.planSteps))} of ${countOf(f.planSteps, "plan step")}` : null,
    f.checks > 0 ? `${formatCount(Math.min(f.checksPassing, f.checks))} of ${countOf(f.checks, "check")} passed` : null,
    f.reviewed ? "reviewed" : null,
    f.merged ? "added to your product" : null,
  ].filter((s): s is string => s !== null);
  if (steps.length === 0) return null;
  return `“${f.title.trim().replace(/[.!?]+$/, "")}” took ${minutesWords(f.durationMs)}: ${steps.join(", ")}.`;
}

/**
 * The steps behind the window's results, longest work first, at most `RESULT_STEPS_MAX`: each `task.completed` with the
 * last `task.progressed` of the same task. `titles` gives a task's founder-facing title by id (else the event's own).
 */
export function resultStepsLines(events: readonly EffortEvent[], since: Date, now: Date, titles: ReadonlyMap<string, string> = new Map()): string[] {
  const inWindow = (e: EffortEvent) => e.occurredAt.getTime() >= since.getTime() && e.occurredAt.getTime() <= now.getTime();
  const lastProgress = new Map<string, EffortEvent>();
  for (const e of events) {
    if (e.type !== "task.progressed" || isSimulatedEvent(e)) continue;
    const id = String(field(e.payload, "taskId") ?? "");
    const seen = lastProgress.get(id);
    if (!seen || seen.occurredAt.getTime() <= e.occurredAt.getTime()) lastProgress.set(id, e);
  }
  return events
    .filter((e) => e.type === "task.completed" && inWindow(e) && !isSimulatedEvent(e))
    .sort((a, b) => num(field(b.payload, "durationMs")) - num(field(a.payload, "durationMs")))
    .map((e) => {
      const id = String(field(e.payload, "taskId") ?? "");
      const p = lastProgress.get(id)?.payload ?? {};
      return resultStepsLine({
        title: titles.get(id) ?? String(field(e.payload, "title") ?? ""),
        durationMs: num(field(e.payload, "durationMs")),
        planStepsDone: num(field(p, "planStepsDone")),
        planSteps: num(field(p, "planSteps")),
        checksPassing: num(field(e.payload, "acceptanceTestsPassing")),
        checks: num(field(e.payload, "acceptanceTests")),
        reviewed: field(p, "reviewPassed") === true,
        merged: field(p, "merged") === true,
      });
    })
    .filter((line): line is string => line !== null)
    .slice(0, RESULT_STEPS_MAX);
}
