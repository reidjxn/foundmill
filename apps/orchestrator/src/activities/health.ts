/**
 * `refreshAgentHealth` (BUILD §9.10): recompute every agent's status from its open sessions, recent tool failures,
 * credential status and wage cap; persist changes and emit `agent.health_changed`. Lost sessions are closed first
 * (`closeLostSessions`).
 */
import { periodOf, repos } from "@foundmill/db";
import { readSessionEvents } from "@foundmill/events";
import type { OrchestratorDeps } from "../deps";
import { emitEvent, systemActor } from "../events";
import { computeHealth, errorRate, type HealthSignals } from "../health";
import { closeLostSessions, enforceWageCaps, recoverAgents } from "./dispatch";
import type { HealthRefreshResult } from "./types";

/** A connector key as the founder reads it ("google_ads" → "Google Ads"). */
const connectorWord = (key: string): string => key.split(/[_-]/).map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");

export function createHealthActivities(deps: OrchestratorDeps) {
  return {
    async refreshAgentHealth(input: { businessId: string }): Promise<HealthRefreshResult> {
      const { db, clock } = deps;
      const now = clock.now();
      // Open rows nothing runs any more are closed first, so they neither block their task nor count as work below.
      await closeLostSessions(deps, input.businessId);
      // Rested failing agents and agents under their wage cap again come back first, and agents over their cap are
      // paused with their note (the same steps a cycle takes before it plans).
      const recovered = [...(await recoverAgents(deps, input.businessId)), ...(await enforceWageCaps(deps, input.businessId))];
      const [agents, expiredCredentials, integrations] = await Promise.all([
        repos.agents.list(db, input.businessId, { limit: 200 }),
        repos.credentials.expiring(db, input.businessId, now),
        repos.integrations.list(db, input.businessId),
      ]);
      const expiredConnectors = new Set(expiredCredentials.map((c) => integrations.find((i) => i.id === c.integrationId)?.connectorKey).filter((k): k is string => Boolean(k)));
      const period = periodOf(now);
      const changed: HealthRefreshResult["changed"] = recovered.map((r) => ({ agentId: r.agentId, from: r.from, to: r.to, reason: r.reason }));
      const eventIds: string[] = [];
      for (const agent of agents.items) {
        // A pause (the founder's, a team-wide stop, a wage cap) is never overridden by a computation: `recoverAgents`
        // lifts a wage-cap pause once the agent is under its cap, and only a resume lifts the others.
        if (agent.status === "paused") continue;
        const open = await repos.agents.listSessions(db, input.businessId, { agentId: agent.id, openOnly: true, limit: 5 });
        // A failing agent with nothing open rests before it works again (`retry.ts`); `recoverAgents` decides when.
        if (agent.status === "failing" && open.items.length === 0) continue;
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
        const lapsed = connectors.filter((k) => expiredConnectors.has(k));
        const credentialExpired = lapsed.length > 0;
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
        const computed = computeHealth(signals);
        // Down for a credential: the reason names what to reconnect, so the Health card can say it.
        const verdict = computed.status === "injured" && credentialExpired ? { ...computed, reason: `The ${lapsed.map(connectorWord).join(" and ")} credential it depends on has expired; reconnect it in Settings › Integrations` } : computed;
        if (verdict.status === agent.status) continue;
        // The wage-cap pause carries its reason so it lifts itself next period; any other verdict never lands on an
        // agent someone paused in the meantime.
        const updated = verdict.status === "paused" ? await repos.agents.setStatus(db, input.businessId, agent.id, "paused", { pausedReason: "wage_cap" }) : await repos.agents.setHealthStatus(db, input.businessId, agent.id, verdict.status);
        if (!updated) continue;
        const ev = await emitEvent(db, {
          businessId: input.businessId,
          type: "agent.health_changed",
          actor: systemActor,
          payload: { agentId: agent.id, from: agent.status, to: verdict.status, reason: verdict.reason, signals: { heartbeatAgeMs: signals.heartbeatAgeMs === null ? null : Math.round(signals.heartbeatAgeMs), errorRate: signals.errorRate, loopDetected: signals.loopDetected, credentialExpired: signals.credentialExpired, rateLimited: signals.rateLimited, budgetRemaining: signals.budgetRemainingMinor === null ? null : { amountMinor: Math.max(0, Math.round(signals.budgetRemainingMinor)), currency: agent.currency } }, expectedReturnAt: verdict.expectedReturnAt, sessionId: open.items[0]?.id ?? null },
        });
        changed.push({ agentId: agent.id, from: agent.status, to: verdict.status, reason: verdict.reason });
        eventIds.push(ev.id);
      }
      return { changed, eventIds };
    },
  };
}

export type HealthActivities = ReturnType<typeof createHealthActivities>;
