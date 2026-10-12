/**
 * Did this request reach a model? (SEC2 S3.) A model-backed procedure spends one hit of its allowance before it runs and
 * gets it back when it is refused before any model call (services/model-limits.ts). The refusal's code alone cannot say
 * that: `inbox.decide` compiles a plan with Opus and only then finds the section the decider cannot write to (403), so a
 * code-based refund let a walled member loop free-text decisions without limit. The request's scope counts the model
 * calls started inside it instead: the api's model client notes each call as it passes the credits gate
 * (services/models.ts), and the composer client notes a call to the composer service, which may call a model itself.
 *
 * Kept per request with AsyncLocalStorage (the model client is process-wide); outside a scope noting does nothing.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ModelCallScope {
  /** Model calls started (or handed to the composer service) inside the scope. */
  calls: number;
}

const scopes = new AsyncLocalStorage<ModelCallScope>();

/** Runs `fn` in a fresh scope and returns its result with the scope, so the caller can read how many calls it made. */
export async function withModelCallScope<T>(fn: () => Promise<T>): Promise<{ result: T; scope: ModelCallScope }> {
  const scope: ModelCallScope = { calls: 0 };
  const result = await scopes.run(scope, fn);
  return { result, scope };
}

/** A model call starts (or may start, in another service) for the current request. */
export function noteModelCall(): void {
  const scope = scopes.getStore();
  if (scope) scope.calls += 1;
}
