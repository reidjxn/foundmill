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
| `login.spec.ts` | the sign-in page at 1280 and 390 px (no horizontal scroll, 44 px targets, the callback's notices), Continue with Google present exactly when `NEXT_PUBLIC_AUTH_GOOGLE=on` and its "isn't available" line on this stack (no Supabase), the developer sign-in with `next`. The spec reads the flag from its own environment: run it as is (off, as CI does) and once more with `NEXT_PUBLIC_AUTH_GOOGLE=on` given to both the runner and the web server (restart `next dev`: the value is built into the page). The sent state (WP-03 T4: "Check your email"; at 390 px the code field above "Or open the link in that email on this device.", on a desktop the link first) needs a web built with a stand-in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `E2E_SUPABASE_STUB=1` for the runner, which answers the browser's send itself; skipped otherwise. `/auth/confirm` (where the sign-in email's link lands since Nov 16, 2026): on this stack it goes to the form's notice; with the stub the page shows its one button, which opens the one-time link only when pressed (the stub answers the verify address). |
| `server-path.spec.ts` | a signed-in `/` redirects to the last business's Home from the proxy; a last business that no longer opens is forgotten (no dead end, no loop); the app frame and the document head go out before the business layout's data; the browser title follows navigations with one `<title>`; the profile the layout read is not asked again |
| `home.spec.ts` | dashboards as tabs, Edit mode on E, presets (AC-11.2.4) |
| `inbox.spec.ts` | 380 px list, tabs, J/K, reading pane anatomy, R refresh debounce (AC-11.3.2), decide → Continue drops (AC-11.3.3) |
| `journey.spec.ts` | Customer Update replay: stepper, CRM link, speed remembered, deterministic schedule hash (AC-11.4.3), reduced motion (AC-11.4.5) |
| `milestones.spec.ts` | `/trophies` → `/milestones`, the ten milestones (the two early ones first), a reached milestone opens its replay, LIVE share card |
| `project-story.spec.ts` | a throwaway project publishes its page and "Page live" is reached in Plan › Milestones; Show on your page, the quiet "On your page" with Hide and Copy card link; signed out at 390 and 1280 px, `/p/<slug>/story` (indexable, "Verified by Foundmill", no horizontal scroll, 44 px links, no text under 11 px) and the card at `/m/<id>` (noindex, both share images); the project page's mark leads to the story; hidden again, the story and the card answer not found |
| `tap-to-post.spec.ts` | tap-to-post (docs/DESIGN.md §9g): a throwaway project publishes its page; Product › Public page offers "Share your page" and Plan › Milestones offers "Share" on a milestone that is on the page; in the panel every "Opens ready to post" link is https to the network's own host with the encoded text and the address with `via` (the page, then the card), the link-only networks carry the link alone, changing the text changes every link and a long text is shortened per network, "Copy link" copies the address, nothing is saved; the Channel Board shows the social channel as available with "You post each one with one press: the text and link are filled in for you." No link is followed: nothing opens a real network |
| `post-drafts.spec.ts` | posts the social agent drafts to share by tap (docs/DESIGN.md §9g), on the mock model: a throwaway project publishes its page with the social channel off the board and nothing is drafted; put on the Channel Board, a post appears on Customers › Creative ("Written by your team for you to share", "Not shared yet", Share and "Not this one", no Approve or Reject), its panel's "Opens ready to post" links carry the whole text and the page's address with `via`, and a change to the text reaches them all; Today shows one quiet line that leads to the post; "Not this one" takes it off the tab and off Today; a milestone shown on the page then gets its own post pointing to its card, and once a share is opened for it (Copy link) it reads "Share opened" and Today's line goes. No link is followed, and nothing says a post was posted |
| `onboarding.spec.ts`, `ideation.spec.ts`, `import.spec.ts`, `commit.spec.ts` | first-run flow (AC-11.1.1–7): profile gate, Ideation Studio, Door B import through `import.start`/`import.status` (AC-11.1.5 never pushes), Commit (the logo: generated marks, a PNG upload resized in the browser and checked by the server, colours from the logo, the logo on the new business's top bar) |
| `live.spec.ts` | the LIVE pages from Ledgerly's sidebar: Network (strip, requests, messages, connections, profile visibility saved and restored), Communities (join and leave, feed, post and reply with Ctrl+Enter), the shell following the last-opened business (a Personal one gets a notice), and signed-out redirects |
| `preferences.spec.ts` | Settings › Preferences: day first and 24-hour change the top bar, Home's Journey ribbon and the Inbox at once, survive a reload with no hydration warning, hold in Ledgerly; ISO and back; the command palette finds Preferences by "24-hour"; the guidance switch and text size; the Email switch ("Email me when something has waited a day for my answer": on by default, saved with a toast, kept across a reload and in Ledgerly). The dev founder's choices are put back afterwards |
| `businesses.spec.ts` | Switch business in the top bar (every business, the current one checked, no frame mixing two businesses, the last business remembered), Create a new business → the doors with Back to …, Your businesses (role, plan, modes, created date, Open, Settings), a business taken charge of appears in the switcher |
| `no-clip.spec.ts` | nothing a person reads is clipped or overlaps, on every screen at 1280 and 1440 px. `E2E_DATE_FORMATS=us.12h,day_first.24h,iso.24h` repeats it under each date format (dates and times change width); the dev founder's choice is set through the API for each run and put back afterwards |
| `platform-mail.spec.ts` | Settings › Integrations › Email from your project: the project's Foundmill address (kept across a reload), today's count against the cap, the line about outside contact and that sending is simulated; no row when the feature is off |
| `billing.spec.ts` | Settings › Billing top-ups: Top up opens a checkout (simulated on this stack, labeled, no money moves), completing it adds the credits once, a reload shows it paid, a canceled checkout says nothing was charged; amounts in US dollars |
| `settings-business.spec.ts` | Settings › Business logo: generate and pick (saved at once, on the top bar, survives a reload), upload a PNG and take its colours, back to the initials mark; the business time zone (the top bar and the Journey's Today name its day; put back afterwards); Settings › Your words renaming Home's captions and the Inbox tabs (removed afterwards) |
| `foundations.spec.ts` | the vision, specification and roadmap drafted on the first open: Home's drafting state (the shell's `product.foundations.ensure` is held until the test has seen it), then ready, the Vision tab, the roadmap's three horizons, agent-written blocks and the Inbox note (Door A); every imported issue on the roadmap and the import's first decisions on the Board item (Door B) |
| `agent-profile.spec.ts`, `crm.spec.ts`, `entity-profile.spec.ts` | agent profile tabs and training flow (AC-11.10.x), CRM search and saved views (a view saved as new, and the open view, come back after a reload; every CRM test starts from All), entity profile tabs |
| `invitations.spec.ts` | invitations to a project (docs/DESIGN.md §9h): Settings › People's "Invite someone" makes a link shown once (a cofounder invitation needs their email), the waiting invitation is listed and Revoke stops its link; `/i/<token>` signed out at 390 px (who, what, as what, "Sign in to accept" back to the same address, no horizontal scroll, 44 px controls, noindex, read by the browser from the api itself), and with the api's limit refusing the read (a routed 429) "Too many people opened links just now." and Try again; another account holding the cofounder link reads "Sign in with the address this invitation was sent to." on Accept and on Decline, at 390 px, and the invitation still waits; the second account (`/auth/dev?as=`, whose stub address `dev-<id>@foundmill.local` the invitation names) signs in, accepts, is taken into the project, the link is used up and the owner's People list shows a Cofounder. With `E2E_SIGNUP_CEILING=0` and the api started with `SIGNUP_OPEN=1 SIGNUP_DAILY_CEILING=0` (its own seeded PGlite directory and ports; the shared stack is unrestricted; every test of the file passes on it), a new account that signs in meets "You're on the list." in place at 390 px (on `/start` and `/new`, Sign out, a link onward, no request for a larger window); skipped otherwise |
| `not-invited.spec.ts` | the gate at 390 px (WP-03 T1): with `E2E_SIGNUP_ALLOWLIST=1` and the api started with `SIGNUP_ALLOWLIST=someone-else@example.com` (its own seeded PGlite directory and ports, as the ceiling case above), a new account signed in through `/auth/dev?as=` meets "A few people at a time" on `/start` in place, never `needs-larger-window`; its place is saved on arrival (or "Save my place" is offered to try again), nothing promises an email, no horizontal scroll, every control at least 44 px tall, and Sign out works; skipped otherwise |
| `founder-notices.spec.ts` | founder notices and the former founder's cancel (security review P2-3; docs/DESIGN.md §9i): a cofounder lowers the dev founder's role, removes them and asks for the project's deletion; the deletion's notice to the dev founder carries a one-click cancel, and `/a/<token>` signed out at 390 px says which project, changes nothing until its button (a POST), cancels once and is spent; asked again, the card on the dev founder's Home asks once more, cancels and says so. The link's token only exists in what the api sends the gateway, so the spec stands in for the gateway with a recorder on `E2E_GATEWAY_RECORDER_PORT`: start the api with `GATEWAY_URL=http://127.0.0.1:<that port>` and a `SESSION_TOKEN_SECRET` of 16 characters or more (the `/a/<token>` test is skipped without the port) |
| `accessibility.spec.ts` | axe-core (WCAG 2.2 AA, the stories' rules in `packages/dugout/.storybook/a11y-rules.ts`) on real pages: the landing page, the Terms, the Privacy Policy, sign-in, `/email/pause`, `/a/<token>` and `/i/<token>` signed out at 390 and 1280 px; the profile, People, Today and Needs you at 390 px; Today, Home, Needs you, the CRM and Settings at 1440 px. `e2e/axe.ts` (`expectNoAxeViolations`) is the helper; `public-page.spec.ts` runs it on a published project page. Reviewed exceptions live in `KNOWN_EXCEPTIONS` there and are listed in the test's annotations. The design system's stories have their own run: `pnpm --filter @foundmill/dugout storybook:build && pnpm --filter @foundmill/dugout test:a11y` |
| `attribution.spec.ts` | `?via=<reference>` on any address: the first reference is kept in the httpOnly `fm_via` cookie (a later one never replaces it, a value that is not a reference sets nothing, the page's scripts cannot read it), a new account's first profile save sends it as `via`, the cookie is gone after that save, and an edit carries none. Signs in as a new account each run, never as the dev founder |

Streamed pages (audit #433, docs/DECISIONS.md 2026-10-14): the server sends the shell with a skeleton in `main` and the screen afterwards in a hidden `div[hidden][id^="S:"]`, which React moves in about 300 ms after the first paint; a shell that hydrates first client-renders the screen, so for a moment the document holds it twice, and a click or a key press can land on nodes React replaces. So: `openBusiness` and `openSettings` end with `settled(page)` (the streamed copy is gone and the screen is hydrated), call `settled(page)` yourself after any `page.goto` or reload that is followed by an interaction, start locators for a Settings tab's content at `settingsScreen(page)`, and look toasts up with `toast(page, title)` (the viewport, whole title: Radix also announces each toast in a hidden live region, so a substring `getByText` matches twice).

No spec skips itself: when the seed does not give the dev user what a spec needs (a won customer, two organisations to merge, a department with specification blocks) it fails with a message that says what is missing and how to re-seed (`seedExpectation` in `helpers.ts`). Every spec is re-runnable against the same database: forks, merges and notes from earlier runs are tolerated, and `onboarding.spec.ts` takes the pre-filled-profile branch once the profile exists (which is the branch CI takes, since CI seeds without `SEED_OWNER_PROFILE=0`). The onboarding tests save the profile as "Playwright Founder"; the file puts the dev founder's profile back as it found it when it finishes (`restoreFounderProfile` in `helpers.ts`), since that name shows on every screen (the Inbox, the Hierarchy).
