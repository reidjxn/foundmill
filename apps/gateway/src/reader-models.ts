/**
 * The gateway's own model calls on the platform key (WP-09 T3, A7-03): the quarantined reader (the pipeline's digest and
 * `quarantine.read_untrusted`) and the web search behind `web.search_web`. The platform client asks first, like the
 * composer's (`apps/composer/src/usage.ts` `creditsGate`): a call for a business whose credits for the month are used up
 * is refused before its request leaves (`credits_exhausted`, 402), and every call is booked through `gatewayUsageSink`
 * at its exact cost. A business on its own Anthropic key runs the reader on that key, ungated (builtins.ts
 * `readerClientFor`); web search stays on the platform key and is charged to credits for every business (SEC2).
 *
 * Who pays decides the model (WP-13): on the platform client, a business not on a paid plan reads and searches on Haiku
 * 5.5 (packages/models free-plan.ts; founder, Nov 16, 2026: live web search on every plan). An own-key business's reader
 * never reaches this client; its web search follows its plan.
 */
import { assertPlatformCredits, cachedModelFundingOf, freeCapCheck, type Db } from "@foundmill/db";
import { enforceModelFunding, gateModelClient, type ModelCallGate, type ModelClient } from "@foundmill/models";
import { AppError } from "@foundmill/shared";

/** The check before every platform-key model call: the business's credits must allow it (`live`: simulated credits do not count). */
export function creditsGate(db: Db, live: boolean, topUps = false): ModelCallGate {
  return async ({ attribution }) => {
    // Every model call the gateway makes is for a business; one that names none is refused, never run unbooked.
    if (!attribution?.businessId) throw new AppError("forbidden", "A model call here must name the business it is for", 403);
    const check = await assertPlatformCredits(db, attribution.businessId, { live, topUps });
    return check.low ? { lowCredits: true } : undefined;
  };
}

/** The platform client, gated on the business's credits (live credits only when the client itself runs live) and on who pays. */
export function gatePlatformModels(models: ModelClient, db: Db, freeCapCents?: number, topUps = false): ModelClient {
  const freeCap = freeCapCents === undefined ? undefined : freeCapCheck(db, freeCapCents);
  return enforceModelFunding(gateModelClient(models, creditsGate(db, models.mode === "live", topUps)), cachedModelFundingOf(db, { ownKeyServed: false }), { freeCap });
}
