/**
 * A model call Anthropic refused to bill (`ModelBillingError`, packages/models; audit BILL-06, CML-07) as the api's own
 * error: code `model_billing`, 402, with the sentence the founder reads (packages/agents `modelBillingMessage`) and the
 * facts the web and the logs need. `toTRPCError` (trpc.ts) maps every such failure through here, so a conversation,
 * Refresh, plan compile, logo or ideation call never reads "Something went wrong on our side" when the cause is that the
 * model account is out of credit; `mapErrors` logs it as the operator's alert (`alert: "model_billing"`).
 */
import { modelBillingFacts, modelBillingMessage } from "@foundmill/agents";
import { AppError } from "@foundmill/shared";

export function modelBillingAppError(err: unknown): AppError {
  const facts = modelBillingFacts(err) ?? { reason: "credit_balance", billedTo: "credits" };
  return new AppError("model_billing", modelBillingMessage(facts), 402, { reason: facts.reason, billedTo: facts.billedTo, alerted: facts.billedTo !== "byok" });
}

/** What a founder reads when a model declined a request (WP-09 T5): the whole fallback chain said no. */
export const MODEL_REFUSED_MESSAGE = "The model declined this request. Reword it and try again.";

/**
 * A model refusal (`ModelOutputError` with code `refusal`, packages/models) as the api's own error: code `model_refused`,
 * 422, with one plain sentence. On Opus and Sonnet the API already re-ran the request on its recommended fallback model,
 * so a refusal that reaches here is final for this wording.
 */
export function modelRefusalAppError(_err: unknown): AppError {
  return new AppError("model_refused", MODEL_REFUSED_MESSAGE, 422);
}

