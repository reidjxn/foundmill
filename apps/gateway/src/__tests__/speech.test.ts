/**
 * `POST /v1/speech/synthesize` and `/v1/speech/transcribe` (docs/TEAM_CALL.md §3): only the api asks; the checks run in
 * the documented order before any vendor call; the day's spoken characters are counted in the shared store and given
 * back when the vendor refused outright; the live call carries the platform key in `xi-api-key` and the id the accent
 * maps to; the audit rows and the log never hold the words; the cost is booked as an Estimate tool row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElevenlabsConnector, createRegistry, jsonResponse, routedFetch, SPEECH_ACCENT_IDS } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { SPEECH_ACCENTS, TEAM_CALL_LIMITS } from "@foundmill/shared";
import { createGatewayApp } from "../app";
import type { GatewayDeps } from "../pipeline";
import { DAY_MS, MemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore, type RedisCounter } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { speechDayKey } from "../speech";
import { signServiceToken } from "../tokens";
import { SIMULATED_NOTICE } from "../types";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let businessId: string;
beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  businessId = (await repos.businesses.create(db, { name: "Speech Co" })).id;
}, 120_000);
afterAll(() => h?.close());

const KEY = "sk_platform_speech_key_0123456789";
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0xff, 0xfb, 0x90, 0x64]);
const TEXT = "I would start with the launch email. It is the one thing a customer will read this week.";
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const RECORDING = Buffer.from("opus-ish bytes of the founder talking").toString("base64");
const NOW = Date.parse("2026-11-12T10:00:10Z");

interface Seen {
  kind: "speech" | "transcribe";
  path: string;
  apiKey: string | null;
  body?: Record<string, unknown>;
  form?: Record<string, FormDataEntryValue>;
}
interface Opts {
  mode?: "mock" | "live";
  key?: string;
  seen?: Seen[];
  liveConnectors?: string[];
  status?: number;
  errorBody?: unknown;
  now?: () => Date;
  rateLimits?: RateLimitStore;
  appEnv?: string;
  logs?: { level: string; args: unknown[] }[];
}

function appFor(opts: Opts = {}) {
  const live = createElevenlabsConnector({
    secrets: opts.key ? { elevenlabsApiKey: opts.key } : {},
    fetch: routedFetch({
      "POST https://api.elevenlabs.io/v1/text-to-speech/*": async (req, url) => {
        opts.seen?.push({ kind: "speech", path: url.pathname, apiKey: req.headers.get("xi-api-key"), body: (await req.json()) as Record<string, unknown> });
        if (opts.status && opts.status !== 200) return jsonResponse(opts.errorBody ?? { detail: { status: "internal_error", message: "The server had an error" } }, { status: opts.status });
        return new Response(new Uint8Array(MP3), { status: 200, headers: { "content-type": "audio/mpeg" } });
      },
      "POST https://api.elevenlabs.io/v1/speech-to-text": async (req, url) => {
        opts.seen?.push({ kind: "transcribe", path: url.pathname, apiKey: req.headers.get("xi-api-key"), form: Object.fromEntries((await req.formData()).entries()) });
        if (opts.status && opts.status !== 200) return jsonResponse(opts.errorBody ?? { detail: { status: "internal_error", message: "boom" } }, { status: opts.status });
        return jsonResponse({ language_code: "eng", text: " Let's plan the launch. ", audio_duration_secs: 3.4 });
      },
    }),
  });
  const log = (level: string) => (...args: unknown[]) => void opts.logs?.push({ level, args });
  const deps: GatewayDeps = {
    db,
    registry: createRegistry([live]),
    vault: null,
    mode: opts.mode ?? "mock",
    liveConnectors: opts.liveConnectors,
    rateLimits: opts.rateLimits ?? new MemoryRateLimitStore(),
    recipients: new UntrustedRecipientRegistry(),
    log: opts.logs ? { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error"), child: () => silentLog } : silentLog,
    now: opts.now ?? (() => new Date(NOW)),
    ...(opts.appEnv ? { appEnv: opts.appEnv } : {}),
  };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

type Body = Record<string, unknown> & { error?: { code: string; message: string; details?: Record<string, unknown> } };
async function send(app: ReturnType<typeof appFor>, route: "synthesize" | "transcribe", body: unknown, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await app.request(`/v1/speech/${route}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Body };
}
const speak = (app: ReturnType<typeof appFor>, over: Record<string, unknown> = {}, svc: string | null = "api", biz = businessId) => send(app, "synthesize", { businessId: biz, callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: TEXT, ...over }, svc);
const hear = (app: ReturnType<typeof appFor>, over: Record<string, unknown> = {}) => send(app, "transcribe", { businessId, callId: CALL_ID, mime: "audio/webm", base64: RECORDING, ...over });
const live = (extra: Opts = {}) => ({ mode: "live" as const, key: KEY, ...extra });

/** A Redis client in a Map, with the INCRBY and DECRBY the day's characters use. */
function fakeRedis(): RedisCounter & { data: Map<string, number>; expiries: string[] } {
  const data = new Map<string, number>();
  const expiries: string[] = [];
  const add = async (k: string, n: number) => {
    data.set(k, (data.get(k) ?? 0) + n);
    return data.get(k)!;
  };
  return { data, expiries, incr: (k) => add(k, 1), incrby: add, decr: (k) => add(k, -1), decrby: (k, n) => add(k, -n), pexpire: async (k) => void expiries.push(k) };
}

