/**
 * Which models an agent may be set to, by who pays (WP-13 T7; founder, Nov 16, 2026): on the free plan a founder chooses
 * between Haiku 5.5 and GLM-5.3 Flash, and Opus and Sonnet stay in the list, grayed, with the offer to upgrade or to
 * connect their own Anthropic key. A paid plan, an own Anthropic key, and (from the day sign-up opens, WP-09 T16) a credit
 * pack unlock them. The agent's stored choice is kept either way: it is what the agent runs on after the upgrade.
 */
import { modelFundingFor, planName, type ModelFundingKind } from "@foundmill/config";
import { markBilling, repos, type Business, type Executor } from "@foundmill/db";
import { AppError, type Env, type ModelKey } from "@foundmill/shared";

/** The Anthropic models a free account does not choose on Foundmill's key. */
const CLAUDE_ON_PLATFORM_KEY: readonly ModelKey[] = ["opus", "sonnet"];

export const UPGRADE_OR_OWN_KEY = "upgrade_or_own_key";
export const UPGRADE_OR_OWN_KEY_MESSAGE = `Claude models come with a paid plan, or connect your own Anthropic key and pay Anthropic directly. On the ${planName("free")} plan your team runs on Haiku 5.5 or GLM-5.3 Flash.`;

export interface ModelGate {
  funding: ModelFundingKind;
  /** Whether choosing this model needs an upgrade or the founder's own key. */
  gated: (modelKey: ModelKey) => boolean;
  /** The model the agent's work sessions run on now (what the table and the dialog show as in use). */
  inUse: (stored: ModelKey) => ModelKey;
}

export async function modelGateFor(tx: Executor, env: Env, business: Pick<Business, "id" | "planTier" | "modelBilling">): Promise<ModelGate> {
  const funding = modelFundingFor({ planTier: business.planTier, modelBilling: business.modelBilling });
  const unlockedByPack = funding === "free_plan" && env.PAID_ENTRY === true && (await repos.accountPlans.ownerBoughtPack(tx, business.id, { live: markBilling(env).live }));
  const locked = funding === "free_plan" && !unlockedByPack;
  return {
    funding,
    gated: (modelKey) => locked && CLAUDE_ON_PLATFORM_KEY.includes(modelKey),
    // The same rule the orchestrator's `freeSessionModel` applies when a free session starts.
    inUse: (stored) => {
      if (funding !== "free_plan" || stored === "glm" || stored === "haiku") return stored;
      if (env.FREE_SESSION_MODEL === "glm" && env.ZAI_API_KEY) return "glm";
      return env.FREE_SESSION_MODEL === "haiku" ? "haiku" : stored;
    },
  };
}

export const upgradeOrOwnKeyError = () => new AppError(UPGRADE_OR_OWN_KEY, UPGRADE_OR_OWN_KEY_MESSAGE, 403);
