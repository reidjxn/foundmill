/**
 * autopilot activities (BUILD §11.3 "In Automated mode Continue auto-runs", §9.6): the loop that keeps a business in
 * Automated mode moving without a press. Each tick the Chief of Staff answers the Inbox items that block Continue inside
 * Automated mode's authority (everything except signing, within the business's spend cap), a cycle runs, and what the
 * cycle raised is answered the same way. Hard gates still queue for the founder. The loop sits out while a vacation runs
 * (its own loop does the same) and while the team is stopped, and ends when the mode changes (audit SOAK-01).
 */
import { DECISION_TYPES } from "@foundmill/shared";
import { repos } from "@foundmill/db";
import { LIMITS } from "@foundmill/config";
import type { OrchestratorDeps } from "../deps";
import { autoDecideBlocking, nextCycleNumberOf } from "./holiday";
import type { AutopilotCheck, HolidayDecisions, LoadedAutopilot } from "./types";

export function createAutopilotActivities(deps: OrchestratorDeps) {
  return {
    async loadAutopilot(input: { businessId: string }): Promise<LoadedAutopilot> {
      const chief = await repos.agents.chiefOfStaff(deps.db, input.businessId);
      return { chiefOfStaffId: chief?.id ?? null, authority: DECISION_TYPES.filter((d) => d !== "sign_contracts"), cadenceAgentHours: LIMITS.cycleTimeBoxAgentHours };
    },

    /** Is the business still in Automated mode, and may a cycle start now? */
    async autopilotCheck(input: { businessId: string }): Promise<AutopilotCheck> {
      const { db } = deps;
      const business = await repos.businesses.get(db, input.businessId, { includeArchived: true });
      if (business.archivedAt) return { active: false, hold: null, reason: "archived" };
      if (business.businessMode !== "automated") return { active: false, hold: null, reason: "mode_changed" };
      if (business.agentsStoppedAt) return { active: true, hold: "stopped", reason: "the team is stopped" };
      if (await repos.holidays.current(db, input.businessId, deps.clock.now())) return { active: true, hold: "vacation", reason: "a vacation is running" };
      return { active: true, hold: null, reason: "" };
    },

    async autopilotAutoDecide(input: { businessId: string; autopilot: LoadedAutopilot }): Promise<HolidayDecisions> {
      const business = await repos.businesses.get(deps.db, input.businessId);
      return autoDecideBlocking(deps, input.businessId, { chiefOfStaffId: input.autopilot.chiefOfStaffId, authority: input.autopilot.authority, auditAction: "autopilot.decide", scope: "Automated mode", spendCapMinor: business.spendCapMinor });
    },

    async autopilotNextCycleNumber(input: { businessId: string }): Promise<{ cycleNumber: number }> {
      return { cycleNumber: await nextCycleNumberOf(deps.db, input.businessId) };
    },
  };
}

export type AutopilotActivities = ReturnType<typeof createAutopilotActivities>;
