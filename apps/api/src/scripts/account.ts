/**
 * Account export and closing by request (WP-11 T16; docs/DEPLOY.md §4 "Closing an account by request"). An operator runs
 * it when a person writes to privacy@ asking for their data or to close their account. It never deletes the person: the
 * founder deletes the auth user in the Supabase dashboard (F6), and nothing here is reachable by an agent or a route.
 *
 *   pnpm --filter @foundmill/api account export <userId>   the person's data as JSON on stdout
 *   pnpm --filter @foundmill/api account check <userId>    what must happen first; exits 1 while they solely own a project
 *   pnpm --filter @foundmill/api account verify <userId>   after the auth user is gone: only cleared references remain,
 *                                                          and the person's event stream (ae:<id>) is removed
 */
import { pathToFileURL } from "node:url";
import { createDb, type Db } from "@foundmill/db";
import { ACCOUNT_COLUMNS, accountPortabilityRepo } from "@foundmill/db/repos/account-portability";
import { deleteAccountStream } from "@foundmill/events/outbox/account-relay";
import { loadEnv } from "@foundmill/shared";
import { createRedis } from "../services/redis";
import { silentLog } from "../services/log";

const USAGE = "usage: account <export|check|verify> <userId>";

export async function runAccountCommand(db: Db, command: string, userId: string, out: (line: string) => void, redis: Parameters<typeof deleteAccountStream>[0] | null = null): Promise<number> {
  if (command === "export") {
    out(JSON.stringify(await accountPortabilityRepo.export(db, userId), null, 2));
    return 0;
  }
  if (command === "check") {
    const plan = await accountPortabilityRepo.closingPlan(db, userId);
    out(JSON.stringify(plan, null, 2));
    if (plan.soleOwnerOf.length) out(`Not yet: hand over or delete ${plan.soleOwnerOf.length} project(s) first (DEPLOY §4).`);
    return plan.soleOwnerOf.length ? 1 : 0;
  }
  if (command === "verify") {
    const left = await accountPortabilityRepo.leftovers(db, userId);
    const notCleared = left.filter((l) => ACCOUNT_COLUMNS[l.column]?.onDelete === "cascade" || ACCOUNT_COLUMNS[l.column]?.onDelete === "restrict");
    out(JSON.stringify({ leftovers: left }, null, 2));
    if (notCleared.length) {
      out(`The account still has rows that go with it (${notCleared.map((l) => l.column).join(", ")}): is the auth user deleted in Supabase?`);
      return 1;
    }
    if (redis) out((await deleteAccountStream(redis, userId)) ? "Removed the account's event stream." : "No event stream to remove.");
    else out("REDIS_URL is not set: remove the stream ae:<userId> by hand if it exists.");
    return 0;
  }
  out(USAGE);
  return 2;
}

async function main(): Promise<void> {
  const [command = "", userId = ""] = process.argv.slice(2);
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = createDb(env.DATABASE_URL, { max: 1 }) as unknown as Db;
  const redis = command === "verify" && env.REDIS_URL ? createRedis(env.REDIS_URL, silentLog()) : null;
  const code = await runAccountCommand(db, command, userId, (line) => process.stdout.write(`${line}\n`), redis as never);
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}
