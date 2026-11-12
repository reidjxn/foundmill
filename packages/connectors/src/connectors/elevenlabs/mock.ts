/**
 * Mock ElevenLabs: deterministic and offline, so INTEGRATIONS_MODE=mock runs a whole Team call with no key and no network.
 * `synthesize_speech` returns a silent mono 16 kHz WAV as long as the words would take to say (150 words a minute, at
 * least 600 ms) so the call's timing is believable, and `transcribe_speech` hears nothing (the web then uses the
 * browser's own recognizer). Every answer says `simulated: true`; it is never presented as real speech.
 */
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { ELEVENLABS_KEY, ELEVENLABS_RATE_LIMITS, elevenlabsTools } from "./tools";

export const MOCK_SPEECH_MODEL = "mock-speech";
export const MOCK_TRANSCRIPTION_MODEL = "mock-transcription";

export const MOCK_SAMPLE_RATE = 16_000;
const WORDS_PER_MINUTE = 150;
const MIN_SPEAKING_MS = 600;

/** How long the words take to say, in ms: 150 words a minute, never under 600 ms. */
export function estimateSpeakingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_SPEAKING_MS, Math.round((words / WORDS_PER_MINUTE) * 60_000));
}

/** A valid RIFF/WAVE file of silence: 16-bit PCM, mono, 16 kHz, `durationMs` long (44-byte header, then zeroed samples). */
export function silentWav(durationMs: number, sampleRate = MOCK_SAMPLE_RATE): Buffer {
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const dataBytes = samples * 2;
  const out = Buffer.alloc(44 + dataBytes); // the samples stay zero: silence
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16); // fmt chunk size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28); // byte rate
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits per sample
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  return out;
}

export const elevenlabsMock = buildMockConnector({
  key: ELEVENLABS_KEY,
  displayName: "ElevenLabs",
  phase: 3,
  auth: { kind: "api_key", platformKey: true },
  tools: elevenlabsTools,
  rateLimits: ELEVENLABS_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    synthesize_speech: async ({ text }) => ({ mime: "audio/wav" as const, base64: silentWav(estimateSpeakingMs(text)).toString("base64"), characters: text.length, model: MOCK_SPEECH_MODEL, simulated: true as const }),
    transcribe_speech: async () => ({ text: "", languageCode: "", durationSeconds: 0, model: MOCK_TRANSCRIPTION_MODEL, simulated: true as const }),
  },
  connect: async (businessId) => mockIntegrationRecord(ELEVENLABS_KEY, businessId, { accountLabel: "ElevenLabs (platform, mock)" }),
  healthcheck: async () => mockHealth(ELEVENLABS_KEY),
});
