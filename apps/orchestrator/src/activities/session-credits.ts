/**
 * The platform key's ceiling inside a live agent session (SEC2 S2). A session on the platform's Anthropic key used to be
 * charged only when it finished, so it could spend any amount past the business's credits, and so could every session
 * running beside it. Now a session on the platform key:
 *
 * - starts only while the month's credits allow a live call (`checkPlatformCredits`, simulated credits not counted) and
 *   what is spendable covers a reserve for it (WP-14 T1; packages/config `SESSION_RESERVE`): the larger of a minimum
 *   and the recent average cost of that agent type's sessions times a safety factor. Under the reserve the session
 *   does not start, nothing is booked, what is left stays in the balance and the team rests (`restBeforeSession`);
 * - hands the Agent SDK what is spendable plus the backstop ceiling as its `maxBudgetUsd`;
 * - books what it spends as it goes (every finished turn and every `SESSION_CREDIT_CHECK_MS`), through `bookUsage` like
 *   every other sink, so concurrent sessions and the api see one balance; the charge that empties it rests the team;
 * - is never stopped part-way because the balance ran out (founder, Nov 17, 2026): a session that outgrows its reserve
 *   finishes on the backstop, spending at most `backstopCeilingMinor` after the balance is empty. That is logged each
 *   time, with the reserve and what the session cost, so the reserve can be tuned. Only at the ceiling does it end
 *   (`blocked`, reason `budget`), with what it spent booked.
 *
 * A team waiting at the platform's monthly cap (WP-13 T4, T6) is a different state with its own message: it is not
 * Resting and nothing here sets it.
 *
 * `finishSession` books only what the session has not booked yet (`repos.usage.sessionTokens`). A session on the
 * business's own key never comes here: its spend is the founder's, billed by Anthropic.
 */
import { grantsActOutside } from "@foundmill/connectors";
import { costCoveredMinor, SESSION_RESERVE, sessionReserveMinor } from "@foundmill/config";
import { bookUsage, checkPlatformCredits, repos, restBeforeSession } from "@foundmill/db";
import { resolveModel, type RouteKey, type RouteResolution } from "@foundmill/models";
import { topUpsOnSale, type ModelKey, type ModuleKey } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";

/** The modules whose agents do money and legal work: low credits never move their sessions to a lower-cost model. */
export const LOW_CREDITS_KEPT_MODULES: readonly ModuleKey[] = ["finance", "legal"];

/**
 * Whether an agent session keeps its usual model when credits are low (the credit saver). The route decides first
 * (`ROUTES[route].lowCredits`, packages/models); on top of it a session keeps its model when its tools can reach someone
 * outside the business or spend money (`grantsActOutside`: the tools the house rules' policy asks about), or when its
 * agent does money or legal work (`LOW_CREDITS_KEPT_MODULES`).
 */
export function sessionKeepsModelOnLowCredits(session: { module: ModuleKey | null; toolRefs: readonly string[] }): boolean {
  return (session.module !== null && LOW_CREDITS_KEPT_MODULES.includes(session.module)) || grantsActOutside(session.toolRefs);
}

const MODEL_RANK: Record<ModelKey, number> = { glm: 0, haiku: 0, sonnet: 1, opus: 2 };

/**
 * The model a run must use instead of its launch's, or null to keep the launch's. The keep rule is decided at
 * `prepareSession`, but every run (a resume after an approval, a hand-off, a retry) re-reads the agent's current tools and
 * mints its token from them. So each run checks again: when the tools it will hold now keep the session's model
 * (`sessionKeepsModelOnLowCredits`) and the launch was moved below the route's usual model, the run goes back up to
 * the usual model. A run is never moved down here (a launch on its usual model stays on it).
 *
 * Only a launch the credit saver moved down (`launch.lowCredits`) is moved back up: a launch below the agent's model for
 * any other reason (the founder raised the agent's model mid-session) keeps it, as runs did before the saver. A launch
 * prepared before `lowCredits` existed (the field absent) is compared as before.
 */
