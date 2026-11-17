/**
 * A founder's own key through the gateway (WP-13 T11): the call leaves for the gateway's route for its business with a
 * service token and no key, usage is booked `byok`, a refused or missing key reads as its sentence, and calls of other
 * businesses (and web search) stay on the platform client.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MockModelClient } from "./mock";
import { OWN_KEY_MISSING, OWN_KEY_REFUSED, ownKeyViaGateway, routeOwnKeyCalls } from "./own-key-route";
import { MODELS } from "./routing";
import type { UsageEvent } from "./types";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function gateway(answer: (url: string) => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return answer(url);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const message = () =>
  new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: MODELS.sonnet, content: [{ type: "text", text: "On your key." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
const refusal = (status: number, msg: string) => new Response(JSON.stringify({ type: "error", error: { type: status === 409 ? "own_key_missing" : "authentication_error", message: msg } }), { status, headers: { "content-type": "application/json" } });

describe("routeOwnKeyCalls with ownKeyViaGateway (WP-13 T11)", () => {
  const setup = (answer: (url: string) => Response) => {
    const gw = gateway(answer);
    const usage: UsageEvent[] = [];
    const platform = new MockModelClient();
    const clientFor = ownKeyViaGateway({ gatewayUrl: "http://gateway.test/", serviceToken: async (businessId) => `svc-token-${businessId.slice(0, 4)}`, fetch: gw.fetch, onUsage: (e) => void usage.push(e) });
    const client = routeOwnKeyCalls(platform, { ownKey: async (a) => a?.businessId === OWN, clientFor });
    return { gw, usage, platform, client };
  };
  const ask = (client: ReturnType<typeof routeOwnKeyCalls>, businessId: string) => client.complete({ route: "chiefOfStaff", messages: [{ role: "user", content: "Plan the week." }], attribution: { businessId } });

  it("sends an own-key business's call to the gateway's route for it, with a service token and no key, booked byok", async () => {
    const { gw, usage, platform, client } = setup(() => message());
    const result = await ask(client, OWN);
    expect(result.text).toBe("On your key.");
    expect(gw.calls).toHaveLength(1);
    expect(gw.calls[0]!.url).toBe(`http://gateway.test/v1/models/anthropic/${OWN}/v1/messages`);
    expect(gw.calls[0]!.headers.authorization).toBe("Bearer svc-token-1111");
    expect(gw.calls[0]!.headers["x-api-key"]).toBeUndefined();
    expect(usage.map((e) => [e.billedTo, e.attribution?.businessId])).toEqual([["byok", OWN]]);
    expect(platform.history).toHaveLength(0);
  });

  it("keeps every other business, and web search, on the platform client", async () => {
    const { gw, platform, client } = setup(() => message());
    await ask(client, OTHER);
    await client.searchWeb!({ query: "compostable cups wholesale", limit: 3, attribution: { businessId: OWN } });
    expect(gw.calls).toHaveLength(0);
    expect(platform.history.length).toBeGreaterThan(0);
  });

  it("reads a refused or missing key as its sentence, never falling back to the platform", async () => {
    const refused = setup(() => refusal(401, "invalid x-api-key"));
    await expect(ask(refused.client, OWN)).rejects.toMatchObject({ code: "auth", message: OWN_KEY_REFUSED });
    const missing = setup(() => refusal(409, "no key"));
    await expect(ask(missing.client, OWN)).rejects.toMatchObject({ code: "auth", message: OWN_KEY_MISSING });
    // The gateway's own refusal (a token fault of Foundmill's) never blames the founder's key.
    const ours = setup(() => new Response(JSON.stringify({ error: { code: "unauthorized", message: "Token has expired" } }), { status: 401, headers: { "content-type": "application/json" } }));
    const err = await ask(ours.client, OWN).catch((e: unknown) => e);
    expect((err as Error).message).not.toBe(OWN_KEY_REFUSED);
    expect(refused.platform.history).toHaveLength(0);
    expect(missing.platform.history).toHaveLength(0);
  });
});

describe("streaming through the gateway's route (WP-13 T11)", () => {
  const sse = (e: Record<string, unknown>) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`;
  const Card = z.object({ name: z.string().min(1) });
  const Cards = z.object({ concepts: z.array(Card).min(2) });
  const json = JSON.stringify({ concepts: [{ name: "First" }, { name: "Second" }] });
  const stream = () => {
    const parts = [
      sse({ type: "message_start", message: { id: "msg_s", type: "message", role: "assistant", model: MODELS.opus, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) + sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ...Array.from({ length: Math.ceil(json.length / 7) }, (_, i) => sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(i * 7, (i + 1) * 7) } })),
      sse({ type: "content_block_stop", index: 0 }) + sse({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } }) + sse({ type: "message_stop" }),
    ];
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(encoder.encode(p)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  it("delivers each card as it completes, from the gateway's stream on the founder's key", async () => {
    const gw = gateway(() => stream());
    const usage: UsageEvent[] = [];
    const client = routeOwnKeyCalls(new MockModelClient(), { ownKey: async () => true, clientFor: ownKeyViaGateway({ gatewayUrl: "http://gateway.test", serviceToken: async () => "svc-token", fetch: gw.fetch, onUsage: (e) => void usage.push(e) }) });
    const seen: string[] = [];
    const r = await client.streamStructured!({ route: "ideation", messages: [{ role: "user", content: "go" }], schema: Cards, elementPath: "concepts", elementSchema: Card, attribution: { businessId: OWN }, onElement: (e) => void seen.push(e.value.name) });
    expect(seen).toEqual(["First", "Second"]);
    expect(r.json).toEqual({ concepts: [{ name: "First" }, { name: "Second" }] });
    expect(gw.calls[0]!.url).toBe(`http://gateway.test/v1/models/anthropic/${OWN}/v1/messages`);
    expect(gw.calls[0]!.body.stream).toBe(true);
    expect(usage.map((e) => e.billedTo)).toEqual(["byok"]);
  });
});
