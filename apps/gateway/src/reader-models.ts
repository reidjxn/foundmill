/**
 * The model client behind the quarantined reader (untrusted-reader.ts): the platform key (mock under MODEL_MODE=mock),
 * every call booked to the business's usage ledger as an Estimate, the way the api and the orchestrator book theirs.
 */
import { bookUsage, type Db } from "@foundmill/db";
import { createModelClient, effectiveModelMode, type ModelClient, type UsageEvent, type UsageSink } from "@foundmill/models";
import type { Env } from "@foundmill/shared";
import type { GatewayLogger } from "./pipeline";

export function readerUsageSink(db: Db, log: GatewayLogger): UsageSink {
  return async (event: UsageEvent) => {
    const a = event.attribution;
    if (!a?.businessId) return;
    try {
      await bookUsage(db, a.businessId, {
        agentId: a.agentId ?? null,
        sessionId: a.sessionId ?? null,
        kind: "tokens",
        modelKey: event.modelKey,
        quantity: event.usage.inputTokens + event.usage.outputTokens,
        unit: "tokens",
        costMinor: Math.max(0, event.cost.costMinorInt),
        currency: event.cost.currency,
        billedTo: event.billedTo,
        occurredAt: event.occurredAt,
        details: { service: "gateway", route: event.route, model: event.model, mode: event.mode, kind: a.kind ?? null, label: event.cost.label, attempt: event.attempt },
      });
    } catch (err) {
      log.warn({ err: (err as Error).message, route: event.route, businessId: a.businessId }, "usage ledger write failed");
    }
  };
}

export function createReaderModelClient(env: Pick<Env, "MODEL_MODE" | "ANTHROPIC_API_KEY">, db: Db, log: GatewayLogger): ModelClient {
  return createModelClient({ mode: effectiveModelMode(env.MODEL_MODE, env.ANTHROPIC_API_KEY, log), apiKey: env.ANTHROPIC_API_KEY, onUsage: readerUsageSink(db, log), logger: log });
}