export function keptModelForRun(launch: { modelKey: ModelKey; lowCredits?: boolean }, run: { route: RouteKey; agentModel: ModelKey; module: ModuleKey | null; toolRefs: readonly string[] }): RouteResolution | null {
  if (launch.lowCredits === false) return null;
  if (!sessionKeepsModelOnLowCredits(run)) return null;
  const usual = resolveModel(run.route, run.agentModel);
  return MODEL_RANK[launch.modelKey] < MODEL_RANK[usual.modelKey] ? usual : null;
}

/** How often a running session books its spend and re-reads the balance between turns. */
export const SESSION_CREDIT_CHECK_MS = 15_000;

/** A task that did not start because the team is resting (nothing was spent on it). Names no top-up: one is named only where it can be bought (WP-09 T13), and the Inbox note does that. */
export const RESTING_SUMMARY = "Resting: this month's team budget is used, so this task did not start and nothing was spent on it. It runs when there is budget again: with next month's budget or your own Anthropic key in Settings › Keys.";
/** A session that reached the backstop ceiling after the balance was empty (rare: the reserve is meant to prevent it). */
export const CREDITS_USED_UP_SUMMARY = "Resting: this month's team budget is used and this task needed more than the small amount set aside to let a running task finish, so it stopped there. What it spent is booked and its work is kept; it carries on when there is budget again.";

export interface SpentSoFar {
  tokensIn: number;
  tokensOut: number;
  /** USD cents, unrounded (an Estimate). */
  costMinor: number;
}

export type SessionCreditsOpen = { ok: true; credits: SessionCredits } | { ok: false; reason: string; resting: boolean; summary: string };

export interface SessionReserveConfig {
  minMinor: number;
  safetyFactor: number;
  sampleSessions: number;
  backstopCeilingMinor: number;
}

export class SessionCredits {
  private bookedMinor = 0;
  private bookedTokens = 0;
  private lastCheckMs: number;
  /** Settles run one at a time (the control loop and a finished turn can ask at once), so nothing is booked twice. */
  private queue: Promise<unknown> = Promise.resolve();

  /** The model the rest of the session is priced on after an "Upgrade to Opus" nudge (audit O-27). */
  useModel(modelKey: ModelKey): void {
    this.session = { ...this.session, modelKey };
  }

  /** What the session had spent (US cents) when the balance was first seen empty; null while there is balance. */
  private backstopFromMinor: number | null = null;

  private constructor(
    private readonly deps: OrchestratorDeps,
    private session: { businessId: string; agentId: string; sessionId: string; modelKey: ModelKey; skillsPreload?: "on" | "off" | null },
    /** What a live call may spend at launch, USD cents. */
    readonly spendableMinor: number,
    /** The reserve this session started against, USD cents. */
    readonly reserveMinor: number,
    private readonly reserve: SessionReserveConfig,
  ) {
    this.lastCheckMs = deps.clock.nowMs();
  }

  /**
   * The session's credits at launch, or why it may not start. Under the reserve it does not start and the team rests
   * (one note; a team already resting is left as it is). `agentType` picks the sessions the reserve is averaged over.
   */
  static async open(deps: OrchestratorDeps, session: { businessId: string; agentId: string; sessionId: string; modelKey: ModelKey; agentType?: string; skillsPreload?: "on" | "off" | null }, reserve: SessionReserveConfig = SESSION_RESERVE): Promise<SessionCreditsOpen> {
    const now = deps.clock.now();
    const check = await checkPlatformCredits(deps.db, session.businessId, { live: true, now });
    if (!check.ok) {
      const mockOnly = check.reason === "mock_only";
      return { ok: false, resting: !mockOnly, reason: mockOnly ? "only simulated credits are left this month, and they never pay for live model calls" : "the team is resting: this month's team budget is used", summary: RESTING_SUMMARY };
    }
    // Credits are charged at cost plus the markup (Nov 17, 2026): the reserve and the session's limit are at cost.
    const coveredMinor = costCoveredMinor(check.spendableMinor);
    const recent = session.agentType ? await repos.agents.recentSessionCost(deps.db, session.businessId, session.agentType, reserve.sampleSessions) : { averageMinor: null, sessions: 0 };
    const reserveMinor = sessionReserveMinor(recent.averageMinor, reserve);
    if (coveredMinor < reserveMinor) {
      await restBeforeSession(deps.db, session.businessId, { reserveMinor, now, topUps: topUpsOnSale(deps.env) });
      deps.log.info({ businessId: session.businessId, sessionId: session.sessionId, agentType: session.agentType ?? null, reserveMinor, spendableMinor: coveredMinor, sampledSessions: recent.sessions }, "what is left is under the session's reserve: the session does not start and the team rests");
      return { ok: false, resting: true, reason: "the team is resting: what is left of this month's team budget is under the reserve for this task", summary: RESTING_SUMMARY };
    }
    return { ok: true, credits: new SessionCredits(deps, session, coveredMinor, reserveMinor, reserve) };
  }

