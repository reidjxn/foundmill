/**
 * Nightly schedule workflows (BUILD §9.4). Each takes the business ids to process (apps/api registers one Temporal
 * Schedule per environment and passes the active businesses) and runs the matching activity; `agentMetricsRollup`
 * also refreshes every agent's health (BUILD §9.10) so `agent.health_changed` is emitted at least nightly.
 */
import { proxyActivities } from "@temporalio/workflow";
import type { Activities, ScheduleInput, ScheduleResult } from "../activities";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "30 minutes", heartbeatTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "30 seconds" } });

export async function journeyDailyRefresh(input: ScheduleInput): Promise<ScheduleResult> {
  return acts.journeyDailyRefresh(input);
}

export async function benchmarksRebuild(input: ScheduleInput): Promise<ScheduleResult> {
  return acts.benchmarksRebuild(input);
}

export async function credentialExpiryScan(input: ScheduleInput): Promise<ScheduleResult> {
  return acts.credentialExpiryScan(input);
}

export async function consentRenewalScan(input: ScheduleInput): Promise<ScheduleResult> {
  return acts.consentRenewalScan(input);
}

export async function agentMetricsRollup(input: ScheduleInput): Promise<ScheduleResult> {
  const rolled = await acts.agentMetricsRollup(input);
  const eventIds = [...rolled.eventIds];
  const notes = [...rolled.notes];
  for (const businessId of input.businessIds) {
    const health = await acts.refreshAgentHealth({ businessId });
    eventIds.push(...health.eventIds);
    if (health.changed.length) notes.push(`${businessId}: ${health.changed.length} agent status change(s)`);
  }
  return { ...rolled, eventIds, notes };
}
