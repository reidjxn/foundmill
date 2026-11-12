/**
 * Team call's streamed speech (services/speech-tickets.ts, `GET /team-call-audio/:ticket`): live, `teamCall.speech` with
 * `stream: true` answers a short-lived ticket path instead of the audio; the route pipes the gateway's stream for it, a
 * few times at most, and nothing for an unknown, expired or used-up ticket. Simulated speech never streams.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, loggedPath, withIdleTimeout } from "../app";
import { createMemorySpeechTickets, SPEECH_TICKET_MAX_USES, SPEECH_TICKET_TTL_MS, speechTickets } from "../services/speech-tickets";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const asked: { speechAccent: string; text: string; turnId: string }[] = [];
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "callstream", env: { LIVE_CONNECTORS: "elevenlabs" } });
  hz.deps.gateway.streamSpeech = async (input) => {
    asked.push({ speechAccent: input.speechAccent, text: input.text, turnId: input.turnId });
    return new Response(new Uint8Array([0xff, 0xf3, 9, 9]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
}, 120_000);
afterAll(() => hz?.close());

describe("speech tickets", () => {
  it("serve a few requests within their time, then nothing", async () => {
    let t = 1_000;
    const store = createMemorySpeechTickets(() => t);
    const ticket = { businessId: "b", callId: "c", turnId: "t", userId: "u", speechAccent: "talia", text: "Hi" };
    const id = await store.issue(ticket);
    expect(id).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    for (let i = 0; i < SPEECH_TICKET_MAX_USES; i++) expect(await store.take(id)).toEqual(ticket);
    expect(await store.take(id)).toBeNull();
    const other = await store.issue(ticket);
    t += SPEECH_TICKET_TTL_MS + 1;
    expect(await store.take(other)).toBeNull();
    expect(await store.take("not a ticket")).toBeNull();
  });
});

describe("teamCall.speech({ stream: true }) and GET /team-call-audio/:ticket", () => {
  it("issues a ticket for a live turn and streams that turn's audio with the agent's accent and the listener's words", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const call = await owner.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    const turn = call.turns[0]!;
    const view = await owner.teamCall.speech({ businessId: hz.A.businessId, callId: call.id, turnId: turn.id, stream: true });
    expect(view).toMatchObject({ simulated: false, base64: "", mime: "audio/mpeg" });
    expect(view.streamUrl).toMatch(/^\/team-call-audio\/[A-Za-z0-9_-]+$/);
    const app = createApp(hz.deps);
    const res = await app.request(view.streamUrl!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xff, 0xf3, 9, 9]);
    expect(asked.at(-1)).toMatchObject({ turnId: turn.id, speechAccent: view.speechAccent, text: view.spokenText.slice(0, 600) });
    expect((await app.request("/team-call-audio/not-a-ticket-at-all-really-not-one-xx")).status).toBe(404);
    // The ticket never reaches the request log.
    const logged: unknown[] = [];
    const quiet = createApp({ ...hz.deps, log: { ...hz.deps.log, info: (...args: unknown[]) => void logged.push(args) } as typeof hz.deps.log });
    const again = await owner.teamCall.speech({ businessId: hz.A.businessId, callId: call.id, turnId: turn.id, stream: true });
    await quiet.request(again.streamUrl!);
    const ticket = again.streamUrl!.split("/").pop()!;
    expect(JSON.stringify(logged)).toContain("/team-call-audio/:ticket");
    expect(JSON.stringify(logged)).not.toContain(ticket);
  });

  it("refuses a viewer, and never streams for someone outside the business", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const call = await owner.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    const viewer = hz.caller({ userId: hz.A.viewerId });
    await expect(viewer.teamCall.speech({ businessId: hz.A.businessId, callId: call.id, turnId: call.turns[0]!.id, stream: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const outsider = hz.caller({ userId: hz.B.ownerId });
    await expect(outsider.teamCall.speech({ businessId: hz.B.businessId, callId: call.id, turnId: call.turns[0]!.id, stream: true })).rejects.toBeTruthy();
  });
});

describe("hardening (security review, Nov 12, 2026)", () => {
  it("masks the ticket wherever a path is logged", () => {
    expect(loggedPath("/team-call-audio/abcdefghijklmnopqrstuvwxyz0123456789")).toBe("/team-call-audio/:ticket");
    expect(loggedPath("/trpc/teamCall.get")).toBe("/trpc/teamCall.get");
  });

  it("cuts a stream that sends nothing for a while", async () => {
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const out = new Uint8Array(await new Response(withIdleTimeout(stalled, 30)).arrayBuffer());
    expect([...out]).toEqual([1]);
    expect(cancelled).toBe(true);
  });

  it("keeps the Redis use counter's expiry from the start, allows two uses, and lets no Redis error carry the ticket or the words", async () => {
    const data = new Map<string, { v: string; px?: number }>();
    const redis = {
      get: async (k: string) => data.get(k)?.v ?? null,
      set: async (k: string, v: string, _px: "PX", ms: number) => void data.set(k, { v, px: ms }),
      incr: async (k: string) => {
        const n = Number(data.get(k)?.v ?? 0) + 1;
        data.set(k, { v: String(n), px: data.get(k)?.px });
        return n;
      },
    };
    const store = speechTickets(redis);
    const ticket = { businessId: "b", callId: "c", turnId: "t", userId: "u", speechAccent: "talia", text: "Secret words" };
    const id = await store.issue(ticket);
    expect([...data.keys()].find((k) => k.endsWith(":uses")) && data.get([...data.keys()].find((k) => k.endsWith(":uses"))!)?.px).toBe(SPEECH_TICKET_TTL_MS);
    expect(await store.take(id)).toEqual(ticket);
    expect(await store.take(id)).toEqual(ticket);
    expect(await store.take(id)).toBeNull();
    const broken = speechTickets({ get: async () => { throw Object.assign(new Error(`OOM command not allowed: SET speech-ticket:${id} Secret words`), { name: "ReplyError" }); }, set: async () => { throw new Error("down: Secret words"); }, incr: async () => 0 });
    const err = await broken.issue(ticket).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("Secret words");
    const err2 = await broken.take(id).catch((e: Error) => e);
    expect(String((err2 as Error).message)).not.toContain(id);
  });

  it("speaks the whole clip when the ticket store is down", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const call = await owner.teamCall.start({ businessId: hz.A.businessId, kind: "team" });
    const saved = hz.deps.redis;
    (hz.deps as { redis: unknown }).redis = { get: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); }, incr: async () => { throw new Error("down"); } };
    const synth = hz.deps.gateway.synthesizeSpeech;
    hz.deps.gateway.synthesizeSpeech = async () => ({ mode: "live", mime: "audio/mpeg", base64: "SUQz", simulated: false, characters: 3, costMinor: 1 }) as never;
    try {
      const fresh = hz.caller({ userId: hz.A.ownerId });
      const view = await fresh.teamCall.speech({ businessId: hz.A.businessId, callId: call.id, turnId: call.turns[0]!.id, stream: true });
      expect(view.streamUrl).toBeUndefined();
      expect(view.base64).toBe("SUQz");
    } finally {
      (hz.deps as { redis: unknown }).redis = saved;
      hz.deps.gateway.synthesizeSpeech = synth;
    }
  });
});
