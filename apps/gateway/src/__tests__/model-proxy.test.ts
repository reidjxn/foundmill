/**
 * `POST /v1/models/anthropic/:businessId/v1/messages` (WP-13 T11): a byok business's call is answered on its own key
 * (the recording fetch sees the founder's key and Anthropic's own answer comes back); a credits business, a business
 * with no stored key, another service and a model Foundmill does not route are refused with no Anthropic call; the key
 * is never logged or echoed.
 */
import { createDefaultRegistry } from "@foundmill/connectors";
import { BYOK_CREDENTIAL_KIND, repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { MODELS } from "@foundmill/models";
import { buildAad, encryptJson, generateMasterKey, LocalVault } from "@foundmill/shared/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGatewayApp } from "../app";
import type { GatewayDeps, GatewayLogger } from "../pipeline";
import { MemoryRateLimitStore } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { signServiceToken } from "../tokens";
import { TEST_SECRET } from "./harness";

const KEY = "sk-ant-api03-founder-own-key-for-models-0123456789";
const COMPOSER_SECRET = "composer-own-secret-0123456789-abcdefgh";
let h: TestHarness;
let db: Db;
let vault: LocalVault;
let ownKeyId: string;
let creditsId: string;
let noKeyId: string;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  vault = new LocalVault(generateMasterKey());
  ownKeyId = (await repos.businesses.create(db, { name: "Own Key Co" })).id;
  creditsId = (await repos.businesses.create(db, { name: "Credits Co" })).id;
  noKeyId = (await repos.businesses.create(db, { name: "No Key Co" })).id;
  await repos.businesses.update(db, ownKeyId, { modelBilling: "byok" });
  await repos.businesses.update(db, noKeyId, { modelBilling: "byok" });
  const integration = await repos.integrations.upsert(db, ownKeyId, { connectorKey: "anthropic", status: "connected", authKind: "api_key", accountLabel: "sk-a***" });
  const payload = { kind: "api_key", secret: KEY };
  const meta = await repos.credentials.store(db, ownKeyId, { integrationId: integration.id, kind: BYOK_CREDENTIAL_KIND, record: await encryptJson(vault, payload, buildAad(ownKeyId, "credentials", "pending")) });
  await repos.credentials.rotate(db, ownKeyId, meta.id, await encryptJson(vault, payload, buildAad(ownKeyId, "credentials", meta.id)));
}, 120_000);
afterAll(() => h?.close());

function setup() {
  const logs: string[] = [];
  const upstream: { url: string; headers: Record<string, string>; body: string }[] = [];
  const anthropicFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    upstream.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()), body: String(init?.body) });
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: MODELS.sonnet, content: [{ type: "text", text: "Yours." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1", "x-internal": "drop me" } });
  }) as typeof globalThis.fetch;
  const line = (...args: unknown[]) => void logs.push(JSON.stringify(args));
  const log: GatewayLogger = { debug: line, info: line, warn: line, error: line, child: () => log };
  const deps: GatewayDeps = { db, registry: createDefaultRegistry({ secrets: {} }), vault, mode: "live", rateLimits: new MemoryRateLimitStore(), recipients: new UntrustedRecipientRegistry(), log, anthropicFetch };
  return { app: createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET, composerServiceTokenSecret: COMPOSER_SECRET }), upstream, logs };
}

interface SendOptions {
  svc?: string | null;
  /** The secret the token is signed with: the composer's own for `svc: composer` unless a test says otherwise. */
  secret?: string;
  /** The business the token names (default: the one in the path). */
  tokenBusiness?: string | null;
  model?: string;
  search?: string;
  beta?: string;
  extra?: Record<string, unknown>;
}

