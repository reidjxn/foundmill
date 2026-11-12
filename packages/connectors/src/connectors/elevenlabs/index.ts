/**
 * Live ElevenLabs connector for Team call: text-to-speech and speech-to-text over the injected fetch (no SDK). Platform
 * key only (`ELEVENLABS_API_KEY`, held by the gateway). The key travels in the `xi-api-key` header and nowhere else: it
 * is never put in a URL, a log line, an error message or a tool result.
 */
import { uuid } from "@foundmill/shared";
import { SPEECH_MODELS } from "@foundmill/models";
import { ConfigError, VendorError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { resolveSpeechAccentIds, speechAccentId } from "./speech-accents";
import { elevenlabsMock } from "./mock";
import { decodedBytes, ELEVENLABS_BASE_URL, ELEVENLABS_KEY, ELEVENLABS_RATE_LIMITS, elevenlabsTools, OUTPUT_FORMAT, VOICE_SETTINGS, ASSUMED_AUDIO_BYTES_PER_SECOND } from "./tools";

/** Flash v2.5 answers in well under a second; a turn is spoken as it arrives, so a slow vendor is a failure, not a wait. */
const SPEECH_TIMEOUT_MS = 30_000;
/** A recording of up to 8 MiB takes a while to transcribe. */
const TRANSCRIPTION_TIMEOUT_MS = 90_000;
/** 600 characters at 64 kbps is well under 1 MB; anything near this is not speech. */
const MAX_AUDIO_RESPONSE_BYTES = 4 * 1024 * 1024;

/** ElevenLabs: `{ detail: { status, message } }`, or for a 422 `{ detail: [{ loc, msg, type }] }`. */
interface ElevenLabsErrorBody {
  detail?: { status?: string; message?: string } | { msg?: string; type?: string }[] | string;
}

interface TranscriptionResponse {
  language_code?: string;
  text?: string;
  audio_duration_secs?: number | null;
}

/**
 * Anything shaped like a key is masked before text from the vendor reaches an error (ElevenLabs keys are `sk_` plus hex),
 * and so is the configured key itself, wherever it appears.
 */
export const redactKeys = (text: string, key?: string): string => {
  const masked = text.replace(/\b(?:sk_|xi-)[A-Za-z0-9_*.-]+/g, "sk_…");
  return key && key.length >= 8 ? masked.split(key).join("sk_…") : masked;
};

/** A vendor status word kept only when it is a plain identifier (`quota_exceeded`, `invalid_api_key`). */
const STATUS_WORD = /^[a-z][a-z0-9_]{0,59}$/;

const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };

