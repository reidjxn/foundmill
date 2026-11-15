/**
 * Speech for Team call (docs/TEAM_CALL.md §3 and §5): what `teamCall.speech` and `teamCall.transcribe` call. Where the
 * `elevenlabs` connector runs live (`INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` naming it) the gateway speaks and
 * transcribes, on the platform key that lives only there, after its own checks (the accent, the words, the business's
 * window and its day of spoken characters). Where it runs its mock the api runs the mock itself and never calls the
 * gateway, like the domain checks and the portraits: the golden path needs no gateway. The mock's answer is a silent WAV
 * the call plays for timing (the browser's own speech says the words) and an empty transcript (the browser's recognizer
 * hears the founder); both say `simulated`, and `speechModes` carries the notice the call shows once.
 *
 * The api names a speech accent (`SPEECH_ACCENTS` key), never a vendor id, and only ever sends the words of one agent
 * turn it rendered itself or a recording the founder made on this call. The words and the audio are not logged here.
 */
import { elevenlabsMock, ELEVENLABS_KEY, mockIntegrationRecord } from "@foundmill/connectors";
import { AppError, connectorMode, TEAM_CALL_WORDS, type Env, type SpeechAccentKey, type TeamCallAudioMime, type TeamCallSpeechModes } from "@foundmill/shared";
import type { ApiGatewayClient } from "./gateway";

export interface SpeechDeps {
  env: Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">;
  gateway: ApiGatewayClient;
}

/** True when speech is real here (the gateway and ElevenLabs), false when the browser's own speech stands in. */
export const speechLive = (env: SpeechDeps["env"]): boolean => connectorMode(env, ELEVENLABS_KEY) === "live";

/** Whether speech and transcription are real here, and the sentence to show once when they are not. One connector serves both. */
export function speechModes(env: SpeechDeps["env"]): TeamCallSpeechModes {
  const mode = speechLive(env) ? "live" : "simulated";
  return { speech: mode, transcription: mode, notice: mode === "simulated" ? TEAM_CALL_WORDS.simulatedNotice : null };
}

export interface SynthesizeCallSpeechInput {
  businessId: string;
  callId: string;
  turnId: string;
  speechAccent: SpeechAccentKey;
  /** The words as the listener hears them: names already rendered (`spokenText`). 1 to 600 characters. */
  text: string;
}

export interface CallSpeech {
  mime: "audio/mpeg" | "audio/wav";
  base64: string;
  simulated: boolean;
}

export interface TranscribeCallSpeechInput {
  businessId: string;
  callId: string;
  mime: TeamCallAudioMime;
  base64: string;
}

export interface CallTranscript {
  text: string;
  simulated: boolean;
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Runs one of the mock's tools in this process; its own validation (accent, length, type, size) is a 400 here too. */
async function runMock(tool: "synthesize_speech" | "transcribe_speech", businessId: string, args: unknown): Promise<unknown> {
  const result = await elevenlabsMock.callTool(tool, args, { businessId, agentId: businessId, sessionId: businessId, integration: mockIntegrationRecord(ELEVENLABS_KEY, businessId), log: silent, mode: "mock" });
  if (!result.ok) {
    const invalid = result.error?.code === "invalid_args";
    throw new AppError(invalid ? "validation" : "speech_unavailable", invalid ? "That cannot be spoken or transcribed" : "Speech is not available right now.", invalid ? 400 : 502);
  }
  return result.data;
}

/** One agent turn spoken in its speech accent: the gateway when speech is live, else the mock's silent WAV. */
export async function synthesizeCallSpeech(deps: SpeechDeps, input: SynthesizeCallSpeechInput): Promise<CallSpeech> {
  if (speechLive(deps.env)) {
    const spoken = await deps.gateway.synthesizeSpeech(input);
    return { mime: spoken.mime, base64: spoken.base64, simulated: spoken.simulated };
  }
  const data = (await runMock("synthesize_speech", input.businessId, { speechAccent: input.speechAccent, text: input.text })) as { mime: "audio/wav"; base64: string };
  return { mime: data.mime, base64: data.base64, simulated: true };
}

/** What the founder said: the gateway when transcription is live, else the mock's empty transcript (the browser's recognizer is used instead). */
export async function transcribeCallSpeech(deps: SpeechDeps, input: TranscribeCallSpeechInput): Promise<CallTranscript> {
  if (speechLive(deps.env)) {
    const heard = await deps.gateway.transcribeSpeech(input);
    return { text: heard.text, simulated: heard.simulated };
  }
  const data = (await runMock("transcribe_speech", input.businessId, { mime: input.mime, base64: input.base64 })) as { text: string };
  return { text: data.text, simulated: true };
}
