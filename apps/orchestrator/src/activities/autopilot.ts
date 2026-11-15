/**
 * autopilot activities (0055): the guard-rail check the `autopilot` workflow runs before every cycle, the pause it
 * persists when a guard rail trips, and the audit entry and event for each cycle it starts. The decision itself is the
 * pure `decideAutopilot` of @foundmill/shared (the API reads the same function for Home and Settings); this file only
 * gathers the facts (`loadAutopilotFacts`), writes what the decision calls for and turns it into a wait.
 *
 * Autopilot never approves, decides or spends by itself: it starts `businessCycle` the way Continue does, so every
 * approval, hard gate, section wall and policy check applies to its cycles exactly as to a founder press.
 */
import { autopilotChangedPayload, loadAutopilotFacts, repos, runRoundsOf } from "@foundmill/db";
import { CONTINUE_RUN_LIMITS, autopilotCycleBudgetMinor, decideAutopilot, decideRun, pauseNote, type AutopilotCadence, type AutopilotDecision, type AutopilotPauseReason, type ContinueRunDecision, type ContinueRunEndReason } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";

/** How often a standing wait (an Inbox item, a vacation, a running cycle) is looked at again. */
export const AUTOPILOT_POLL_MS = 5 * 60 * 1000;
/** The longest the workflow sleeps without looking at the guard rails again (credits, stop). */
export const AUTOPILOT_MAX_SLEEP_MS = 15 * 60 * 1000;

export interface AutopilotEvaluation {
  decision: AutopilotDecision;
  /** How long to wait before looking again (`wait` only). */
  waitMs: number;
  cadence: AutopilotCadence;
  maxIdleCycles: number;
  /** Cycles started today (UTC) that count toward the daily cap, before this decision. */
  cyclesToday: number;
  /** The budget a cycle Autopilot starts on its own is given (the rest of its own spend ceiling today, 0077); null: none. */
  cycleBudgetMinor?: number | null;
  /** The run's own decision (Continue runs until done), taken before the schedule's; null without a run. */
  run: { decision: ContinueRunDecision; waitMs: number } | null;
}

/** One `cycle.run_ended` per run, whoever writes it (this activity, or the API for Pause, Stop all agents and a lost run). */
export const runEndedKey = (runId: string) => `cycle.run_ended:${runId}`;

const money = (amountMinor: number) => ({ amountMinor, currency: "USD" });

