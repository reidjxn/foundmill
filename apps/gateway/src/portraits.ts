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

/** A vendor's own code (`moderation_blocked`), kept only when it is a plain identifier; never its message. */
const VENDOR_CODE = /^[a-z][a-z0-9_]{0,59}$/;

export interface PortraitFailure {
  code: "portrait_refused" | "portrait_rate_limited" | "portrait_unavailable";
  message: string;
  status: number;
  details: { vendorStatus: number | null; vendorCode: string | null };
}

/**
 * What the api is told when the image vendor did not make the portrait: a code, a status and a fixed sentence, never the
 * vendor's own words (they can quote the request or, in a bad-key answer, a masked key). The status says what the api
 * should do: 422 `portrait_refused` (the vendor refused this prompt: moderation, a bad request) will never succeed for the
 * key, so it is not retried; 429 waits; 502 (the vendor failed, or refused the platform key) is retried with backoff.
 */
export function portraitFailure(error: { code?: string; status?: number; details?: unknown } | undefined): PortraitFailure {
  const vendorStatus = typeof error?.status === "number" ? error.status : null;
  const raw = (error?.details as { code?: unknown; type?: unknown } | undefined) ?? {};
  const candidate = typeof raw.code === "string" ? raw.code : typeof raw.type === "string" ? raw.type : null;
  const details = { vendorStatus, vendorCode: candidate && VENDOR_CODE.test(candidate) ? candidate : null };
  if (vendorStatus === 429 || error?.code === "rate_limited") return { code: "portrait_rate_limited", message: "The image service is busy. Try again later.", status: 429, details };
  // A refused platform key (401, 403) is the gateway's configuration, not this persona: retried once it is fixed.
  if (vendorStatus !== null && vendorStatus >= 400 && vendorStatus < 500 && vendorStatus !== 401 && vendorStatus !== 403 && vendorStatus !== 408) {
    return { code: "portrait_refused", message: "The image service refused to make this portrait.", status: 422, details };
  }
  return { code: "portrait_unavailable", message: "The portrait could not be generated right now.", status: 502, details };
}

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
    const failure = portraitFailure(result.error);
    deps.log.warn({ personaKey: persona.key, code: result.error?.code, status: result.error?.status, vendorCode: failure.details.vendorCode }, "persona portrait refused");
    throw new GatewayError(failure.code, failure.message, failure.status, failure.details);
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
