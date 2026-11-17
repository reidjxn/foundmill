/**
 * Cost metering (BUILD §10.4 "Inbox Refresh … cost metered", §11.8 wage bill). Every model completion the composer
 * makes — the Opus note, the Haiku sweep, Sonnet commentary, chapter titles — reaches `usage_ledger` through this sink,
 * attached to the models client as `onUsage`. Costs are list-price arithmetic from @foundmill/models and therefore
 * labelled "Estimate" in `details`. Rows are billed to whoever's key the client ran on (`event.billedTo`; the composer
 * runs on the platform key, so credits) and settled through `bookUsage`, which charges the period's balance.
 *
 * Every call also asks first (`creditsGate`, SEC2 S2): a note, a sweep, commentary or a chapter title for a business whose
 * credits for the month are used up is refused before the request leaves (`credits_exhausted`, 402, which the api
 * passes through), whatever the business's model billing; a pre-written note from the buffer still serves Refresh.
 */
import { assertPlatformCredits, bookUsage, cachedModelFundingOf, freeCapCheck, type Db } from "@foundmill/db";
import { enforceModelFunding, gateModelClient, type ModelCallGate, type ModelClient, type ModelLogger, type UsageEvent, type UsageSink } from "@foundmill/models";

/** The composer's check before every model call: the business's credits must allow it (`live`: simulated credits do not count). */
export function creditsGate(db: Db, live: boolean): ModelCallGate {
  return async ({ attribution }) => {
    if (!attribution?.businessId) return undefined;
    const check = await assertPlatformCredits(db, attribution.businessId, { live });
    // Low credits (the credit saver): commentary moves to a lower-cost model; the Inbox note is locked to its own.
    return check.low ? { lowCredits: true } : undefined;
  };
}

/**
 * The composer's client on the platform key: the credits gate, and who pays decides the model (WP-13: a business not on
 * a paid plan runs on Haiku 5.5). The composer cannot use a business's own key, so an own-key business runs as its plan
 * says until WP-13 T11 routes these calls through the gateway on that key.
 */
export function composerModelClient(platform: ModelClient, db: Db, freeCapCents?: number): ModelClient {
  const freeCap = freeCapCents === undefined ? undefined : freeCapCheck(db, freeCapCents);
  return enforceModelFunding(gateModelClient(platform, creditsGate(db, platform.mode === "live")), cachedModelFundingOf(db, { ownKeyServed: false }), { freeCap });
}

export interface UsageSinkOptions {
  /** Called after each ledger write (tests). */
  onRecorded?: (event: UsageEvent, costMinor: number) => void;
}

export function createUsageSink(db: Db, log: ModelLogger, options: UsageSinkOptions = {}): UsageSink {
  return async (event) => {
    const businessId = event.attribution?.businessId;
    if (!businessId) {
      log.debug({ route: event.route }, "model usage without a business id; not metered");
      return;
    }
    const quantity = event.usage.inputTokens + event.usage.outputTokens + event.usage.cacheCreationInputTokens + event.usage.cacheReadInputTokens;
    try {
      await bookUsage(db, businessId, {
        agentId: event.attribution?.agentId ?? null,
        kind: "tokens",
        modelKey: event.modelKey,
        quantity,
        unit: "tokens",
        costMinor: event.cost.costMinorInt,
        // The exact cost (0039): sums and credits add these, so a call under half a cent is not booked at 0.
        costMicroMinor: event.cost.costMicroMinor,
        currency: event.cost.currency,
        billedTo: event.billedTo,
        occurredAt: new Date(event.occurredAt),
        details: {
          service: "composer",
          route: event.route,
          purpose: event.attribution?.kind ?? "composer",
          inboxItemId: event.attribution?.inboxItemId ?? null,
          model: event.model,
          mode: event.mode,
          attempt: event.attempt,
          label: event.cost.label,
          pricingAsOf: event.cost.pricingAsOf,
          usage: event.usage,
        },
      });
      options.onRecorded?.(event, event.cost.costMinorInt);
    } catch (err) {
      // Metering must never fail a note; the ledger is observability, the Anthropic invoice is the truth.
      log.warn({ err: (err as Error).message, businessId, route: event.route }, "usage ledger write failed");
    }
  };
}
