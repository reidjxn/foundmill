---
date: 2026-11-15
branch: claude/wp01-t4-watch-paths
title: Railway watch paths per service, written out and proven
areas: [railway, scripts, deploy]
supersedes: []
---
## What changed
**WP-01 T4: watch paths per service, written out and proven** (branch `claude/wp01-t4-watch-paths`, stacked on T1). `scripts/railway-watch.mjs` computes each
service's list from its `dependencies` (`--print`), and `--replay <range>` shows what commits would redeploy. The `railway/*.toml` copies mirror it;
`scripts/railway-config.test.mjs` pins the lists and checks docs-only (nothing), `apps/ingest` (ingest), `packages/sandbox` (orchestrator) and the lockfile (all
six). Replay over main's last 150 commits: api 104, gateway 99, orchestrator 111, composer 92, stream 91, ingest 98, instead of 150 each. Applying the lists in
Railway is WP-00 S4 (Desktop, before Dec 1, 2026).

## Decisions
### Railway watch paths: per service from its dependencies; the toml files are a mirror (WP-01 T4)

- **Chosen.** A service's watch paths are its app, the workspace packages it reaches through `dependencies` (never `devDependencies`: the api lists the gateway
  there and imports nothing from it), and the image's inputs; the orchestrator also watches `/infra/**`. A service's own `railway/<service>.toml` leaves its
  list: Railway stops reading those files on Dec 1, 2026, so editing one should not restart anything. `scripts/railway-watch.mjs` is the source; the tomls are
  kept equal by the test.
- **Measured.** Over main's last 150 commits the replay gives 91 to 111 deploys per service, slightly above the audit's estimate of 86 to 104 (the orchestrator is highest because it also imports sandbox and watches infra). With the optional negations, 86 to 105.
- **Not applied here.** Applying the lists, trying the negations on ingest first, and "Wait for CI" on api and gateway are WP-00 S4.

## Not done
See the pull request's "Not verified" section.
