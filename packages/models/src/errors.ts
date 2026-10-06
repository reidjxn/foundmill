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
  ) {
    super(status === 401 ? "auth" : "request", message, false, details);
    this.name = "ModelRequestError";
  }
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
