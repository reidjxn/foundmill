# BUILD_RUNBOOK.md — how this repo is being built (for any Claude Code session continuing the work)

The build runs as **waves of parallel agents** orchestrated with the Workflow tool. Each wave is a script in `.claude/workflows/`. Read `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/DECISIONS.md` and `docs/PROGRESS.md` first.

## Ground rules for the orchestrating session
1. Work on a machine with ample disk (the founder's laptop is full; local building is suspended — build in the cloud).
2. `pnpm install` once at the start (`pnpm approve-builds --all -y` if pnpm complains about build scripts).
3. The scripts assume `ROOT` is the repo path: set `FM_ROOT=$(pwd)` or edit the constant at the top of each script before running.
4. Sub-agents read the user's most recent chat message as their request. Before launching a wave, make sure that message is the build instruction (e.g. "Build Foundmill end to end per docs/BUILD.md").
5. After each wave: `node .claude/workflows/reports.mjs <transcript-dir>/journal.jsonl "Wave N reports" > docs/WAVEN_REPORTS.md`, run `pnpm typecheck && pnpm lint && pnpm test` for the whole repo, fix integration issues (small fix-up agents per failing package are fine), commit, push.
6. Never commit secrets. Never rename the package scope mid-wave.

## Waves
- **Wave 1 — foundation packages** (`.claude/workflows/wave1-packages.js`): db schema/RLS/harness → repos; dugout foundation → shell/data/journey/agents; events, models, policy, agents+evals, connectors, entity-linker, journey, sandbox, shared/crypto. Status at the last local run: policy, events, dugout foundation **complete and green**; db (schema only), models, agents, connectors, entity-linker, journey partially written (files exist, not verified); sandbox, crypto, db repos, dugout stage 2 not started. Re-run the whole wave: agents must first read what already exists in their package and complete it rather than start over.
- **Wave 2 — apps and surfaces** (`.claude/workflows/wave2-apps.js`): api, gateway, orchestrator, composer, stream, ingest, collab/social, widgets, six module packs, seeds, web core → home/inbox/journey, onboarding/new business, agents/CRM. Requires `docs/WAVE1_REPORTS.md`.
- **Wave 3 — integration and gates**: whole-repo typecheck/lint/test, Storybook build, Playwright golden path (BUILD §17), fix-ups, Gate 0/1 checks from BUILD §16, security review (`.claude/agents/security-reviewer.md`), `pnpm banned-terms`.
- **Rename**: between waves, rename the package scope `@founder-manager/*` → `@foundmill/*` (sed over package.json, imports, tsconfig paths, Dockerfile, docs) and run `pnpm install`.

## Deployment (from a machine with the CLIs logged in)
- Supabase: `railway run -s api -- pnpm db:migrate` then `railway run -s api -- pnpm db:seed` (uses the service's DATABASE_URL without exposing it).
- Railway: `railway up --service <name>` per backend service (root Dockerfile, `APP` variable selects the package).
- Vercel: `vercel deploy --prod` from the repo root (root directory `apps/web` is set on the project).
- DNS for foundmill.com at Spaceship: see the table in the session notes / docs/DECISIONS.md.
