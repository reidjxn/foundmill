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
