/**
 * Speech for Team call (services/speech.ts): where `elevenlabs` runs its mock the api answers itself, with no gateway
 * (a silent WAV and an empty transcript, both simulated); where it runs live the api asks the gateway, which holds the
 * key, maps the speech accent to the vendor's id and makes the checks. The api names an accent, never a vendor id.
 */
import { createElevenlabsConnector, createRegistry, ELEVENLABS_SPEECH_TIMEOUT_MS, ELEVENLABS_TRANSCRIPTION_TIMEOUT_MS, jsonResponse, routedFetch, SPEECH_ACCENT_IDS } from "@foundmill/connectors";
import { SPEECH_ACCENTS, TEAM_CALL_WORDS } from "@foundmill/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SPEECH_CLIENT_TIMEOUT_MS, TRANSCRIBE_CLIENT_TIMEOUT_MS } from "../services/gateway";
import { speechModes, synthesizeCallSpeech, transcribeCallSpeech, type SpeechDeps } from "../services/speech";
import { createApiHarness, type ApiHarness } from "./harness";
import { inProcessGateway, type InProcessGateway } from "./gateway-double";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "speech-service" });
}, 120_000);
afterAll(() => hz.close());
afterEach(() => vi.unstubAllGlobals());

const KEY = "sk_api_test_speech_key_0123456789";
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0xff, 0xfb, 0x90, 0x64]);
const TEXT = "Let's start with the launch email, then the pricing page.";
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const RECORDING = Buffer.from("the founder, talking").toString("base64");
const MOCK_ENV = { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" } as const;
const LIVE_ENV = { INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "elevenlabs" } as const;

interface Seen {
  path: string;
  apiKey: string | null;
  body?: Record<string, unknown>;
  form?: Record<string, FormDataEntryValue>;
}

/** The api's real gateway client over an in-process gateway whose ElevenLabs is canned; the process's own fetch reaches nothing. */
function liveSetup(key: string | null = KEY, status = 200) {
  const seen: Seen[] = [];
  const gateway: InProcessGateway = inProcessGateway();
  const connector = createElevenlabsConnector({
    secrets: key ? { elevenlabsApiKey: key } : {},
    fetch: routedFetch({
      "POST https://api.elevenlabs.io/v1/text-to-speech/*": async (req, url) => {
        seen.push({ path: url.pathname, apiKey: req.headers.get("xi-api-key"), body: (await req.json()) as Record<string, unknown> });
        return status === 200 ? new Response(new Uint8Array(MP3), { status: 200, headers: { "content-type": "audio/mpeg" } }) : jsonResponse({ detail: { status: "quota_exceeded", message: "no credits" } }, { status });
      },
      "POST https://api.elevenlabs.io/v1/speech-to-text": async (req, url) => {
        seen.push({ path: url.pathname, apiKey: req.headers.get("xi-api-key"), form: Object.fromEntries((await req.formData()).entries()) });
        return jsonResponse({ language_code: "eng", text: "Let's plan the launch.", audio_duration_secs: 2.5 });
      },
    }),
  });
  gateway.bind({ db: hz.db, vault: hz.deps.vault, registry: createRegistry([connector]), mode: "mock", liveConnectors: ["elevenlabs"] });
  vi.stubGlobal("fetch", async () => {
    throw new Error("the api called a vendor directly");
  });
  const deps: SpeechDeps = { env: LIVE_ENV, gateway: gateway.client };
  return { deps, seen, paths: gateway.paths };
}

/** Mock mode: a gateway that fails the test if it is asked. */
const mockDeps = (): SpeechDeps => ({
  env: MOCK_ENV,
  gateway: {
    ...hz.deps.gateway,
    synthesizeSpeech: async () => {
      throw new Error("the gateway was asked in mock mode");
    },
    transcribeSpeech: async () => {
      throw new Error("the gateway was asked in mock mode");
    },
  },
});

describe("speechModes", () => {
  it("is simulated, with the notice to show once, where elevenlabs runs its mock", () => {
    expect(speechModes(MOCK_ENV)).toEqual({ speech: "simulated", transcription: "simulated", notice: TEAM_CALL_WORDS.simulatedNotice });
  });
  it("is live, with no notice, where LIVE_CONNECTORS names elevenlabs or everything is live", () => {
    expect(speechModes(LIVE_ENV)).toEqual({ speech: "live", transcription: "live", notice: null });
    expect(speechModes({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" })).toMatchObject({ speech: "live", transcription: "live" });
    expect(speechModes({ INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe,domains" })).toMatchObject({ speech: "simulated" });
  });
});

describe("mock mode: the api answers itself and never asks the gateway", () => {
  it("speaks a silent WAV, simulated, as long as the words take", async () => {
    const spoken = await synthesizeCallSpeech(mockDeps(), { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: TEXT });
    expect(spoken).toMatchObject({ mime: "audio/wav", simulated: true });
    const wav = Buffer.from(spoken.base64, "base64");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });
  it("hears nothing and says it is simulated", async () => {
    expect(await transcribeCallSpeech(mockDeps(), { businessId: hz.A.businessId, callId: CALL_ID, mime: "audio/webm", base64: RECORDING })).toEqual({ text: "", simulated: true });
  });
  it("refuses an accent that does not exist, empty or too long words, and an unsupported recording, as a 400", async () => {
    const bad = (over: Record<string, unknown>) => synthesizeCallSpeech(mockDeps(), { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: TEXT, ...over });
    await expect(bad({ speechAccent: "nobody" })).rejects.toMatchObject({ status: 400 });
    await expect(bad({ text: "" })).rejects.toMatchObject({ status: 400 });
    await expect(bad({ text: "x".repeat(601) })).rejects.toMatchObject({ status: 400 });
    await expect(transcribeCallSpeech(mockDeps(), { businessId: hz.A.businessId, callId: CALL_ID, mime: "audio/flac" as never, base64: RECORDING })).rejects.toMatchObject({ status: 400 });
  });
  it("speaks every speech accent", async () => {
    for (const slot of SPEECH_ACCENTS) expect((await synthesizeCallSpeech(mockDeps(), { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: slot.key, text: "Hello" })).simulated).toBe(true);
  });
});

describe("live mode: the gateway speaks", () => {
  it("asks the gateway once, which asks ElevenLabs with the key and the id the accent maps to; the api calls nothing itself", async () => {
    const { deps, seen, paths } = liveSetup();
    const spoken = await synthesizeCallSpeech(deps, { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "wyatt", text: TEXT });
    expect(spoken).toEqual({ mime: "audio/mpeg", base64: MP3.toString("base64"), simulated: false });
    expect(paths).toEqual(["/v1/speech/synthesize"]);
    expect(seen).toEqual([{ path: `/v1/text-to-speech/${SPEECH_ACCENT_IDS.wyatt}`, apiKey: KEY, body: expect.objectContaining({ text: TEXT, model_id: "eleven_flash_v2_5" }) }]);
  });

  it("transcribes through the gateway", async () => {
    const { deps, seen, paths } = liveSetup();
    expect(await transcribeCallSpeech(deps, { businessId: hz.A.businessId, callId: CALL_ID, mime: "audio/webm", base64: RECORDING })).toEqual({ text: "Let's plan the launch.", simulated: false });
    expect(paths).toEqual(["/v1/speech/transcribe"]);
    expect(seen[0]).toMatchObject({ path: "/v1/speech-to-text", apiKey: KEY });
  });

  it("passes the gateway's refusals through with their code and status", async () => {
    const { deps } = liveSetup();
    await expect(synthesizeCallSpeech(deps, { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "nobody", text: TEXT })).rejects.toMatchObject({ code: "unknown_speech_accent", status: 400 });
    await expect(synthesizeCallSpeech(deps, { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: "" })).rejects.toMatchObject({ code: "validation", status: 400 });
    const unconfigured = liveSetup(null);
    await expect(synthesizeCallSpeech(unconfigured.deps, { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: TEXT })).rejects.toMatchObject({ code: "speech_unconfigured", status: 503 });
    const refused = liveSetup(KEY, 400);
    await expect(synthesizeCallSpeech(refused.deps, { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: TEXT })).rejects.toMatchObject({ code: "speech_refused", status: 422 });
  });

  it("never carries the key or the words into the answer's error", async () => {
    const { deps } = liveSetup(KEY, 500);
    const error = await synthesizeCallSpeech(deps, { businessId: hz.A.businessId, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: TEXT }).catch((e: unknown) => e);
    expect(JSON.stringify({ message: (error as Error).message, code: (error as { code?: string }).code })).not.toContain(KEY);
    expect((error as Error).message).not.toContain("launch email");
  });
});

describe("the api waits for the gateway longer than the gateway waits for ElevenLabs", () => {
  it("by a margin, for a turn and for a recording", () => {
    expect(SPEECH_CLIENT_TIMEOUT_MS).toBeGreaterThan(ELEVENLABS_SPEECH_TIMEOUT_MS);
    expect(TRANSCRIBE_CLIENT_TIMEOUT_MS).toBeGreaterThan(ELEVENLABS_TRANSCRIPTION_TIMEOUT_MS);
  });
});