describe("synthesize: mock", () => {
  it("answers the mock's silent WAV, marked simulated with the notice, and reaches no vendor", async () => {
    const seen: Seen[] = [];
    const res = await speak(appFor({ seen }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "mock", mime: "audio/wav", simulated: true, notice: SIMULATED_NOTICE, characters: TEXT.length });
    expect(Buffer.from(res.body.base64 as string, "base64").subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(seen).toHaveLength(0);
  });
  it("LIVE_CONNECTORS=elevenlabs makes only speech live while connectors are mock", async () => {
    const seen: Seen[] = [];
    const speech = await speak(appFor({ mode: "mock", liveConnectors: ["elevenlabs"], key: KEY, seen }));
    expect(speech.body).toMatchObject({ mode: "live", mime: "audio/mpeg", simulated: false });
    expect(speech.body.notice).toBeUndefined();
    const other = await speak(appFor({ mode: "mock", liveConnectors: ["stripe"], key: KEY, seen }));
    expect(other.body.mime).toBe("audio/wav");
    expect(seen).toHaveLength(1);
  });
});

describe("synthesize: live", () => {
  it("asks ElevenLabs with the platform key, the id the accent maps to and the documented body", async () => {
    const seen: Seen[] = [];
    const res = await speak(appFor(live({ seen })), { speechAccent: "kaelen" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "live", mime: "audio/mpeg", base64: MP3.toString("base64"), simulated: false, characters: TEXT.length });
    expect(res.body.costMinor).toBeGreaterThan(0);
    expect(seen).toEqual([{ kind: "speech", path: `/v1/text-to-speech/${SPEECH_ACCENT_IDS.kaelen}`, apiKey: KEY, body: { text: TEXT, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 } } }]);
  });

  it("speaks every speech accent with its own id", async () => {
    const seen: Seen[] = [];
    const app = appFor(live({ seen, now: () => new Date(NOW) }));
    // Different businesses so one minute's window does not stop 19 turns.
    for (const slot of SPEECH_ACCENTS) {
      const biz = (await repos.businesses.create(db, { name: `Accent ${slot.key}` })).id;
      expect((await speak(app, { speechAccent: slot.key }, "api", biz)).status).toBe(200);
    }
    expect(seen.map((s) => s.path.split("/").pop())).toEqual(SPEECH_ACCENTS.map((s) => SPEECH_ACCENT_IDS[s.key]));
  });

  it("audits the call without the words and books the cost as an Estimate tool row; the log has neither the words nor the key", async () => {
    const biz = (await repos.businesses.create(db, { name: "Audit Co" })).id;
    const logs: NonNullable<Opts["logs"]> = [];
    const res = await speak(appFor(live({ logs })), {}, "api", biz);
    expect(res.status).toBe(200);
    const audit = await repos.audit.list(db, biz, { action: "gateway.speech.synthesized" });
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({ actorKind: "system", target: { id: CALL_ID }, details: { service: "api", mode: "live", callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", characters: TEXT.length, label: "Estimate" } });
    expect(JSON.stringify(audit.items)).not.toContain("launch email");
    const usage = await repos.usage.list(db, biz, { kind: "tool" });
    expect(usage.items).toHaveLength(1);
    expect(usage.items[0]).toMatchObject({ kind: "tool", currency: "USD", costMinor: res.body.costMinor, details: { connector: "elevenlabs", tool: "synthesize_speech", label: "Estimate" } });
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain("launch email");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(MP3.toString("base64"));
  });

  it("without ELEVENLABS_API_KEY it is a clear 503, nothing is called and the characters are given back", async () => {
    const seen: Seen[] = [];
    const rateLimits = new MemoryRateLimitStore();
    const res = await speak(appFor({ mode: "live", seen, rateLimits }));
    expect(res).toMatchObject({ status: 503, body: { error: { code: "speech_unconfigured" } } });
    expect(res.body.error?.message).toContain("ELEVENLABS_API_KEY");
    expect(seen).toHaveLength(0);
    expect(rateLimits.peek(speechDayKey(businessId), NOW)).toBe(0);
  });
});

describe("synthesize: the checks, in order", () => {
  it("an unknown accent is refused first, whatever the words, before any count or call", async () => {
    const seen: Seen[] = [];
    const rateLimits = new MemoryRateLimitStore();
    const app = appFor(live({ seen, rateLimits }));
    expect((await speak(app, { speechAccent: "nobody", text: "" })).body.error?.code).toBe("unknown_speech_accent");
    expect((await speak(app, { speechAccent: "nobody" })).status).toBe(400);
    // The old name of the field is not an accent.
    expect((await send(app, "synthesize", { businessId, callId: CALL_ID, turnId: TURN_ID, accent: "talia", text: TEXT })).status).toBe(400);
    expect(seen).toHaveLength(0);
    expect(rateLimits.peek(speechDayKey(businessId), NOW)).toBe(0);
    expect(rateLimits.peek(`rl:${businessId}:elevenlabs:minute`, NOW)).toBe(0);
  });

  it("the words are 1 to 600 characters", async () => {
    const seen: Seen[] = [];
    const app = appFor(live({ seen }));
    for (const text of ["", "   ", "x".repeat(TEAM_CALL_LIMITS.maxTurnChars + 1)]) {
      const res = await speak(app, { text });
      expect(res, JSON.stringify(text.length)).toMatchObject({ status: 400, body: { error: { code: "validation" } } });
    }
    expect((await speak(app, { text: "x".repeat(TEAM_CALL_LIMITS.maxTurnChars) })).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it("a malformed body is a fixed 400 that does not repeat the words", async () => {
    const app = appFor(live());
    for (const body of [{ businessId: "nope", callId: CALL_ID, turnId: TURN_ID, speechAccent: "talia", text: "private words" }, "not json", {}]) {
      const res = await send(app, "synthesize", body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("private words");
    }
  });

  it("a business the gateway does not know is a 404", async () => {
    expect((await speak(appFor(live()), {}, "api", crypto.randomUUID())).status).toBe(404);
  });

  it("only the api may ask, with a service token", async () => {
    const app = appFor(live());
    expect((await speak(app, {}, "orchestrator")).status).toBe(403);
    expect((await speak(app, {}, null)).status).toBe(401);
    expect((await send(app, "transcribe", { businessId, callId: CALL_ID, mime: "audio/webm", base64: RECORDING }, "orchestrator")).status).toBe(403);
  });

  it("the business's window on the connector comes before the day's characters (60 a minute)", async () => {
    let at = NOW;
    const rateLimits = new MemoryRateLimitStore();
    const biz = (await repos.businesses.create(db, { name: "Window Co" })).id;
    const app = appFor(live({ now: () => new Date(at), rateLimits }));
    for (let i = 0; i < 60; i++) expect((await speak(app, { text: "Hello" }, "api", biz)).status).toBe(200);
    const limited = await speak(app, { text: "Hello" }, "api", biz);
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    // The refused turn spoke nothing and counted no characters.
    expect(rateLimits.peek(speechDayKey(biz), at)).toBe(60 * "Hello".length);
    at += 60_000;
    expect((await speak(app, { text: "Hello" }, "api", biz)).status).toBe(200);
  });
});

describe("synthesize: the day's spoken characters", () => {
  const ceiling = TEAM_CALL_LIMITS.speechCharsPerBusinessPerDay;

  it("counts the length of the words under sp:<businessId>:day and refuses past the ceiling with a plain sentence", async () => {
    const seen: Seen[] = [];
    const rateLimits = new MemoryRateLimitStore();
    const biz = (await repos.businesses.create(db, { name: "Ceiling Co" })).id;
    await rateLimits.hit(speechDayKey(biz), DAY_MS, NOW, ceiling - 100);
    const app = appFor(live({ seen, rateLimits }));
    expect((await speak(app, { text: "x".repeat(101) }, "api", biz)).status).toBe(429);
    // Refused, so given back: exactly 100 characters still fit.
    expect(rateLimits.peek(speechDayKey(biz), NOW)).toBe(ceiling - 100);
    const last = await speak(app, { text: "x".repeat(100) }, "api", biz);
    expect(last.status).toBe(200);
    expect(rateLimits.peek(speechDayKey(biz), NOW)).toBe(ceiling);
    const over = await speak(app, { text: "x" }, "api", biz);
    expect(over).toMatchObject({ status: 429, body: { error: { code: "speech_daily_limit", details: { limit: ceiling } } } });
    expect(over.body.error?.message).toMatch(/as much as one project can in a day/);
    expect(over.body.error?.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
  });

  it("is per business and starts again on the next UTC day", async () => {
    let at = Date.parse("2026-11-12T23:59:00Z");
    const rateLimits = new MemoryRateLimitStore();
    const a = (await repos.businesses.create(db, { name: "Day A" })).id;
    const b = (await repos.businesses.create(db, { name: "Day B" })).id;
    await rateLimits.hit(speechDayKey(a), DAY_MS, at, ceiling);
    const app = appFor(live({ rateLimits, now: () => new Date(at) }));
    expect((await speak(app, { text: "More" }, "api", a)).status).toBe(429);
    expect((await speak(app, { text: "More" }, "api", b)).status).toBe(200);
    at = Date.parse("2026-11-13T00:00:30Z");
    expect((await speak(app, { text: "More" }, "api", a)).status).toBe(200);
  });

  it("gives the characters back when the vendor refused outright, and keeps them after a failure that may have spoken", async () => {
    const run = async (status: number, errorBody?: unknown) => {
      const rateLimits = new MemoryRateLimitStore();
      const res = await speak(appFor(live({ status, ...(errorBody ? { errorBody } : {}), rateLimits })));
      return { res, counted: rateLimits.peek(speechDayKey(businessId), NOW) };
    };
    const refused = await run(422, { detail: [{ loc: ["body", "text"], msg: "Field required", type: "missing" }] });
    expect(refused.res).toMatchObject({ status: 422, body: { error: { code: "speech_refused", details: { vendorStatus: 422 } } } });
    expect(refused.counted).toBe(0);
    const busy = await run(429, { detail: { status: "too_many_concurrent_requests", message: "Too many concurrent requests." } });
    expect(busy.res).toMatchObject({ status: 429, body: { error: { code: "speech_rate_limited", details: { vendorCode: "too_many_concurrent_requests" } } } });
    expect(busy.counted).toBe(0);
    const badKey = await run(401, { detail: { status: "invalid_api_key", message: `Invalid key ${KEY}` } });
    expect(badKey.res).toMatchObject({ status: 502, body: { error: { code: "speech_unavailable" } } });
    expect(JSON.stringify(badKey.res.body)).not.toContain(KEY);
    expect(badKey.counted).toBe(0);
    const down = await run(503);
    expect(down.res).toMatchObject({ status: 502, body: { error: { code: "speech_unavailable" } } });
    expect(JSON.stringify(down.res.body)).not.toContain("The server had an error");
    expect(down.counted).toBe(TEXT.length);
  });

  it("counts in Redis with INCRBY, shared by replicas, and gives back with DECRBY", async () => {
    const redis = fakeRedis();
    const store = new RedisRateLimitStore(redis);
    const biz = (await repos.businesses.create(db, { name: "Redis Co" })).id;
    const dayStart = Math.floor(NOW / DAY_MS) * DAY_MS;
    const dayKey = `${speechDayKey(biz)}:${dayStart}`;
    // Two gateway replicas on one Redis.
    const first = appFor(live({ rateLimits: store }));
    const second = appFor(live({ rateLimits: new RedisRateLimitStore(redis) }));
    expect((await speak(first, {}, "api", biz)).status).toBe(200);
    expect((await speak(second, {}, "api", biz)).status).toBe(200);
    expect(redis.data.get(dayKey)).toBe(TEXT.length * 2);
    expect(redis.expiries).toContain(dayKey);
    const refusing = appFor(live({ status: 422, rateLimits: store }));
    await speak(refusing, {}, "api", biz);
    expect(redis.data.get(dayKey)).toBe(TEXT.length * 2);
  });

  it("outside development and test, a live call is refused while the count is not shared, and counts nothing", async () => {
    const seen: Seen[] = [];
    const memory = new MemoryRateLimitStore();
    const refused = await speak(appFor(live({ seen, appEnv: "production", rateLimits: memory })));
    expect(refused).toMatchObject({ status: 503, body: { error: { code: "speech_store_unavailable" } } });
    expect(seen).toHaveLength(0);
    expect(memory.peek(speechDayKey(businessId), NOW)).toBe(0);
    // Redis answering: durable, so the call goes through.
    expect((await speak(appFor(live({ seen, appEnv: "production", rateLimits: new RedisRateLimitStore(fakeRedis()) })))).status).toBe(200);
    // A Redis store that has fallen back to memory is not durable either.
    const down = new RedisRateLimitStore({ ...fakeRedis(), incr: async () => { throw new Error("down"); }, incrby: async () => { throw new Error("down"); } });
    expect((await speak(appFor(live({ appEnv: "production", rateLimits: down })))).status).toBe(503);
    // Development and test, and the mock anywhere, count in memory.
    expect((await speak(appFor(live({ appEnv: "development", rateLimits: new MemoryRateLimitStore() })))).status).toBe(200);
    expect((await speak(appFor({ mode: "mock", appEnv: "production", rateLimits: new MemoryRateLimitStore() }))).status).toBe(200);
  });
});

describe("transcribe", () => {
  it("mock: hears nothing and says it is simulated, reaching no vendor", async () => {
    const seen: Seen[] = [];
    const res = await hear(appFor({ seen }));
    expect(res).toMatchObject({ status: 200, body: { mode: "mock", text: "", simulated: true, notice: SIMULATED_NOTICE, durationSeconds: 0 } });
    expect(seen).toHaveLength(0);
  });

  it("live: sends the recording as multipart with the platform key and returns the words", async () => {
    const seen: Seen[] = [];
    const biz = (await repos.businesses.create(db, { name: "Hear Co" })).id;
    const res = await send(appFor(live({ seen })), "transcribe", { businessId: biz, callId: CALL_ID, mime: "audio/webm", base64: RECORDING });
    expect(res).toMatchObject({ status: 200, body: { mode: "live", text: "Let's plan the launch.", simulated: false, durationSeconds: 3.4 } });
    expect(res.body.notice).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "transcribe", path: "/v1/speech-to-text", apiKey: KEY, form: { model_id: "scribe_v3", tag_audio_events: "false", timestamps_granularity: "none" } });
    const audit = await repos.audit.list(db, biz, { action: "gateway.speech.transcribed" });
    expect(audit.items[0]).toMatchObject({ details: { service: "api", mode: "live", callId: CALL_ID, durationSeconds: 3.4, label: "Estimate" } });
    expect(JSON.stringify(audit.items)).not.toContain("launch");
    expect((await repos.usage.list(db, biz, { kind: "tool" })).items[0]).toMatchObject({ details: { tool: "transcribe_speech", label: "Estimate" } });
  });

  it("refuses an unknown type, bad base64 and a recording over 8 MiB before any vendor call", async () => {
    const seen: Seen[] = [];
    const app = appFor(live({ seen }));
    expect((await hear(app, { mime: "audio/flac" })).body.error?.code).toBe("unsupported_audio");
    expect((await hear(app, { base64: "not base64!" })).status).toBe(400);
    expect((await hear(app, { base64: "" })).status).toBe(400);
    const big = Buffer.alloc(TEAM_CALL_LIMITS.maxAudioBytes + 3).toString("base64");
    expect(await hear(app, { base64: big })).toMatchObject({ status: 413, body: { error: { code: "audio_too_large" } } });
    // Exactly 8 MiB is allowed.
    expect((await hear(app, { base64: Buffer.alloc(TEAM_CALL_LIMITS.maxAudioBytes).toString("base64") })).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it("a body past the route's limit is a 413 before anything parses it", async () => {
    const app = appFor(live());
    const token = await signServiceToken(TEST_SECRET, "api");
    const res = await app.request("/v1/speech/transcribe", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ businessId, callId: CALL_ID, mime: "audio/webm", base64: "A".repeat(13 * 1024 * 1024) }) });
    expect(res.status).toBe(413);
    const small = await app.request("/v1/speech/synthesize", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ text: "x".repeat(2 * 1024 * 1024) }) });
    expect(small.status).toBe(413);
  });

  it("without the key it is a 503; a vendor failure is a code and a status, not the vendor's words", async () => {
    expect(await hear(appFor({ mode: "live" }))).toMatchObject({ status: 503, body: { error: { code: "speech_unconfigured" } } });
    const refused = await hear(appFor(live({ status: 422, errorBody: { detail: [{ loc: ["body", "file"], msg: "Audio too short", type: "value_error" }] } })));
    expect(refused).toMatchObject({ status: 422, body: { error: { code: "speech_refused" } } });
    expect(JSON.stringify(refused.body)).not.toContain("Audio too short");
    expect(await hear(appFor(live({ status: 500 })))).toMatchObject({ status: 502, body: { error: { code: "speech_unavailable" } } });
  });

  it("does not touch the day's spoken characters", async () => {
    const rateLimits = new MemoryRateLimitStore();
    await hear(appFor(live({ rateLimits })));
    expect(rateLimits.peek(speechDayKey(businessId), NOW)).toBe(0);
  });
});
