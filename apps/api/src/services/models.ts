/**
 * Process-wide model client (packages/models). Mock under MODEL_MODE=mock; live with the platform key otherwise.
 * BYOK keys are decrypted only in the gateway/orchestrator (BUILD §10.2), so the API's own calls (ideation,
 * plan compilation, recommendations) use the platform key.
 */
import { createModelClient, type ModelClient, type UsageEvent } from "@foundmill/models";
import type { Env } from "@foundmill/shared";
import type { ApiLogger } from "./log";

export function createApiModelClient(env: Pick<Env, "MODEL_MODE" | "ANTHROPIC_API_KEY">, log: ApiLogger, onUsage?: (e: UsageEvent) => void): ModelClient {
  const usage = (e: UsageEvent) => {
    log.debug({ route: e.route, model: e.model, costMinor: e.cost.costMinorInt, attribution: e.attribution }, "model usage (Estimate)");
    onUsage?.(e);
  };
  if (env.MODEL_MODE === "live" && !env.ANTHROPIC_API_KEY) {
    log.error({}, "MODEL_MODE=live but ANTHROPIC_API_KEY is missing; falling back to the mock model client");
    return createModelClient({ mode: "mock", onUsage: usage, logger: log });
  }
  return createModelClient({ mode: env.MODEL_MODE, apiKey: env.ANTHROPIC_API_KEY, onUsage: usage, logger: log });
}
