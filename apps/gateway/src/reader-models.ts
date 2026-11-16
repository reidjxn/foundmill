/**
 * The gateway's own model calls on the platform key (WP-09 T3, A7-03): the quarantined reader (the pipeline's digest and
 * `quarantine.read_untrusted`) and the web search behind `web.search_web`. The platform client asks first, like the
 * composer's (`apps/composer/src/usage.ts` `creditsGate`): a call for a business whose credits for the month are used up
 * is refused before its request leaves (`credits_exhausted`, 402), and every call is booked through `gatewayUsageSink`
 * at its exact cost. A business on its own Anthropic key runs the reader on that key, ungated (builtins.ts
 * `readerClientFor`); web search stays on the platform key and is charged to credits for every business (SEC2).
 */
import { assertPlatformCredits, type Db } from "@foundmill/db";
import { gateModelClient, type ModelCallGate, type ModelClient } from "@foundmill/models";

/** The check before every platform-key model call: the business's credits must allow it (`live`: simulated credits do not count). */
export function creditsGate(db: Db, live: boolean): ModelCallGate {
  return async ({ attribution }) => {
    if (!attribution?.businessId) return undefined;
    const check = await assertPlatformCredits(db, attribution.businessId, { live });
    return check.low ? { lowCredits: true } : undefined;
  };
}

/** The platform client, gated on the business's credits (live credits only when the client itself runs live). */
export function gatePlatformModels(models: ModelClient, db: Db): ModelClient {
  return gateModelClient(models, creditsGate(db, models.mode === "live"));
}
