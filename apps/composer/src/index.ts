/**
 * @foundmill/composer — Inbox Composer + Refresh buffer + Journey commentary + chapter titles (docs/ARCHITECTURE.md §11).
 *
 * Boot: load env → service database (repositories only) → models client (mock or live, usage metered into
 * usage_ledger) → Hono app → listen on PORT (fallback COMPOSER_PORT) on host "::" (Railway's private network is
 * IPv6-only, §17; falls back to 0.0.0.0 where IPv6 is unavailable) → drain buffer refills on SIGTERM/SIGINT.
 */
import { serve } from "@hono/node-server";
import { createServiceDb, closeDb } from "@foundmill/db";
import { createModelClient, effectiveModelMode } from "@foundmill/models";
import { createLogger, loadEnv, servicePort } from "@foundmill/shared";
import { createApp } from "./app";
import { prepareDb } from "./db-boot";
import { createComposerService } from "./service";
import { createUsageSink } from "./usage";

export { createApp, NarrateBody, RefreshBody, CommentaryBody, ChapterTitleBody, type ComposerApp } from "./app";
export { ComposerService, createComposerService, type ComposerServiceDeps, type ComposerServiceOptions, type NarrateResult } from "./service";
export { RefreshEngine, type RefreshResult, type RefreshEngineOptions } from "./refresh";
export { composeNote, ComposerSchema, ComposerRejectedError, blocksContinueFor, composerInputs, CUSTOMER_UPDATE_OPTIONS, DEFAULT_DECISION_OPTIONS, type ComposedNote, type ComposeBrief } from "./compose";
export { loadContext, type ComposeContext } from "./context";
export { NAMED_QUERIES, NAMED_QUERY_IDS, getNamedQuery, isNamedQueryId, namedQueryCatalogue, runNamedQuery, sanitizeExhibit, type ExhibitData, type NamedQuery, type NamedQueryId } from "./exhibits";
export { loadMetricsSnapshot, statusMetrics, estimateRunwayMonths, runwayThresholdsBelow, blocksForRunway, type MetricsSnapshot } from "./metrics";
export { computeInsights, DEFAULT_INSIGHT_THRESHOLDS, type Insight, type InsightThresholds } from "./insights";
export { nextBestDecision, type NextBestDecision } from "./decisions";
export { composeCommentary, type CommentaryResult, type CommentaryLine } from "./commentary";
export { composeChapterTitle, loadQuarterFacts, parseQuarter, quarterOf, provisionalTitle, titleAcceptable, ChapterTitleOutput, type ChapterTitleResult } from "./chapter";
export { createUsageSink } from "./usage";
export { persistNote, persistDrafts, writeEventRow } from "./persist";
export { prepareDb, type DbReadiness } from "./db-boot";

export async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger("composer", env.LOG_LEVEL);
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; the composer cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  // PGlite boots + migrates here; a locked directory or an unreachable Postgres is one clear line and /health says db:false.
  const readiness = await prepareDb(db, log, { service: "composer" });
  const models = createModelClient({ mode: effectiveModelMode(env.MODEL_MODE, env.ANTHROPIC_API_KEY, log), apiKey: env.ANTHROPIC_API_KEY, logger: log, onUsage: createUsageSink(db, log) });
  const service = createComposerService({ db, models, log });
  const app = createApp(service, { env, log });
  const port = servicePort(env, "COMPOSER_PORT");

  const server = await listen(app, port, log);
  log.info({ db: readiness.ok, driver: readiness.driver, modes: { integrations: env.INTEGRATIONS_MODE, models: env.MODEL_MODE } }, "composer ready (refresh debounce and buffer refills are in-process; no Redis needed)");
  const shutdown = async (signal: string) => {
    log.info({ signal }, "composer shutting down");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.drain();
    await closeDb(db);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
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
