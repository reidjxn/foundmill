---
name: verify-done
description: Run Foundmill's definition of done for the packages a change touched — typecheck, lint, unit tests, RLS tests, Playwright for touched screens, stories, evals, the copy linters — and report each with its result. Use before saying any change is finished.
---

# Definition of done

Run each line that applies, from the repo root, and report the command and its result. A step you could not run is reported as not run, with the reason.

1. For each touched package: `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> test`. (Package names are `@foundmill/<dir>`.)
2. A migration or a business-scoped table changed: `pnpm test:rls` (and the new table has its cross-tenant test: `rls-test`).
3. A screen changed: its spec, `pnpm --filter @foundmill/web exec playwright test e2e/<spec>.ts --trace off`.
4. A new component: a story in `packages/dugout`; `pnpm storybook:build` when stories changed.
5. A new agent behavior: an eval in `evals/src/`, run in mock mode with `pnpm --filter @foundmill/evals test`.
6. Copy a person can read changed: `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate --summary`, `node scripts/focus-visible.mjs`.
7. An event added: declared in `packages/events` with Zod and written through the outbox.
8. The branch has its file under `docs/log/` with what changed and the judgment calls; neither frozen log is edited.

Never skip, disable or quarantine a test to get green. A failing test that also fails on main is reported as such, not hidden.
