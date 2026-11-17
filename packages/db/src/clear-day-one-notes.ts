/**
 * `pnpm --filter @foundmill/db notes:clear-day-one [-- --apply]` (WP-04 T16 step 2; founder, Nov 17, 2026): the
 * unanswered day-one notes of quiet projects (nobody here for 14 days, notes older than 14 days; `dayOneNotesRepo`).
 * A dry run by default: one line per project with its name, how many notes and the oldest note's date. Only `--apply`
 * changes rows, and then it archives them (never deletes) with one audit row per project. Service role through
 * DATABASE_URL (a `pglite:<dir>` URL works locally). Not run against production without the founder.
 */
import { loadEnv, usDate } from "@foundmill/shared";
import { closeDb, createDb } from "./client";
import { dayOneNotesRepo } from "./repos/day-one-notes";

const DAYS_14 = 14 * 86_400_000;
const print = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const apply = process.argv.includes("--apply");
  const db = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const projects = await dayOneNotesRepo.toClear(db, { now: new Date(), quietFor: DAYS_14, olderThan: DAYS_14 });
    print(apply ? "Archiving the unanswered day-one notes of quiet projects:" : "Dry run (nothing changes; add --apply to archive):");
    let total = 0;
    for (const p of projects) {
      const moved = apply ? await dayOneNotesRepo.archive(db, p.businessId, p.ids) : p.ids.length;
      total += moved;
      print(`- ${p.name} (${p.businessId}): ${moved} note${moved === 1 ? "" : "s"}, oldest ${usDate(p.oldest)}`);
    }
    print(`${projects.length} project${projects.length === 1 ? "" : "s"}, ${total} note${total === 1 ? "" : "s"}${apply ? " archived" : " would be archived"}.`);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
