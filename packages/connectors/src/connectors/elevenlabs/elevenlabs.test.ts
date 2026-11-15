import { describe, expect, it } from "vitest";
import { SPEECH_MODELS } from "@foundmill/models";
import { SPEECH_ACCENTS, TEAM_CALL_AUDIO_MIMES, TEAM_CALL_LIMITS } from "@foundmill/shared";
import { SERVICE_ONLY_CONNECTORS } from "../../grants";
import { jsonResponse, routedFetch } from "../../http";
import { describeConnectorContract, envKeysPresent, makeToolContext, type collectingLogger } from "../../testing/contract-suite";
import { speechAccentId, speechAccentsWithoutId, SPEECH_ACCENT_IDS, resolveSpeechAccentIds } from "./speech-accents";
import { BAD_KEY, QUOTA_EXCEEDED, TINY_MP3, TINY_MP3_BASE64, TOO_MANY, TRANSCRIPT_NO_DURATION, TRANSCRIPT_OK, VALIDATION_ERROR } from "./fixtures/speech";
import { createElevenlabsConnector, redactKeys } from "./index";
import { elevenlabsMock, estimateSpeakingMs, silentWav } from "./mock";
import { decodedBytes, estimateSpeechCostMinor, estimateTranscriptionCostMinor } from "./tools";

const KEY = "sk_test_secret_key_1234567890abcdef";
const TEXT = "I would start with the launch email, then the pricing page.";
const RECORDING = Buffer.from("not really opus, but bytes").toString("base64");

