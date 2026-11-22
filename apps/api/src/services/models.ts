/**
 * Process-wide model client (packages/models). Mock under MODEL_MODE=mock; live with the platform key otherwise.
 * BYOK keys are decrypted only in the gateway/orchestrator (BUILD §10.2), so the API's own calls (ideation,
 * plan compilation, recommendations) use the platform key.
 *
 * Every call made for a business (`attribution.businessId`: conversation replies, plan compiles, the in-process
 * composer, foundations, logo sets, recommenders) is booked to that business's usage ledger here, one row per model
 * call, as the orchestrator's usage sink does (review item 7). A live call with no business but a signed-in person
 * (`attribution.userId`: Ideation, Import, Ask on a concept, compare, a logo before commit, the screen of a post made
 * without a business) is booked to that person's `account_usage` instead, and refused before it is made once their
 * calls before a project have cost the day's or the 30 days' ceiling (WP-09 T2, `precommit_ceiling`, 429).
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
import { assertPlatformCredits, bookUsage, cachedFreeCap, cachedModelFundingOf, freeCapCheck, repos, type Db } from "@foundmill/db";
import { createModelClient, enforceModelFunding, gateModelClient, ownKeyViaGateway, routeOwnKeyCalls, usageForLedger, type ModelCallGate, type ModelClient, type UsageEvent, type UsageSink } from "@foundmill/models";
import { AppError, PRECOMMIT_CEILING_DEFAULT_CENTS, type Env } from "@foundmill/shared";
import type { ApiLogger } from "./log";
import { markNotesCalls, noteModelCall } from "./model-calls";

export interface ApiModelClientOptions {
  /** The service-role database the usage ledger is written to; without it nothing is booked (logged only). */
  db?: Db;
  /** Called after the ledger write (tests, observability). */
  onUsage?: (e: UsageEvent) => void;
  /**
   * The gateway, for a business on its own Anthropic key (WP-13 T11): its calls run on that key through the gateway's
   * model route, booked `byok`. Absent (tests, no secret): they run as the business's plan says, on Foundmill's key.
   */
  ownKeyGateway?: { url: string; serviceToken: (businessId: string) => Promise<string> };
  /** Injectable fetch for the gateway route (tests). */
  gatewayFetch?: typeof globalThis.fetch;
  /** Credits can be bought here (packages/shared `topUpsOnSale`): refusals and the zero note name a top-up (WP-09 T13). */
  topUps?: boolean;
}

/**
 * Books a model call to its business's usage ledger: tokens at list prices in the pricing currency (USD,
 * `PRICING_CURRENCY`), labelled Estimate, billed to whoever's key the client ran on (`event.billedTo`: credits for the
 * API's process-wide client on the platform key) and, for credits, charged to the period's balance (`bookUsage`, which
 * pauses the team on the last credit). A call stopped in flight keeps `aborted: true` (its tokens are estimated too). A
 * failed write is logged and never fails the call.
 */
export function apiUsageSink(db: Db, log: ApiLogger, topUps = false): UsageSink {
  return async (event) => {
    const a = event.attribution;
    const { quantity, tokens } = usageForLedger(event.usage);
    if (!a?.businessId) {
      // Before a project exists: a live call for a signed-in person is booked to their account (WP-09 T2). Mock calls
      // cost nothing and book nothing.
      if (!a?.userId || event.mode !== "live") return;
      try {
        await repos.accountUsage.record(db, {
          userId: a.userId,
          kind: a.kind ?? "model_call",
          route: event.route,
          modelKey: event.modelKey,
          quantity,
          costMicroMinor: Math.max(0, event.cost.costMicroMinor),
          occurredAt: new Date(event.occurredAt),
          details: { service: "api", model: event.model, label: event.cost.label, attempt: event.attempt, tokens, ...(event.aborted ? { aborted: true } : {}) },
        });
      } catch (err) {
        log.warn({ err: (err as Error).message, route: event.route }, "account usage write failed");
      }
      return;
    }
    try {
      await bookUsage(db, a.businessId, {
        agentId: a.agentId ?? null,
        sessionId: a.sessionId ?? null,
        kind: "tokens",
        modelKey: event.modelKey,
        quantity,
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
          tokens,
          ...(event.streamed ? { streamed: true } : {}),
          ...(event.aborted ? { aborted: true } : {}),
        },
      }, { topUps });
    } catch (err) {
      log.warn({ err: (err as Error).message, route: event.route, businessId: a.businessId }, "usage ledger write failed");
    }
  };
}

/** The day's and the 30 days' ceilings on one person's live calls before they have a project, in US cents (WP-09 T2). */
export interface PrecommitCeilings {
  dailyCents: number;
  monthlyCents: number;
}

export const PRECOMMIT_DAY_SENTENCE = "That is all the drafting for today. Take charge of one of your ideas to keep going, or come back tomorrow.";
export const PRECOMMIT_MONTH_SENTENCE = "You have used this month's free drafting. Take charge of one of your ideas to keep going.";

const DAY_MS = 86_400_000;

