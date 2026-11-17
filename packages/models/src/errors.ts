/** Error types thrown by the model client. All extend `ModelError` with a stable `code`. */

export type ModelErrorCode =
  | "invalid_output"
  | "refusal"
  | "max_tokens"
  | "request"
  | "auth"
  | "rate_limited"
  | "unavailable"
  | "aborted"
  | "billing"
  | "not_funded"
  | "mock";

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/** The model returned output that did not match the requested schema even after the repair retry. */
export class ModelOutputError extends ModelError {
  constructor(message: string, details?: unknown, code: ModelErrorCode = "invalid_output") {
    super(code, message, false, details);
    this.name = "ModelOutputError";
  }
}

/** A non-retryable API error (400/401/403/404/413 ...). `status` is the HTTP status when known. */
export class ModelRequestError extends ModelError {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly apiErrorType: string | null = null,
    details?: unknown,
    code: ModelErrorCode = status === 401 ? "auth" : "request",
  ) {
    super(code, message, false, details);
    this.name = "ModelRequestError";
  }
}

/**
 * Why Anthropic refused to bill a call: the organization's prepaid `credit_balance` is used up (400 "Your credit balance
 * is too low"), or a `spend_limit` is reached (the Console's own limit, 400 "You have reached your specified API usage
 * limits"; the tier's monthly cap, 429 `enforced_spend_limit_reached` with no retry-after).
 */
export type ModelBillingReason = "credit_balance" | "spend_limit";

/**
 * The key's account cannot pay for calls (code `billing`). Never retried: it lasts until someone pays or the month
 * ends, so retrying (or backing off as for a rate limit) only delays the answer. Services turn it into a plain message
 * for the founder and an alert for the operator (whose key it is depends on `billedTo`).
 */
export class ModelBillingError extends ModelRequestError {
  constructor(
    message: string,
    readonly reason: ModelBillingReason,
    /** Whose account refused: `credits` is the platform's key (the operator pays), `byok` the business's own. */
    readonly billedTo: "credits" | "byok",
    status: number | undefined,
    apiErrorType: string | null = null,
    details?: unknown,
  ) {
    super(message, status, apiErrorType, details, "billing");
    this.name = "ModelBillingError";
  }
}

/** True for a `ModelBillingError`, also across package copies and serialization (Temporal failures keep the name). */
export function isModelBillingError(err: unknown): err is ModelBillingError {
  if (err instanceof ModelBillingError) return true;
  const e = err as { name?: unknown; code?: unknown } | null;
  return typeof e === "object" && e !== null && (e.name === "ModelBillingError" || e.code === "billing");
}

/**
 * True when the model declined the request (stop_reason `refusal`, thrown as a `ModelOutputError` with code `refusal`),
 * also across package copies and serialization. A refusal is never retried: the caller decides what the person sees.
 */
export function isModelRefusal(err: unknown): err is ModelOutputError {
  if (err instanceof ModelError) return err.code === "refusal";
  const e = err as { code?: unknown } | null;
  return typeof e === "object" && e !== null && e.code === "refusal";
}

/** Rate limit (429) still in force after every allowed attempt, or a wait longer than the limiter permits. */
export class ModelRateLimitError extends ModelError {
  constructor(
    message: string,
    readonly scope: string,
    readonly retryAfterMs?: number,
    details?: unknown,
  ) {
    super("rate_limited", message, true, details);
    this.name = "ModelRateLimitError";
  }
}

/** 5xx / 529 / connection failures after every allowed attempt. */
export class ModelUnavailableError extends ModelError {
  constructor(message: string, details?: unknown) {
    super("unavailable", message, true, details);
    this.name = "ModelUnavailableError";
  }
}

export class ModelAbortedError extends ModelError {
  constructor(message = "Model call aborted") {
    super("aborted", message, false);
    this.name = "ModelAbortedError";
  }
}

/**
 * A call refused before it left because Foundmill's key must not pay for it (WP-13, `enforceModelFunding`): a business
 * on its own Anthropic key is served on that key.
 */
export class ModelNotFundedError extends ModelError {
  constructor(
    message: string,
    readonly reason: "own_key_route",
  ) {
    super("not_funded", message, false, { reason });
    this.name = "ModelNotFundedError";
  }
}
