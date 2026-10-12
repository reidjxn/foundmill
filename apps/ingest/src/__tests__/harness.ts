/**
 * Test harness: PGlite with every migration, two businesses from the db fixture, the default connector registry in
 * mock mode, a memory nonce store, no after-commit follow-ups (unless a test passes its own) and the ingest clock pinned
 * to `MOCK_NOW` (the instant the mock connectors sign their deliveries at). `serve()` binds an ephemeral port on 127.0.0.1 so the raw-body path through
 * @hono/node-server is what the webhook tests exercise.
 */
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createDefaultRegistry, MOCK_NOW } from "@foundmill/connectors";
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db, type Event } from "@foundmill/db";
import type { EventType } from "@foundmill/shared";
import { buildIngest, type BuildIngestOptions, type BuiltIngest } from "../index";
import { noFollowups } from "../followups";
import { MemoryNonceStore } from "../nonce-store";
import { signSimulateToken, type SignSimulateTokenInput } from "../simulate-token";
import { silentLogger } from "../types";

/** The `SESSION_TOKEN_SECRET` of the test ingest (never a real one). */
export const SIMULATE_TEST_SECRET = "ingest-test-session-token-secret";

/** A service token for `businessId` as apps/api would mint it, dated at the ingest clock (`MOCK_NOW`). */
export const simulateToken = (businessId: string, extra: Partial<SignSimulateTokenInput> = {}, secret = SIMULATE_TEST_SECRET, now: () => Date = () => MOCK_NOW): string => signSimulateToken(secret, { businessId, svc: "api", ...extra }, now);

export interface IngestHarness {
  h: TestHarness;
  db: Db;
  A: BusinessFixture;
  B: BusinessFixture;
  built: BuiltIngest;
  /** Base URL of the running server. */
  base: string;
  /** Build another app over the same database (e.g. with Simulate disabled). */
  build(options?: BuildIngestOptions): BuiltIngest;
  events(businessId: string, type?: EventType): Promise<Event[]>;
  close(): Promise<void>;
}

export async function createIngestHarness(prefix: string, options: BuildIngestOptions = {}): Promise<IngestHarness> {
  const h = await createTestDb();
  const db = h.db as unknown as Db;
  const [A, B] = await Promise.all([createBusinessFixture(h, `${prefix}-a`), createBusinessFixture(h, `${prefix}-b`)]);
  const registry = createDefaultRegistry({ now: () => MOCK_NOW });
  // APP_ENV is "development" so the Simulate gate (packages/config `simulatePanelHonoured`) is exercised as the
  // real thing rather than bypassed for tests; the secret is what `simulateToken()` signs with.
  const build = (extra: BuildIngestOptions = {}) =>
    buildIngest({
      env: { APP_ENV: "development", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "", MODEL_MODE: "mock" } as BuiltIngest["env"],
      db,
      registry,
      vault: null,
      nonces: new MemoryNonceStore({ now: () => MOCK_NOW.getTime() }),
      log: silentLogger,
      now: () => MOCK_NOW,
      simulateEnabled: true,
      simulateTokenSecret: SIMULATE_TEST_SECRET,
      // No composer or Temporal in unit tests; followups.test.ts passes recording ones.
      followups: noFollowups,
      ...options,
      ...extra,
    });
  const built = build();
  let base = "";
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: built.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve(s);
    });
  });
  return {
    h,
    db,
    A,
    B,
    built,
    get base() {
      return base;
    },
    build,
    async events(businessId, type) {
      const page = await repos.events.list(db, businessId, { limit: 500, ...(type ? { type } : {}) });
      // The db fixture seeds six placeholder events per business; only what ingest wrote is of interest here.
      return page.items.filter((e) => e.actor.kind === "webhook" || e.actor.id === "simulate");
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await h.close();
    },
  };
}

/** Send a prepared `Request` (built by a connector helper against https://ingest.example) to the running server. */
export async function deliver(base: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  const body = await req.clone().arrayBuffer();
  return fetch(`${base}${url.pathname}${url.search}`, { method: req.method, headers, body: body.byteLength ? body : undefined });
}

export const json = async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T;
