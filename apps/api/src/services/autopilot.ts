/**
 * Autopilot (0055): a business that starts its own cycles. The founder's switch and settings (owners and admins, in
 * Settings › Mode or on Commit), the status Home and Settings read, and the `autopilot` workflow's start and nudges.
 *
 * Autopilot only decides when the next cycle starts: the workflow starts `businessCycle` the way Continue does, so every
 * approval, hard gate, section wall and policy check applies as for a founder press, and it never approves anything.
 * The status is the same pure decision the workflow runs (`decideAutopilot`, @foundmill/shared) over the same facts
 * (`loadAutopilotFacts`, packages/db), so the chip can never disagree with what the workflow does. Turning it on is
 * refused while the team is stopped; Resume never turns it back on by itself.
 */
import { autopilotChangedPayload, loadAutopilotFacts, repos, type AutopilotChange } from "@foundmill/db";
import { autopilotView, decideAutopilot, type AutopilotCadence, type AutopilotPauseReason, type AutopilotState } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit, emit } from "../trpc";
import { assertAgentsRunning } from "./stop-guard";
import { SIGNALS, WORKFLOWS, workflowIds, type TemporalResult } from "./temporal";

export interface AutopilotStatus {
  enabled: boolean;
  state: AutopilotState;
  /** The chip text: On, Waiting for you, Paused: reason, Off. */
  label: string;
  /** One plain sentence under the chip. */
  detail: string;
  pausedReason: AutopilotPauseReason | null;
  /** Why it is holding off right now (it stays on): an Inbox item, a vacation, a running cycle, a daily limit. */
  waitingFor: string | null;
  /** The next planned cycle, an Estimate (ISO); null when none is planned. */
  nextAt: string | null;
  settings: { cadence: AutopilotCadence; dailyHour: number; maxCyclesPerDay: number; spendCeilingMinor: number | null; maxIdleCycles: number };
  /** Autopilot cycles started today (UTC). */
  cyclesToday: number;
  /** Model spend today in USD cents (an Estimate). */
  spentTodayMinor: number;
  /** Credits left this period in USD cents (an Estimate); null on the founder's own key. */
  creditsRemainingMinor: number | null;
  changedAt: string | null;
}

export async function autopilotStatus(ctx: BusinessContext): Promise<AutopilotStatus> {
  const business = await repos.businesses.get(ctx.db, ctx.businessId);
  const facts = await loadAutopilotFacts(ctx.db, business, new Date());
  const decision = decideAutopilot(facts);
  const view = autopilotView(decision);
  return {
    enabled: business.autopilotEnabled,
    state: view.state,
    label: view.label,
    detail: view.detail,
    pausedReason: decision.action === "paused" || decision.action === "pause" ? decision.reason : null,
    waitingFor: decision.action === "wait" && decision.why !== "schedule" ? decision.why : null,
    nextAt: view.nextAt === null ? null : new Date(view.nextAt).toISOString(),
    settings: facts.settings,
    cyclesToday: facts.cyclesToday,
    spentTodayMinor: facts.spentTodayMinor,
    creditsRemainingMinor: facts.creditsRemainingMinor,
    changedAt: business.autopilotChangedAt ? business.autopilotChangedAt.toISOString() : null,
  };
}

export interface SetAutopilotInput {
  enabled?: boolean;
  cadence?: AutopilotCadence;
  dailyHour?: number;
  maxCyclesPerDay?: number;
  spendCeilingMinor?: number | null;
  maxIdleCycles?: number;
}

export interface SetAutopilotResult {
  status: AutopilotStatus;
  change: AutopilotChange | null;
  /** The workflow start or nudge; null when nothing needed one. */
  workflow: TemporalResult | null;
}

/** Start the business's Autopilot workflow, or nudge the running one to look again (idempotent: one id per business). */
export async function startAutopilotWorkflow(ctx: Pick<BusinessContext, "businessId" | "temporal">): Promise<TemporalResult> {
  const started = await ctx.temporal.start(WORKFLOWS.autopilot, { workflowId: workflowIds.autopilot(ctx.businessId), args: [{ businessId: ctx.businessId }] });
  if (started.queued && started.reason === "already running") await ctx.temporal.signal(started.workflowId, SIGNALS.autopilotRefresh, {});
  return started;
}

/**
 * The founder's switch and settings. Turning Autopilot on starts its workflow (refused while the team is stopped);
 * turning it off or changing a setting nudges the running one. Every change writes an audit row and `autopilot.changed`.
 */
export async function setAutopilot(ctx: BusinessContext, input: SetAutopilotInput): Promise<SetAutopilotResult> {
  const before = ctx.business;
  const willBeOn = input.enabled ?? before.autopilotEnabled;
  // Turning it on (or back on after a pause) needs a team that can run: a stopped team never auto-starts.
  if (input.enabled === true && (!before.autopilotEnabled || before.autopilotPausedReason !== null)) await assertAgentsRunning(ctx, "Autopilot");

  const result = await ctx.rls(async (tx) => {
    const r = await repos.autopilot.set(tx, ctx.businessId, input);
    const change: AutopilotChange | null = r.turnedOn ? "turned_on" : r.turnedOff ? "turned_off" : r.settingsChanged ? "settings_changed" : null;
    if (change) {
      const action = change === "turned_on" ? "autopilot.turn_on" : change === "turned_off" ? "autopilot.turn_off" : "autopilot.update_settings";
      await audit(tx, ctx, {
        action,
        target: { kind: "business", id: ctx.businessId },
        details: {
          enabled: r.business.autopilotEnabled,
          cadence: r.business.autopilotCadence,
          dailyHour: r.business.autopilotDailyHour,
          maxCyclesPerDay: r.business.autopilotMaxCyclesPerDay,
          spendCeilingMinor: r.business.autopilotSpendCeilingMinor === null ? null : Number(r.business.autopilotSpendCeilingMinor),
          maxIdleCycles: r.business.autopilotMaxIdleCycles,
          wasPausedFor: r.before.autopilotPausedReason,
        },
      });
      await emit(tx, ctx, { type: "autopilot.changed", payload: autopilotChangedPayload(r.business, change, null) });
    }
    return { turnedOn: r.turnedOn, change };
  });

  let workflow: TemporalResult | null = null;
  if (result.turnedOn) workflow = await startAutopilotWorkflow(ctx);
  else if (result.change && (willBeOn || before.autopilotEnabled)) workflow = await ctx.temporal.signal(workflowIds.autopilot(ctx.businessId), SIGNALS.autopilotRefresh, {});
  return { status: await autopilotStatus({ ...ctx, business: await repos.businesses.get(ctx.db, ctx.businessId) }), change: result.change, workflow };
}

/**
 * Starts the workflow of a business whose Autopilot is on and not paused, when it is not running (the start is idempotent).
 * The shell calls it when Home opens, so an Autopilot saved while the orchestrator was down begins as soon as it is back.
 */
export async function ensureAutopilot(ctx: BusinessContext): Promise<{ running: boolean; workflow: TemporalResult | null }> {
  const business = await repos.businesses.get(ctx.db, ctx.businessId);
  if (!business.autopilotEnabled || business.autopilotPausedReason !== null || business.agentsStoppedAt !== null) return { running: false, workflow: null };
  const workflow = await ctx.temporal.start(WORKFLOWS.autopilot, { workflowId: workflowIds.autopilot(ctx.businessId), args: [{ businessId: ctx.businessId }] });
  return { running: workflow.queued, workflow };
}