/**
 * A live call with no business for a signed-in person, refused once their calls before a project cost the ceiling over
 * the last 24 hours or 30 days. Parallel calls of one draft read the same sum, so one draft can pass the line (as SEC2
 * accepts one turn).
 */
async function assertPrecommitCeiling(db: Db, userId: string, ceilings: PrecommitCeilings): Promise<void> {
  const now = Date.now();
  const [day, month] = await Promise.all([repos.accountUsage.spentMicro(db, userId, new Date(now - DAY_MS)), repos.accountUsage.spentMicro(db, userId, new Date(now - 30 * DAY_MS))]);
  if (month >= ceilings.monthlyCents * 1_000_000) throw new AppError("precommit_ceiling", PRECOMMIT_MONTH_SENTENCE, 429, { window: "30d" });
  if (day >= ceilings.dailyCents * 1_000_000) throw new AppError("precommit_ceiling", PRECOMMIT_DAY_SENTENCE, 429, { window: "24h" });
}

/**
 * The api's check before every model call (see the module comment): a call for a business runs only while its credits
 * allow it (`live`: the client spends real money, so simulated credits do not count). A live call with no business for
 * a signed-in person runs only under the ceilings before commit. Both throw before the call is noted, so a refused call
 * gives its request's allowance back. A call that passes is noted on the request.
 */
export function apiCreditsGate(db: Db, live: boolean, ceilings: PrecommitCeilings = { dailyCents: PRECOMMIT_CEILING_DEFAULT_CENTS.daily, monthlyCents: PRECOMMIT_CEILING_DEFAULT_CENTS.monthly }, topUps = false): ModelCallGate {
  return async ({ attribution }) => {
    const check = attribution?.businessId ? await assertPlatformCredits(db, attribution.businessId, { live, topUps }) : null;
    if (!attribution?.businessId && attribution?.userId && live) await assertPrecommitCeiling(db, attribution.userId, ceilings);
    noteModelCall();
    // Low credits (the credit saver): routine routes run on their lower-cost model; founder-facing routes keep theirs.
    return check?.low ? { lowCredits: true } : undefined;
  };
}

export function createApiModelClient(
  env: Pick<Env, "MODEL_MODE" | "ANTHROPIC_API_KEY"> & Partial<Pick<Env, "FREE_PLAN_MONTHLY_CAP_CENTS" | "PRECOMMIT_DAILY_CEILING_CENTS" | "PRECOMMIT_MONTHLY_CEILING_CENTS">>,
  log: ApiLogger,
  opts: ApiModelClientOptions = {},
): ModelClient {
  const book = opts.db ? apiUsageSink(opts.db, log, opts.topUps ?? false) : null;
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
  const gated = gateModelClient(client, opts.db ? apiCreditsGate(opts.db, client.mode === "live", precommitCeilingsOf(env), opts.topUps ?? false) : async () => noteModelCall());
  // The month's free-plan cap (WP-13 T6): at the cap a free call is refused with the date free AI is back.
  const freeCap = opts.db && env.FREE_PLAN_MONTHLY_CAP_CENTS !== undefined ? freeCapCheck(opts.db, env.FREE_PLAN_MONTHLY_CAP_CENTS) : undefined;
  const platform = opts.db ? enforceModelFunding(gated, cachedModelFundingOf(opts.db, { ownKeyServed: false }), { freeCap }) : gated;
  // A business on its own key (WP-13 T11): live calls go to the gateway's model route, which puts the founder's key on
  // them. Never a fallback to Foundmill's key: a missing or refused key ends in its own sentence (packages/models).
  if (!opts.db || !opts.ownKeyGateway || client.mode !== "live") return markNotesCalls(platform);
  const ownKeyOf = cachedModelFundingOf(opts.db, { ownKeyServed: true });
  const viaGateway = ownKeyViaGateway({ gatewayUrl: opts.ownKeyGateway.url, serviceToken: opts.ownKeyGateway.serviceToken, onUsage: usage, logger: log, ...(opts.gatewayFetch ? { fetch: opts.gatewayFetch } : {}) });
  const noted = new Map<string, ModelClient>();
  const clientFor = (businessId: string) => {
    let c = noted.get(businessId);
    if (!c) noted.set(businessId, (c = gateModelClient(viaGateway(businessId), async () => noteModelCall())));
    return c;
  };
  return markNotesCalls(routeOwnKeyCalls(platform, { ownKey: async (a) => (await ownKeyOf(a)) === "own_key", clientFor }));
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

function precommitCeilingsOf(env: Partial<Pick<Env, "PRECOMMIT_DAILY_CEILING_CENTS" | "PRECOMMIT_MONTHLY_CEILING_CENTS">>): PrecommitCeilings {
  return { dailyCents: env.PRECOMMIT_DAILY_CEILING_CENTS ?? PRECOMMIT_CEILING_DEFAULT_CENTS.daily, monthlyCents: env.PRECOMMIT_MONTHLY_CEILING_CENTS ?? PRECOMMIT_CEILING_DEFAULT_CENTS.monthly };
}

