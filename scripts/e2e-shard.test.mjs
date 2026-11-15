// Run: node --test scripts/e2e-shard.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { deal, specFiles, weights } from "./e2e-shard.mjs";

const TOTAL = 8;

test("every spec file but onboarding is in exactly one shard", () => {
  const files = specFiles();
  const { shards } = deal(files, weights(), TOTAL);
  assert.deepEqual(shards.flat().sort(), files);
  assert.ok(!files.includes("e2e/onboarding.spec.ts"));
});

test("by the recorded weights no shard is more than 1.3 times the lightest", () => {
  const { load } = deal(specFiles(), weights(), TOTAL);
  assert.ok(Math.max(...load) <= 1.3 * Math.min(...load), `loads ${load.map(Math.round).join(", ")}`);
});

test("a file with no recorded weight counts as the median and is still dealt", () => {
  const { shards } = deal(["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/new.spec.ts"], { "e2e/a.spec.ts": 10, "e2e/b.spec.ts": 30, "e2e/c.spec.ts": 20 }, 2);
  assert.deepEqual(shards.flat().sort(), ["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/new.spec.ts"]);
});

test("the weights name only spec files that exist (onboarding included)", () => {
  const names = new Set([...specFiles(), "e2e/onboarding.spec.ts"]);
  for (const f of Object.keys(weights())) assert.ok(names.has(f), `${f} is in shard-weights.json but not in apps/web/e2e`);
});
