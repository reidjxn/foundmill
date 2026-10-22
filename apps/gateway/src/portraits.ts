/**
 * `POST /v1/personas/portrait` (Anthropomorphic agents): the AI-generated face for one persona catalog key. Only the api
 * asks (service token `svc: api`). The request carries a catalog key and nothing else the image depends on: the gateway
 * builds the prompt itself with `personaPortraitPrompt`, so the api (or anything that steals its token) can never send
 * the image vendor an arbitrary prompt. The `openai_images` connector runs here, the one service holding OPENAI_API_KEY
 * (live, when INTEGRATIONS_MODE=live or LIVE_CONNECTORS names `openai_images`), or its deterministic placeholder in mock mode.
 *
 * A portrait is a platform asset (at most one per catalog key, 240 ever), so the rate limit is the platform's own window
 * on the connector (`rl:platform:openai_images`) rather than a business's. The key is logged, never the prompt or the
 * image; a business id is optional and only attributes the audit row to the business whose agents needed the face.
 */
import { z } from "zod";
import { isConfigError, mockIntegrationRecord, OPENAI_IMAGES_KEY, type ToolContext } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { personaByKey, personaPortraitPrompt } from "@foundmill/shared";
import { GatewayError, modeFor, type GatewayDeps } from "./pipeline";
import { checkRateLimit } from "./rate-limit";

export const PortraitRequest = z.object({
  /** A key of the persona catalog (`PERSONAS`); anything else is a 400. */
  personaKey: z.string().min(1).max(80),
  /** The business whose agents need the face: only attributes the audit row. */
  businessId: z.guid().optional(),
});
export type PortraitRequest = z.infer<typeof PortraitRequest>;

export interface PortraitResponse {
  mime: "image/webp" | "image/png";
  base64: string;
  model: string;
}

const PortraitData = z.object({ mime: z.enum(["image/webp", "image/png"]), base64: z.string().min(1), model: z.string().min(1) });

/** The platform-wide scope of the rate limit and the tool context (there is no business behind a portrait). */
export const PORTRAIT_SCOPE = "platform";
const NIL_ID = "00000000-0000-0000-0000-000000000000";
/** The same ceiling the api's table enforces (persona_portraits check, 8 MiB). */
const MAX_PORTRAIT_BYTES = 8 * 1024 * 1024;

export async function generatePortrait(deps: GatewayDeps, input: PortraitRequest, service: string): Promise<PortraitResponse> {
  const persona = personaByKey(input.personaKey);
  if (!persona) throw new GatewayError("unknown_persona", "That is not a persona in the catalog", 400);
  const now = deps.now?.() ?? new Date();
  const mode = modeFor(deps, OPENAI_IMAGES_KEY);
  const connector = deps.registry.get(OPENAI_IMAGES_KEY, mode);
  const limit = await checkRateLimit(deps.rateLimits, { businessId: PORTRAIT_SCOPE, connector: OPENAI_IMAGES_KEY, limits: connector.rateLimits ?? {} }, now.getTime());
  if (!limit.allowed) {
    throw new GatewayError("rate_limited", `Too many portraits requested. Try again in ${limit.retryAfterSeconds} seconds.`, 429, { retryAfterSeconds: limit.retryAfterSeconds, scope: limit.scope, limit: limit.limit });
  }
  const ctx: ToolContext = { businessId: input.businessId ?? NIL_ID, agentId: NIL_ID, sessionId: NIL_ID, integration: mockIntegrationRecord(OPENAI_IMAGES_KEY, input.businessId ?? NIL_ID), log: deps.log, mode };
  let result;
  try {
    result = await connector.callTool("generate_image", { prompt: personaPortraitPrompt(persona), size: "1024x1024", quality: "medium" }, ctx);
  } catch (e) {
    if (isConfigError(e)) throw new GatewayError("portraits_unconfigured", "Portraits are not set up on this server yet (OPENAI_API_KEY is missing on the gateway)", 503);
    throw e;
  }
  if (!result.ok) {
    deps.log.warn({ personaKey: persona.key, code: result.error?.code, status: result.error?.status }, "persona portrait refused");
    throw new GatewayError("portrait_unavailable", `The portrait could not be generated: ${result.error?.message ?? "unknown error"}`, 502);
  }
  const data = PortraitData.safeParse(result.data);
  if (!data.success || Math.floor((data.data.base64.length * 3) / 4) > MAX_PORTRAIT_BYTES) {
    throw new GatewayError("portrait_unavailable", "The image service sent back something that is not a usable portrait", 502);
  }
  deps.log.info({ personaKey: persona.key, mode, model: data.data.model }, "persona portrait generated");
  if (input.businessId) {
    // Best effort and attributed: a business that is gone, or an audit write that fails, must not lose a paid-for image.
    await repos.audit
      .append(deps.db, input.businessId, { actorKind: "system", action: "gateway.persona_portrait.generated", target: { kind: "persona_portrait", id: persona.key }, details: { service, mode, model: data.data.model, label: "Estimate", costEstimateMinor: result.costMinor } })
      .catch((e: unknown) => deps.log.warn({ personaKey: persona.key, reason: e instanceof Error ? e.name : "unknown" }, "persona portrait audit not written"));
  }
  return data.data;
}
