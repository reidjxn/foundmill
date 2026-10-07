/**
 * @foundmill/social — LIVE network, communities, leaderboards (docs/ARCHITECTURE.md §1; BUILD §11.14; Phase 4).
 *
 * Skeleton only now: `/health`, `GET /v1/public-profiles` over the `public_profiles` view, and 501 placeholders for
 * the Phase 4 routers. Boot: load env → service database (repositories only) → Hono app → listen on PORT (fallback
 * SOCIAL_PORT) on host "::" (Railway's private network is IPv6-only, §17; falls back to 0.0.0.0 where IPv6 is
 * unavailable) → graceful shutdown.
 */
import { serve } from "@hono/node-server";
import { closeDb, createServiceDb } from "@foundmill/db";
import { createLogger, loadEnv, servicePort } from "@foundmill/shared";
import { createApp } from "./app";
import { prepareDb } from "./db-boot";

export { prepareDb, type DbReadiness } from "./db-boot";
export { createApp, PHASE4_ROUTERS, PublicProfilesQuery, SOCIAL_SERVICE, type AppOptions, type Phase4Feature, type SocialApp, type SocialLogger } from "./app";

export async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger("social", env.LOG_LEVEL);
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; the social service cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  // PGlite boots + migrates here; a locked directory or an unreachable Postgres is one clear line and /health says db:false.
  const readiness = await prepareDb(db, log, { service: "social" });
  const app = createApp(db, { env, log, dbReady: () => readiness.ok });
  const server = await listen(app, servicePort(env, "SOCIAL_PORT"), log);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "social shutting down");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb(db);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

export interface ListenLogger {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
}

/** Binds the app to the first host that supports the address family; resolves with the Node server (port via `address()`). */
export function listen(app: ReturnType<typeof createApp>, port: number, log: ListenLogger, hosts: readonly string[] = ["::", "0.0.0.0"]): Promise<ReturnType<typeof serve>> {
  const [hostname, ...rest] = hosts;
  if (!hostname) return Promise.reject(new Error("no address family available to listen on"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      settled = true;
      log.info({ port: info.port, hostname }, "social listening");
      resolve(server);
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      if ((err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") && rest.length > 0) {
        log.warn({ hostname, code: err.code }, "address family unavailable; falling back");
        server.close();
        listen(app, port, log, rest).then(resolve, reject);
      } else reject(err);
    });
  });
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]social[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
