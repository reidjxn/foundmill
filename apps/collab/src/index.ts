/**
 * @foundmill/collab — Hocuspocus (Yjs) server for spec blocks (docs/ARCHITECTURE.md §1, §3, §17; BUILD §11.5).
 *
 * Boot: load env → service database (repositories only) → token verifier (Supabase JWKS / HS256, collab service
 * tokens, dev bypass; the JWKS fetched at boot and every 5 minutes) → Hocuspocus server listening on PORT (fallback
 * COLLAB_PORT) on host "::" with a 0.0.0.0
 * fallback → graceful shutdown flushes pending stores before closing.
 */
import { closeDb, createServiceDb, watchPoolOrExit } from "@foundmill/db";
import { admittedBy, bootSummary, loadEnv, parseSignupAllowlist, servicePort } from "@foundmill/shared";
import { createLogger } from "@foundmill/shared/logger";
import { createCollabAuthenticator } from "./auth";
import { prepareDb } from "./db-boot";
import { createCollabServer } from "./server";

export { COLLAB_SERVICE_AUDIENCE, SUPABASE_AUDIENCE, CollabAuthError, createCollabAuthenticator, mintCollabServiceToken, parseDevToken, type CollabAuthenticator, type CollabAuthenticatorOptions, type MintServiceTokenInput, type Principal } from "./auth";
export { InvalidDocumentNameError, SPEC_DOCUMENT_PREFIX, isGuid, parseDocumentName, specDocumentName, tryParseDocumentName, type SpecDocumentName } from "./document-name";
export { DEFAULT_FRAGMENT, EMPTY_DOC, InvalidProseMirrorJsonError, docToPmDoc, fillFragment, fragmentToPmDoc, parsePmDoc, pmDocToYDoc, pmEqual, reconcileFragment, typesFromNodes, type PmMark, type PmNode, type ReconcileResult } from "./prosemirror";
export { contentToPmDoc, createSpecBlockStore, type Author, type AuthorKind, type SpecBlockStore, type SpecBlockStoreOptions } from "./store";
export { COLLAB_SERVICE, ReadOnlyError, WRITE_ROLES, bearerToken, createCollabServer, httpError, readJsonBody, silentLogger, type Authorization, type CollabContext, type CollabLogger, type CollabServer, type CollabServerDeps, type CollabServerOptions, type EditOptions, type EditResult, type HealthReport, type ReadResult, StaleRevisionError } from "./server";
export { createCollabClient, type CollabClient, type CollabClientError, type CollabClientOptions } from "./client";
export { prepareDb, type DbReadiness } from "./db-boot";

export async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger("collab", env.LOG_LEVEL);
  if (!env.DATABASE_URL) {
    log.error({}, "DATABASE_URL is not set; the collab server cannot start");
    process.exit(1);
  }
  const db = createServiceDb();
  // PGlite boots + migrates here; a locked directory or an unreachable Postgres is one clear line and /health says db:false.
  const readiness = await prepareDb(db, log, { service: "collab" });
  // A pool that stops answering while the database is fine exits the process; the platform restarts it (DECISIONS 2026-10-19).
  const watchdog = watchPoolOrExit({ db, url: env.DATABASE_URL, log, service: "collab" });
  const auth = createCollabAuthenticator({
    appEnv: env.APP_ENV,
    supabaseUrl: env.SUPABASE_URL,
    jwtSecret: env.SUPABASE_JWT_SECRET ?? null,
    serviceSecret: env.SESSION_TOKEN_SECRET ?? null,
    devUserId: env.DEV_AUTH_USER_ID ?? null,
  });
  const keys = auth.keepKeysFresh?.({ onError: (err) => log.warn({ err: (err as Error)?.message }, "fetching Supabase's signing keys failed; retrying in 5 minutes") });
  if (!env.SESSION_TOKEN_SECRET) log.warn({}, "SESSION_TOKEN_SECRET is not set; agents cannot connect to the collab server");
  // The api's invite list (SIGNUP_ALLOWLIST): a person it does not name opens no spec block either.
  const allowlist = parseSignupAllowlist(env.SIGNUP_ALLOWLIST);
  const server = createCollabServer({ db, auth, log, dbReady: () => readiness.ok, admit: (user) => admittedBy(allowlist, user, auth.devUserId) });
  await server.listen(servicePort(env, "COLLAB_PORT"));
  log.info(bootSummary(env), "collab environment");
  log.info({ db: readiness.ok, driver: readiness.driver }, "collab ready");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "collab shutting down");
    keys?.stop();
    watchdog.stop();
    try {
      await server.close();
    } finally {
      await closeDb(db);
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

const entry = process.argv[1] ?? "";
if (/apps[\\/]collab[\\/]src[\\/]index\.ts$/.test(entry)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
