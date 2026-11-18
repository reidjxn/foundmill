/**
 * A founder's own Anthropic key reaches the api's model calls (WP-13 T11). Every procedure calls `ctx.models`, which is
 * this client, so the desk, team calls, the plan compiler, the task graph, the recommenders, the logo, the page quiz,
 * post drafts and the agent builder all take this route. In live mode a business on its own key, free or paid, is
 * answered through the gateway's model route on its key and booked `byok`; a refused key reaches the founder as its
 * sentence (PRECONDITION_FAILED), never a silent fallback to Foundmill's key.
 */
import { repos } from "@foundmill/db";
import { MODELS, OWN_KEY_REFUSED } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiModelClient } from "../services/models";
import { toTRPCError } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const log = { debug() {}, info() {}, warn() {}, error() {} } as never;

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ownkeycalls" });
  await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "byok" });
});
afterAll(async () => {
  await hz?.close();
});

function gateway(status = 200) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers as HeadersInit).get("authorization") });
    if (status !== 200) return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: MODELS.opus, content: [{ type: "text", text: "Answered on your key." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 300, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const client = (gw: ReturnType<typeof gateway>) =>
  createApiModelClient({ MODEL_MODE: "live", ANTHROPIC_API_KEY: "sk-ant-platform-key-not-used-here" }, log, { db: hz.db, ownKeyGateway: { url: "http://gateway.internal:4001", serviceToken: async () => "svc-api" }, gatewayFetch: gw.fetch });

describe("the api's calls on a founder's own key (WP-13 T11)", () => {
  it("answers a free business on its own key through the gateway, on the route's own model, booked byok", async () => {
    const gw = gateway();
    const result = await client(gw).complete({ route: "chiefOfStaff", messages: [{ role: "user", content: "Plan the week." }], attribution: { businessId: hz.A.businessId, kind: "test" } });
    expect(result.text).toBe("Answered on your key.");
    expect(gw.calls).toEqual([{ url: `http://gateway.internal:4001/v1/models/anthropic/${hz.A.businessId}/v1/messages?beta=true`, auth: "Bearer svc-api" }]);
    const rows = (await repos.usage.list(hz.db, hz.A.businessId, { limit: 10 })).items;
    expect(rows[0]).toMatchObject({ billedTo: "byok", modelKey: "opus" });
  });

  it("answers a refused key with its sentence, as a precondition, and never calls Foundmill's key instead", async () => {
    const gw = gateway(401);
    const err = await client(gw)
      .complete({ route: "chiefOfStaff", messages: [{ role: "user", content: "Plan the week." }], attribution: { businessId: hz.A.businessId, kind: "test" } })
      .catch((e: unknown) => e);
    expect(toTRPCError(err)).toMatchObject({ code: "PRECONDITION_FAILED", message: OWN_KEY_REFUSED });
    expect(gw.calls).toHaveLength(1);
  });
});
