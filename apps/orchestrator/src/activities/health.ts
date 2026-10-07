/**
 * `refreshAgentHealth` (BUILD §9.10): recompute every agent's status from its open sessions, recent tool failures,
 * credential status and wage cap; persist changes and emit `agent.health_changed`.
 */
import { periodOf, repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { computeHealth, errorRate, type HealthSignals } from "../health";
import type { HealthRefreshResult } from "./types";

export function createHealthActivities(deps: OrchestratorDeps) {
  return {
    async refreshAgentHealth(input: { businessId: string }): Promise<HealthRefreshResult> {
      const { db, clock } = deps;
      const now = clock.now();
      const [agents, expiredCredentials, integrations] = await Promise.all([
        repos.agents.list(db, input.businessId, { limit: 200 }),
        repos.credentials.expiring(db, input.businessId, now),
        repos.integrations.list(db, input.businessId),
      ]);
      const expiredConnectors = new Set(expiredCredentials.map((c) => integrations.find((i) => i.id === c.integrationId)?.connectorKey).filter((k): k is string => Boolean(k)));
      const period = periodOf(now);
      const changed: HealthRefreshResult["changed"] = [];
      const eventIds: string[] = [];
      for (const agent of agents.items) {
        if (agent.status === "paused") continue; // the founder's pause is never overridden by a computation
        const open = await repos.agents.listSessions(db, input.businessId, { agentId: agent.id, openOnly: true, limit: 5 });
        let heartbeatAgeMs: number | null = null;
        let failed = 0;
        let total = 0;
        let loopDetected = false;
        for (const session of open.items) {
          const events = await readSessionEvents(deps.redis, session.id, { kinds: ["tool_call", "note"], limit: 2000 });
          const last = events[events.length - 1];
          const lastAt = last ? new Date(last.event.at).getTime() : new Date(session.startedAt).getTime();
          heartbeatAgeMs = Math.max(heartbeatAgeMs ?? 0, clock.nowMs() - lastAt);
          for (const { event } of events) {
            if (event.kind === "tool_call" && event.status === "started") total += 1;
            if (event.kind === "tool_call" && (event.status === "failed" || event.status === "denied")) failed += 1;
            if (event.kind === "note" && event.source === "system" && /loop detected/i.test(event.text)) loopDetected = true;
          }
        }
        const version = agent.currentVersionId ? await repos.agents.getVersion(db, input.businessId, agent.currentVersionId) : null;
        const connectors = Array.isArray(version?.tools) ? (version!.tools as { connectorKey?: string }[]).map((t) => t.connectorKey).filter((k): k is string => typeof k === "string") : [];
        const credentialExpired = connectors.some((k) => expiredConnectors.has(k));
        const spend = await repos.usage.agentSpend(db, input.businessId, agent.id, period);
        const signals: HealthSignals = {
          heartbeatAgeMs,
          errorRate: errorRate(failed, total),
          loopDetected,
          credentialExpired,
          rateLimited: false,
          budgetRemainingMinor: spend.remainingMinor,
          paused: false,
          active: open.items.length > 0,
          expectedReturnAt: credentialExpired ? null : spend.remainingMinor !== null && spend.remainingMinor <= 0 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() : null,
        };
        const verdict = computeHealth(signals);
        if (verdict.status === agent.status) continue;
        await repos.agents.setStatus(db, input.businessId, agent.id, verdict.status);
        const ev = await emitEvent(db, {
          businessId: input.businessId,
          type: "agent.health_changed",
          actor: systemActor,
          payload: { agentId: agent.id, from: agent.status, to: verdict.status, reason: verdict.reason, signals: { heartbeatAgeMs: signals.heartbeatAgeMs === null ? null : Math.round(signals.heartbeatAgeMs), errorRate: signals.errorRate, loopDetected: signals.loopDetected, credentialExpired: signals.credentialExpired, rateLimited: signals.rateLimited, budgetRemaining: signals.budgetRemainingMinor === null ? null : { amountMinor: Math.max(0, Math.round(signals.budgetRemainingMinor)), currency: agent.currency ?? "EUR" } }, expectedReturnAt: verdict.expectedReturnAt, sessionId: open.items[0]?.id ?? null },
        });
        changed.push({ agentId: agent.id, from: agent.status, to: verdict.status, reason: verdict.reason });
        eventIds.push(ev.id);
      }
      return { changed, eventIds };
    },
  };
}

export type HealthActivities = ReturnType<typeof createHealthActivities>;
