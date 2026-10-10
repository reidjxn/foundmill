/**
 * Cost metering (BUILD §10.4 "Inbox Refresh … cost metered", §11.8 wage bill). Every model completion the composer
 * makes — the Opus note, the Haiku sweep, Sonnet commentary, chapter titles — reaches `usage_ledger` through this sink,
 * attached to the models client as `onUsage`. Costs are list-price arithmetic from @foundmill/models and therefore
 * labelled "Estimate" in `details`. Rows are billed to whoever's key the client ran on (`event.billedTo`; the composer
 * runs on the platform key, so credits) and settled through `bookUsage`, which charges the period's balance.
 */
import { bookUsage, type Db } from "@foundmill/db";
import type { ModelLogger, UsageEvent, UsageSink } from "@foundmill/models";

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