export function createElevenlabsConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  // Parsed once, here: the accent table does not change while the gateway runs.
  const accents = resolveSpeechAccentIds(secrets.elevenlabsSpeechAccentIds);
  let warned = false;
  const warnOnce = (ctx: ToolContext) => {
    if (warned) return;
    warned = true;
    for (const w of accents.warnings) ctx.log.warn({ connector: ELEVENLABS_KEY }, w);
  };
  const apiKey = (): string => {
    if (!secrets.elevenlabsApiKey) throw new ConfigError(ELEVENLABS_KEY, "ELEVENLABS_API_KEY");
    return secrets.elevenlabsApiKey;
  };
  const http = (timeoutMs?: number) => createHttp({ connectorKey: ELEVENLABS_KEY, baseUrl: ELEVENLABS_BASE_URL, fetch, ...(timeoutMs ? { timeoutMs } : {}) });

  /** The vendor's own status word and a short redacted message; the status decides retryability (429 and 5xx retry). */
  const sanitized = (e: VendorError, what: string): VendorError => {
    const detail = (e.body as ElevenLabsErrorBody | undefined)?.detail;
    let code: string | null = null;
    let message: string | undefined;
    if (Array.isArray(detail)) {
      message = detail[0] && "msg" in detail[0] ? detail[0].msg : undefined;
    } else if (detail && typeof detail === "object") {
      code = typeof detail.status === "string" && STATUS_WORD.test(detail.status) ? detail.status : null;
      message = detail.message;
    } else if (typeof detail === "string") {
      message = detail;
    }
    const text = [code, message && redactKeys(message, secrets.elevenlabsApiKey).slice(0, 200)].filter(Boolean).join(": ");
    return new VendorError(ELEVENLABS_KEY, e.httpStatus, `${what} → ${e.httpStatus}${text ? ` (${text})` : ""}`, { code });
  };

  return buildLiveConnector(
    {
      key: ELEVENLABS_KEY,
      displayName: "ElevenLabs",
      phase: 3,
      auth: { kind: "api_key", platformKey: true },
      tools: elevenlabsTools,
      rateLimits: ELEVENLABS_RATE_LIMITS,
      now,
      handlers: {
        synthesize_speech: async ({ speechAccent, text }, ctx) => {
          const key = apiKey();
          warnOnce(ctx);
          const voiceId = speechAccentId(speechAccent, accents.ids);
          if (!voiceId) throw new VendorError(ELEVENLABS_KEY, 400, `no id for the accent "${speechAccent}"`);
          const model = SPEECH_MODELS.call_speech;
          const res = await http(SPEECH_TIMEOUT_MS)
            .raw("POST", `/text-to-speech/${encodeURIComponent(voiceId)}`, { query: { output_format: OUTPUT_FORMAT }, headers: { "xi-api-key": key, accept: "audio/mpeg" }, body: { text, model_id: model, voice_settings: VOICE_SETTINGS } })
            .catch((e: unknown) => {
              throw e instanceof VendorError ? sanitized(e, "POST /text-to-speech") : e;
            });
          const type = res.headers.get("content-type") ?? "";
          const bytes = Buffer.from(await res.arrayBuffer());
          if (bytes.length === 0 || /json|text/i.test(type) || bytes.length > MAX_AUDIO_RESPONSE_BYTES) throw new VendorError(ELEVENLABS_KEY, 502, "POST /text-to-speech answered without usable audio");
          return { mime: "audio/mpeg" as const, base64: bytes.toString("base64"), characters: text.length, model };
        },
        transcribe_speech: async ({ mime, base64 }, ctx) => {
          const key = apiKey();
          warnOnce(ctx);
          const model = SPEECH_MODELS.call_transcription;
          const audio = Buffer.from(base64, "base64");
          const form = new FormData();
          form.set("model_id", model);
          form.set("tag_audio_events", "false");
          form.set("timestamps_granularity", "none");
          form.set("file", new Blob([new Uint8Array(audio)], { type: mime }), `recording.${EXTENSIONS[mime] ?? "bin"}`);
          const res = await http(TRANSCRIPTION_TIMEOUT_MS)
            .json<TranscriptionResponse>("POST", "/speech-to-text", { headers: { "xi-api-key": key }, body: form })
            .catch((e: unknown) => {
              throw e instanceof VendorError ? sanitized(e, "POST /speech-to-text") : e;
            });
          if (!res || typeof res.text !== "string") throw new VendorError(ELEVENLABS_KEY, 502, "POST /speech-to-text answered without a transcript");
          // The vendor's own length when it gives one; else the recording's size at the assumed rate (an estimate).
          const seconds = typeof res.audio_duration_secs === "number" && res.audio_duration_secs >= 0 ? res.audio_duration_secs : decodedBytes(base64) / ASSUMED_AUDIO_BYTES_PER_SECOND;
          return { text: res.text.trim(), languageCode: typeof res.language_code === "string" ? res.language_code : "", durationSeconds: Math.round(seconds * 10) / 10, model };
        },
      },
      connect: async (businessId) => {
        await http().json("GET", "/models", { headers: { "xi-api-key": apiKey() } });
        const createdAt = now().toISOString();
        return { id: uuid(), businessId, connectorKey: ELEVENLABS_KEY, status: "connected", scopes: [], accountLabel: "ElevenLabs (platform)", externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          // Listing the models costs nothing; a health check never speaks.
          await http().json("GET", "/models", { headers: { "xi-api-key": apiKey() } });
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? redactKeys(e.message, secrets.elevenlabsApiKey) : String(e) });
        }
      },
    },
    elevenlabsMock,
  );
}

export { elevenlabsMock, silentWav, estimateSpeakingMs, MOCK_SPEECH_MODEL, MOCK_TRANSCRIPTION_MODEL, MOCK_SAMPLE_RATE } from "./mock";
export { elevenlabsTools, ELEVENLABS_KEY, estimateSpeechCostMinor, estimateTranscriptionCostMinor, decodedBytes, SynthesizeSpeechInput, SynthesizeSpeechOutput, TranscribeSpeechInput, TranscribeSpeechOutput, OUTPUT_FORMAT } from "./tools";
export { SPEECH_ACCENT_IDS, resolveSpeechAccentIds, speechAccentId } from "./speech-accents";
/** How long the live connector waits for ElevenLabs; the api's wait for the gateway must be longer. */
export { SPEECH_TIMEOUT_MS as ELEVENLABS_SPEECH_TIMEOUT_MS, TRANSCRIPTION_TIMEOUT_MS as ELEVENLABS_TRANSCRIPTION_TIMEOUT_MS };
