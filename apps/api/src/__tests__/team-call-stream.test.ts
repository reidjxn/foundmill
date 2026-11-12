/**
 * Team call's streamed speech (services/speech-tickets.ts, `GET /team-call-audio/:ticket`): live, `teamCall.speech` with
 * `stream: true` answers a short-lived ticket path instead of the audio; the route pipes the gateway's stream for it, a
 * few times at most, and nothing for an unknown, expired or used-up ticket. Simulated speech never streams.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createMemorySpeechTickets, SPEECH_TICKET_MAX_USES, SPEECH_TICKET_TTL_MS } from "../services/speech-tickets";
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
