export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 500, public readonly details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}
export class NotFoundError extends AppError { constructor(what: string, id?: string) { super("not_found", id ? `${what} ${id} not found` : `${what} not found`, 404); } }
export class ForbiddenError extends AppError { constructor(message = "Forbidden") { super("forbidden", message, 403); } }
export class UnauthorizedError extends AppError { constructor(message = "Unauthorized") { super("unauthorized", message, 401); } }
export class ValidationError extends AppError { constructor(message: string, details?: unknown) { super("validation", message, 400, details); } }
export class HardGateError extends AppError { constructor(action: string) { super("hard_gate", `"${action}" always requires a human action (BUILD §2.2)`, 403); } }
export class PolicyDeniedError extends AppError { constructor(reason: string) { super("policy_denied", reason, 403); } }
/**
 * A plan tier limit (BUILD §10.5 `TIERS`): businesses per owner, seats or concurrent agents. `details.limit` names it;
 * the web turns the code into an upgrade prompt rather than a plain failure.
 */
export class TierLimitError extends AppError { constructor(message: string, details: { limit: "businesses" | "seats" | "concurrent_agents"; tier: string; allowed: number; used: number } & Record<string, unknown>) { super("tier_limit", message, 403, details); } }
/**
 * A business on credits whose balance for the month is used up (BUILD §10.4, §10.5): a model call on the platform's key
 * is refused before it is sent. `details` says where the balance stands; the message says the way back for the tier.
 */
export class CreditsExhaustedError extends AppError { constructor(message: string, details: { tier: string; period: string; balanceMinor: number; currency: string }) { super("credits_exhausted", message, 402, details); } }
