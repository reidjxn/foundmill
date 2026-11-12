/**
 * ElevenLabs for Team call (docs/TEAM_CALL.md §3): an agent's spoken turn (`synthesize_speech`) and what the founder said
 * (`transcribe_speech`). Platform key only (`ELEVENLABS_API_KEY` on the gateway), service-only: the platform's gateway
 * routes call it, no agent session does. API shapes checked against ElevenLabs' docs on Nov 12, 2026 (text-to-speech
 * convert, speech-to-text convert).
 */
import { z } from "zod";
import { isSpeechAccentKey, TEAM_CALL_AUDIO_MIMES, TEAM_CALL_LIMITS } from "@foundmill/shared";
import { defineTool } from "../../define";

export const ELEVENLABS_KEY = "elevenlabs";
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

/** MP3, 44.1 kHz, 64 kbps: clear speech at half the bytes of the default 128 kbps (the api sends it as base64). */
export const OUTPUT_FORMAT = "mp3_44100_64";
export const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, speed: 1 } as const;

export const SPEECH_MIMES = ["audio/mpeg", "audio/wav"] as const;

/** The longest base64 string whose decoded size can still be within the audio limit (4 characters per 3 bytes, padded). */
const MAX_BASE64_CHARS = Math.ceil(TEAM_CALL_LIMITS.maxAudioBytes / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded size of a base64 string, without decoding it. */
export const decodedBytes = (base64: string): number => Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);

export const SynthesizeSpeechInput = z.object({
  speechAccent: z.string().refine(isSpeechAccentKey, "unknown accent"),
  text: z.string().trim().min(1).max(TEAM_CALL_LIMITS.maxTurnChars),
});
export type SynthesizeSpeechInput = z.output<typeof SynthesizeSpeechInput>;

export const SynthesizeSpeechOutput = z.object({
  mime: z.enum(SPEECH_MIMES),
  base64: z.string().min(1),
  /** What the vendor bills by: the characters sent. */
  characters: z.number().int().min(1),
  model: z.string().min(1),
  /** Present (true) only on the mock's answer: nothing was said by a real speech service. */
  simulated: z.literal(true).optional(),
});
export type SynthesizeSpeechOutput = z.output<typeof SynthesizeSpeechOutput>;

export const TranscribeSpeechInput = z.object({
  mime: z.enum(TEAM_CALL_AUDIO_MIMES),
  base64: z
    .string()
    .min(1)
    .max(MAX_BASE64_CHARS)
    .refine((v) => BASE64.test(v) && v.length % 4 === 0, "not base64")
    .refine((v) => decodedBytes(v) <= TEAM_CALL_LIMITS.maxAudioBytes, "recording too large"),
});
export type TranscribeSpeechInput = z.output<typeof TranscribeSpeechInput>;

export const TranscribeSpeechOutput = z.object({
  text: z.string(),
  languageCode: z.string(),
  durationSeconds: z.number().min(0),
  model: z.string().min(1),
  simulated: z.literal(true).optional(),
});
export type TranscribeSpeechOutput = z.output<typeof TranscribeSpeechOutput>;

/**
 * Cost Estimate (not an invoice), in USD cents. Flash v2.5 is ElevenLabs' lower-cost real-time model: about $0.05 per
 * 1,000 characters on the API plans (their pricing page, Nov 12, 2026), so 0.005 cents a character, rounded up to a whole
 * cent per call. Scribe v3 is about $0.40 an hour of audio; the length is not known before the call, so it is taken from
 * the recording's size at about 16 KB a second (opus speech) and floored at a cent. Config, not a quote: change the
 * constants when the price list changes.
 */
export const SPEECH_USD_CENTS_PER_CHARACTER = 0.005;
export const TRANSCRIPTION_USD_CENTS_PER_HOUR = 40;
export const ASSUMED_AUDIO_BYTES_PER_SECOND = 16_000;
export const estimateSpeechCostMinor = (characters: number): number => Math.max(1, Math.ceil(characters * SPEECH_USD_CENTS_PER_CHARACTER));
export const estimateTranscriptionCostMinor = (audioBytes: number): number => Math.max(1, Math.ceil(((audioBytes / ASSUMED_AUDIO_BYTES_PER_SECOND) / 3600) * TRANSCRIPTION_USD_CENTS_PER_HOUR));

export const elevenlabsTools = [
  defineTool({
    name: "synthesize_speech",
    description: `Speak one agent turn (at most ${TEAM_CALL_LIMITS.maxTurnChars} characters) in an accent. Returns the audio as base64 with its mime type, the characters billed and the model. Cost is an estimate.`,
    input: SynthesizeSpeechInput,
    output: SynthesizeSpeechOutput,
    // Metered platform spend, never the business's money (like openai_images and embeddings). Nothing leaves the platform
    // except the words, to the speech vendor; nobody outside the project is contacted.
    hints: { spendsMoney: true, contactsThirdParty: false, requiresKitMode: false, irreversible: false },
    annotations: { readOnlyHint: false, idempotentHint: false },
    costMinor: (args) => estimateSpeechCostMinor(args.text.length),
  }),
  defineTool({
    name: "transcribe_speech",
    description: `Transcribe a recording of the founder (at most ${TEAM_CALL_LIMITS.maxAudioBytes / 1024 / 1024} MiB). Returns the words, the language and the length in seconds. Cost is an estimate.`,
    input: TranscribeSpeechInput,
    output: TranscribeSpeechOutput,
    hints: { spendsMoney: true, contactsThirdParty: false, requiresKitMode: false, irreversible: false },
    annotations: { readOnlyHint: false, idempotentHint: false },
    costMinor: (args) => estimateTranscriptionCostMinor(decodedBytes(args.base64)),
  }),
] as const;

/** One business, for a call each: a turn is spoken as it arrives. The day's characters have their own ceiling in the gateway. */
export const ELEVENLABS_RATE_LIMITS = { perMinute: 60, perDay: 3000 };
