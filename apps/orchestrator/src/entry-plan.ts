/**
 * Paid entry in the orchestrator (WP-09 T16): while `PAID_ENTRY` is on, a project's agents work only once one of its
 * founders holds the entry plan, however the work was started (Continue, Autopilot, Automated mode, a vacation, a task
 * started by hand). The api refuses those presses first; this is the same rule where the work actually begins: the
 * cycle's brief reads a closed plan as a stopped team (it plans and dispatches nothing) and the dispatch guard refuses
 * a session. A simulated plan counts only on a fully simulated stack (`paidEntryLive`, @foundmill/shared).
 */
import { repos, type Executor } from "@foundmill/db";
import { paidEntryLive, type Env } from "@foundmill/shared";

type EntryEnv = Partial<Pick<Env, "PAID_ENTRY">> & Pick<Env, "APP_ENV" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS" | "MODEL_MODE" | "ALLOW_MOCK_PAYMENTS">;

/** Whether the business's agents may work: always with the switch off; with it on, when a founder holds the plan. */
export async function entryPlanOpenFor(deps: { db: Executor; env: EntryEnv }, businessId: string): Promise<boolean> {
  if (deps.env.PAID_ENTRY !== true) return true;
  return repos.accountPlans.ownerHasActivePlan(deps.db, businessId, { live: paidEntryLive(deps.env) });
}

/** What a session refused for it says. */
export const ENTRY_PLAN_CLOSED_DETAIL = "the team starts working once a founder subscribes in Settings › Billing";
