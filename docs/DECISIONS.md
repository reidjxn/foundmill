# DECISIONS.md

Decisions this build has taken where `docs/BUILD.md` left room. Each entry: the decision, the option chosen, why. Newest at the bottom.

## 2026-10-05 — Toolchain versions (BUILD §3.1 "record exact versions")

Pinned in `pnpm-workspace.yaml` under `catalog:` (one version per dependency for the whole repo). Highlights:

| Layer | Version | Note |
| --- | --- | --- |
| Node / pnpm | 22.x / 12.9.1 | corepack-managed |
| TypeScript | 5.9.3 | TypeScript 7.0 (the native port) is published but tooling compatibility (Next, typescript-eslint, Storybook) is not yet uniform; stay on 5.9 |
| Next.js / React | 16.3.8 / 19.3.0 | App Router |
| Tailwind | 4.3.3 | CSS-first config; Dugout tokens mapped through `@theme` |
| TanStack Query / Table | 5.104 / 8.21.3 | react-table 9.x exists but its API is new; 8.x is the documented virtualised-table path |
| react-grid-layout | 2.3.0 | current major; check its README before use |
| Storybook | 10.6.1 | react-vite framework |
| Drizzle | 0.45.3 (+ drizzle-kit 0.31.11) | SQL migrations in `packages/db/migrations` |
| Hono / tRPC | 4.13 / 11.19 | `@hono/trpc-server` adapter |
| Temporal TS SDK | 1.24.0 | |
| Claude Agent SDK / Anthropic SDK | 0.3.291 / 0.131.0 | |
| Cedar | `@cedar-policy/cedar-wasm` 4.13.0 | |
| Vitest / Playwright | 5.0.3 / 1.63.0 | |
| ESLint | 9.39.5 flat config | custom `fm/no-raw-db` rule inline in `eslint.config.mjs`; the events outbox/relay/consumer files are allow-listed because they are the data layer for events |

## 2026-10-05 — Model ids (BUILD §10.1)

`packages/models/src/routing.ts` uses `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, as given in BUILD.md and matching Anthropic's current model list at the time of writing. Re-verify before Phase 1 live smoke.

## 2026-10-05 — No Docker on the build machine

Docker is not installed on the machine this was built on. Consequences:
- **RLS cross-tenant tests run on PGlite** (`@electric-sql/pglite`, real Postgres compiled to WASM, supports roles, RLS, `pg_trgm`, `pgvector`). The test harness creates a stub `auth` schema with `auth.uid()` reading `request.jwt.claims`, applies the SQL migrations, and switches roles per test. The same tests can run against a real Postgres when `RLS_TEST_DATABASE_URL` is set.
- **Supabase local** is not used; development and staging point at the hosted EU project.
- **Local sandbox runner**: the Docker runner is implemented behind the `packages/sandbox` interface but the mock sandbox (replays recorded sessions) is the default in development.

## 2026-10-05 — Migrations runner

Migrations are plain SQL files in `packages/db/migrations` (drizzle-kit journal format) applied by `pnpm db:migrate` (drizzle `migrate()` over `DATABASE_URL`). The Supabase CLI is used for project linking and type generation only, not for migrations, so the migration directory stays where BUILD §3.2 puts it.

## 2026-10-05 — Node services run with `tsx` in staging

`apps/api`, `apps/gateway`, `apps/composer`, `apps/ingest`, `apps/stream`, `apps/collab`, `apps/orchestrator` start with `tsx src/index.ts` (no bundling step). Simplest thing that runs TypeScript source across workspace packages; swap for a bundler when cold-start time matters.

## 2026-10-05 — Staging topology (substitutions for BUILD §3.1 "Hosting")

- Web: Vercel (as specified).
- Node services and the Temporal worker: **Railway** instead of Fly.io (the human's accounts are Vercel, Supabase, GitHub and Railway).
- Redis: **Railway Redis** instead of Upstash for staging; production can switch by changing `REDIS_URL`.
- Temporal: `temporalio/auto-setup` image on Railway with a Railway Postgres, instead of Temporal Cloud (which requires an account the human has not created). The orchestrator reaches it over Railway private networking.
- Envelope encryption: **libsodium with `DEV_MASTER_KEY`** in staging (no AWS KMS key exists yet). The KMS implementation is present behind the same interface and activates when `KMS_KEY_ID` is set.
- Database: Supabase project `foundermanager` (ref `sdruubitufjqibsjyxlc`, North EU / Stockholm), created by the human.

## 2026-10-05 — Hooks (BUILD §4.2)

`.claude/settings.json` wires `PostToolUse` (matcher `Edit|Write|MultiEdit`) to `.claude/hooks/post-edit.sh` and `Stop` to `.claude/hooks/stop.sh`, per the current Claude Code hooks reference (hook input arrives as JSON on stdin with `tool_input.file_path`). Both scripts are **gated by `FM_HOOKS=1`** so that the bulk-generation phase with many parallel agents is not slowed to a crawl by a typecheck after every edit. Set `FM_HOOKS=1` in your shell for day-to-day development.

## 2026-10-05 — MCP servers (BUILD §4.5)

`.mcp.json` declares Vercel (remote, OAuth), Supabase (remote, OAuth, scoped to the staging project), GitHub (remote, needs `GITHUB_MCP_PAT` in the environment — HUMAN CHECKPOINT) and Playwright (stdio). The Vercel plugin for Claude Code was installed at user scope by following https://vercel.com/get-started.md.

## 2026-10-05 — Fonts

Self-hosted through `@fontsource/barlow-semi-condensed`, `@fontsource/inter` and `@fontsource-variable/jetbrains-mono` (OFL licences), imported once in `packages/dugout/src/fonts.css`. No runtime font CDN.

## 2026-10-05 — Procedural crests and avatars

Crests and agent avatars are generated as SVG in `packages/dugout` from a seed and kit/department colours, so mock mode needs no image-generation connector. The Recraft/Ideogram connector (BUILD §13.2) can replace the crest later; the data model stores `crest_url` either way.

## 2026-10-05 — Development auth bypass

`DEV_AUTH_USER_ID` lets `apps/api` and `apps/stream` skip JWT verification **only when `APP_ENV` is `development` or `test`** (Playwright, local development without Supabase Auth). Any other value of `APP_ENV` ignores the variable.

## 2026-10-05 — Repository location: not on the Desktop

The repo first lived in `~/Desktop/founder-manager`. That folder is an iCloud Drive file-provider domain ("Desktop & Documents" sync) and the machine's disk was full, so macOS evicted freshly written files and every read (including `git add`) blocked on an iCloud download that never completed. The repo was recreated at `~/code/founder-manager`, which is not synced. Rule: never put this repo (or `node_modules`) inside an iCloud-synced folder.
