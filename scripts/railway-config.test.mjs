// Run: node --test scripts/railway-config.test.mjs
// The Railway config files (docs/DEPLOY.md §3): /railway.toml is the shared base (no healthcheck, no watch patterns);
// every service has its own /railway/<service>.toml that repeats the shared build and teardown and adds a healthcheck
// on GET /health (the orchestrator: GET /ready, readiness without its task-queue backlog verdict) and its own watch
// patterns. A redeploy then moves traffic only once the new deployment answers, and a push redeploys only the services
// whose code it changed (#222: every push used to restart the orchestrator and cut its agent sessions short).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICES = ["api", "gateway", "orchestrator", "composer", "stream", "ingest"];
/** What every service's image is built from (Dockerfile COPY lines and the install). */
const BUILD_INPUTS = ["/packages/**", "/patches/**", "/Dockerfile", "/package.json", "/pnpm-lock.yaml", "/pnpm-workspace.yaml", "/.npmrc"];

/** The flat subset of TOML these files use: `[section]` headers and `key = "string" | number | ["string", ...]` lines. */
function parseToml(text) {
  const out = {};
  let section = out;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const header = /^\[([a-zA-Z]+)\]$/.exec(line);
    if (header) {
      section = out[header[1]] = {};
      continue;
    }
    const kv = /^([a-zA-Z]+)\s*=\s*(.+)$/.exec(line);
    assert.ok(kv, `unexpected line: ${raw}`);
    const value = kv[2];
    section[kv[1]] = /^".*"$/.test(value) ? value.slice(1, -1) : /^\[.*\]$/.test(value) ? JSON.parse(value) : Number(value);
  }
  return out;
}

const read = (path) => parseToml(readFileSync(join(root, path), "utf8"));
const withoutHealthcheck = ({ healthcheckPath: _p, healthcheckTimeout: _t, ...rest }) => rest;
const withoutWatch = ({ watchPatterns: _w, ...rest }) => rest;

describe("Railway config files", () => {
  const shared = read("railway.toml");

  it("the shared base builds the Dockerfile and has no healthcheck and no watch patterns", () => {
    assert.deepEqual(shared.build, { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
    assert.equal(shared.deploy.healthcheckPath, undefined);
    assert.ok(shared.deploy.drainingSeconds > 45, "drainingSeconds stays above SHUTDOWN_TIMEOUT_MS (45 s)");
  });

  it("every service has its own file: the shared settings plus a healthcheck", () => {
    for (const service of SERVICES) {
      const own = read(`railway/${service}.toml`);
      assert.deepEqual(withoutWatch(own.build), shared.build, `${service}: build`);
      assert.deepEqual(withoutHealthcheck(own.deploy), shared.deploy, `${service}: deploy settings other than the healthcheck`);
      // The orchestrator's /health also fails on an old task-queue backlog; a deploy that comes to clear one must pass.
      assert.equal(own.deploy.healthcheckPath, service === "orchestrator" ? "/ready" : "/health", service);
      assert.ok(own.deploy.healthcheckTimeout >= 60, `${service}: healthcheckTimeout`);
    }
    // The api migrates before it listens and waits up to MIGRATION_LOCK_TIMEOUT_MS (60 s) for the lock; the orchestrator
    // bundles its workflows and connects to Temporal before its workers run.
    assert.ok(read("railway/api.toml").deploy.healthcheckTimeout >= 120);
    assert.ok(read("railway/orchestrator.toml").deploy.healthcheckTimeout >= 120);
  });

  it("each service redeploys on its own code, the shared packages and the image, and on nothing else", () => {
    for (const service of SERVICES) {
      const patterns = read(`railway/${service}.toml`).build.watchPatterns;
      assert.ok(Array.isArray(patterns), `${service}: watchPatterns`);
      assert.deepEqual([...patterns].sort(), [`/apps/${service}/**`, `/railway/${service}.toml`, ...BUILD_INPUTS].sort(), service);
      // Docs, the web app and the other services never restart it.
      for (const other of ["/docs/README.md", "/apps/web/app/page.tsx", ...SERVICES.filter((s) => s !== service).map((s) => `/apps/${s}/src/index.ts`)]) {
        assert.ok(!patterns.some((p) => matches(p, other)), `${service} must not redeploy on ${other}`);
      }
      assert.ok(patterns.some((p) => matches(p, `/apps/${service}/src/index.ts`)), `${service} redeploys on its own code`);
      assert.ok(patterns.some((p) => matches(p, "/packages/db/src/index.ts")), `${service} redeploys on a shared package`);
    }
  });

  it("there is one file per service and none for an unknown service", () => {
    const files = readdirSync(join(root, "railway")).filter((f) => f.endsWith(".toml")).map((f) => f.replace(/\.toml$/, ""));
    assert.deepEqual(files.sort(), [...SERVICES].sort());
    for (const service of SERVICES) assert.ok(existsSync(join(root, "apps", service)), `apps/${service} exists`);
  });
});

/** Railway's watch patterns are gitignore-style globs; the ones here only use a trailing `/**` or an exact path. */
function matches(pattern, path) {
  return pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern;
}
