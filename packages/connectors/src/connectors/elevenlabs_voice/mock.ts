/**
 * Mock voiceover: deterministic and offline. The "audio" is a silent WAV as long as the script would take to say, so a
 * mock-generated voiceover is plainly not speech, and every answer says `simulated: true` with a notice. Nothing here
 * imports the platform `elevenlabs` connector.
 */
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { approxSeconds, ELEVENLABS_VOICE_KEY, ELEVENLABS_VOICE_RATE_LIMITS, elevenlabsVoiceTools, VOICE_ID_RE } from "./tools";

export const MOCK_NOTICE = "Simulated: this is silence, not a voice. No speech was made and nothing was spent at ElevenLabs.";
export const MOCK_MODEL = "mock-voiceover";
export const MOCK_VOICE_ID = "MockVoiceNorthwind01";
const SAMPLE_RATE = 8_000;

/** A valid RIFF/WAVE file of silence: 16-bit PCM, mono, `seconds` long. */
export function silentWav(seconds: number): Buffer {
  const samples = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const dataBytes = samples * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  return out;
}

const VOICES = [
  { voiceId: MOCK_VOICE_ID, name: "Sample Warm", category: "premade", description: "A fixture voice for the mock." },
  { voiceId: "MockVoiceNorthwind02", name: "Sample Bright", category: "premade", description: "A second fixture voice for the mock." },
];

export const elevenlabsVoiceMock = buildMockConnector({
  key: ELEVENLABS_VOICE_KEY,
  displayName: "ElevenLabs (your account)",
  phase: 3,
  auth: { kind: "api_key" },
  tools: elevenlabsVoiceTools,
  rateLimits: ELEVENLABS_VOICE_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    list_voices: async ({ search, limit }) => {
      const needle = search?.toLowerCase();
      return { voices: VOICES.filter((v) => !needle || v.name.toLowerCase().includes(needle)).slice(0, limit), simulated: true as const, notice: MOCK_NOTICE };
    },
    generate_voiceover: async ({ text, voiceId }, ctx) => {
      const configured = ctx.integration.config.voiceId;
      const voice = voiceId ?? (typeof configured === "string" && VOICE_ID_RE.test(configured) ? configured : MOCK_VOICE_ID);
      const seconds = approxSeconds(text.length);
      const wav = silentWav(seconds);
      return { mime: "audio/wav" as const, base64: wav.toString("base64"), bytes: wav.length, characters: text.length, approxSeconds: seconds, voiceId: voice, model: MOCK_MODEL, simulated: true as const, notice: MOCK_NOTICE };
    },
  },
  connect: async (businessId) => mockIntegrationRecord(ELEVENLABS_VOICE_KEY, businessId, { accountLabel: "ElevenLabs (mock)" }),
  healthcheck: async () => mockHealth(ELEVENLABS_VOICE_KEY),
});
