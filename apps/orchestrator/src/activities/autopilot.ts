/**
 * autopilot activities (0041): the guard-rail check the `autopilot` workflow runs before every cycle, the pause it
 * persists when a guard rail trips, and the audit entry and event for each cycle it starts. The decision itself is the
 * pure `decideAutopilot` of @foundmill/shared (the API reads the same function for Home and Settings); this file only
 * gathers the facts (`loadAutopilotFacts`), writes what the decision calls for and turns it into a wait.
 *
 * Autopilot never approves, decides or spends by itself: it starts `businessCycle` the way Continue does, so every
 * approval, hard gate, section wall and policy check applies to its cycles exactly as to a founder press.
 */
import { autopilotChangedPayload, loadAutopilotFacts, repos } from "@foundmill/db";
import { decideAutopilot, pauseNote, type AutopilotCadence, type AutopilotDecision, type AutopilotPauseReason } from "@foundmill/shared";
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
  /** Autopilot cycles started today (UTC) before this decision. */
  cyclesToday: number;
}

const money = (amountMinor: number) => ({ amountMinor, currency: "USD" });

export function createAutopilotActivities(deps: OrchestratorDeps) {
  return {
    /** Gather the facts, decide, and (for a wait) say how long to sleep. Writes the planned time for the Home chip. */
    async autopilotEvaluate(input: { businessId: string; unrecordedFailures?: number }): Promise<AutopilotEvaluation> {
      const { db, clock } = deps;
      const now = clock.now();
      const business = await repos.businesses.get(db, input.businessId, { includeArchived: true });
      const facts = await loadAutopilotFacts(db, business, now, { unrecordedFailures: input.unrecordedFailures });
      const decision = decideAutopilot(facts);
      let waitMs = 0;
      if (decision.action === "wait") waitMs = Math.max(1_000, Math.min(AUTOPILOT_MAX_SLEEP_MS, decision.until !== null ? decision.until - now.getTime() : AUTOPILOT_POLL_MS));
      const planned = decision.action === "wait" || decision.action === "start" ? decision.nextAt : null;
      const plannedAt = planned === null ? null : new Date(planned);
      if ((business.autopilotNextAt?.getTime() ?? null) !== (plannedAt?.getTime() ?? null) && business.autopilotEnabled) await repos.autopilot.setNextAt(db, input.businessId, plannedAt);
      return { decision, waitMs, cadence: facts.settings.cadence, maxIdleCycles: facts.settings.maxIdleCycles, cyclesToday: facts.cyclesToday };
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
            body_md: `${note}\n\nAutopilot starts no more cycles until you turn it back on in Settings › Mode. Look at the last cycle's tasks for what is stuck; a blocked task, a missing connection or an empty plan are the usual causes.`,
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

    /** Autopilot started a cycle: the audit entry and `autopilot.cycle_started` (the cycle's own events follow). */
    async autopilotCycleStarted(input: { businessId: string; cycleNumber: number; workflowId: string; cadence: AutopilotCadence; cyclesToday: number }): Promise<{ eventId: string }> {
      const { db } = deps;
      await repos.audit.append(db, input.businessId, { actorKind: "system", action: "autopilot.cycle_start", target: { kind: "cycle", id: input.workflowId }, details: { cycleNumber: input.cycleNumber, cadence: input.cadence, cyclesToday: input.cyclesToday } });
      const ev = await emitEvent(db, { businessId: input.businessId, type: "autopilot.cycle_started", actor: systemActor, payload: { cycleNumber: input.cycleNumber, workflowId: input.workflowId, cadence: input.cadence, cyclesToday: input.cyclesToday } });
      return { eventId: ev.id };
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