async function send(app: ReturnType<typeof setup>["app"], businessId: string, opts: SendOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": "own-key-at-gateway" };
  const svc = opts.svc === undefined ? "api" : opts.svc;
  if (svc !== null) headers.authorization = `Bearer ${await signServiceToken(opts.secret ?? (svc === "composer" ? COMPOSER_SECRET : TEST_SECRET), svc, 60, opts.tokenBusiness === null ? undefined : (opts.tokenBusiness ?? businessId))}`;
  if (opts.beta) headers["anthropic-beta"] = opts.beta;
  const res = await app.request(`/v1/models/anthropic/${businessId}/v1/messages${opts.search ?? ""}`, { method: "POST", headers, body: JSON.stringify({ model: opts.model ?? MODELS.sonnet, max_tokens: 64, messages: [{ role: "user", content: "Hi" }], ...opts.extra }) });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

describe("the own-key model route (WP-13 T11)", () => {
  it("answers a byok business on its own key, for the api and the composer, and passes Anthropic's answer back", async () => {
    const { app, upstream, logs } = setup();
    for (const svc of ["api", "composer"]) {
      const r = await send(app, ownKeyId, { svc });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).toMatchObject({ content: [{ text: "Yours." }] });
      expect(r.headers.get("request-id")).toBe("req_1");
      expect(r.headers.get("x-internal")).toBeNull();
      expect(r.text).not.toContain(KEY);
    }
    expect(upstream).toHaveLength(2);
    expect(upstream[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(upstream[0]!.headers["x-api-key"]).toBe(KEY);
    expect(upstream[0]!.headers.authorization).toBeUndefined();
    expect(logs.join("\n")).not.toContain(KEY);
    // The beta endpoint (fast mode) keeps its query.
    await send(app, ownKeyId, { search: "?beta=true" });
    expect(upstream[2]!.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
  });

  it("refuses a credits business and a byok business with no stored key, with 409 and no call", async () => {
    const { app, upstream } = setup();
    for (const id of [creditsId, noKeyId]) {
      const r = await send(app, id);
      expect(r.status).toBe(409);
      expect(JSON.parse(r.text)).toMatchObject({ type: "error", error: { type: "own_key_missing" } });
    }
    expect(upstream).toHaveLength(0);
  });

  it("refuses no token, another service, and a model Foundmill does not route, with no call", async () => {
    const { app, upstream } = setup();
    expect((await send(app, ownKeyId, { svc: null })).status).toBe(401);
    expect((await send(app, ownKeyId, { svc: "orchestrator" })).status).toBe(403);
    expect((await send(app, ownKeyId, { model: "claude-made-up-1" })).status).toBe(400);
    expect((await send(app, ownKeyId, { model: MODELS.glm })).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("refuses a composer token signed with the shared secret, and a token for another business (security review)", async () => {
    const { app, upstream } = setup();
    // Every service holds the shared secret: claiming to be the composer with it is not enough.
    expect((await send(app, ownKeyId, { svc: "composer", secret: TEST_SECRET })).status).toBe(403);
    // A token minted for one business cannot spend another's key, nor a token that names none.
    expect((await send(app, ownKeyId, { tokenBusiness: creditsId })).status).toBe(403);
    expect((await send(app, ownKeyId, { tokenBusiness: null })).status).toBe(403);
    expect(upstream).toHaveLength(0);
  });

  it("refuses MCP servers, containers, server tools and other betas on the founder's account, and forwards only the parsed body", async () => {
    const { app, upstream } = setup();
    expect((await send(app, ownKeyId, { extra: { mcp_servers: [{ type: "url", url: "https://example.test/mcp", name: "x" }] } })).status).toBe(400);
    expect((await send(app, ownKeyId, { extra: { container: "c1" } })).status).toBe(400);
    expect((await send(app, ownKeyId, { extra: { tools: [{ type: "web_fetch_20250910", name: "web_fetch" }] } })).status).toBe(400);
    expect((await send(app, ownKeyId, { beta: "code-execution-2025-08-25" })).status).toBe(400);
    expect(upstream).toHaveLength(0);
    expect((await send(app, ownKeyId, { extra: { tools: [{ name: "report", input_schema: { type: "object" } }] } })).status).toBe(200);
    expect(JSON.parse(upstream[0]!.body)).toMatchObject({ model: MODELS.sonnet, tools: [{ name: "report" }] });
  });
});
