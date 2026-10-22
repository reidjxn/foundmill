# Foundmill handover: what the agents need to continue building Foundmill

Written 2026-10-22 for the Foundmill business owned by reid@foundmill.com. It is the first thing an agent reads. It is not a substitute for the docs it points to; it says where to look and what is true today.

## What Foundmill is

Foundmill is a platform where a founder runs a business with a team of AI agents. The founder sets the direction and approves the decisions that matter; the agents do the work, inside a set of rules and gates. Business is the word for the thing being run (never "club"). Agents are the team (never "squad"). Staff are the human members. The Chief of Staff is the agent that coordinates the team.

The codebase is a pnpm and Turborepo monorepo:
- `apps/web`: the Next.js app (Vercel, production)
- `apps/api`: Hono and tRPC API (Railway)
- `apps/gateway`: the only service that calls outside vendors (Railway). Every agent tool call goes through it, with policy and audit.
- `apps/orchestrator`: runs agent sessions and workflows (Railway)
- `apps/composer`, `apps/ingest`, `apps/stream`, `apps/collab`, `apps/social`: supporting services
- `packages/dugout`: the design system. Every UI element comes from here.
- `packages/modules`, `packages/widgets`: screens and widgets
- `packages/db`: Drizzle schema, migrations (`packages/db/migrations`), repositories, seeds
- `packages/agents`: agent templates, skills, prompts
- `packages/connectors`: connectors to vendors, each with a real and a mock implementation
- `packages/models`: model routing. Model ids live only in `packages/models/src/routing.ts`.
- `packages/events`, `packages/shared`: event schemas (Zod) and shared constants

## Read these, in this order

1. `CLAUDE.md` (repo root): the rules. Vocabulary, never-list, definition of done. Authoritative.
2. `docs/ARCHITECTURE.md`: package ownership and cross-package contracts.
3. `docs/DESIGN.md`: the design direction. Every pixel follows it.
4. `docs/DECISIONS.md`: decisions already taken. Do not re-decide them. Add new judgement calls here.
5. `docs/PROGRESS.md`: what was built, wave by wave. Update it after every task.
6. `docs/DEPLOY.md`: how production is set up, including the GitHub App (section 4) and the live connectors (section 6).
7. `docs/BUILD.md`: the original build plan.
8. `docs/UX_AUDIT_AND_PLAN.md`: the UX audit and the guided-layer plan that was built in the last big wave.

## Where production stands (as of 2026-10-22)

- Production is `main` at `dc44af6` (PR #12, the UX plan). Vercel serves `foundmill.com` from it. Railway runs the api and gateway from it.
- Migrations 0064 to 0066 applied at api boot.
- The gateway is live with GitHub: `LIVE_CONNECTORS=github`, the GitHub App is installed on `reidjxn/foundmill` only, and reid@foundmill.com has connected it inside Foundmill.
- PR #13 (`claude/relaxed-fermi-oip5am`) adds, when merged:
  - `run_checks` (starts the real CI on an `agent/` branch) and `get_checks` (reads its result)
  - the merge rule: a merge into `main` is always the founder's decision, whoever is delegated
  - the `checks.run` grant for the QA engineer and the engineering lead
  - the tamper guard on `run_checks`: it refuses to run when `.github` on the branch differs from `main`
  - `get_checks` waits for a completed CI run on the head commit before it reports success
- Not built yet: a Railway deploy connector, so agents can deploy production directly. The founder has decided they should be able to. It needs real and mock versions, tests, and a gateway policy that allows only the production service, only `main`, and only after CI passes for that exact commit.
- Not finished: the go-to-market channels. Each needs its own accounts, approvals and keys, and some are regulated. That needs a separate plan, written after the first live loop works.

## The rules that matter most

- Never push to `main`. Work on your own `agent/<name>` branch, open a pull request, and wait for the founder. Never merge. Never approve your own merge.
- Never commit or print secrets. Tokens and keys live in Railway variables and nowhere else.
- Every change: typecheck, lint, unit tests, and a Playwright spec for any screen you touched, a Storybook story for any new component, an eval for any new agent behaviour, and an update to `docs/PROGRESS.md`.
- Business-scoped tables need a `business_id`, a row-level security policy, and a cross-tenant test in the same change.
- Outside calls go only through `apps/gateway`. Never call a vendor API from another service.
- Events are declared in `packages/events` with Zod, and written through the outbox.
- Connectors have a real and a mock implementation. `INTEGRATIONS_MODE=mock` must run the golden path.
- Label every number that is not from real data "Forecast" or "Estimate".
- US English and US dates everywhere a user can read them. Run `node scripts/us-english.mjs`.
- Banned vocabulary: run `node scripts/banned-terms.mjs`. The full table is in `CLAUDE.md`.
- Desktop only, at 1280 px and wider. Never build mobile layouts.

## How to check your work

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit, runs on CI)
- `pnpm --filter @foundmill/web exec playwright test <spec>` for browser specs (run one spec at a time, from the repo root with the local stack)
- `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate`
- `pnpm evals` for agent behaviour

CI runs on every pull request. A full CI run takes about 40 to 50 minutes, because the unit-test job is long. The agent's own commits carry `[skip ci]`, so CI does not run on them until you start it with `run_checks`.

## Open items, in priority order

1. Merge PR #13 (founder), then redeploy the gateway from `main`, so `run_checks` and `get_checks` reach production.
2. The first live loop: an engineering agent branches, commits, runs checks, opens a pull request, and asks the founder to approve the merge.
3. The Railway deploy connector (agents deploy production directly, under the rules above).
4. A hydration mismatch in the Example chip on the example business's shell. It logs a React error and fails no test.
5. Copy on the Team › Responsibilities screen may still describe delegating merges. Merges are the founder's only; that copy must say so.
6. A scalability baseline from Railway metrics, then a ramp, one department at a time.
7. The go-to-market plan, written after step 2 works.

## History, so you do not repeat it

- The UX audit and plan came from a 30-minute external user test. The guided layer, the plain-language sweep, the example business and the tours were built from it (PR #12).
- The earlier waves of Foundmill, and the reasons for the big choices (Railway instead of Fly.io, GitHub Actions as the verification machine, the sandbox runner choice), are in `docs/DECISIONS.md`.
- Production incidents and their fixes are in `docs/PROGRESS.md` and `docs/DECISIONS.md`.

If something in this brief disagrees with the repo, trust the repo, and record the difference in `docs/PROGRESS.md`.
