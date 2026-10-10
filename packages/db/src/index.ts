// @foundmill/db — see docs/ARCHITECTURE.md §4
export * from "./client";
export * from "./schema";
export * from "./repos";
export { BYOK_CONNECTOR_KEY, BYOK_CREDENTIAL_KIND, LEGACY_BYOK_CREDENTIAL_KIND, StoredApiKeySchema, loadByokApiKey, type ByokApiKey } from "./byok";
export { bookUsage, CREDITS_EXHAUSTED_SUBJECT, type BookUsageResult, type CreditsOutcome } from "./billing";
export { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, readJournal, readMigrations } from "./migrations";
export type { Journal, JournalEntry, MigrationFile } from "./migrations";
export { appliedMigrationCount, migrateDb, type MigrateResult } from "./migrator";
export { DEFAULT_PGLITE_DIR, PGLITE_BOOTSTRAP_SQL, findWorkspaceRoot, isPgliteDb, isPgliteUrl, parsePgliteUrl, pgliteUrl, resolvePgliteDir } from "./pglite";
export type { LazyPgliteClient, PgliteTarget } from "./pglite";
