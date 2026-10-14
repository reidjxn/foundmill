/**
 * A check that runs before every call a client makes (SEC2: the ceiling on the platform's Anthropic key). Each service
 * that calls the model on the platform key wraps its client with `gateModelClient` and a check that throws while the
 * business the call is attributed to may not spend (apps/api, apps/composer, the orchestrator's platform client): the
 * refusal happens before the request leaves, so nothing is spent and nothing is booked. The wrapped client is
 * otherwise the inner one (mode, usage events); it streams structured output whether or not the inner client does
 * (through the `streamStructured` helper, which falls back to `complete`).
 */
import type { z } from "zod";
import type { RouteKey } from "./routing";
import { streamStructured } from "./structured-stream";
import type { CompleteRequest, CompleteResult, CompleteResultWithJson, ModelClient, ModelMode, StreamStructuredRequest, StreamStructuredResult, UsageAttribution } from "./types";

/** What the gate sees of a call: its route and who it is for. Throw to refuse it. */
export type ModelCallGate = (call: { route: RouteKey; attribution?: UsageAttribution }) => Promise<void>;

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
    await this.gate({ route: req.route, attribution: req.attribution });
    return this.inner.complete(req as CompleteRequest<unknown> & { schema?: undefined });
  }

  async streamStructured<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
    await this.gate({ route: req.route, attribution: req.attribution });
    return streamStructured(this.inner, req);
  }
}

export function gateModelClient(inner: ModelClient, gate: ModelCallGate): ModelClient {
  return new GatedModelClient(inner, gate);
}
