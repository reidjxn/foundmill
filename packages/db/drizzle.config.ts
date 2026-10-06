import { defineConfig } from "drizzle-kit";

// Migrations are hand-written SQL in ./migrations (drizzle-kit journal format). drizzle-kit is used for
// `generate` diffs against the Drizzle schema when adding tables; `migrate`/`push` go through src/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/founder_manager" },
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
});
