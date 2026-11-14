/**
 * A check that runs before every call a client makes (SEC2: the ceiling on the platform's Anthropic key). Each service
 * that calls the model on the platform key wraps its client with `gateModelClient` and a check that throws while the
 * business the call is attributed to may not spend (apps/api, apps/composer, the orchestrator's platform client): the
 * refusal happens before the request leaves, so nothing is spent and nothing is booked. The wrapped client is
 * otherwise the inner one (mode, usage events); it streams structured output whether or not the inner client does
 * (through the `streamStructured` helper, which falls back to `complete`).
 *
 * A check that lets the call run may also say the business's credits are low (`ModelCallVerdict.lowCredits`, the credit
 * saver): the call then runs with `lowCredits`, so a routine route moves to its lower-cost model (routing.ts) and a kept
 * route is unchanged.
 */
import type { z } from "zod";
import type { RouteKey } from "./routing";
import { streamStructured } from "./structured-stream";
import type { CompleteRequest, CompleteResult, CompleteResultWithJson, ModelClient, ModelMode, StreamStructuredRequest, StreamStructuredResult, UsageAttribution } from "./types";

/** What a check may say about a call it lets run. */
export interface ModelCallVerdict {
  /** The business's credits are low: routine routes run on their lower-cost model. */
  lowCredits?: boolean;
}

/** What the gate sees of a call: its route and who it is for. Throw to refuse it; return a verdict to shape it. */
export type ModelCallGate = (call: { route: RouteKey; attribution?: UsageAttribution }) => Promise<void | ModelCallVerdict>;

/** The request as the verdict shapes it (the same object when there is nothing to change). */
function shaped<R extends { lowCredits?: boolean }>(req: R, verdict: void | ModelCallVerdict): R {
  return verdict && verdict.lowCredits ? { ...req, lowCredits: true } : req;
}

/** Methods live on the prototype, as on the built-in clients, so `{ ...client, complete }` overrides behave the same. */
class GatedModelClient implements ModelClient {
  readonly mode: ModelMode;

  constructor(
    private readonly inner: ModelClient,
    private readonly gate: ModelCallGate,
  ) {
    this.mode = inner.mode;
  }

  complete<T>(req: CompleteRequest<T> & { schema: z.ZodType<T> }): Promise<CompleteResultWithJson<T>>;
  complete(req: CompleteRequest<unknown> & { schema?: undefined }): Promise<CompleteResult<unknown>>;
  async complete(req: CompleteRequest<unknown>): Promise<CompleteResult<unknown>> {
    const verdict = await this.gate({ route: req.route, attribution: req.attribution });
    return this.inner.complete(shaped(req, verdict) as CompleteRequest<unknown> & { schema?: undefined });
  }

  async streamStructured<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
    const verdict = await this.gate({ route: req.route, attribution: req.attribution });
    return streamStructured(this.inner, shaped(req, verdict));
  }
}

export function gateModelClient(inner: ModelClient, gate: ModelCallGate): ModelClient {
  return new GatedModelClient(inner, gate);
}
