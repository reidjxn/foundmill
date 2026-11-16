/**
 * Who pays decides the model (WP-13; founder, Nov 16, 2026). Each service wraps the client on Foundmill's Anthropic key
 * with `enforceModelFunding` and a `fundingOf` that reads who pays for a call from its attribution: the business's plan
 * and billing, else the person's (the highest tier among the projects they own), else nobody (signed out).
 *
 * - `paid_plan`: the call runs as its route says.
 * - `free_plan`: the call runs on Haiku 5.5, every route included (`ResolveOptions.freePlan`). A free account's agent
 *   sessions run on GLM-5.3 Flash through Z.ai instead (apps/orchestrator, WP-13 T4); they never use this client.
 * - `own_key`: refused before it leaves. A business on its own Anthropic key is served by a client built on that key.
 *   Free web search is refused the same way until it has its own route (WP-13 T5).
 *
 * The refusal happens before the request leaves, so nothing is spent and nothing is booked; callers keep naming a route
 * and never a model.
 */
import { ModelNotFundedError } from "./errors";
import { gateModelClient } from "./gate";
import type { ModelClient, UsageAttribution } from "./types";

/** Who pays for a call (packages/config `modelFundingFor`, the same three values). */
export type ModelFunding = "paid_plan" | "free_plan" | "own_key";

/** Reads who pays from a call's attribution. Each service supplies its own, cached per business. */
export type FundingOf = (attribution: UsageAttribution | undefined) => Promise<ModelFunding>;

const OWN_KEY_ROUTE = "This call is for a business on its own Anthropic key and must run on that key.";
const SEARCH_UNAVAILABLE = "Web search is not available on the free plan yet.";

export function enforceModelFunding(client: ModelClient, fundingOf: FundingOf): ModelClient {
  return gateModelClient(client, async ({ route, attribution }) => {
    const funding = await fundingOf(attribution);
    if (funding === "paid_plan") return;
    if (funding === "own_key") throw new ModelNotFundedError(OWN_KEY_ROUTE, "own_key_route");
    if (route === "webSearch") throw new ModelNotFundedError(SEARCH_UNAVAILABLE, "search_unavailable");
    return { freePlan: true };
  });
}
