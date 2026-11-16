---
date: 2026-11-16
branch: claude/landing-build-env
title: The landing page's switches reach the Vercel build (turbo.json), and turbo.json changes rebuild the web
areas: [build, deploy, landing]
supersedes: []
---
## What changed
- `turbo.json`: the `build` task declares `SIGNUP_OPEN`, `LIVE_MODE` and `PLATFORM_MAIL_DOMAIN` (`env`). Vercel builds through Turborepo, whose strict environment mode hands a task only the variables it declares, so `/` was prerendered with every switch off whatever Vercel had set (LIVE_MODE=1 on the Vercel project, Nov 16, still served `data-people="closed"`).
- `scripts/vercel-ignore.sh` watches `turbo.json`: it decides what the web app is built with, and a change to it alone was skipped.
- Proof: `LIVE_MODE=1 npx turbo run build --filter=@foundmill/web --force` prerendered `data-people="closed"` before and `data-people="open"` after; `node --test scripts/vercel-ignore.test.mjs` passes.

## Decisions
### Declare the three switches, not loosen the env mode
`envMode: "loose"` would pass every variable to every task and drop them from the cache key; naming the three keeps the build cache honest (a switch change is a cache miss).

## Not done
Nothing else reads a non-public variable at build time today; a new one must be added here too.
