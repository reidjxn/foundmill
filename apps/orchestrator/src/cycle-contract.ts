/**
 * Names the businessCycle workflow and its planning activity agree on. Pure (no imports): workflow code bundles it.
 */

/**
 * `ApplicationFailure.type` of a planning failure retrying cannot fix (audit BILL-06): a billing refusal, a refused or
 * missing key, a refused request. Its message is the sentence the founder reads in the Inbox and its first detail is a
 * `PlanFailureDetails`. businessCycle catches every planning failure and ends the cycle `failed` with that note instead
 * of letting the workflow die without a word.
 */
export const CYCLE_PLAN_FAILURE = "CyclePlanFailure";

export interface PlanFailureDetails {
  kind: "billing" | "credential" | "request" | "error";
  /** For `billing`: whose account refused (`credits` is the platform's key, `byok` the business's own) and why. */
  billedTo?: string;
  reason?: string;
}

/** What a planning failure tells the founder when it is transient (a rate limit or an outage after every retry). */
export const PLAN_FAILED_MESSAGE = "The Chief of Staff could not draft this cycle's plan: the model service was busy or its answer could not be read, even after three tries. Press Continue to try again.";

/*
 * The Inbox words the cycle writes (founder, Nov 8, 2026: Builder view). A note is stored once and read by everyone,
 * whatever their Builder view, so it is always in the founder's words: a "round of work", never "Cycle 7".
 */

/** The subject of the note when a round of work stopped before it finished (an error, or its workflow ended). */
export const CYCLE_NOT_FINISHED_SUBJECT = "The team's last round of work did not finish";
/** The subject of the note when a round of work could not be planned, so no new work started. */
export const CYCLE_NOT_STARTED_SUBJECT = "The team could not start work";

/** The narrated note's subject when the Composer writes none, by the cycle's outcome. */
export function cycleOutcomeSubject(outcome: string): string {
  switch (outcome) {
    case "completed":
      return "The team finished a round of work";
    case "time_box":
      return "The team's round of work reached its time limit";
    case "waiting":
      return "The team is waiting on you";
    case "stopped":
      return "The team's round of work stopped";
    case "failed":
      return CYCLE_NOT_FINISHED_SUBJECT;
    default:
      return "The team finished a round of work";
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The tally under the plan's summary in the narrated note (and the body itself when the Composer refuses):
 * "This round of work: 3 tasks started, 2 finished, 1 blocked; 1 task deferred."
 */
export function cycleTallyLine(t: { started: number; finished: number; blocked: number; stillRunning: number; deferred: number }): string {
  return `This round of work: ${plural(t.started, "task")} started, ${t.finished} finished, ${t.blocked} blocked${t.stillRunning ? `, ${t.stillRunning} still running past the time limit` : ""}${t.deferred ? `; ${plural(t.deferred, "task")} deferred` : ""}.`;
}

/**
 * What a task without a budget reserves of the cycle's credits (US cents, an Estimate). It is also the most a session may
 * spend on such a task (`sessionBudget`, activities/session-budget.ts), so the reserve a cycle sets aside is the ceiling
 * the session runs under.
 */
export const DEFAULT_TASK_RESERVE_MINOR = 2_000;