describeConnectorContract("elevenlabs (mock)", {
  connector: elevenlabsMock,
  mode: "mock",
  calls: [
    {
      tool: "synthesize_speech",
      args: { speechAccent: "talia", text: TEXT },
      check: (r) => {
        const d = r.data as { mime: string; base64: string; characters: number; model: string; simulated?: boolean };
        expect(d).toMatchObject({ mime: "audio/wav", characters: TEXT.length, model: "mock-speech", simulated: true });
        expect(r.costMinor).toBeGreaterThan(0);
      },
    },
    { tool: "transcribe_speech", args: { mime: "audio/webm", base64: RECORDING }, check: (r) => expect(r.data).toMatchObject({ text: "", simulated: true }) },
    { tool: "synthesize_speech", args: { speechAccent: "nobody", text: "hi" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "synthesize_speech", args: { speechAccent: "talia", text: "" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "synthesize_speech", args: { speechAccent: "talia", text: "x".repeat(TEAM_CALL_LIMITS.maxTurnChars + 1) }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "transcribe_speech", args: { mime: "audio/flac", base64: RECORDING }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "transcribe_speech", args: { mime: "audio/webm", base64: "not base64!" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

/** Reads a WAV back: RIFF/WAVE, PCM, mono, 16 kHz, 16 bits, and a data chunk that fills the file exactly. */
function readWav(bytes: Buffer) {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
  expect(bytes.toString("ascii", 12, 16)).toBe("fmt ");
  expect(bytes.readUInt32LE(16)).toBe(16);
  const fmt = { format: bytes.readUInt16LE(20), channels: bytes.readUInt16LE(22), rate: bytes.readUInt32LE(24), byteRate: bytes.readUInt32LE(28), align: bytes.readUInt16LE(32), bits: bytes.readUInt16LE(34) };
  expect(bytes.toString("ascii", 36, 40)).toBe("data");
  const dataBytes = bytes.readUInt32LE(40);
  expect(44 + dataBytes).toBe(bytes.length);
  expect(bytes.subarray(44).every((b) => b === 0)).toBe(true);
  return { ...fmt, dataBytes, ms: (dataBytes / fmt.byteRate) * 1000 };
}

describe("elevenlabs mock", () => {
  const ctx = () => makeToolContext(elevenlabsMock);
  it("returns a valid silent mono 16 kHz PCM WAV, the same bytes for the same words", async () => {
    const a = await elevenlabsMock.callTool("synthesize_speech", { speechAccent: "darian", text: TEXT }, ctx());
    const b = await elevenlabsMock.callTool("synthesize_speech", { speechAccent: "darian", text: TEXT }, ctx());
    expect(a.data).toEqual(b.data);
    const wav = readWav(Buffer.from((a.data as { base64: string }).base64, "base64"));
    expect(wav).toMatchObject({ format: 1, channels: 1, rate: 16_000, byteRate: 32_000, align: 2, bits: 16 });
  });
  it("is as long as the words take to say: 150 words a minute, at least 600 ms", () => {
    expect(estimateSpeakingMs("Hi")).toBe(600);
    expect(estimateSpeakingMs(Array.from({ length: 150 }, () => "word").join(" "))).toBe(60_000);
    expect(estimateSpeakingMs(Array.from({ length: 75 }, () => "word").join(" "))).toBe(30_000);
    expect(readWav(silentWav(600)).ms).toBeCloseTo(600, 0);
    expect(readWav(silentWav(estimateSpeakingMs(Array.from({ length: 75 }, () => "word").join(" ")))).ms).toBeCloseTo(30_000, 0);
  });
  it("transcribes nothing and says it is simulated", async () => {
    const r = await elevenlabsMock.callTool("transcribe_speech", { mime: "audio/wav", base64: Buffer.from(silentWav(600)).toString("base64") }, ctx());
    expect(r.data).toMatchObject({ text: "", simulated: true });
  });
  it("declares what it does as policy hints", () => {
    for (const tool of ["synthesize_speech", "transcribe_speech"]) expect(elevenlabsMock.policyHints[tool]).toEqual({ spendsMoney: true, contactsThirdParty: false, requiresKitMode: false, irreversible: false });
  });
  it("is service-only: a grant on it resolves to nothing", () => {
    expect(SERVICE_ONLY_CONNECTORS.has("elevenlabs")).toBe(true);
  });
});

describe("accents", () => {
  it("has a default id for every accent in SPEECH_ACCENTS, and no id for an accent that does not exist", () => {
    expect(speechAccentsWithoutId(SPEECH_ACCENT_IDS)).toEqual([]);
    expect(Object.keys(SPEECH_ACCENT_IDS).sort()).toEqual(SPEECH_ACCENTS.map((s) => s.key).sort());
    expect(new Set(Object.values(SPEECH_ACCENT_IDS)).size).toBe(SPEECH_ACCENTS.length);
  });
  it("looks an id up by accent key", () => {
    expect(speechAccentId("talia")).toBe("OZ0L6eISlOejga3XjDFt");
    expect(speechAccentId("kaelen")).toBe("10NkTYmU7tSz3Kkl3Lex");
    expect(speechAccentId("nobody")).toBeNull();
    expect(speechAccentId("talia", { talia: "ABCDEFGHIJ1234567890" })).toBe("ABCDEFGHIJ1234567890");
  });
  it("overrides key by key from ELEVENLABS_SPEECH_ACCENT_IDS", () => {
    const { ids, warnings } = resolveSpeechAccentIds(JSON.stringify({ talia: "ABCDEFGHIJ1234567890" }));
    expect(ids.talia).toBe("ABCDEFGHIJ1234567890");
    expect(ids.darian).toBe(SPEECH_ACCENT_IDS.darian);
    expect(warnings).toEqual([]);
  });
  it("ignores an unknown accent, a bad id and bad JSON with a warning, and never echoes an id", () => {
    const unknown = resolveSpeechAccentIds(JSON.stringify({ nobody: "ABCDEFGHIJ1234567890", talia: "../etc/passwd" }));
    expect(unknown.ids).toEqual(SPEECH_ACCENT_IDS);
    expect(unknown.warnings).toHaveLength(2);
    expect(unknown.warnings.join(" ")).toContain("nobody");
    expect(unknown.warnings.join(" ")).not.toContain("passwd");
    expect(resolveSpeechAccentIds("{nope").warnings).toHaveLength(1);
    expect(resolveSpeechAccentIds("[1]").warnings).toHaveLength(1);
    expect(resolveSpeechAccentIds("").warnings).toEqual([]);
    expect(resolveSpeechAccentIds(undefined).ids).toEqual(SPEECH_ACCENT_IDS);
  });
});

describe("estimates", () => {
  it("rounds a call up to a whole cent and grows with the characters", () => {
    expect(estimateSpeechCostMinor(1)).toBe(1);
    expect(estimateSpeechCostMinor(600)).toBe(3);
    expect(estimateSpeechCostMinor(20_000)).toBe(100);
    expect(estimateTranscriptionCostMinor(160_000)).toBe(1);
    // A recording is at most `maxAudioBytes` (1.4 MB, about a minute and a half): a cent at most. Longer audio costs more.
    expect(estimateTranscriptionCostMinor(TEAM_CALL_LIMITS.maxAudioBytes)).toBeGreaterThanOrEqual(1);
    expect(estimateTranscriptionCostMinor(50_000_000)).toBeGreaterThan(estimateTranscriptionCostMinor(TEAM_CALL_LIMITS.maxAudioBytes));
    expect(decodedBytes(Buffer.from("abcd").toString("base64"))).toBe(4);
    expect(decodedBytes(Buffer.from("abcde").toString("base64"))).toBe(5);
  });
});

describe("elevenlabs live (canned)", () => {
  interface Seen {
    method: string;
    url: string;
    apiKey: string | null;
    contentType: string | null;
    accept: string | null;
    body?: Record<string, unknown>;
    form?: Record<string, FormDataEntryValue>;
  }
  const VOICE = SPEECH_ACCENT_IDS.talia;
  function connectorWith(respond: (kind: "speech" | "transcribe") => Response, seen: Seen[] = [], secrets: { elevenlabsApiKey?: string; elevenlabsSpeechAccentIds?: string } = { elevenlabsApiKey: KEY }) {
    return createElevenlabsConnector({
      secrets,
      fetch: routedFetch({
        "POST https://api.elevenlabs.io/v1/text-to-speech/*": async (req, url) => {
          seen.push({ method: req.method, url: url.toString(), apiKey: req.headers.get("xi-api-key"), contentType: req.headers.get("content-type"), accept: req.headers.get("accept"), body: (await req.json()) as Record<string, unknown> });
          return respond("speech");
        },
        "POST https://api.elevenlabs.io/v1/speech-to-text": async (req, url) => {
          const form = await req.formData();
          seen.push({ method: req.method, url: url.toString(), apiKey: req.headers.get("xi-api-key"), contentType: req.headers.get("content-type"), accept: req.headers.get("accept"), form: Object.fromEntries(form.entries()) });
          return respond("transcribe");
        },
        "GET https://api.elevenlabs.io/v1/models": (req) => (req.headers.get("xi-api-key") === KEY ? jsonResponse([{ model_id: SPEECH_MODELS.call_speech }]) : jsonResponse(BAD_KEY, { status: 401 })),
      }),
    });
  }
  const audio = () => new Response(new Uint8Array(TINY_MP3), { status: 200, headers: { "content-type": "audio/mpeg" } });
  const live = (c: ReturnType<typeof connectorWith>) => makeToolContext(c, { mode: "live" });

  it("speaks with the documented request and returns the MP3 as base64", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => audio(), seen);
    const r = await c.callTool("synthesize_speech", { speechAccent: "talia", text: TEXT }, live(c));
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual({ mime: "audio/mpeg", base64: TINY_MP3_BASE64, characters: TEXT.length, model: SPEECH_MODELS.call_speech });
    expect(r.costMinor).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`, apiKey: KEY, contentType: "application/json", accept: "audio/mpeg" });
    expect(seen[0]!.body).toEqual({ text: TEXT, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 } });
    // The key travels in the header only.
    expect(seen[0]!.url).not.toContain(KEY);
    expect(JSON.stringify(seen[0]!.body)).not.toContain(KEY);
  });

  it("uses the id an accent is mapped to, and the override from ELEVENLABS_SPEECH_ACCENT_IDS", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => audio(), seen, { elevenlabsApiKey: KEY, elevenlabsSpeechAccentIds: JSON.stringify({ kaelen: "ZZZZZZZZZZ1234567890", ghost: "ABCDEFGHIJ1234567890" }) });
    const ctx = live(c);
    await c.callTool("synthesize_speech", { speechAccent: "kaelen", text: "Hello" }, ctx);
    await c.callTool("synthesize_speech", { speechAccent: "wyatt", text: "Hello" }, ctx);
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual(["/v1/text-to-speech/ZZZZZZZZZZ1234567890", `/v1/text-to-speech/${SPEECH_ACCENT_IDS.wyatt}`]);
    // The unknown accent in the override is warned about once, with no id in the line.
    const warnings = (ctx.log as ReturnType<typeof collectingLogger>).entries.filter((e) => e.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).toContain("ghost");
    expect(JSON.stringify(warnings)).not.toContain("ABCDEFGHIJ");
  });

  it("throws ConfigError without ELEVENLABS_API_KEY and calls nothing", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => audio(), seen, {});
    await expect(c.callTool("synthesize_speech", { speechAccent: "talia", text: "Hi" }, live(c))).rejects.toMatchObject({ code: "connector_unconfigured", message: expect.stringContaining("ELEVENLABS_API_KEY") });
    await expect(c.callTool("transcribe_speech", { mime: "audio/webm", base64: RECORDING }, live(c))).rejects.toMatchObject({ code: "connector_unconfigured" });
    expect(seen).toHaveLength(0);
  });

  it("transcribes with the documented multipart request", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(TRANSCRIPT_OK), seen);
    const r = await c.callTool("transcribe_speech", { mime: "audio/webm", base64: RECORDING }, live(c));
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual({ text: "Let's talk about the launch email.", languageCode: "eng", durationSeconds: 4.2, model: SPEECH_MODELS.call_transcription });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "https://api.elevenlabs.io/v1/speech-to-text", apiKey: KEY });
    expect(seen[0]!.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0]!.form).toMatchObject({ model_id: "scribe_v3", tag_audio_events: "false", timestamps_granularity: "none" });
    const file = seen[0]!.form!.file as File;
    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("audio/webm");
    expect(Buffer.from(await file.arrayBuffer()).toString("base64")).toBe(RECORDING);
  });

  it("names a file for every audio type it accepts", async () => {
    const seen: Seen[] = [];
    const c = connectorWith(() => jsonResponse(TRANSCRIPT_NO_DURATION), seen);
    for (const mime of TEAM_CALL_AUDIO_MIMES) await c.callTool("transcribe_speech", { mime, base64: RECORDING }, live(c));
    expect(seen.map((s) => (s.form!.file as File).name)).toEqual(["recording.webm", "recording.ogg", "recording.m4a", "recording.mp3", "recording.wav"]);
  });

  it("estimates the length when the vendor gives none", async () => {
    const c = connectorWith(() => jsonResponse(TRANSCRIPT_NO_DURATION));
    const r = await c.callTool("transcribe_speech", { mime: "audio/webm", base64: RECORDING }, live(c));
    expect((r.data as { durationSeconds: number }).durationSeconds).toBeGreaterThanOrEqual(0);
    expect(r.data).toMatchObject({ text: "hello there" });
  });

  it("maps vendor failures to tool errors without echoing a key", async () => {
    const connector = (body: unknown, status: number) => connectorWith(() => jsonResponse(body, { status }));
    const speak = async (c: ReturnType<typeof connector>) => c.callTool("synthesize_speech", { speechAccent: "talia", text: "Hi" }, live(c));

    const invalid = await speak(connector(VALIDATION_ERROR, 422));
    expect(invalid.error).toMatchObject({ code: "vendor_error", status: 422, retryable: false });
    expect(invalid.error?.message).toContain("Field required");

    const quota = await speak(connector(QUOTA_EXCEEDED, 401));
    expect(quota.error).toMatchObject({ code: "unauthorized", status: 401 });
    expect(quota.error?.message).toContain("quota_exceeded");

    const busy = await speak(connector(TOO_MANY, 429));
    expect(busy.error).toMatchObject({ code: "rate_limited", status: 429, retryable: true });

    const badKey = await speak(connector(BAD_KEY, 401));
    expect(badKey.error).toMatchObject({ code: "unauthorized", status: 401 });
    expect(JSON.stringify(badKey)).not.toContain("0123456789abcdef");

    const down = await speak(connector({ detail: { status: "internal_error", message: "boom" } }, 503));
    expect(down.error).toMatchObject({ code: "vendor_error", status: 503, retryable: true });

    const sttInvalid = connector(VALIDATION_ERROR, 422);
    const stt = await sttInvalid.callTool("transcribe_speech", { mime: "audio/webm", base64: RECORDING }, live(sttInvalid));
    expect(stt.error).toMatchObject({ code: "vendor_error", status: 422 });
  });

  it("never passes on the configured key, wherever the vendor quotes it", async () => {
    const quoted = { detail: { status: "invalid_api_key", message: `The key ${KEY} is not valid` } };
    const c = connectorWith(() => jsonResponse(quoted, { status: 401 }));
    const r = await c.callTool("synthesize_speech", { speechAccent: "talia", text: "Hi" }, live(c));
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain("secret_key");
  });

  it("masks key-shaped strings", () => {
    expect(redactKeys("Invalid API key: sk_0123abcd0123abcd.")).toBe("Invalid API key: sk_…");
    expect(redactKeys("header xi-api-key ok")).toBe("header sk_… ok");
    expect(redactKeys("the key is hunter2-hunter2", "hunter2-hunter2")).toBe("the key is sk_…");
    expect(redactKeys("nothing here")).toBe("nothing here");
  });

  it("treats an answer without audio or without a transcript as a vendor failure", async () => {
    for (const respond of [() => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "audio/mpeg" } }), () => jsonResponse({ ok: true })]) {
      const c = connectorWith(respond);
      const r = await c.callTool("synthesize_speech", { speechAccent: "talia", text: "Hi" }, live(c));
      expect(r.error).toMatchObject({ code: "vendor_error", status: 502 });
    }
    const c = connectorWith(() => jsonResponse({}));
    const r = await c.callTool("transcribe_speech", { mime: "audio/webm", base64: RECORDING }, live(c));
    expect(r.error).toMatchObject({ code: "vendor_error", status: 502 });
  });

  it("health check lists the models (nothing is spoken) and reports a wrong key as degraded, a missing one as disconnected", async () => {
    const seen: Seen[] = [];
    const good = connectorWith(() => audio(), seen);
    expect((await good.healthcheck(live(good).integration)).status).toBe("connected");
    expect(seen).toHaveLength(0);
    const missing = connectorWith(() => audio(), seen, {});
    expect((await missing.healthcheck(live(missing).integration)).status).toBe("disconnected");
    const wrong = connectorWith(() => audio(), seen, { elevenlabsApiKey: "sk_other_key_0000000" });
    const health = await wrong.healthcheck(live(wrong).integration);
    expect(health.status).toBe("degraded");
    expect(JSON.stringify(health)).not.toContain("0123456789abcdef");
  });
});

describe.skipIf(!envKeysPresent("ELEVENLABS_API_KEY"))("elevenlabs (live)", () => {
  // Costs a fraction of a cent: one short sentence, only when a key is in the environment.
  describeConnectorContract("elevenlabs live", { connector: createElevenlabsConnector({ secrets: { elevenlabsApiKey: process.env.ELEVENLABS_API_KEY! } }), mode: "live", deterministic: false, calls: [{ tool: "synthesize_speech", args: { speechAccent: "talia", text: "Hello from your team." } }] });
});
