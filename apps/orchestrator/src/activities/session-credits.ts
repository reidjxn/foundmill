/**
 * The platform key's ceiling inside a live agent session (SEC2 S2). A session on the platform's Anthropic key used to be
 * charged only when it finished, so it could spend any amount past the business's credits, and so could every session
 * running beside it. Now a session on the platform key:
 *
 * - starts only while the month's credits allow a live call (`checkPlatformCredits`, simulated credits not counted);
 * - hands the Agent SDK what is spendable as its `maxBudgetUsd`, so the SDK itself stops past it;
 * - books what it spends as it goes (every finished turn and every `SESSION_CREDIT_CHECK_MS`), through `bookUsage` like
 *   every other sink, so concurrent sessions and the api see one balance; the charge that empties it stops the team;
 * - ends cleanly (`blocked`, reason `budget`) when the credits are used up, with what it spent booked; a turn that
 *   finished the task stays done (the task is not run again for the credit its last turn used).
 *
 * `finishSession` books only what the session has not booked yet (`repos.usage.sessionTokens`). A session on the
 * business's own key never comes here: its spend is the founder's, billed by Anthropic.
 */
import { bookUsage, checkPlatformCredits, repos } from "@foundmill/db";
import type { ModelKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";

/** How often a running session books its spend and re-reads the balance between turns. */
export const SESSION_CREDIT_CHECK_MS = 15_000;

export const CREDITS_USED_UP_SUMMARY = "Blocked: this month's credits are used up, so the session stopped. What it spent is booked; the task runs again after a top-up in Settings › Billing or with next month's credits.";

export interface SpentSoFar {
  tokensIn: number;
  tokensOut: number;
  /** USD cents, unrounded (an Estimate). */
  costMinor: number;
}

export type SessionCreditsOpen = { ok: true; credits: SessionCredits } | { ok: false; reason: string };

export class SessionCredits {
  private bookedMinor = 0;
  private bookedTokens = 0;
  private lastCheckMs: number;
  /** Settles run one at a time (the control loop and a finished turn can ask at once), so nothing is booked twice. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly deps: OrchestratorDeps,
    private readonly session: { businessId: string; agentId: string; sessionId: string; modelKey: ModelKey },
    /** What a live call may spend at launch, USD cents. */
    readonly spendableMinor: number,
  ) {
    this.lastCheckMs = deps.clock.nowMs();
  }

  /** The session's credits at launch, or why it may not start. */
  static async open(deps: OrchestratorDeps, session: { businessId: string; agentId: string; sessionId: string; modelKey: ModelKey }): Promise<SessionCreditsOpen> {
    const check = await checkPlatformCredits(deps.db, session.businessId, { live: true, now: deps.clock.now() });
    if (!check.ok) return { ok: false, reason: check.reason === "mock_only" ? "only simulated credits are left this month, and they never pay for live model calls" : "this month's credits are used up" };
    return { ok: true, credits: new SessionCredits(deps, session, check.spendableMinor) };
  }

  /** The Agent SDK's `maxBudgetUsd`: what is spendable at launch, in US dollars. */
  get maxBudgetUsd(): number {
    return this.spendableMinor / 100;
  }

  /** True once `SESSION_CREDIT_CHECK_MS` passed since the last settle (the control loop asks every poll). */
  due(): boolean {
    return this.deps.clock.nowMs() - this.lastCheckMs >= SESSION_CREDIT_CHECK_MS;
  }

  /**
   * Books what was spent since the last settle and says whether the session may go on: `exhausted` when that charge (or
   * one before it, by this session, another or the api) used the last credit, or the credits no longer allow a live
   * call. A failed write is logged and the session goes on: `finishSession` books the rest.
   */
  settle(spent: SpentSoFar): Promise<"ok" | "exhausted"> {
    this.lastCheckMs = this.deps.clock.nowMs();
    const run = this.queue.then(() => this.settleNow(spent));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async settleNow(spent: SpentSoFar): Promise<"ok" | "exhausted"> {
    const costMinor = Math.max(0, Math.round(spent.costMinor) - this.bookedMinor);
    const tokens = Math.max(0, spent.tokensIn + spent.tokensOut - this.bookedTokens);
    try {
      if (costMinor > 0 || tokens > 0) {
        const booked = await bookUsage(this.deps.db, this.session.businessId, {
          agentId: this.session.agentId,
          sessionId: this.session.sessionId,
          kind: "tokens",
          modelKey: this.session.modelKey,
          quantity: tokens,
          unit: "tokens",
          costMinor,
          currency: "USD",
          billedTo: "credits",
          occurredAt: this.deps.clock.now(),
          details: { source: "claude-agent-sdk", label: "Estimate", partial: true },
        });
        this.bookedMinor += costMinor;
        this.bookedTokens += tokens;
        if (booked.credits?.exhausted) return "exhausted";
      }
      const check = await checkPlatformCredits(this.deps.db, this.session.businessId, { live: true, now: this.deps.clock.now() });
      return check.ok ? "ok" : "exhausted";
    } catch (err) {
      this.deps.log.warn({ err: (err as Error).message, sessionId: this.session.sessionId }, "session credits could not be settled; trying again on the next check");
      return "ok";
    }
  }
}

/** What `finishSession` still books for a session: its totals less what it booked while running (never below zero). */
export async function unbookedTokens(deps: OrchestratorDeps, businessId: string, sessionId: string, totals: { tokens: number; costMinor: number }): Promise<{ tokens: number; costMinor: number }> {
  const booked = await repos.usage.sessionTokens(deps.db, businessId, sessionId);
  return { tokens: Math.max(0, totals.tokens - booked.quantity), costMinor: Math.max(0, Math.round(totals.costMinor) - booked.costMinor) };
}
