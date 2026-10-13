/**
 * What the founder reads when Anthropic refuses to bill a model call (`ModelBillingError`, packages/models; audit
 * BILL-06, CML-07): who has to act and what happens next, never the provider's raw text. On the platform's key the
 * operator pays (the refusal is logged as an alert and shown on /health) and nothing is charged to the founder's credits;
 * on the business's own key the founder adds credit in the Anthropic Console.
 */
import { APP_NAME } from "@foundmill/config";

export interface ModelBillingFacts {
  /** `credit_balance` (no credit left) or `spend_limit` (a spend limit is reached). */
  reason: string;
  /** Whose account refused: `credits` is the platform's key, `byok` the business's own. */
  billedTo: string;
}

/** The facts of a billing refusal (`code: "billing"`), also after serialization; null for any other error. */
export function modelBillingFacts(err: unknown): ModelBillingFacts | null {
  const e = err as { name?: unknown; code?: unknown; reason?: unknown; billedTo?: unknown } | null;
  if (!e || typeof e !== "object" || (e.name !== "ModelBillingError" && e.code !== "billing")) return null;
  return { reason: typeof e.reason === "string" ? e.reason : "credit_balance", billedTo: e.billedTo === "byok" ? "byok" : "credits" };
}

/** One or two sentences for a toast, an error line or an Inbox note. `what` names what could not run ("This reply"). */
export function modelBillingMessage(facts: ModelBillingFacts, what = "This"): string {
  const state = facts.reason === "spend_limit" ? "has reached its spend limit" : "is out of credit";
  if (facts.billedTo === "byok") {
    const fix = facts.reason === "spend_limit" ? "Raise the limit in the Anthropic Console" : "Add credit in the Anthropic Console";
    return `${what} could not run: your Anthropic account ${state}. ${fix}, then try again; your key stays as it is.`;
  }
  return `${what} could not run: the model account that runs ${APP_NAME} ${state}. Our team has been alerted, and nothing was charged to your credits. Try again later.`;
}