  /** The Agent SDK's `maxBudgetUsd`: what is spendable at launch plus the backstop ceiling, in US dollars. */
  get maxBudgetUsd(): number {
    return (this.spendableMinor + this.reserve.backstopCeilingMinor) / 100;
  }

  /** True once the session runs on the backstop (the balance was seen empty while it was running). */
  get onBackstop(): boolean {
    return this.backstopFromMinor !== null;
  }

  /** True once `SESSION_CREDIT_CHECK_MS` passed since the last settle (the control loop asks every poll). */
  due(): boolean {
    return this.deps.clock.nowMs() - this.lastCheckMs >= SESSION_CREDIT_CHECK_MS;
  }

  /**
   * Books what was spent since the last settle and says whether the session may go on. An empty balance does not end
   * it: from the settle that first sees the balance empty (emptied by this session, another or the api) the session
   * runs on the backstop, logged once, and `exhausted` is returned only when it has spent `backstopCeilingMinor` since
   * then. A failed write is logged and the session goes on: `finishSession` books the rest.
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
          details: { source: "claude-agent-sdk", label: "Estimate", partial: true, ...(this.session.skillsPreload ? { skills_preload: this.session.skillsPreload } : {}) },
        }, { topUps: topUpsOnSale(this.deps.env) });
        this.bookedMinor += costMinor;
        this.bookedTokens += tokens;
        if (booked.credits?.exhausted) return this.backstop(spent);
      }
      const check = await checkPlatformCredits(this.deps.db, this.session.businessId, { live: true, now: this.deps.clock.now() });
      return check.ok ? "ok" : this.backstop(spent);
    } catch (err) {
      this.deps.log.warn({ err: (err as Error).message, sessionId: this.session.sessionId }, "session credits could not be settled; trying again on the next check");
      return "ok";
    }
  }

  /** The balance is empty while the session runs: it goes on, up to the ceiling. */
  private backstop(spent: SpentSoFar): "ok" | "exhausted" {
    const spentMinor = Math.round(spent.costMinor);
    if (this.backstopFromMinor === null) {
      this.backstopFromMinor = spentMinor;
      // Logged each time a session outgrows its reserve, so the reserve can be tuned (WP-14 T1).
      this.deps.log.warn({ businessId: this.session.businessId, sessionId: this.session.sessionId, reserveMinor: this.reserveMinor, spendableAtStartMinor: this.spendableMinor, spentMinor, backstopCeilingMinor: this.reserve.backstopCeilingMinor }, "session outgrew its reserve: the balance is empty and it finishes on the backstop");
    }
    const pastEmptyMinor = spentMinor - this.backstopFromMinor;
    if (pastEmptyMinor < this.reserve.backstopCeilingMinor) return "ok";
    this.deps.log.error({ businessId: this.session.businessId, sessionId: this.session.sessionId, reserveMinor: this.reserveMinor, spentMinor, pastEmptyMinor }, "session reached the backstop ceiling: it stops here");
    return "exhausted";
  }
}

/** What `finishSession` still books for a session: its totals less what it booked while running (never below zero). */
export async function unbookedTokens(deps: OrchestratorDeps, businessId: string, sessionId: string, totals: { tokens: number; costMinor: number }): Promise<{ tokens: number; costMinor: number }> {
  const booked = await repos.usage.sessionTokens(deps.db, businessId, sessionId);
  return { tokens: Math.max(0, totals.tokens - booked.quantity), costMinor: Math.max(0, Math.round(totals.costMinor) - booked.costMinor) };
}
