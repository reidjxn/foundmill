/**
 * Live OpenAI Images connector: `POST https://api.openai.com/v1/images/generations` over the injected fetch (no SDK).
 * Platform key only (`OPENAI_API_KEY`, held by the gateway). The key travels in the Authorization header and nowhere
 * else: it is never put in a URL, a log line, an error message or a tool result.
 */
import { uuid } from "@foundmill/shared";
import { IMAGE_MODELS } from "@foundmill/models";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { openaiImagesMock } from "./mock";
import { OPENAI_IMAGES_BASE_URL, OPENAI_IMAGES_KEY, OPENAI_IMAGES_RATE_LIMITS, openaiImagesTools, OUTPUT_COMPRESSION } from "./tools";

/** A portrait takes 10 to 60 seconds to render; the shared client's default 20 s would cut most of them off. */
const GENERATION_TIMEOUT_MS = 120_000;

interface ImagesResponse {
  data?: { b64_json?: string }[];
}

interface OpenAiErrorBody {
  error?: { message?: string; type?: string; code?: string | null };
}

/**
 * Anything shaped like a key is masked before text from the vendor reaches an error, a masked one too: OpenAI's
 * bad-key answer quotes the key as `sk-proj-****…abcd`, whose visible tail is still part of the secret.
 */
export const redactKeys = (text: string): string => text.replace(/\bsk-[A-Za-z0-9_*.-]+/g, "sk-…");

export function createOpenaiImagesConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const apiKey = (): string => {
    if (!secrets.openaiApiKey) throw new ConfigError(OPENAI_IMAGES_KEY, "OPENAI_API_KEY");
    return secrets.openaiApiKey;
  };
  const http = (timeoutMs?: number) => createHttp({ connectorKey: OPENAI_IMAGES_KEY, baseUrl: OPENAI_IMAGES_BASE_URL, fetch, ...(timeoutMs ? { timeoutMs } : {}) });

  /** The vendor's own words, minus anything key-shaped; the status decides retryability (429 and 5xx retry). */
  const sanitized = (e: VendorError): VendorError => {
    const err = (e.body as OpenAiErrorBody | undefined)?.error;
    const detail = [err?.code ?? err?.type, err?.message && redactKeys(err.message).slice(0, 200)].filter(Boolean).join(": ");
    return new VendorError(OPENAI_IMAGES_KEY, e.httpStatus, `POST /images/generations → ${e.httpStatus}${detail ? ` (${detail})` : ""}`, err ? { code: err.code ?? null, type: err.type ?? null } : undefined);
  };

  return buildLiveConnector(
    {
      key: OPENAI_IMAGES_KEY,
      displayName: "OpenAI Images",
      phase: 1,
      auth: { kind: "api_key", platformKey: true },
      tools: openaiImagesTools,
      rateLimits: OPENAI_IMAGES_RATE_LIMITS,
      now,
      handlers: {
        generate_image: async ({ prompt, size, quality }) => {
          const key = apiKey();
          const model = IMAGE_MODELS.portrait_image;
          const res = await http(GENERATION_TIMEOUT_MS)
            .json<ImagesResponse>("POST", "/images/generations", { headers: { authorization: bearer(key) }, body: { model, prompt, n: 1, size, quality, output_format: "webp", output_compression: OUTPUT_COMPRESSION } })
            .catch((e: unknown) => {
              throw e instanceof VendorError ? sanitized(e) : e;
            });
          const base64 = res?.data?.[0]?.b64_json;
          if (typeof base64 !== "string" || base64.length === 0) throw new VendorError(OPENAI_IMAGES_KEY, 502, "POST /images/generations answered without an image");
          return { mime: "image/webp" as const, base64, model };
        },
      },
      connect: async (businessId) => {
        await http().json("GET", "/models/" + encodeURIComponent(IMAGE_MODELS.portrait_image), { headers: { authorization: bearer(apiKey()) } });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: OPENAI_IMAGES_KEY, status: "connected", scopes: [], accountLabel: "OpenAI Images (platform)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          // Reading the model record costs nothing; a health check never renders an image.
          await http().json("GET", "/models/" + encodeURIComponent(IMAGE_MODELS.portrait_image), { headers: { authorization: bearer(apiKey()) } });
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? redactKeys(e.message) : String(e) });
        }
      },
    },
    openaiImagesMock,
  );
}

export { openaiImagesMock, placeholderPortraitPng, MOCK_IMAGE_MODEL } from "./mock";
export { openaiImagesTools, OPENAI_IMAGES_KEY, estimateImageCostMinor } from "./tools";
/** How long the live connector waits for OpenAI to render one image; the api's wait for the gateway must be longer. */
export { GENERATION_TIMEOUT_MS as OPENAI_IMAGES_GENERATION_TIMEOUT_MS };
