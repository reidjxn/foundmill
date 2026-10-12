// Run: node --test scripts/railway-config.test.mjs
// The Railway config files (docs/DEPLOY.md §3): /railway.toml serves the orchestrator, which has no HTTP server and so
// no healthcheck; every service with a /health route has its own /railway/<service>.toml that repeats the shared build
// and teardown and adds the healthcheck. A redeploy then moves traffic only once the new deployment answers /health.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_SERVICES = ["api", "gateway", "composer", "stream", "ingest"];

/** The flat subset of TOML these files use: `[section]` headers and `key = "string" | number` lines. */
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
    section[kv[1]] = /^".*"$/.test(kv[2]) ? kv[2].slice(1, -1) : Number(kv[2]);
  }
  return out;
}

const read = (path) => parseToml(readFileSync(join(root, path), "utf8"));
const withoutHealthcheck = ({ healthcheckPath: _p, healthcheckTimeout: _t, ...rest }) => rest;

describe("Railway config files", () => {
  const shared = read("railway.toml");

  it("the shared file (the orchestrator's) builds the Dockerfile and has no healthcheck", () => {
    assert.deepEqual(shared.build, { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
    assert.equal(shared.deploy.healthcheckPath, undefined);
    assert.ok(shared.deploy.drainingSeconds > 45, "drainingSeconds stays above SHUTDOWN_TIMEOUT_MS (45 s)");
  });

  it("every HTTP service has its own file: the shared settings plus GET /health", () => {
    for (const service of HTTP_SERVICES) {
      const own = read(`railway/${service}.toml`);
      assert.deepEqual(own.build, shared.build, `${service}: build`);
      assert.deepEqual(withoutHealthcheck(own.deploy), shared.deploy, `${service}: deploy settings other than the healthcheck`);
      assert.equal(own.deploy.healthcheckPath, "/health", service);
      assert.ok(own.deploy.healthcheckTimeout >= 60, `${service}: healthcheckTimeout`);
    }
    // The api migrates before it listens and waits up to MIGRATION_LOCK_TIMEOUT_MS (60 s) for the lock.
    assert.ok(read("railway/api.toml").deploy.healthcheckTimeout >= 120);
  });

  it("there is no file for a service without an HTTP server, and none for an unknown service", () => {
    assert.equal(existsSync(join(root, "railway/orchestrator.toml")), false);
    const files = readdirSync(join(root, "railway")).filter((f) => f.endsWith(".toml")).map((f) => f.replace(/\.toml$/, ""));
    assert.deepEqual(files.sort(), [...HTTP_SERVICES].sort());
    for (const service of HTTP_SERVICES) assert.ok(existsSync(join(root, "apps", service)), `apps/${service} exists`);
  });
});
