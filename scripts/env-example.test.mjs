// Run: node --test scripts/env-example.test.mjs
// .env.example lists every variable the code reads, and nothing else (#431: it had drifted, with variables nothing read
// and others missing). The sources of truth are the Zod schemas (packages/shared/src/env.ts, apps/orchestrator/src/env.ts),
// the NEXT_PUBLIC_* the web app reads and the seed CLI's own SEED_* switches.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

/** Keys of the `z.object({...})` schemas in a file: lines like `  KEY: z.…`. */
function schemaKeys(path) {
  return [...read(path).matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*z\./gm)].map((m) => m[1]);
}

/** `process.env.KEY` reads under a directory (source files only, tests excluded). */
function processEnvKeys(dir, prefix) {
  const out = new Set();
  const walk = (d) => {
    for (const name of readdirSync(join(root, d))) {
      const rel = join(d, name);
      if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.(test|spec)\./.test(name)) {
        for (const m of read(rel).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) if (m[1].startsWith(prefix)) out.add(m[1]);
      }
    }
  };
  walk(dir);
  return [...out];
}

function exampleKeys() {
  const keys = [];
  for (const raw of read(".env.example").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]+)=/.exec(raw);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe(".env.example", () => {
  const shared = schemaKeys("packages/shared/src/env.ts");
  const orchestrator = schemaKeys("apps/orchestrator/src/env.ts");
  const web = ["apps/web/lib", "apps/web/app", "apps/web/components"].flatMap((d) => processEnvKeys(d, "NEXT_PUBLIC_"));
  const seedCli = processEnvKeys("packages/db/src", "SEED_").filter((k) => !shared.includes(k));
  const expected = new Set([...shared, ...orchestrator, ...web, ...seedCli]);
  const listed = exampleKeys();

  it("the schemas were found (the parser still matches their shape)", () => {
    assert.ok(shared.length > 60, `shared schema keys: ${shared.length}`);
    assert.ok(shared.includes("SUPABASE_JWT_SECRET") && shared.includes("SENTRY_DSN") && shared.includes("OTEL_EXPORTER_OTLP_ENDPOINT"));
    assert.ok(orchestrator.includes("SANDBOX_MODE") && orchestrator.includes("ORCHESTRATOR_PORT"));
    assert.ok(web.includes("NEXT_PUBLIC_API_URL"));
  });

  it("lists every variable the code reads, once", () => {
    const missing = [...expected].filter((k) => !listed.includes(k));
    assert.deepEqual(missing, [], `add to .env.example: ${missing.join(", ")}`);
    const dupes = listed.filter((k, i) => listed.indexOf(k) !== i);
    assert.deepEqual(dupes, [], "listed twice");
  });

  it("lists nothing the code does not read", () => {
    const dead = listed.filter((k) => !expected.has(k));
    assert.deepEqual(dead, [], `read nowhere: ${dead.join(", ")}`);
  });
});
