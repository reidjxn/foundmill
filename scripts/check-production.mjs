#!/usr/bin/env node
/**
 * Check docs/DEPLOY.md §6, the production record (WP-02 T12), against production from outside: public GETs and
 * HEADs only, no credentials, user agent `foundmill-production-check`, 10 s per request. One line per row: `ok`,
 * `differs: expected … got …`, or `manual` (what cannot be seen from outside). Exits 1 when a checked row differs or
 * names an unknown check, so a typo in the record cannot pass silently. It never writes the record: a difference is
 * fixed by a person or a session changing the record or the product.
 *
 *   node scripts/check-production.mjs
 *   node scripts/check-production.mjs --json
 *   node scripts/check-production.mjs --only api-health
 *   node scripts/check-production.mjs --base https://foundmill.com --api https://api.foundmill.com --ingest https://ingest.foundmill.com
 *   node scripts/check-production.mjs --only sites-headers --sites https://<canary>.foundmill.app/ --preview https://p-<token>.foundmill.app/
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const START = "<!-- production-record:start -->";
const END = "<!-- production-record:end -->";
const UA = "foundmill-production-check";
const TIMEOUT_MS = 10_000;

/** The rows of the table between the markers: { area, expected, state, check }. */
export function parseRecord(text) {
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from < 0 || to < from) throw new Error("docs/DEPLOY.md has no production record between the markers");
  return text
    .slice(from + START.length, to)
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, line.trimEnd().endsWith("|") ? line.trimEnd().length - 1 : undefined).split("|").map((c) => c.trim()))
    .filter((cells) => cells[0] !== "Area")
    .map(([area = "", expected = "", state = "", check = ""]) => ({ area, expected, state, check: check.replace(/`/g, "").trim() }));
}

async function get(ctx, url, { method = "GET", redirect = "follow" } = {}) {
  const signal = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  return ctx.fetch(url, { method, redirect, headers: { "user-agent": UA }, ...(signal ? { signal } : {}) });
}

const differs = (expected, got) => ({ status: "differs", detail: `expected ${expected} got ${got}` });
const ok = (detail = "") => ({ status: "ok", detail });
/** `key: "value"` pairs written in the Expected cell, e.g. `env: "staging"`. */
const pairsOf = (expected) => Object.fromEntries([...expected.matchAll(/([\w.]+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const pick = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** One function per check id. Each reads production and compares with the row's Expected cell. */
export const CHECKS = {
  async "api-health"(ctx, row) {
    const body = await (await get(ctx, `${ctx.api}/health`)).json();
    for (const [path, want] of Object.entries(pairsOf(row.expected))) if (String(pick(body, path)) !== want) return differs(`${path}: "${want}"`, `"${pick(body, path)}"`);
    for (const dep of ["db", "redis", "temporal"]) if (row.expected.includes(dep) && body[dep] !== true) return differs(`${dep} healthy`, String(body[dep]));
    return ok();
  },
  async "api-platform-mail"(ctx, row) {
    const body = await (await get(ctx, `${ctx.api}/health`)).json();
    const want = pairsOf(row.expected).platformMail;
    return body.platformMail === want ? ok() : differs(`platformMail: "${want}"`, body.platformMail === undefined ? "no platformMail field" : `"${body.platformMail}"`);
  },
  async "ingest-webhooks"(ctx, row) {
    const body = await (await get(ctx, `${ctx.ingest}/health`)).json();
    const refused = new Set(body.refusedMockWebhooks ?? []);
    const live = new Set(body.webhooks ?? []);
    const wantsRefused = /refusedMockWebhooks.*sendgrid/.test(row.expected);
    if (wantsRefused) return refused.has("sendgrid") ? ok() : differs("sendgrid in refusedMockWebhooks", JSON.stringify([...refused]));
    return live.has("sendgrid") ? ok() : differs("sendgrid in webhooks", JSON.stringify([...live]));
  },
  async "landing-robots"(ctx, row) {
    const home = await (await get(ctx, `${ctx.base}/`)).text();
    const noindex = /<meta name="robots" content="[^"]*noindex/.test(home);
    const robots = (await get(ctx, `${ctx.base}/robots.txt`)).status;
    const wantsHidden = /noindex/.test(row.expected);
    const got = `${noindex ? "noindex" : "indexable"}, robots.txt ${robots}`;
    if (wantsHidden) return noindex && robots === 404 ? ok(got) : differs("noindex, robots.txt 404", got);
    return !noindex && robots === 200 ? ok(got) : differs("indexable, robots.txt 200", got);
  },
  async "signin-page"(ctx) {
    const res = await get(ctx, `${ctx.base}/login`);
    const text = await res.text();
    if (res.status !== 200) return differs("200", String(res.status));
    return /google/i.test(text) ? ok() : differs("a Google option", "none on the page");
  },
  async "public-404"(ctx) {
    const res = await get(ctx, `${ctx.base}/p/no-such-page-${Date.now().toString(36)}`);
    return res.status === 404 ? ok() : differs("404", String(res.status));
  },
  async "web-up"(ctx) {
    const apex = await get(ctx, `${ctx.base}/`, { method: "HEAD" });
    if (apex.status !== 200) return differs("apex 200", String(apex.status));
    const www = await get(ctx, ctx.base.replace("://", "://www."), { method: "HEAD", redirect: "manual" });
    const to = (www.headers.get ? www.headers.get("location") : null) ?? "";
    return www.status >= 300 && www.status < 400 && to.startsWith(ctx.base) ? ok() : differs(`www redirects to ${ctx.base}`, `${www.status} ${to}`);
  },
  // Foundmill Sites (WP-07 T10): with --sites <canary site address> (and --preview <a preview address>), the site answers
  // 200 with the site header set and a preview is never indexed. Without --sites (SITES_DOMAIN unset) it is skipped.
  async "sites-headers"(ctx) {
    if (!ctx.sites) return { status: "manual", detail: "skipped: no --sites address (SITES_DOMAIN unset)" };
    const res = await get(ctx, ctx.sites);
    const csp = res.headers.get ? (res.headers.get("content-security-policy") ?? "") : "";
    if (res.status !== 200) return differs("200", String(res.status));
    if (!csp.includes("default-src 'none'")) return differs("content-security-policy default-src 'none'", csp || "none");
    if (res.headers.get("set-cookie")) return differs("no set-cookie", "a cookie");
    if (ctx.preview) {
      const p = await get(ctx, ctx.preview, { method: "HEAD" });
      if (!/noindex/.test(p.headers.get("x-robots-tag") ?? "")) return differs("preview x-robots-tag noindex", p.headers.get("x-robots-tag") ?? "none");
    }
    return ok();
  },
  async "service-health"(ctx) {
    const hosts = [ctx.api, ctx.ingest, ctx.stream];
    for (const host of hosts) {
      const res = await get(ctx, `${host}/health`);
      if (res.status !== 200) return differs(`${host}/health 200`, String(res.status));
    }
    return ok(hosts.map((h) => h.replace(/^https?:\/\//, "")).join(", "));
  },
};

/** Run every row (or one, with `only`); returns the results and the exit code. */
export async function runChecks(rows, { fetch = globalThis.fetch, base = "https://foundmill.com", api = "https://api.foundmill.com", ingest = "https://ingest.foundmill.com", stream = "https://stream.foundmill.com", sites = null, preview = null, only = null } = {}) {
  const ctx = { fetch, base, api, ingest, stream, sites, preview };
  const results = [];
  for (const row of rows) {
    if (only && row.check !== only) continue;
    if (row.check.startsWith("manual")) {
      results.push({ ...row, status: "manual", detail: row.check.slice("manual".length).replace(/^:\s*/, "") });
      continue;
    }
    const check = CHECKS[row.check];
    if (!check) {
      results.push({ ...row, status: "differs", detail: `unknown check "${row.check}"` });
      continue;
    }
    try {
      results.push({ ...row, ...(await check(ctx, row)) });
    } catch (err) {
      results.push({ ...row, status: "differs", detail: err && (err.name === "AbortError" || err.name === "TimeoutError") ? "no answer" : `no answer (${err && err.message ? err.message : err})` });
    }
  }
  return { results, exitCode: results.some((r) => r.status === "differs") ? 1 : 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const rows = parseRecord(readFileSync(join(root, "docs/DEPLOY.md"), "utf8"));
  const options = { ...(flag("--base") ? { base: flag("--base") } : {}), ...(flag("--api") ? { api: flag("--api") } : {}), ...(flag("--ingest") ? { ingest: flag("--ingest") } : {}), ...(flag("--sites") ? { sites: flag("--sites") } : {}), ...(flag("--preview") ? { preview: flag("--preview") } : {}), only: flag("--only") ?? null };
  const { results, exitCode } = await runChecks(rows, options);
  if (args.includes("--json")) console.log(JSON.stringify(results.map(({ area, check, status, detail }) => ({ area, check, status, detail })), null, 2));
  else for (const r of results) console.log(`${r.status === "ok" ? "ok     " : r.status === "manual" ? "manual " : "differs"}  ${r.area}${r.detail ? `: ${r.status === "differs" ? "" : ""}${r.detail}` : ""}`);
  process.exit(exitCode);
}
