#!/usr/bin/env node
// Deals apps/web's Playwright spec files to CI shards by measured weight (WP-01 T1): each file goes to the shard with the
// least time so far, heaviest first. apps/web/e2e/shard-weights.json holds the seconds each file took in CI; a file not
// listed counts as the median. Shard 1 also runs onboarding.spec.ts first and the e2e/ golden path, so it starts loaded.
//   node scripts/e2e-shard.mjs <shard> <total>    prints that shard's files, one per line, relative to apps/web
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** What shard 1 runs besides its dealt files: onboarding.spec.ts and the e2e/ golden path and smoke (about 2.5 min). */
export const SHARD_ONE_EXTRA_SECONDS = 150;

export function specFiles() {
  return readdirSync(join(root, "apps/web/e2e"))
    .filter((f) => f.endsWith(".spec.ts") && f !== "onboarding.spec.ts")
    .map((f) => `e2e/${f}`)
    .sort();
}

export function weights() {
  return JSON.parse(readFileSync(join(root, "apps/web/e2e/shard-weights.json"), "utf8")).seconds;
}

/** Returns `total` lists of files. Deterministic: ties go to the lower shard, equal weights in name order. */
export function deal(files, seconds, total) {
  const known = Object.values(seconds).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 30;
  const weight = (f) => seconds[f] ?? median;
  const onboarding = seconds["e2e/onboarding.spec.ts"] ?? 0;
  const load = Array.from({ length: total }, (_, i) => (i === 0 ? onboarding + SHARD_ONE_EXTRA_SECONDS : 0));
  const shards = Array.from({ length: total }, () => []);
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const i = load.indexOf(Math.min(...load));
    shards[i].push(f);
    load[i] += weight(f);
  }
  return { shards, load };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [shard, total] = process.argv.slice(2).map(Number);
  if (!(shard >= 1 && total >= 1 && shard <= total)) {
    console.error("usage: node scripts/e2e-shard.mjs <shard> <total>");
    process.exit(2);
  }
  const { shards, load } = deal(specFiles(), weights(), total);
  console.error(`shard ${shard} of ${total}: ${shards[shard - 1].length} files, about ${Math.round(load[shard - 1] / 60)} min by the recorded weights`);
  for (const f of shards[shard - 1]) console.log(f);
}
