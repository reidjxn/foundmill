/**
 * Process-wide model client (packages/models). Mock under MODEL_MODE=mock; live with the platform key otherwise.
 * BYOK keys are decrypted only in the gateway/orchestrator (BUILD §10.2), so the API's own calls (ideation,
 * plan compilation, recommendations) use the platform key.
 *
 * Every call made for a business (`attribution.businessId`: conversation replies, plan compiles, the in-process
 * composer, foundations, logo sets, recommenders) is booked to that business's usage ledger here, one row per model
 * call, as the orchestrator's usage sink does (review item 7). Calls with no business (Ideation drafting, Ask on a
 * concept, a logo before commit) are not booked: there is no ledger to book them to yet (DECISIONS 2026-10-09).
 */
import { repos, type Db } from "@foundmill/db";
import { createModelClient, type ModelClient, type UsageEvent, type UsageSink } from "@foundmill/models";
import type { Env } from "@foundmill/shared";
import type { ApiLogger } from "./log";

export interface ApiModelClientOptions {
  /** The service-role database the usage ledger is written to; without it nothing is booked (logged only). */
  db?: Db;
  /** Called after the ledger write (tests, observability). */
  onUsage?: (e: UsageEvent) => void;
}

/**
 * Books a model call to its business's usage ledger: tokens at list prices in the pricing currency (USD,
 * `PRICING_CURRENCY`), labelled Estimate, billed to credits (the API runs on the platform key). A call stopped in flight
 * keeps `aborted: true` (its tokens are estimated too). A failed write is logged and never fails the call.
 */
export function apiUsageSink(db: Db, log: ApiLogger): UsageSink {
  return async (event) => {
    const a = event.attribution;
    if (!a?.businessId) return;
    try {
      await repos.usage.record(db, a.businessId, {
        agentId: a.agentId ?? null,
        sessionId: a.sessionId ?? null,
        kind: "tokens",
        modelKey: event.modelKey,
        quantity: event.usage.inputTokens + event.usage.outputTokens,
        unit: "tokens",
        costMinor: Math.max(0, event.cost.costMinorInt),
        // The meter's currency (PRICING_CURRENCY): list prices are USD, never relabelled as the business's currency.
        currency: event.cost.currency,
        billedTo: "credits",
        occurredAt: event.occurredAt,
        details: {
          service: "api",
          route: event.route,
          model: event.model,
          mode: event.mode,
          kind: a.kind ?? null,
          taskId: a.taskId ?? null,
          inboxItemId: a.inboxItemId ?? null,
          label: event.cost.label,
          attempt: event.attempt,
          ...(event.streamed ? { streamed: true } : {}),
          ...(event.aborted ? { aborted: true } : {}),
        },
      });
    } catch (err) {
      log.warn({ err: (err as Error).message, route: event.route, businessId: a.businessId }, "usage ledger write failed");
    }
  };
}

export function createApiModelClient(env: Pick<Env, "MODEL_MODE" | "ANTHROPIC_API_KEY">, log: ApiLogger, opts: ApiModelClientOptions = {}): ModelClient {
  const book = opts.db ? apiUsageSink(opts.db, log) : null;
  const usage = async (e: UsageEvent) => {
    log.debug({ route: e.route, model: e.model, costMinor: e.cost.costMinorInt, attribution: e.attribution }, "model usage (Estimate)");
    await book?.(e);
    opts.onUsage?.(e);
  };
  if (env.MODEL_MODE === "live" && !env.ANTHROPIC_API_KEY) {
    log.error({}, "MODEL_MODE=live but ANTHROPIC_API_KEY is missing; falling back to the mock model client");
    return createModelClient({ mode: "mock", onUsage: usage, logger: log });
  }
  return createModelClient({ mode: env.MODEL_MODE, apiKey: env.ANTHROPIC_API_KEY, onUsage: usage, logger: log });
}
