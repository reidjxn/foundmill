# apps/web Playwright suites

Screen tests for the web app (CLAUDE.md "Playwright test for any screen touched"; docs/ARCHITECTURE.md §15). Desktop only: every spec runs at 1440 × 900 in Chromium. Spec names carry the acceptance-criteria ids they cover (`AC-11.3.3` and so on).

## The stack the suites run against

Everything is mock-first and needs no secrets, Redis, Temporal or Supabase:

| Piece | Setting |
| --- | --- |
| Database | one file-backed PGlite directory, `DATABASE_URL=pglite:./.pglite/e2e` (relative paths resolve against the workspace root, `packages/db/src/pglite.ts`) |
| Seed | `pnpm --filter @foundmill/db seed` with `SEED_TARGET=pglite SEED_PGLITE_DIR=./.pglite/e2e` (Northwind Skincare + Ledgerly; `SEED_VOLUME_SCALE=0.1` keeps it quick) |
| Signed-in founder | `DEV_AUTH_USER_ID` = the seed owner, `DEMO_OWNER_USER_ID` in `packages/db/src/seed/constants.ts` (`0f0a0d00-0000-4000-8000-00000000f0a1`); the login page's "Continue as developer" button sets the dev cookie, the api and the stream accept the literal `dev` bearer |
| apps/api | `:4000`, `APP_ENV=test INTEGRATIONS_MODE=mock MODEL_MODE=mock LIVE_MODE=1 PLATFORM_MAIL_DOMAIN=mail.foundmill.test` (the LIVE pages and Go live are closed without `LIVE_MODE`; the domain shows a project's Foundmill sending address in Settings › Integrations, on its mock), no reachable `COMPOSER_URL` (the api narrates in-process), no Redis (no live stream; the shell polls `cycle.status`), no Temporal (`business.continue` runs one in-process cycle step) |
| apps/web | `next dev` on `:3000` with `NEXT_PUBLIC_APP_ENV=test NEXT_PUBLIC_API_URL=http://localhost:4000` and no `NEXT_PUBLIC_COLLAB_URL` (the spec editor keeps edits local) |
| Browser | Chromium from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in the build container (`playwright.config.ts` uses `/opt/pw-browsers/chromium` when it exists, or `FM_CHROMIUM`); never run `playwright install` there. CI runners install Chromium with `pnpm --filter @foundmill/web exec playwright install --with-deps chromium` |

`apps/web/playwright.config.ts` starts both servers itself (and seeds the database when `./.pglite/e2e` is missing) unless `E2E_BASE_URL` is set, in which case it only points the browser at the running stack.

## Commands

From the workspace root.

One-shot, everything managed by Playwright (seed on first run, api + web started and stopped by the runner):

```sh
pnpm --filter @foundmill/web exec playwright test
# one spec, headed, with the trace viewer afterwards
pnpm --filter @foundmill/web exec playwright test e2e/inbox.spec.ts --headed
pnpm --filter @foundmill/web exec playwright show-report
```

Step by step (what CI does in `.github/workflows/ci.yml` and what to do when the servers should stay up between runs):

```sh
# 1. seed once (re-run to reset the data; the seed replaces the demo businesses)
SEED_TARGET=pglite SEED_PGLITE_DIR=./.pglite/e2e SEED_VOLUME_SCALE=0.1 pnpm --filter @foundmill/db seed

# 2. the api on :4000 against that database
APP_ENV=test INTEGRATIONS_MODE=mock MODEL_MODE=mock LIVE_MODE=1 PLATFORM_MAIL_DOMAIN=mail.foundmill.test DATABASE_URL=pglite:./.pglite/e2e \
DEV_AUTH_USER_ID=0f0a0d00-0000-4000-8000-00000000f0a1 API_PORT=4000 \
pnpm --filter @foundmill/api start

# 3. the web on :3000 (second terminal)
NEXT_PUBLIC_APP_ENV=test NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_COLLAB_URL= \
pnpm --filter @foundmill/web dev

# 4. the suites against the running stack (third terminal)
E2E_BASE_URL=http://localhost:3000 pnpm --filter @foundmill/web exec playwright test
E2E_BASE_URL=http://localhost:3000 pnpm --filter @foundmill/e2e test   # the golden path in /e2e
```

Keep `COMPOSER_URL` unset (or pointing at nothing) so the api uses its in-process composer; a stale `.env` with `COMPOSER_URL=http://localhost:4002` is fine as long as nothing listens there. On a small machine keep `NODE_OPTIONS=--max-old-space-size=2048` for the web dev server. The config runs one worker: the specs share one seeded database and several of them write to it (the Inbox refresh adds a note, Commit creates businesses, the spec editor saves a block), so the counts they assert are only deterministic in file order.

## Specs

| File | Covers |
| --- | --- |
| `shell.spec.ts` | login form and dev bypass, redirect to `/login?next=`, AppShell at 1440 px, NeedsLargerWindow below 1280 px, G-chords, every Settings tab |
| `server-path.spec.ts` | a signed-in `/` redirects to the last business's Home from the proxy; a last business that no longer opens is forgotten (no dead end, no loop); the app frame and the document head go out before the business layout's data; the browser title follows navigations with one `<title>`; the profile the layout read is not asked again |
| `home.spec.ts` | dashboards as tabs, Edit mode on E, presets (AC-11.2.4) |
| `inbox.spec.ts` | 380 px list, tabs, J/K, reading pane anatomy, R refresh debounce (AC-11.3.2), decide → Continue drops (AC-11.3.3) |
| `journey.spec.ts` | Customer Update replay: stepper, CRM link, speed remembered, deterministic schedule hash (AC-11.4.3), reduced motion (AC-11.4.5) |
| `milestones.spec.ts` | `/trophies` → `/milestones`, the eight milestones, a reached milestone opens its replay, LIVE share card |
| `onboarding.spec.ts`, `ideation.spec.ts`, `import.spec.ts`, `commit.spec.ts` | first-run flow (AC-11.1.1–7): profile gate, Ideation Studio, Door B import through `import.start`/`import.status` (AC-11.1.5 never pushes), Commit (the logo: generated marks, a PNG upload resized in the browser and checked by the server, colours from the logo, the logo on the new business's top bar) |
| `live.spec.ts` | the LIVE pages from Ledgerly's sidebar: Network (strip, requests, messages, connections, profile visibility saved and restored), Communities (join and leave, feed, post and reply with Ctrl+Enter), the shell following the last-opened business (a Personal one gets a notice), and signed-out redirects |
| `preferences.spec.ts` | Settings › Preferences: day first and 24-hour change the top bar, Home's Journey ribbon and the Inbox at once, survive a reload with no hydration warning, hold in Ledgerly; ISO and back; the command palette finds Preferences by "24-hour". The dev founder's choice is put back afterwards |
| `businesses.spec.ts` | Switch business in the top bar (every business, the current one checked, no frame mixing two businesses, the last business remembered), Create a new business → the doors with Back to …, Your businesses (role, plan, modes, created date, Open, Settings), a business taken charge of appears in the switcher |
| `no-clip.spec.ts` | nothing a person reads is clipped or overlaps, on every screen at 1280 and 1440 px. `E2E_DATE_FORMATS=us.12h,day_first.24h,iso.24h` repeats it under each date format (dates and times change width); the dev founder's choice is set through the API for each run and put back afterwards |
| `platform-mail.spec.ts` | Settings › Integrations › Email from your project: the project's Foundmill address (kept across a reload), today's count against the cap, the line about outside contact and that sending is simulated; no row when the feature is off |
| `billing.spec.ts` | Settings › Billing top-ups: Top up opens a checkout (simulated on this stack, labeled, no money moves), completing it adds the credits once, a reload shows it paid, a canceled checkout says nothing was charged; amounts in US dollars |
| `settings-business.spec.ts` | Settings › Business logo: generate and pick (saved at once, on the top bar, survives a reload), upload a PNG and take its colours, back to the initials mark; the business time zone (the top bar and the Journey's Today name its day; put back afterwards); Settings › Your words renaming Home's captions and the Inbox tabs (removed afterwards) |
| `foundations.spec.ts` | the vision, specification and roadmap drafted on the first open: Home's drafting state (the shell's `product.foundations.ensure` is held until the test has seen it), then ready, the Vision tab, the roadmap's three horizons, agent-written blocks and the Inbox note (Door A); every imported issue on the roadmap and the import's first decisions on the Board item (Door B) |
| `agent-profile.spec.ts`, `crm.spec.ts`, `entity-profile.spec.ts` | agent profile tabs and training flow (AC-11.10.x), CRM search and saved views (a view saved as new, and the open view, come back after a reload; every CRM test starts from All), entity profile tabs |

Streamed pages (audit #433, docs/DECISIONS.md 2026-10-14): the server sends the shell with a skeleton in `main` and the screen afterwards in a hidden `div[hidden][id^="S:"]`, which React moves in about 300 ms after the first paint; a shell that hydrates first client-renders the screen, so for a moment the document holds it twice, and a click or a key press can land on nodes React replaces. So: `openBusiness` and `openSettings` end with `settled(page)` (the streamed copy is gone and the screen is hydrated), call `settled(page)` yourself after any `page.goto` or reload that is followed by an interaction, start locators for a Settings tab's content at `settingsScreen(page)`, and look toasts up with `toast(page, title)` (the viewport, whole title: Radix also announces each toast in a hidden live region, so a substring `getByText` matches twice).

No spec skips itself: when the seed does not give the dev user what a spec needs (a won customer, two organisations to merge, a department with specification blocks) it fails with a message that says what is missing and how to re-seed (`seedExpectation` in `helpers.ts`). Every spec is re-runnable against the same database: forks, merges and notes from earlier runs are tolerated, and `onboarding.spec.ts` takes the pre-filled-profile branch once the profile exists (which is the branch CI takes, since CI seeds without `SEED_OWNER_PROFILE=0`). The onboarding tests save the profile as "Playwright Founder"; the file puts the dev founder's profile back as it found it when it finishes (`restoreFounderProfile` in `helpers.ts`), since that name shows on every screen (the Inbox, the Hierarchy).
