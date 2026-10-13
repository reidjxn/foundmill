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

/**
 * What a task without a budget reserves of the cycle's credits (US cents, an Estimate). It is also the most a session may
 * spend on such a task (`sessionBudget`, activities/session-budget.ts), so the reserve a cycle sets aside is the ceiling
 * the session runs under.
 */
export const DEFAULT_TASK_RESERVE_MINOR = 2_000;
