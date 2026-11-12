/**
 * Streamed speech for Team call: ElevenLabs' `POST /text-to-speech/{voice_id}/stream` answers MP3 bytes as they are made,
 * so the call can start playing an agent's turn within about a second instead of after the whole turn is rendered
 * (13 to 18 seconds measured on the first production call with the buffered endpoint). Not a tool: the agent tool
 * contract answers one JSON result, and a stream is the gateway's own service path (`POST /v1/speech/stream`). Same
 * platform key, accent table and key discipline as the connector (`index.ts`): the key only in the `xi-api-key` header,
 * never in a URL, a log line, an error or a result.
 */
import { SPEECH_MODELS } from "@foundmill/models";
import { ConfigError, VendorError } from "../../contract";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { redactKeys } from "./index";
import { resolveSpeechAccentIds, speechAccentId } from "./speech-accents";
import { ELEVENLABS_BASE_URL, ELEVENLABS_KEY, OUTPUT_FORMAT, VOICE_SETTINGS } from "./tools";

/** How long the vendor may take to start answering; once bytes flow, the stream runs as long as the turn. */
export const SPEECH_FIRST_BYTE_TIMEOUT_MS = 15_000;

export interface SpeechStreamInput {
  speechAccent: string;
  text: string;
}

export interface SpeechStream {
  body: ReadableStream<Uint8Array>;
  mime: "audio/mpeg";
  model: string;
  characters: number;
}

export interface SpeechStreamer {
  /** Starts one turn's speech; rejects with a VendorError (the vendor refused, or did not start in time) or a ConfigError (no key). */
  stream(input: SpeechStreamInput, signal?: AbortSignal): Promise<SpeechStream>;
}

export function createElevenlabsSpeechStreamer(options: LiveConnectorOptions = {}): SpeechStreamer {
  const { secrets, fetch } = resolveLiveOptions(options);
  const accents = resolveSpeechAccentIds(secrets.elevenlabsSpeechAccentIds);
  return {
    async stream({ speechAccent, text }, signal) {
      const key = secrets.elevenlabsApiKey;
      if (!key) throw new ConfigError(ELEVENLABS_KEY, "ELEVENLABS_API_KEY");
      const voiceId = speechAccentId(speechAccent, accents.ids);
      if (!voiceId) throw new VendorError(ELEVENLABS_KEY, 400, `no id for the accent "${speechAccent}"`);
      const model = SPEECH_MODELS.call_speech;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SPEECH_FIRST_BYTE_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let res: Response;
      try {
        const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
        res = (await fetch(url, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }), signal: controller.signal })) as Response;
      } catch (e) {
        throw new VendorError(ELEVENLABS_KEY, 504, `POST /text-to-speech/stream did not start (${redactKeys(e instanceof Error ? e.name : "error", key)})`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: { status?: string; message?: string } | string } | null;
        const detail = body?.detail;
        const code = detail && typeof detail === "object" && typeof detail.status === "string" && /^[a-z][a-z0-9_]{0,59}$/.test(detail.status) ? detail.status : null;
        const message = detail && typeof detail === "object" ? detail.message : typeof detail === "string" ? detail : undefined;
        throw new VendorError(ELEVENLABS_KEY, res.status, `POST /text-to-speech/stream → ${res.status}${message ? ` (${redactKeys(message, key).slice(0, 200)})` : ""}`, { code });
      }
      const type = res.headers.get("content-type") ?? "";
      if (!res.body || /json|text/i.test(type)) throw new VendorError(ELEVENLABS_KEY, 502, "POST /text-to-speech/stream answered without audio");
      // The caller's abort (the listener left) ends the vendor's stream too.
      signal?.addEventListener("abort", () => void res.body?.cancel().catch(() => undefined), { once: true });
      return { body: res.body, mime: "audio/mpeg", model, characters: text.length };
    },
  };
}
