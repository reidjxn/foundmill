/**
 * Live ElevenLabs connector on the founder's own key (voiceover for ready-to-post videos), over the injected fetch
 * (no SDK). The key comes from the connect form and then from `ctx.credential`, and nowhere else: this file never
 * reads `secrets`, never names `ELEVENLABS_API_KEY`, and imports nothing from the platform `elevenlabs` connector
 * (Team call speech on Foundmill's own key), so no configuration of the gateway can make it speak on the platform's
 * account. Not connected means not connected. The key travels in the `xi-api-key` header and nowhere else; vendor
 * failures are rebuilt from the status and a plain status word, never the vendor's text. NO WEBHOOKS: text-to-speech
 * answers in the same call.
 */
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { elevenlabsVoiceMock } from "./mock";
import { approxSeconds, ELEVENLABS_VOICE_BASE_URL, ELEVENLABS_VOICE_CONNECT_FIELDS, ELEVENLABS_VOICE_KEY, ELEVENLABS_VOICE_RATE_LIMITS, elevenlabsVoiceTools, mapVoices, MAX_AUDIO_BYTES, OUTPUT_FORMAT, VOICE_ID_RE, VOICE_SETTINGS, VOICEOVER_MODEL, type VoicesResponse } from "./tools";

/** A minute of speech takes a few seconds to make. */
const SPEECH_TIMEOUT_MS = 60_000;

/** ElevenLabs keys are `sk_` plus hex. Anything key-shaped, and the key in hand, is masked out of vendor text. */
export const redactKeys = (text: string, secret?: string): string => {
  const masked = secret && secret.length >= 8 ? text.split(secret).join("sk_…") : text;
  return masked.replace(/\b(?:sk_|xi-)[A-Za-z0-9_*.-]+/g, "sk_…");
};

/** A vendor status word kept only when it is a plain identifier (`quota_exceeded`, `invalid_api_key`). */
const STATUS_WORD = /^[a-z][a-z0-9_]{0,59}$/;

export function createElevenlabsVoiceConnector(options: LiveConnectorOptions = {}): Connector {
  // Deliberately only `fetch` and `now`: the platform secrets are not looked at.
  const { fetch, now } = resolveLiveOptions(options);

  const missingKey = () => new ConfigError(ELEVENLABS_VOICE_KEY, "the business's own ElevenLabs API key", "connect ElevenLabs in Settings › Integrations");

  const http = (secret: string, timeoutMs?: number) => createHttp({ connectorKey: ELEVENLABS_VOICE_KEY, baseUrl: ELEVENLABS_VOICE_BASE_URL, fetch, headers: { "xi-api-key": secret }, ...(timeoutMs ? { timeoutMs } : {}) });

  /** The status, and the vendor's own status word when it is a plain identifier. The vendor's message can quote the script. */
  const sanitized = (e: VendorError, what: string): VendorError => {
    const detail = (e.body as { detail?: { status?: unknown } } | undefined)?.detail;
    const word = detail && typeof detail === "object" && !Array.isArray(detail) && typeof detail.status === "string" && STATUS_WORD.test(detail.status) ? detail.status : null;
    return new VendorError(ELEVENLABS_VOICE_KEY, e.httpStatus, `${what} → ${e.httpStatus}${word ? ` (${word})` : ""}`, { code: word });
  };
  const guard = (what: string) => (e: unknown): never => {
    throw e instanceof VendorError ? sanitized(e, what) : e;
  };

  /** Listing the models costs nothing and is the check used for connecting and for health. */
  const checkKey = async (secret: string) => {
    await http(secret).json("GET", "/v1/models").catch(guard("GET /v1/models"));
  };

  return buildLiveConnector(
    {
      key: ELEVENLABS_VOICE_KEY,
      displayName: "ElevenLabs (your account)",
      phase: 3,
      auth: { kind: "api_key" },
      tools: elevenlabsVoiceTools,
      rateLimits: ELEVENLABS_VOICE_RATE_LIMITS,
      now,
      handlers: {
        list_voices: async ({ search, limit }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const res = await http(secret).json<VoicesResponse>("GET", "/v2/voices", { query: { page_size: limit, ...(search ? { search } : {}) } }).catch(guard("GET /v2/voices"));
          return { voices: mapVoices(res, limit) };
        },
        generate_voiceover: async ({ text, voiceId }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const configured = ctx.integration.config.voiceId;
          const voice = voiceId ?? (typeof configured === "string" && VOICE_ID_RE.test(configured) ? configured : null);
          if (!voice) throw new AppError("invalid_args", "No voice chosen: pass a voiceId from list_voices, or set a default voice when connecting ElevenLabs.", 400);
          const res = await http(secret, SPEECH_TIMEOUT_MS)
            .raw("POST", `/v1/text-to-speech/${encodeURIComponent(voice)}`, { query: { output_format: OUTPUT_FORMAT }, headers: { accept: "audio/mpeg" }, body: { text, model_id: VOICEOVER_MODEL, voice_settings: VOICE_SETTINGS } })
            .catch(guard("POST /v1/text-to-speech"));
          const type = res.headers.get("content-type") ?? "";
          const bytes = Buffer.from(await res.arrayBuffer());
          if (bytes.length === 0 || /json|text/i.test(type) || bytes.length > MAX_AUDIO_BYTES) throw new VendorError(ELEVENLABS_VOICE_KEY, 502, "POST /v1/text-to-speech answered without usable audio");
          return { mime: "audio/mpeg" as const, base64: bytes.toString("base64"), bytes: bytes.length, characters: text.length, approxSeconds: approxSeconds(text.length), voiceId: voice, model: VOICEOVER_MODEL };
        },
      },
      connectFields: ELEVENLABS_VOICE_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(ELEVENLABS_VOICE_KEY, "apiKey", "Enter your ElevenLabs API key to connect ElevenLabs");
        const voiceId = connectInputValue(input, "voiceId");
        if (voiceId && !VOICE_ID_RE.test(voiceId)) throw new ConnectInputError(ELEVENLABS_VOICE_KEY, "voiceId", "A voice ID is letters and digits only; copy it from your Voices page");
        await checkKey(apiKey);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: ELEVENLABS_VOICE_KEY,
          status: "connected",
          scopes: [],
          accountLabel: "ElevenLabs",
          externalAccountId: null,
          config: voiceId ? { voiceId } : {},
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (_integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        const secret = credential?.secret;
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No ElevenLabs API key is connected" });
        try {
          await checkKey(secret);
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    elevenlabsVoiceMock,
  );
}

export { elevenlabsVoiceMock } from "./mock";
export { elevenlabsVoiceTools, ELEVENLABS_VOICE_KEY, estimateVoiceoverCostMinor } from "./tools";
