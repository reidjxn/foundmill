/**
 * `POST /v1/push/send` (docs/mobile/BACKEND_CHANGES.md §4): only the api asks, with subscription ids, a title, a body and
 * routing data; live mode calls OneSignal with the platform app id and key, mock mode accepts everything; a missing key
 * is a clear 503; the business's window limits the calls; the audit row carries the counts, never the words.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOnesignalConnector, createRegistry, jsonResponse, routedFetch } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { createGatewayApp } from "../app";
import type { GatewayDeps } from "../pipeline";
import { MemoryRateLimitStore } from "../rate-limit";
import { UntrustedRecipientRegistry } from "../recipients";
import { signServiceToken } from "../tokens";
import { silentLog, TEST_SECRET } from "./harness";

let h: TestHarness;
let db: Db;
let businessId: string;
beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  businessId = (await repos.businesses.create(db, { name: "Push Co" })).id;
}, 120_000);
afterAll(() => h?.close());

interface Opts {
  mode?: "mock" | "live";
  keys?: boolean;
  seen?: { auth: string | null; body: Record<string, unknown> }[];
  liveConnectors?: string[];
  status?: number;
  answer?: unknown;
  now?: () => Date;
  logs?: { level: string; args: unknown[] }[];
}

const APP_ID = "app-1111-2222";
const API_KEY = "os_v2_app_platformkeyplatformkeyplatformkey";
const ids = ["sub-0123456789abcdef-1", "sub-0123456789abcdef-2"];

function appFor(opts: Opts = {}) {
  const live = createOnesignalConnector({
    secrets: opts.keys ? { onesignalAppId: APP_ID, onesignalApiKey: API_KEY } : {},
    fetch: routedFetch({
      "POST https://api.onesignal.com/notifications": async (req) => {
        opts.seen?.push({ auth: req.headers.get("authorization"), body: (await req.json()) as Record<string, unknown> });
        if (opts.status && opts.status !== 200) return jsonResponse(opts.answer ?? { errors: ["Internal error"] }, { status: opts.status });
        return jsonResponse(opts.answer ?? { id: "ntf-1", recipients: 2 });
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
    rateLimits: new MemoryRateLimitStore(),
    recipients: new UntrustedRecipientRegistry(),
    log: opts.logs ? { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error"), child: () => silentLog } : silentLog,
    ...(opts.now ? { now: opts.now } : {}),
  };
  return createGatewayApp(deps, { sessionTokenSecret: TEST_SECRET });
}

const request = (overrides: Record<string, unknown> = {}) => ({ businessId, kind: "decision", subscriptionIds: ids, title: "Needs your answer", body: "Juno (Chief of Staff): Approve batch 002 before the Ireland launch?", data: { businessId, kind: "decision", itemId: "item-1" }, ...overrides });

async function post(app: ReturnType<typeof appFor>, body: unknown, svc: string | null = "api") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (svc) headers.authorization = `Bearer ${await signServiceToken(TEST_SECRET, svc)}`;
  const res = await app.request("/v1/push/send", { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { mode?: string; id?: string; recipients?: number; errors?: string[]; error?: { code: string; message: string } } };
}

describe("push through the gateway", () => {
  it("mock mode: accepts every subscription and answers a deterministic id", async () => {
    const app = appFor();
    const a = await post(app, request());
    const b = await post(app, request());
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ mode: "mock", recipients: 2, errors: [] });
    expect(a.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.body.id).toBe(a.body.id);
  });

  it("live mode: asks OneSignal with the platform app id and key; the key never leaves the header", async () => {
    const seen: NonNullable<Opts["seen"]> = [];
    const res = await post(appFor({ mode: "live", keys: true, seen }), request({ collapseKey: "inbox:item-1" }));
    expect(res).toMatchObject({ status: 200, body: { mode: "live", id: "ntf-1", recipients: 2 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.auth).toBe(`Key ${API_KEY}`);
    expect(seen[0]!.body).toMatchObject({ app_id: APP_ID, include_subscription_ids: ids, headings: { en: "Needs your answer" }, contents: { en: "Juno (Chief of Staff): Approve batch 002 before the Ireland launch?" }, data: { businessId, kind: "decision", itemId: "item-1" }, collapse_id: "inbox:item-1" });
    expect(JSON.stringify(seen[0]!.body)).not.toContain(API_KEY);
  });

  it("LIVE_CONNECTORS=onesignal makes only push live while connectors are mock", async () => {
    const seen: NonNullable<Opts["seen"]> = [];
    expect((await post(appFor({ mode: "mock", liveConnectors: ["onesignal"], keys: true, seen }), request())).body.mode).toBe("live");
    expect((await post(appFor({ mode: "mock", liveConnectors: ["stripe"], keys: true, seen }), request())).body.mode).toBe("mock");
    expect(seen).toHaveLength(1);
  });

  it("refuses a malformed body with a 400 before any vendor call", async () => {
    const seen: NonNullable<Opts["seen"]> = [];
    const app = appFor({ mode: "live", keys: true, seen });
    for (const body of [request({ subscriptionIds: [] }), request({ title: "" }), request({ kind: "marketing" }), request({ businessId: "nope" }), request({ body: "x".repeat(241) }), {}]) {
      expect((await post(app, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it("only the api may ask, with a service token", async () => {
    const app = appFor();
    expect((await post(app, request(), "orchestrator")).status).toBe(403);
    expect((await post(app, request(), null)).status).toBe(401);
  });

  it("live without the keys is a clear 503 and nothing is called", async () => {
    const seen: NonNullable<Opts["seen"]> = [];
    const res = await post(appFor({ mode: "live", seen }), request());
    expect(res).toMatchObject({ status: 503, body: { error: { code: "push_unconfigured" } } });
    expect(res.body.error?.message).toContain("ONESIGNAL_APP_ID");
    expect(seen).toHaveLength(0);
  });

  it("a vendor failure is a 502, a busy vendor a 429, neither with the vendor's words or the key", async () => {
    const down = await post(appFor({ mode: "live", keys: true, status: 500 }), request());
    // A 5xx answer carries no details (the gateway's onError keeps details for 4xx only), so the vendor's status stays in the log.
    expect(down).toMatchObject({ status: 502, body: { error: { code: "push_unavailable" } } });
    expect(JSON.stringify(down.body)).not.toContain("Internal error");
    const busy = await post(appFor({ mode: "live", keys: true, status: 429, answer: { errors: ["Too many requests"] } }), request());
    expect(busy).toMatchObject({ status: 429, body: { error: { code: "push_rate_limited" } } });
    const badKey = await post(appFor({ mode: "live", keys: true, status: 401, answer: { errors: [`Access denied. Key ${API_KEY}`] } }), request());
    expect(badKey.status).toBe(502);
    expect(JSON.stringify(badKey.body)).not.toContain(API_KEY);
  });

  it("an answer with no id means nothing was sent: zero recipients, still a 200 with the notes", async () => {
    const res = await post(appFor({ mode: "live", keys: true, answer: { id: "", errors: ["All included players are not subscribed"] } }), request());
    expect(res).toMatchObject({ status: 200, body: { id: "", recipients: 0, errors: ["All included players are not subscribed"] } });
  });

  it("the business's window limits the calls (600 a minute)", async () => {
    let at = Date.parse("2026-11-08T10:00:10Z");
    const app = appFor({ now: () => new Date(at) });
    for (let i = 0; i < 600; i++) expect((await post(app, request())).status).toBe(200);
    expect(await post(app, request())).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    at += 60_000;
    expect((await post(app, request())).status).toBe(200);
  }, 60_000);

  it("logs and audits the kind and the counts, never the title, the body or the key", async () => {
    const logs: NonNullable<Opts["logs"]> = [];
    const res = await post(appFor({ mode: "live", keys: true, logs }), request({ kind: "customer", title: "New customer", body: "Bo Yun just became a paying customer · £96.00" }));
    expect(res.status).toBe(200);
    const logged = JSON.stringify(logs);
    expect(logged).toContain("customer");
    expect(logged).not.toContain("Bo Yun");
    expect(logged).not.toContain(API_KEY);
    const audit = await repos.audit.list(db, businessId, { action: "gateway.push.sent" });
    expect(audit.items[0]).toMatchObject({ actorKind: "system", target: { kind: "push", id: "ntf-1" }, details: { service: "api", mode: "live", kind: "customer", devices: 2, recipients: 2 } });
    expect(JSON.stringify(audit.items[0])).not.toContain("Bo Yun");
  });
});
