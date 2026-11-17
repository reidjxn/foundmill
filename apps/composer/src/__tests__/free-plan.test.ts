/** The composer's client chooses by who pays (WP-13): a free business runs on Haiku 5.5, a paid plan as routed. */
import { repos } from "@foundmill/db";
import { createHmac } from "node:crypto";
import { MockModelClient, MODELS, type ModelClient, type UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composerModelClient, composerServiceToken } from "../usage";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("freeplan");
});
afterAll(async () => {
  await hz?.close();
});

describe("composerModelClient (WP-13)", () => {
  it("writes a free business's Inbox note on Haiku 5.5 and a paid plan's on its locked model", async () => {
    const events: UsageEvent[] = [];
    const client = composerModelClient(new MockModelClient({ onUsage: (e) => void events.push(e) }), hz.db);
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "credits" });
    await repos.businesses.update(hz.db, hz.B.businessId, { planTier: "pro", modelBilling: "credits" });
    for (const businessId of [hz.A.businessId, hz.B.businessId]) await client.complete({ route: "inboxComposer", attribution: { businessId, kind: "test" }, messages: [{ role: "user", content: "today" }] });
    expect(events.map((e) => e.model)).toEqual([MODELS.haiku, MODELS.opus]);
  });
});

describe("composerModelClient on a founder's own key (WP-13 T11)", () => {
  const SECRET = "composer-test-secret-0123456789-abcdef";
  it("writes an own-key business's note through the gateway's route on its key, booked byok, and keeps others on the platform", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers as HeadersInit).get("authorization") });
      return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: MODELS.opus, content: [{ type: "text", text: "Your note." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    const own: UsageEvent[] = [];
    const mock = new MockModelClient();
    // The router applies to a live platform client only; this one answers like the mock.
    const platform: ModelClient = { mode: "live", complete: mock.complete.bind(mock) as ModelClient["complete"] };
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "byok" });
    await repos.businesses.update(hz.db, hz.B.businessId, { planTier: "pro", modelBilling: "credits" });
    const client = composerModelClient(platform, hz.db, undefined, { gatewayUrl: "http://gateway.internal:4001", secret: SECRET, onUsage: (e) => void own.push(e), logger: log, fetch });
    const note = await client.complete({ route: "inboxComposer", attribution: { businessId: hz.A.businessId, kind: "test" }, messages: [{ role: "user", content: "today" }] });
    expect(note.text).toBe("Your note.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`http://gateway.internal:4001/v1/models/anthropic/${hz.A.businessId}/v1/messages`);
    expect(own.map((e) => e.billedTo)).toEqual(["byok"]);
    await client.complete({ route: "inboxComposer", attribution: { businessId: hz.B.businessId, kind: "test" }, messages: [{ role: "user", content: "today" }] });
    expect(calls).toHaveLength(1);
    expect(mock.history).toHaveLength(1);
    await repos.businesses.update(hz.db, hz.A.businessId, { modelBilling: "credits" });
  });

  it("signs the gateway's service token as the gateway checks it: HS256, svc composer, 60 seconds", async () => {
    const token = await composerServiceToken(SECRET, hz.A.businessId, 1_800_000_000_000);
    const [head, body, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(body!, "base64url").toString())).toMatchObject({ svc: "composer", businessId: hz.A.businessId, iss: "foundmill-gateway", aud: "foundmill-gateway/service", iat: 1_800_000_000, exp: 1_800_000_060 });
    expect(signature).toBe(createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url"));
  });
});
