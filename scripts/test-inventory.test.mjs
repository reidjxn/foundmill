// Run: node --test scripts/test-inventory.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySkips, flakyTests } from "./test-inventory.mjs";

test("conditional skips are counted by reason", () => {
  const { counts, banned } = classifySkips([
    { file: "evals/a.eval.test.ts", text: 'describe.skipIf(!live)("live model", () => {' },
    { file: "packages/connectors/x.test.ts", text: 'describe.skipIf(!envKeysPresent("STRIPE_SECRET_KEY"))("stripe live", () => {' },
    { file: "packages/db/m.test.ts", text: 'describe.skipIf(!DIRECT)("migrate on Postgres", () => {' },
    { file: "apps/api/r.test.ts", text: "it.skipIf(onPostgres)(\"pglite only\", async () => {" },
    { file: "apps/web/e2e/h.spec.ts", text: "test.skip(!bid, \"no seeded business\");" },
  ]);
  assert.deepEqual(banned, []);
  assert.equal(counts["Live model needed"], 1);
  assert.equal(counts["Vendor keys needed"], 1);
  assert.equal(counts["Real Postgres, pooler or Redis needed"], 2);
  assert.equal(counts["Seed or stack state"], 1);
});

test("an unconditional skip, .only, .fixme or .todo is refused with its file", () => {
  const { banned } = classifySkips([
    { file: "a.test.ts", text: 'it.skip("x", () => {});' },
    { file: "b.test.ts", text: "test.skip();" },
    { file: "c.test.ts", text: 'it.only("y", () => {});' },
    { file: "d.spec.ts", text: 'test.fixme("z", async () => {});' },
    { file: "e.test.ts", text: 'it.todo("later");' },
  ]);
  assert.deepEqual(banned.map((b) => b.file), ["a.test.ts", "b.test.ts", "c.test.ts", "d.spec.ts", "e.test.ts"]);
});

test("a Playwright report's flaky tests are listed with file and line", () => {
  const report = {
    suites: [
      {
        file: "first-days.spec.ts",
        specs: [],
        suites: [
          {
            specs: [
              { title: "the note arrives", file: "first-days.spec.ts", line: 158, tests: [{ status: "flaky" }] },
              { title: "steady", file: "first-days.spec.ts", line: 40, tests: [{ status: "expected" }] },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(flakyTests(report), [{ file: "first-days.spec.ts", line: 158, title: "the note arrives" }]);
});
