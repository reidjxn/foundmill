/**
 * `pnpm --filter @foundmill/db report:retention [-- --from 2026-11-01 --to 2026-11-08] [--json]`: the retention report
 * (presenceRepo.retentionReport) for businesses committed in the range, default the last 14 days. Reads with the
 * service role through DATABASE_URL (a `pglite:<dir>` URL works locally). Prints counts and one line per business; no
 * names of people, only ids.
 */
import { loadEnv } from "@foundmill/shared";
import { closeDb, createDb } from "./client";
import { presenceRepo } from "./repos/presence";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const print = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const to = arg("to") ? new Date(`${arg("to")}T00:00:00Z`) : new Date();
  const from = arg("from") ? new Date(`${arg("from")}T00:00:00Z`) : new Date(to.getTime() - 14 * 86_400_000);
  const db = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const report = await presenceRepo.retentionReport(db, { from, to });
    if (process.argv.includes("--json")) {
      print(JSON.stringify(report, null, 2));
      return;
    }
    const pct = (n: number) => (report.businesses ? `${Math.round((100 * n) / report.businesses)}%` : "n/a");
    print(`Committed ${report.from.slice(0, 10)} to ${report.to.slice(0, 10)}: ${report.businesses} businesses`);
    print(`Activated (both sign-offs and a first Continue within 24 hours): ${report.activated} (${pct(report.activated)})`);
    print(`Habit (3 return days in week 1): ${report.habit} (${pct(report.habit)})`);
    for (const r of report.rows) {
      print(`  ${r.businessId}  activated=${r.activation.activated ? "yes" : `no (${r.activation.missing.join(", ")})`}  return days=${r.habit.returnDays.length}  returns from notifications=${r.returnsFromNotifications}`);
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
