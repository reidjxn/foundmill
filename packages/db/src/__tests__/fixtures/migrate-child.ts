/**
 * Child process for migrate-lock.test.ts: migrates `<url>` from `<folder>` and prints "done" when finished.
 * The test kills it with SIGKILL mid-migration to show the lock does not outlive the process.
 * Usage: node --import tsx src/__tests__/fixtures/migrate-child.ts <url> <folder>
 */
import { closeDb, createDb } from "../../client";
import { migrateDb } from "../../migrator";

const [url, folder] = process.argv.slice(2);
if (!url || !folder) throw new Error("usage: migrate-child.ts <url> <folder>");
const db = createDb(url, { max: 1, prepare: false });
await migrateDb(db, { migrationsFolder: folder, lockTimeoutMs: 30_000 });
process.stdout.write("done\n");
await closeDb(db);
