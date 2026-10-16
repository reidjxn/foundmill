/**
 * @foundmill/composer — Inbox Composer + Refresh buffer + Journey commentary + chapter titles (docs/ARCHITECTURE.md §11).
 *
 * Boot: load env → service database (repositories only; four connections kept open, packages/db `keepPoolWarm`, so a
 * Refresh after a quiet spell does not open them) → models client (mock or live, usage metered into
 * usage_ledger) → Hono app → listen on PORT (fallback COMPOSER_PORT) on host "::" (Railway's private network is
 * IPv6-only, §17; falls back to 0.0.0.0 where IPv6 is unavailable). SIGTERM/SIGINT: stop accepting connections, let
 * in-flight requests finish, drain buffer refills, close the database pool, exit 0, within SHUTDOWN_TIMEOUT_MS
 * (docs/DEPLOY.md §3).
 */
import { serve } from "@hono/node-server";
import { createServiceDb, closeDb, keepPoolWarm, type PoolWarmer } from "@foundmill/db";
import { createModelClient, effectiveModelMode, gateModelClient } from "@foundmill/models";
import { loadEnv, servicePort } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { drainHttpServer, onShutdown } from "@foundmill/shared/shutdown";
import { installTelemetry } from "@foundmill/shared/telemetry";
import { createApp } from "./app";
import { prepareDb } from "./db-boot";
import { createComposerService } from "./service";
import { createUsageSink, creditsGate } from "./usage";

export { createApp, NarrateBody, RefreshBody, CommentaryBody, ChapterTitleBody, type ComposerApp } from "./app";
export { ComposerService, createComposerService, narrationKey, type ComposerServiceDeps, type ComposerServiceOptions, type NarrateResult } from "./service";
export { RefreshEngine, type RefreshResult, type RefreshEngineOptions } from "./refresh";
export { composeNote, ComposerSchema, ComposerRejectedError, ComposeTimeoutError, blocksContinueFor, composerInputs, CUSTOMER_UPDATE_OPTIONS, DEFAULT_DECISION_OPTIONS, type ComposedNote, type ComposeBrief } from "./compose";
export { loadContext, NARRATABLE_EVENT_TYPES, type ComposeContext } from "./context";
export { NAMED_QUERIES, NAMED_QUERY_IDS, getNamedQuery, isNamedQueryId, namedQueryCatalogue, runNamedQuery, sanitizeExhibit, type ExhibitData, type NamedQuery, type NamedQueryId } from "./exhibits";
export { loadMetricsSnapshot, statusMetrics, estimateRunwayMonths, runwayThresholdsBelow, blocksForRunway, type MetricsSnapshot } from "./metrics";
export { computeInsights, DEFAULT_INSIGHT_THRESHOLDS, type Insight, type InsightThresholds } from "./insights";
export { nextBestDecision, type NextBestDecision } from "./decisions";
export { composeCommentary, type CommentaryResult, type CommentaryLine } from "./commentary";
export { composeChapterTitle, loadQuarterFacts, parseQuarter, quarterOf, provisionalTitle, titleAcceptable, ChapterTitleOutput, type ChapterTitleResult } from "./chapter";
export { createUsageSink, creditsGate } from "./usage";
export { persistNote, persistDrafts, findPersisted, writeEventRow } from "./persist";
export { prepareDb, type DbReadiness } from "./db-boot";

export async function main(): Promise<void> {
  const env = loadEnv();
  // Traces to OTEL_EXPORTER_OTLP_ENDPOINT and error reports to SENTRY_DSN, when set (packages/shared telemetry.ts).
  const telemetry = installTelemetry("composer", env);
  const log = createLogger("composer", env.LOG_LEVEL);
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; the composer cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  let server: ReturnType<typeof serve> | null = null;
  let service: ReturnType<typeof createComposerService> | null = null;
  let warmer: PoolWarmer | null = null;
  const lifecycle = onShutdown({
    service: "composer",
    log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    steps: () => [
      {
        name: "drain http",
        run: async ({ remainingMs }) => {
          if (!server) return;
          const { forced } = await drainHttpServer(server, { timeoutMs: Math.max(0, remainingMs - 10_000) });
          if (forced > 0) log.warn({ forced }, "composer: connections still open at the drain deadline were cut");
        },
      },
      { name: "drain buffer refills", run: () => service?.drain() },
      { name: "stop pool warmer", run: () => warmer?.stop() },
      { name: "close database", run: () => closeDb(db) },
      { name: "flush telemetry", run: () => telemetry.shutdown() },
    ],
  });
  // PGlite boots + migrates here; a locked directory or an unreachable Postgres is one clear line and /health says db:false.
  const readiness = await prepareDb(db, log, { service: "composer" });
  warmer = keepPoolWarm(db, { connections: 4, onError: (err) => log.warn({ err: (err as Error)?.message }, "warming the database pool failed") });
  const platform = createModelClient({ mode: effectiveModelMode(env.MODEL_MODE, env.ANTHROPIC_API_KEY, log), apiKey: env.ANTHROPIC_API_KEY, logger: log, onUsage: createUsageSink(db, log) });
  // The platform key's ceiling: no call for a business whose credits are used up (usage.ts `creditsGate`).
  const models = gateModelClient(platform, creditsGate(db, platform.mode === "live"));
  service = createComposerService({ db, models, log });
  const app = createApp(service, { env, log });
  const port = servicePort(env, "COMPOSER_PORT");

  if (lifecycle.stopping) return;
  server = await listen(app, port, log);
  log.info({ db: readiness.ok, driver: readiness.driver, modes: { integrations: env.INTEGRATIONS_MODE, models: env.MODEL_MODE } }, "composer ready (refresh debounce and buffer refills are in-process; no Redis needed)");
}

export function listen(app: ReturnType<typeof createApp>, port: number, log: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void }, hosts: readonly string[] = ["::", "0.0.0.0"]): Promise<ReturnType<typeof serve>> {
  const [hostname, ...rest] = hosts;
  if (!hostname) return Promise.reject(new Error("no address family available to listen on"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      settled = true;
      log.info({ port: info.port, hostname }, "composer listening");
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
if (/apps[\\/]composer[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