export function createAutopilotActivities(deps: OrchestratorDeps) {
  return {
    /** Gather the facts, decide, and (for a wait) say how long to sleep. Writes the planned time for the Home chip. */
    async autopilotEvaluate(input: { businessId: string; unrecordedFailures?: number; run?: { id: string; startedAt: number; unrecordedFailures?: number } }): Promise<AutopilotEvaluation> {
      const { db, clock } = deps;
      const now = clock.now();
      const business = await repos.businesses.get(db, input.businessId, { includeArchived: true });
      const facts = await loadAutopilotFacts(db, business, now, { unrecordedFailures: input.unrecordedFailures, run: input.run ?? null });
      const decision = decideAutopilot(facts);
      const runDecision = decideRun(facts);
      const run = runDecision ? { decision: runDecision, waitMs: runDecision.action === "wait" ? Math.max(1_000, Math.min(CONTINUE_RUN_LIMITS.pollMs, runDecision.until !== null ? runDecision.until - now.getTime() : CONTINUE_RUN_LIMITS.pollMs)) : 0 } : null;
      let waitMs = 0;
      if (decision.action === "wait") waitMs = Math.max(1_000, Math.min(AUTOPILOT_MAX_SLEEP_MS, decision.until !== null ? decision.until - now.getTime() : AUTOPILOT_POLL_MS));
      const planned = decision.action === "wait" || decision.action === "start" ? decision.nextAt : null;
      const plannedAt = planned === null ? null : new Date(planned);
      if ((business.autopilotNextAt?.getTime() ?? null) !== (plannedAt?.getTime() ?? null) && business.autopilotEnabled) await repos.autopilot.setNextAt(db, input.businessId, plannedAt);
      return { decision, waitMs, cadence: facts.settings.cadence, maxIdleCycles: facts.settings.maxIdleCycles, cyclesToday: facts.cyclesToday, cycleBudgetMinor: autopilotCycleBudgetMinor(facts), run };
    },

    /**
     * A guard rail paused Autopilot: persist it (once), with an audit entry and `autopilot.changed`; failed or empty
     * cycles also leave a note in the Inbox. The founder turns Autopilot back on by hand. Already paused or off: no-op.
     */
    async autopilotPause(input: { businessId: string; reason: AutopilotPauseReason }): Promise<{ paused: boolean }> {
      const { db } = deps;
      const paused = await repos.autopilot.pause(db, input.businessId, input.reason);
      if (!paused) return { paused: false };
      const business = await repos.businesses.get(db, input.businessId, { includeArchived: true });
      const note = pauseNote(input.reason, business.autopilotMaxIdleCycles);
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "autopilot.pause", target: { kind: "business", id: input.businessId }, details: { reason: input.reason, note } });
      await emitEvent(db, { businessId: input.businessId, type: "autopilot.changed", actor: systemActor, payload: autopilotChangedPayload(business, "paused", input.reason) });
      if (input.reason === "idle_cycles") {
        const chief = await repos.agents.chiefOfStaff(db, input.businessId);
        if (chief) {
          const item = await repos.inbox.createItem(db, input.businessId, {
            type: "warning",
            from_agent_id: chief.id,
            subject: "Autopilot paused: nothing got done",
            body_md: `${note}\n\nAutopilot starts no more cycles until you turn it back on in Settings › What the team can do. Look at the last cycle's tasks for what is stuck; a blocked task, a missing connection or an empty plan are the usual causes.`,
            status_strip: [],
            exhibit: { kind: "none", spec_ref: null },
            decision: null,
            // A note, never a blocker: it must not hold up Continue.
            blocks_continue: false,
            source_event_ids: [],
            entity_ids: [],
          });
          await emitEvent(db, { businessId: input.businessId, type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
        }
      }
      return { paused: true };
    },

    /**
     * Autopilot started a cycle: the audit entry and `autopilot.cycle_started` (the cycle's own events follow). `runId`:
     * the cycle is a follow-on round of the run a press of Continue started.
     */
    async autopilotCycleStarted(input: { businessId: string; cycleNumber: number; workflowId: string; cadence: AutopilotCadence; cyclesToday: number; runId?: string }): Promise<{ eventId: string }> {
      const { db } = deps;
      const run = input.runId ? { runId: input.runId } : {};
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "autopilot.cycle_start", target: { kind: "cycle", id: input.workflowId }, details: { cycleNumber: input.cycleNumber, cadence: input.cadence, cyclesToday: input.cyclesToday, ...run } });
      const ev = await emitEvent(db, { businessId: input.businessId, type: "autopilot.cycle_started", actor: systemActor, payload: { cycleNumber: input.cycleNumber, workflowId: input.workflowId, cadence: input.cadence, cyclesToday: input.cyclesToday, ...run } });
      return { eventId: ev.id };
    },

    /**
     * A run a press of Continue started has ended: `cycle.run_ended` (once per run: Pause and Stop all agents may have
     * written it already from the API) and the audit entry `cycle.run_end`. The day's limits also leave one Chief of Staff
     * note in the Inbox that never blocks Continue; a run that ended `done` needs none (the idle cycle's own note says
     * what is in the way).
     */
    async autopilotRunEnded(input: { businessId: string; runId: string; startedAt: number; reason: ContinueRunEndReason }): Promise<{ recorded: boolean; rounds: number }> {
      const { db } = deps;
      const key = runEndedKey(input.runId);
      const page = await repos.events.list(db, input.businessId, { type: ["cycle.completed"], limit: 200 });
      const rounds = runRoundsOf(page.items, input.startedAt);
      if (await repos.events.byIdempotencyKey(db, input.businessId, key)) return { recorded: false, rounds: rounds.rounds };
      const daily = input.reason === "daily_cycles" || input.reason === "daily_spend";
      const business = daily ? await repos.businesses.get(db, input.businessId, { includeArchived: true }) : null;
      const max = business?.autopilotMaxCyclesPerDay ?? null;
      await emitEvent(db, { businessId: input.businessId, type: "cycle.run_ended", actor: systemActor, payload: { runId: input.runId, reason: input.reason, rounds: rounds.rounds, cost: rounds.cost, maxCyclesPerDay: input.reason === "daily_cycles" ? max : null } }, { idempotencyKey: key });
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "cycle.run_end", target: { kind: "business", id: input.businessId }, details: { runId: input.runId, reason: input.reason, rounds: rounds.rounds, costMinor: rounds.cost.amountMinor } });
      if (daily && max !== null) {
        const chief = await repos.agents.chiefOfStaff(db, input.businessId);
        if (chief) {
          const what = input.reason === "daily_cycles" ? `today's limit of ${max} cycle${max === 1 ? "" : "s"}` : "today's spend ceiling (Estimate)";
          const item = await repos.inbox.createItem(db, input.businessId, {
            type: "update",
            from_agent_id: chief.id,
            subject: input.reason === "daily_cycles" ? "Today's cycle limit is reached" : "Today's spend ceiling is reached (Estimate)",
            body_md: `The team worked through ${rounds.rounds} cycle${rounds.rounds === 1 ? "" : "s"} after you pressed Continue and stopped at ${what}. No more cycles start on their own today. Press Continue for one more, or raise the limit in Settings › What the team can do.`,
            status_strip: [],
            exhibit: { kind: "none", spec_ref: null },
            decision: null,
            // A note, never a blocker: it must not hold up Continue.
            blocks_continue: false,
            source_event_ids: [],
            entity_ids: [],
          });
          await emitEvent(db, { businessId: input.businessId, type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
        }
      }
      return { recorded: true, rounds: rounds.rounds };
    },

    /**
     * A cycle Autopilot started ended in an error. If it had written `cycle.started` but never completed, close it as
     * failed (so it is not "running" forever and counts toward the idle streak) and say `recorded`; otherwise the caller
     * counts the failure itself.
     */
    async autopilotCycleFailed(input: { businessId: string; workflowId: string; error: string }): Promise<{ recorded: boolean }> {
      const { db } = deps;
      const page = await repos.events.list(db, input.businessId, { type: ["cycle.started", "cycle.completed"], limit: 50 });
      const started = page.items.find((e) => e.type === "cycle.started" && (e.payload as { workflowId?: string }).workflowId === input.workflowId);
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "autopilot.cycle_failed", target: { kind: "cycle", id: input.workflowId }, details: { error: input.error.slice(0, 300) } });
      if (!started) return { recorded: false };
      const payload = started.payload as { cycleId: string; cycleNumber: number };
      const done = page.items.some((e) => e.type === "cycle.completed" && (e.payload as { cycleId?: string }).cycleId === payload.cycleId);
      if (done) return { recorded: true };
      await emitEvent(db, {
        businessId: input.businessId,
        type: "cycle.completed",
        actor: systemActor,
        payload: { cycleId: payload.cycleId, cycleNumber: payload.cycleNumber, workflowId: input.workflowId, outcome: "failed", tasksDispatched: 0, tasksCompleted: 0, tasksBlocked: 0, agentHours: 0, cost: money(0), inboxItemIds: [], durationMs: 0 },
      });
      return { recorded: true };
    },
  };
}

export type AutopilotActivities = ReturnType<typeof createAutopilotActivities>;
