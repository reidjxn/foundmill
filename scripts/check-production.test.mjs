// node --test scripts/check-production.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRecord, runChecks, CHECKS } from "./check-production.mjs";

const TABLE = `intro
<!-- production-record:start -->
| Area | Expected | State on Nov 15, 2026 | Check |
| --- | --- | --- | --- |
| api health | \`env: "staging"\`, \`modes.integrations: "mock"\`, \`modes.models: "live"\`, db, redis, temporal healthy | as expected | \`api-health\` |
| Public page route | \`/p/<unknown>\` answers 404, not 500 | 404 | \`public-404\` |
| Hosting plan | Pro | Pro | \`manual: founder\` |
<!-- production-record:end -->
outro`;

const json = (body, status = 200) => ({ status, ok: status < 400, headers: new Map(), json: async () => body, text: async () => JSON.stringify(body) });
const fakeFetch = (routes) => async (url) => {
  for (const [match, answer] of routes) if (url.includes(match)) return typeof answer === "function" ? answer() : answer;
  throw new Error(`unexpected fetch ${url}`);
};
const healthy = { env: "staging", modes: { integrations: "mock", models: "live" }, db: true, redis: true, temporal: true };

test("parses the rows between the markers", () => {
  const rows = parseRecord(TABLE);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.check), ["api-health", "public-404", "manual: founder"]);
});

test("a matching answer is ok, a manual row is never fetched", async () => {
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push(url);
    return fakeFetch([["/health", json(healthy)], ["/p/", json({}, 404)]])(url, opts);
  };
  const { results, exitCode } = await runChecks(parseRecord(TABLE), { fetch });
  assert.deepEqual(results.map((r) => r.status), ["ok", "ok", "manual"]);
  assert.equal(exitCode, 0);
  assert.equal(seen.length, 2);
});

test("a changed env differs and exits 1", async () => {
  const fetch = fakeFetch([["/health", json({ ...healthy, env: "production" })], ["/p/", json({}, 404)]]);
  const { results, exitCode } = await runChecks(parseRecord(TABLE), { fetch });
  assert.equal(results[0].status, "differs");
  assert.match(results[0].detail, /env/);
  assert.equal(exitCode, 1);
});

test("an unknown check id fails the run", async () => {
  const rows = parseRecord(TABLE.replace("`public-404`", "`public-4o4`"));
  const fetch = fakeFetch([["/health", json(healthy)]]);
  const { results, exitCode } = await runChecks(rows, { fetch });
  assert.equal(results[1].status, "differs");
  assert.match(results[1].detail, /unknown check/);
  assert.equal(exitCode, 1);
});

test("a timeout is differs: no answer", async () => {
  const fetch = async () => {
    throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  };
  const { results } = await runChecks(parseRecord(TABLE).slice(0, 1), { fetch });
  assert.equal(results[0].status, "differs");
  assert.match(results[0].detail, /no answer/);
});

test("every check id in docs/DEPLOY.md is known", async () => {
  const { readFileSync } = await import("node:fs");
  const rows = parseRecord(readFileSync(new URL("../docs/DEPLOY.md", import.meta.url), "utf8"));
  assert.ok(rows.length >= 10);
  for (const r of rows) if (!r.check.startsWith("manual")) assert.ok(r.check in CHECKS, r.check);
});

test("sites-headers is skipped without --sites, and checks the header set and the preview's noindex with it", async () => {
  const row = { area: "Foundmill Sites", expected: "", state: "", check: "sites-headers" };
  const skipped = await runChecks([row], { fetch: async () => assert.fail("fetched without --sites") });
  assert.equal(skipped.results[0].status, "manual");
  assert.equal(skipped.exitCode, 0);
  const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });
  const site = async (url) => ({ status: 200, headers: headers(url.includes("p-") ? { "x-robots-tag": "noindex, nofollow" } : { "content-security-policy": "default-src 'none'; img-src 'self' data:" }), json: async () => ({}), text: async () => "" });
  const good = await runChecks([row], { fetch: site, sites: "https://lunchbox.example-sites.app/", preview: "https://p-abc.example-sites.app/" });
  assert.equal(good.results[0].status, "ok");
  const bad = await runChecks([row], { fetch: async () => ({ status: 200, headers: headers({}) }), sites: "https://lunchbox.example-sites.app/" });
  assert.equal(bad.results[0].status, "differs");
  assert.equal(bad.exitCode, 1);
});

test("landing-robots: hidden accepts a 404 or a 200 that disallows everything", async () => {
  const row = { area: "Landing indexing", expected: "`noindex` and robots", state: "", check: "landing-robots" };
  const page = { status: 200, headers: new Map(), text: async () => '<meta name="robots" content="noindex, nofollow"/>' };
  const robots = (status, body) => ({ status, headers: new Map(), text: async () => body });
  const run = async (answer) => (await runChecks([row], { fetch: async (url) => (url.endsWith("/robots.txt") ? answer : page) })).results[0].status;
  assert.equal(await run(robots(404, "")), "ok");
  assert.equal(await run(robots(200, "User-Agent: *\nDisallow: /\n")), "ok");
  assert.notEqual(await run(robots(200, "User-Agent: *\nAllow: /\nDisallow: /api/\n")), "ok");
});
