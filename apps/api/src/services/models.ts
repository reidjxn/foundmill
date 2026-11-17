/**
 * Process-wide model client (packages/models). Mock under MODEL_MODE=mock; live with the platform key otherwise.
 * BYOK keys are decrypted only in the gateway/orchestrator (BUILD §10.2), so the API's own calls (ideation,
 * plan compilation, recommendations) use the platform key.
 *
 * Every call made for a business (`attribution.businessId`: conversation replies, plan compiles, the in-process
 * composer, foundations, logo sets, recommenders) is booked to that business's usage ledger here, one row per model
 * call, as the orchestrator's usage sink does (review item 7). Calls with no business (Ideation drafting, Ask on a
 * concept, a logo before commit) are not booked: there is no ledger to book them to yet (DECISIONS 2026-10-09).
 *
 * Every call for a business also asks first (SEC2 S2): the credits gate (`assertPlatformCredits`, packages/db) refuses it
 * with `credits_exhausted` (402) once the business's credits for the month are used up, whatever its model billing (a
 * business on its own key pays for these platform-key calls with its credits too), and, where calls are live, when only
 * credits from a simulated payment are left. A call that passes is noted on the request (services/model-calls.ts), so
 * its allowance is never given back. While the credits are low, a call that passes runs with `lowCredits` (the credit
 * saver): a routine route moves to its lower-cost model (packages/models routing.ts), a founder-facing one keeps its own.
 *
 * Who pays decides the model (WP-13; founder, Nov 16, 2026): every call for an account not on a paid plan (a free
 * business, a person before commit, the signed-out idea box) runs on Haiku 5.5 (`enforceModelFunding`). The api cannot
 * use a business's own key (above), so an own-key business runs as its plan says until WP-13 T11 sends these calls
 * through the gateway on that key.
 */
import { assertPlatformCredits, bookUsage, cachedFreeCap, cachedModelFundingOf, freeCapCheck, type Db } from "@foundmill/db";
import { createModelClient, enforceModelFunding, gateModelClient, type ModelCallGate, type ModelClient, type UsageEvent, type UsageSink } from "@foundmill/models";
import type { Env } from "@foundmill/shared";
import type { ApiLogger } from "./log";
import { markNotesCalls, noteModelCall } from "./model-calls";

export interface ApiModelClientOptions {
  /** The service-role database the usage ledger is written to; without it nothing is booked (logged only). */
  db?: Db;
  /** Called after the ledger write (tests, observability). */
  onUsage?: (e: UsageEvent) => void;
}

/**
 * Books a model call to its business's usage ledger: tokens at list prices in the pricing currency (USD,
 * `PRICING_CURRENCY`), labelled Estimate, billed to whoever's key the client ran on (`event.billedTo`: credits for the
 * API's process-wide client on the platform key) and, for credits, charged to the period's balance (`bookUsage`, which
 * pauses the team on the last credit). A call stopped in flight keeps `aborted: true` (its tokens are estimated too). A
 * failed write is logged and never fails the call.
 */
export function apiUsageSink(db: Db, log: ApiLogger): UsageSink {
  return async (event) => {
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
        // The exact cost (0039): sums and credits add these, so a call under half a cent is not booked at 0.
        costMicroMinor: Math.max(0, event.cost.costMicroMinor),
        // The meter's currency (PRICING_CURRENCY): list prices are USD, never relabelled as the business's currency.
        currency: event.cost.currency,
        billedTo: event.billedTo,
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

/**
 * The api's check before every model call (see the module comment): a call for a business runs only while its credits
 * allow it (`live`: the client spends real money, so simulated credits do not count). Calls with no business (Ideation,
 * Ask on a concept) have their own allowances and nothing to charge. A call that passes is noted on the request.
 */
export function apiCreditsGate(db: Db, live: boolean): ModelCallGate {
  return async ({ attribution }) => {
    const check = attribution?.businessId ? await assertPlatformCredits(db, attribution.businessId, { live }) : null;
    noteModelCall();
    // Low credits (the credit saver): routine routes run on their lower-cost model; founder-facing routes keep theirs.
    return check?.low ? { lowCredits: true } : undefined;
  };
}

export function createApiModelClient(env: Pick<Env, "MODEL_MODE" | "ANTHROPIC_API_KEY"> & Partial<Pick<Env, "FREE_PLAN_MONTHLY_CAP_CENTS">>, log: ApiLogger, opts: ApiModelClientOptions = {}): ModelClient {
  const book = opts.db ? apiUsageSink(opts.db, log) : null;
  const usage = async (e: UsageEvent) => {
    log.debug({ route: e.route, model: e.model, costMinor: e.cost.costMinorInt, attribution: e.attribution }, "model usage (Estimate)");
    await book?.(e);
    opts.onUsage?.(e);
  };
  let client: ModelClient;
  if (env.MODEL_MODE === "live" && !env.ANTHROPIC_API_KEY) {
    log.error({}, "MODEL_MODE=live but ANTHROPIC_API_KEY is missing; falling back to the mock model client");
    client = createModelClient({ mode: "mock", onUsage: usage, logger: log });
  } else client = createModelClient({ mode: env.MODEL_MODE, apiKey: env.ANTHROPIC_API_KEY, onUsage: usage, logger: log });
  const gated = gateModelClient(client, opts.db ? apiCreditsGate(opts.db, client.mode === "live") : async () => noteModelCall());
  // The month's free-plan cap (WP-13 T6): at the cap a free call is refused with the date free AI is back.
  const freeCap = opts.db && env.FREE_PLAN_MONTHLY_CAP_CENTS !== undefined ? freeCapCheck(opts.db, env.FREE_PLAN_MONTHLY_CAP_CENTS) : undefined;
  return markNotesCalls(opts.db ? enforceModelFunding(gated, cachedModelFundingOf(opts.db, { ownKeyServed: false }), { freeCap }) : gated);
}

/**
 * Whether a request runs on the free plan while the month's free-plan spend is in its slow band (WP-13 T6): from 80% of
 * the cap a free request gets a quarter of its usual allowances (services/model-limits.ts). A paid plan or a founder's
 * own key is never slowed, and an unreadable spend slows nobody (the cap itself still holds at 100%).
 */
export function freePlanSlowCheck(db: Db, capCents: number): (scope: { userId: string; businessId?: string | null }) => Promise<boolean> {
  const cap = cachedFreeCap(db, { capCents });
  const fundingOf = cachedModelFundingOf(db, { ownKeyServed: false });
  return async (scope) => {
    try {
      if ((await cap()).state !== "slow") return false;
      return (await fundingOf({ userId: scope.userId, businessId: scope.businessId ?? undefined })) === "free_plan";
    } catch {
      return false;
    }
  };
}
