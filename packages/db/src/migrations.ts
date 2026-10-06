/**
 * Migration files live in packages/db/migrations in drizzle-kit journal format:
 * NNNN_name.sql + meta/_journal.json. The journal is what drizzle's migrate() reads;
 * this module reads the same journal for the PGlite harness and for tooling.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Drizzle's migrations bookkeeping schema/table (defaults of drizzle-orm/pg-core). */
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface MigrationFile {
  tag: string;
  when: number;
  path: string;
  sql: string;
  /** Statements split on drizzle's `--> statement-breakpoint` marker. */
  statements: string[];
}

export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function readJournal(dir: string = MIGRATIONS_DIR): Journal {
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
  if (!Array.isArray(journal.entries)) throw new Error(`Malformed journal at ${journalPath}`);
  return journal;
}

/** Reads every migration in journal order. Throws when a journal entry has no SQL file. */
export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const journal = readJournal(dir);
  const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return sorted.map((entry) => {
    const file = path.join(dir, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) throw new Error(`Journal entry ${entry.tag} has no file at ${file}`);
    const sql = fs.readFileSync(file, "utf8");
    const statements = sql
      .split(STATEMENT_BREAKPOINT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { tag: entry.tag, when: entry.when, path: file, sql, statements };
  });
}
