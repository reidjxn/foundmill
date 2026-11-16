/**
 * @foundmill/sites — Foundmill Sites (WP-07 T4; apps/sites/CLAUDE.md). Boot: load env → the `sites_reader` database
 * connection (DATABASE_URL; it can execute the site functions and read no table) → Hono app → listen on `PORT`
 * (fallback `SITES_PORT`, 4007) on `::` with a 0.0.0.0 fallback. SIGTERM/SIGINT drain the server and close the pool.
 * With SITES_DOMAIN unset it starts and every site host answers 404.
 */
import { serve, type ServerType } from "@hono/node-server";
import { APP_NAME, type TierKey } from "@foundmill/config";
import { closeDb, createServiceDb, repos, type Executor } from "@foundmill/db";
import { loadEnv, sitesDomain, type Env } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { drainHttpServer, onShutdown } from "@foundmill/shared/shutdown";
import { createSitesApp, SITES_SERVICE, type SitesDeps, type SitesLogger } from "./app";

export * from "./app";
export * from "./headers";
export * from "./pages";

const TIERS: readonly TierKey[] = ["free", "pro", "scale"];
/** An unknown plan reads as free: the mark shows rather than vanishing by mistake. */
const tierOf = (value: string): TierKey => (TIERS.includes(value as TierKey) ? (value as TierKey) : "free");

/**
 * The app's database calls. `run` wraps each one (tests run them as `sites_reader` to prove the login is enough).
 */
export function sitesDeps(options: { env: Pick<Env, "APP_ENV" | "APP_URL" | "SITES_DOMAIN">; run: <T>(fn: (db: Executor) => Promise<T>) => Promise<T>; log: SitesLogger }): SitesDeps {
  const { env, run, log } = options;
  return {
    env: { APP_ENV: env.APP_ENV, APP_URL: env.APP_URL, SITES_DOMAIN: sitesDomain(env) },
    resolve: async (label) => {
      const host = await run((db) => repos.sites.resolveHost(db, label));
      return host ? { ...host, planTier: tierOf(host.planTier) } : null;
    },
    readFile: (releaseId, path) => run((db) => repos.sites.readFile(db, releaseId, path)),
    report: (label, reason, detail) => run((db) => repos.sites.report(db, label, { reason, detail })),
    // A call of a function the login may execute proves the connection (an invalid label resolves nothing).
    ping: async () => (await run((db) => repos.sites.resolveHost(db, "-")), true),
    log,
  };
}

export const DEFAULT_SITES_PORT = 4007;

function listen(fetch: (req: Request) => Response | Promise<Response>, port: number, hosts: readonly string[] = ["::", "0.0.0.0"]): Promise<ServerType> {
  const [hostname, ...rest] = hosts;
  if (!hostname) return Promise.reject(new Error("no address family available to listen on"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch, port, hostname }, () => {
      settled = true;
      resolve(server);
    });
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      if ((err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL") && rest.length > 0) {
        server.close();
        listen(fetch, port, rest).then(resolve, reject);
      } else reject(err);
    });
  });
}

export async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(SITES_SERVICE, env.LOG_LEVEL) as unknown as SitesLogger;
  if (!env.DATABASE_URL) {
    log.warn({}, "DATABASE_URL is not set; sites cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  let server: ServerType | null = null;
  const lifecycle = onShutdown({
    service: SITES_SERVICE,
    log: log as never,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      { name: "drain http", run: async ({ remainingMs }) => void (server && (await drainHttpServer(server, { timeoutMs: Math.max(0, remainingMs - 5_000) }))) },
      { name: "close database", run: () => closeDb(db) },
    ],
  });
  const app = createSitesApp(sitesDeps({ env, run: (fn) => fn(db), log }));
  const port = env.PORT ?? DEFAULT_SITES_PORT;
  if (lifecycle.stopping) return;
  server = await listen(app.fetch, port);
  log.info({ port, domain: sitesDomain(env) }, `${APP_NAME} sites listening`);
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]sites[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
