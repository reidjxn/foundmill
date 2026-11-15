---
date: 2026-11-15
branch: claude/wp01-t5-fewer-web-builds
title: Fewer web builds: no preview for a change the web app is not built from
areas: [vercel, scripts, ci]
supersedes: []
---
## What changed
**WP-01 T5: fewer web builds** (branch `claude/wp01-t5-fewer-web-builds`, stacked on T1). `apps/web/vercel.json` turns off deployments for `agent/**` branches
and runs `scripts/vercel-ignore.sh` as the Ignored Build Step: a push that changes nothing the web app is built from (docs, the backend apps, `.github`) builds
no preview. `scripts/vercel-ignore.test.mjs` fails when a package the web app reaches is missing from the script.

## Decisions
### Vercel's Ignored Build Step follows the web app's packages transitively (WP-01 T5)

- **Chosen.** The plan's script listed the web app's direct workspace dependencies. `@foundmill/events` depends on `db`, `agents` and `models` at runtime, so a
  change there can change the web bundle; the script and its test follow `dependencies` transitively and add those three, plus `patches`. `@foundmill/api`
  counts as its source only: the web app imports its router's types (the one runtime import is in a test), and `next.config.ts` ignores type errors at build.
- **Effect.** Docs-only, `.github`-only and backend-app-only pushes build no preview; a change under `packages/db` still builds one. No `agent/**` branch deploys (founder decision 4 of WP-01: the founder reviews an agent's web change from the diff and CI).

## Not done
See the pull request's "Not verified" section.
