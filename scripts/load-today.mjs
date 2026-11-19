#!/usr/bin/env node
/**
 * Measure the api under simultaneous Today loads (WP-11 T10). Each simulated user sends the one batched request the
 * Today screen makes (`today.get` and `today.visit`, apps/web/components/today/TodayScreen.tsx); a step sends that many
 * at once, `--rounds` times. Per step it prints requests, errors, p50, p95 and max in ms, and the transaction gate's
 * `peak`, `waiting` and `timeouts` from `/health` before and after. Both procedures are reads. No dependency: fetch and
 * performance.now().
 *
 *   read -rs FM_BEARER && export FM_BEARER   # paste the token; it stays out of shell history
 *   node scripts/load-today.mjs --url http://localhost:4000 --business <uuid> --users 25,50,100 [--rounds 3] [--json]
 *
 * The bearer comes from FM_BEARER only, never from an argument (arguments land in shell history and process lists).
 * Production is the founder's run (WP-11 F4): a quiet hour, their own token, the sample business.
 */
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nearest-rank percentile of an ascending array; 0 for an empty one. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** `{ url, business, users, rounds, json }`; throws with a message a person can act on. */
export function parseArgs(argv) {
  for (const a of argv) {
    if (/^--(bearer|token|auth)/.test(a) || /^(Bearer\s|eyJ)/.test(a)) throw new Error("pass the bearer in FM_BEARER, never as an argument");
  }
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const url = flag("--url");
  const business = flag("--business");
  const users = (flag("--users") ?? "25,50,100").split(",").map(Number);
  const rounds = Number(flag("--rounds") ?? 3);
  if (!url || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/]?)/.test(url)) throw new Error("--url must be https://, or http:// on localhost");
  if (!business || !UUID.test(business)) throw new Error("--business must be a business id (uuid)");
  if (!users.length || users.some((n) => !Number.isInteger(n) || n < 1 || n > 500)) throw new Error("--users must be whole numbers from 1 to 500, comma-separated");
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error("--rounds must be a whole number from 1 to 20");
  return { url: url.replace(/\/+$/, ""), business, users, rounds, json: argv.includes("--json") };
}

/** The Today screen's batched read, superjson-encoded as the web client sends it. */
export function todayPath(business) {
  const input = { 0: { json: { businessId: business } }, 1: { json: { businessId: business } } };
  return `/trpc/today.get,today.visit?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
}

async function gate(url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
    const t = (await res.json()).transactions;
    return t ? { peak: t.peak, waiting: t.waiting, timeouts: t.timeouts } : null;
  } catch {
    return null;
  }
}

async function one(url, path, bearer) {
  const start = performance.now();
  try {
    const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(60_000) });
    await res.arrayBuffer();
    return { ms: performance.now() - start, ok: res.ok };
  } catch {
    return { ms: performance.now() - start, ok: false };
  }
}

export async function runStep({ url, business, rounds }, users, bearer) {
  const path = todayPath(business);
  const before = await gate(url);
  const results = [];
  for (let r = 0; r < rounds; r++) results.push(...(await Promise.all(Array.from({ length: users }, () => one(url, path, bearer)))));
  const after = await gate(url);
  const ms = results.map((x) => x.ms).sort((a, b) => a - b);
  const round = (n) => Math.round(n);
  return { users, requests: results.length, errors: results.filter((x) => !x.ok).length, p50: round(percentile(ms, 50)), p95: round(percentile(ms, 95)), max: round(ms.at(-1) ?? 0), before, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const bearer = process.env.FM_BEARER;
    if (!bearer) throw new Error("FM_BEARER is not set");
    const steps = [];
    for (const n of opts.users) {
      const s = await runStep(opts, n, bearer);
      steps.push(s);
      const g = (x) => (x ? `peak ${x.peak} waiting ${x.waiting} timeouts ${x.timeouts}` : "no gate stats");
      if (!opts.json) console.log(`${n} at once x ${opts.rounds}: ${s.requests} requests, ${s.errors} errors, p50 ${s.p50} ms, p95 ${s.p95} ms, max ${s.max} ms; gate before: ${g(s.before)}; after: ${g(s.after)}`);
    }
    if (opts.json) console.log(JSON.stringify(steps, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
