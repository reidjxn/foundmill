---
date: 2026-11-18
branch: claude/next-security-upgrade
title: Next.js 16.4.3 → 16.4.5 for two cache advisories
areas: [web, deps]
supersedes: []
---
## What changed
The founder decided on Nov 17, 2026, relayed by the plan-execution session, that the Next.js upgrade leaves the
post-Stripe dependency batch and is done now. The dev server had been printing a "known security vulnerability" notice.

- The pnpm catalog (`pnpm-workspace.yaml`) moves `next` and `eslint-config-next` from 16.4.3 to 16.4.5. Only
  `apps/web` depends on them. The lockfile changes only Next.js's own packages (`next`, `@next/env`, the `@next/swc-*`
  binaries, `eslint-config-next`, `@next/eslint-plugin-next`). React is unchanged.
- No code changed.

The advisories, both moderate, both fixed in 16.4.5:
- GHSA-mfr8-8qww-v76h: information disclosure across root params when a `'use cache'` function is called through
  `unstable_cache()` (>=16.3.0 <=16.4.4).
- GHSA-vc7v-qv4w-wrv8: cache leak across root param values in nested `'use cache'` functions (>=16.2.0 <=16.4.4).

Both live in the server runtime, so they apply to `next start` and Vercel as well as `next dev`. Neither path was
reachable here: apps/web has no `'use cache'`, `unstable_cache`, `cacheComponents` or root params. `apps/sites` is a
Hono app and does not use Next.js.

## Decisions
- 16.4.5, not 16.4.6 or a 16.5 canary: it is the smallest version that fixes both and was released Nov 3, more than
  two weeks before the change.
- The rest of the batch (undici, body-parser, follow-redirects and the others `pnpm audit` lists) stays out: no Next.js
  advisory needs it. CI's audit gate (`pnpm audit --prod --audit-level critical`) passes before and after.
- The Next.js nudge's own `next upgrade --agent=security` command was not used; the catalog edit is the whole change.

## Not done
- `pnpm audit` still reports 40 findings (3 low, 22 moderate, 14 high, 1 critical), none in Next.js. The packages are
  @hono/node-server, body-parser, esbuild, fast-uri, follow-redirects, glob, happy-dom, hono, ip-address, minimatch,
  picomatch, qs, storybook (the critical one, a dev dependency) and undici. They stay with the post-Stripe batch.
