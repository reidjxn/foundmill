# WP-03: The door

**Goal:** a stranger on a phone can get in, or is told honestly when and how; the landing page is true and can be found.

**Why:** `audits/a1-first-run.md` FR-01, FR-02, FR-03 (the wall's exits and the reroute only), FR-06, FR-13, FR-14; `audits/a9-people-network-mobile.md` A9-P0-1, A9-P0-2 (item 2), A9-P1-1, A9-P2-1; `audits/a2-console-design.md` A2-01 (items 1 and 3), A2-02; `audits/s2-activation-growth.md` §1.3, §3, §4.3, §4.4; `audits/s3-seo-ai-visibility.md` findings 1, 2, 3, 5, 9, 13, 16; `audits/s1-design-critique.md` §3.1 to §3.3; `audits/s6-market-last30days.md` §5 items 3, 4, 7; `audits/a11-roadmap-status.md` §4; `audits/e0-production-evidence.md` (19 accounts, 1 new in 14 days, 0 waitlist rows, `/` is `noindex`, `/robots.txt` 404).

**Done when (each is checked on production by the Desktop session after merge):**
1. At 390 px, signed in with an address that is not on the list, `/start` shows the place-saved page (never `needs-larger-window`), and one row exists in `waitlist_entries` for that account without a button press.
2. An entry admitted by the operator's SQL, or by the daily number, receives one email within 20 minutes, and `waitlist_entries.notified_at` is set. No screen promises that email before this is true.
3. Every signed-in desktop-only route at 390 px shows the note with at least two working controls ("Email me a link" and a way back); the kept card and `/home` no longer link a phone into a wall.
4. `/` at 390 px and 1440 px renders the same eleven sections with no horizontal scroll, contains none of the strings in T5's "removed claims" list, and `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs` pass.
5. `curl -sI https://foundmill.com/robots.txt` is 200 `text/plain`; `/sitemap.xml` is 200; `/` sends `index, follow` and a canonical; `/llms.txt` is 200; `/pricing-nope` is 404; `/login` and `/tour` stay `noindex`; `/` carries exactly one `application/ld+json` block.
6. A new address receives a sign-in email that carries a six-digit code (after WP-00 S10).
7. With `SIGNUP_OPEN=1` on a test stack, the sixth same-day address from one private domain and a second address that differs only by a plus-tag both wait instead of getting in.

**Scope in:** the gate's words and pages, the waitlist (store, admit, email, an operator way), the bare small-screen wall's controls and the email behind them, where the kept card and `/home` send a phone, the landing page (copy and structure, desktop and phone), `robots.ts`, `sitemap.ts`, per-route robots, 404s for unknown signed-out addresses, the home JSON-LD, `/llms.txt`, the sign-up email template, the idea box's deadline and refusal lines, the guards that must exist before sign-up opens, the store-links value and its first readers.

**Scope out (owner):** the profile form, Commit and publish at 390 px (WP-04; A9-P0-2 items 1, 3, 4 and FR-03 fixes 1 to 3). The note inside the project shell, the phone menu and first paint (WP-10; A2-01 items 2, 4, 6). Today's links into walls (WP-04; A2-01 item 5). Funnel events (WP-02). Per-account dollar ceiling before commit (WP-09; FR-11). Project and person pages in the sitemap, their JSON-LD, the listing rule and per-project text files (WP-08; s3 findings 4, 6, 7, 8, 12). The app prompt on public pages and the `.well-known` files (WP-12). Flipping `SIGNUP_OPEN` (WP-00 S5). Reporting of people and messages (WP-12).

**Depends on:** WP-00 S1 and S2 (platform mail proven and ingest hearing SendGrid) before T2 and T3 are switched on in production; WP-00 S10 for T4 and T8's bot check; WP-02 for the funnel event names (T1 and T2 call WP-02's writers if they are merged, and add none of their own). Nothing else.

**Collides with:**
- WP-02 edits false strings across the product and adds funnel writes in `apps/api/src/services/access.ts` and `services/idea-box.ts`. This package owns every string in `apps/web/components/landing/**`, `components/shell/NotInvitedPage.tsx`, `OnWaitlistPage.tsx`, `components/new/card/CardKeptView.tsx`, `CardKeepView.tsx`, `packages/shared/src/idea-box.ts` (`IDEA_BOX_ERRORS`), `packages/shared/src/allowlist.ts` (`ON_WAITLIST_WORDS`) and `NOT_INVITED_MESSAGE`. WP-02 skips those.
- WP-04 rebuilds `OnboardingScreen`, Commit and `CardKeptView`'s next step. T3's reroute in `CardKeptView` and `PersonHome` is a stopgap that WP-04 deletes; say so in the pull request.
- WP-10 owns `AppShell` and the in-shell note. T3 changes only `NeedsLargerWindow.tsx` and `DesktopOnly.tsx`.
- `claude/blissful-fermat-q03yq1` touches `packages/dugout/src/components/shell/{AppShell,KitBar,Panel,PhoneBar}.tsx` and `packages/dugout/src/components/public/*`. T3 and T9 touch neither set, except one new file `public/GetTheApp.tsx`; run `plan-change` before T9.
- `claude/zealous-rubin-8q52gr` (mobile): T8's bot check changes what Supabase asks of every sign-in, the app's included (see Decisions 6).
- The network session owns "the referral-ordered waitlist" (DECISIONS 2026-11-12, "Working beside the other sessions", item 3). T10 is built only after Decision 5.

**Setup it needs:** WP-00 S1, S2 (mail), S5 (the switch, after T8), S7 (indexing check, after T6), S10 (Supabase templates and bot check). One new variable for the Desktop session to set after T2: `WAITLIST_ADMIT_PER_DAY` on the orchestrator (not a secret; unset means 0).

**Recorded decisions this package follows (do not reopen):** "Sign-up: a waitlist ordered by referral now; open sign-up once per-account spend ceilings and reporting of people, profiles and messages exist" (2026-11-11, "The thesis, and the founder's first five answers", answer 4). "The waitlist stays plain and ordered by referral. No admission in weekly cohorts, no invite passes" (2026-11-12, "The founder's answers to docs/NETWORK.md §14", answer 7). "No public counts" (same entry, answer 4). "The waitlist line promises no email until the waitlist that sends it exists" (2026-11-13, "The security review of invitations and roles"). "One card per browser; about 5 per address a day; $20 a day" and the dark Generate button with a white outline (2026-11-13, "The landing page's idea box"; `docs/IDEA_BOX.md`). Who may let a new account in (same Nov 13 entry). Email about people rides the one sender (2026-11-12).

Migrations: take the next free number when the branch is cut (0108, journal idx 96, at `04a0a509`); renumber on rebase. T2 and T8 each add one.

---

## Tasks

Order: T1, T4, T7 and T9 can start at once. T2, then T3 (T3 reuses T2's gateway module). T5, then T6. T8 after T2. T10 last, after Decision 5.

### [x] T1: The gate tells the truth at any width [S] [ships alone]

**Why:** FR-01 (fixes 1 and 4), FR-02, A9-P1-1, s2 §1.3 rows 1 to 3, §4.4.

**Files (modify):** `apps/web/components/shell/NotInvitedPage.tsx`, `OnWaitlistPage.tsx`, `UnreachablePage.tsx`, `apps/web/components/providers/DesktopOnly.tsx`, `apps/api/src/services/access.ts` (`NOT_INVITED_MESSAGE` only), `apps/web/app/login/LoginForm.tsx` (one line), `apps/web/components/landing/idea-box/IdeaBox.tsx` (`IDEA_BOX_WORDS.keepLead`, `freeLine`), `packages/shared/src/idea-box.ts` (`IDEA_BOX_ERRORS.limit`, `.resting`). Tests: `apps/web/components/shell/__tests__/api-error-page.test.tsx`, `apps/web/components/providers/__tests__/desktop-only.test.tsx`, `apps/web/components/landing/idea-box/__tests__/` (the words test), `apps/api/src/__tests__/signup-allowlist.test.ts`, `apps/web/e2e/idea-box.spec.ts`.

**Interfaces (existing, from code):**
- `NotInvitedPage({ message, email, unconfirmed })` renders `<BrandFrame title="Invite only for now" …>` with no `smallScreen` and no `<WorksOnSmallScreens />`; `OnWaitlistPage` has both.
- `joinWaitlist(_previous: WaitlistJoinState): Promise<WaitlistJoinState>` (`components/shell/waitlist-actions.ts`, a Server Action that reads the `fm_idea` cookie) and `waitlist.join({ token? }) → { joined: true, cardKept }` (`apps/api/src/routers/idea-box.ts`, `confirmedProcedure`: signed in with a confirmed address, the list is not checked).
- `SMALL_SCREEN_PREFIXES`, `WorksOnSmallScreens` (`DesktopOnly.tsx`); `BrandFrame({ smallScreen })`.
- No new interface. One wording serves `invite_only` and `open`, so the static landing page needs no mode value (see Corrections 2).

**Copy (before → after).** Until T2 ships, no string promises an email.

| Where | Before | After (T1) |
| --- | --- | --- |
| `BrandFrame` title, `NotInvitedPage` | "Invite only for now" | "A few people at a time" |
| `EmptyState` title | "{email} is not on the list" | "{email} has a place in line" |
| `NOT_INVITED_MESSAGE` (`access.ts`) | "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it." | "Foundmill is letting new people in a few at a time so every project gets real agent work. Your place is not open yet." |
| `WAITLIST_WORDS.offer` | "Join the waitlist and we will let you in as soon as there is room. If you made a card on the home page, it is kept for you." | "We are saving your place." (shown while the join runs) |
| `WAITLIST_WORDS.joinedWithCard` | "You are on the waitlist, and your card is kept for 90 days." | "Your place is saved, and your card is kept for 90 days. Come back to check; we cannot email you yet." |
| `WAITLIST_WORDS.joined` | "You are on the waitlist. We will email you when there is room." | "Your place is saved. Come back to check; we cannot email you yet." |
| `WAITLIST_WORDS.join` (now the retry) | "Join the waitlist" | "Save my place" |
| Footer, `NotInvitedPage` | "Foundmill is open to invited founders while it is in preview." | "Foundmill lets new people in a few at a time." |
| `IDEA_BOX_WORDS.keepLead` | "Sign in and it is saved to your account. From there your team checks it against real sources, drafts the plan, and starts building when you say so." | "Sign in to keep this card. Foundmill lets new people in a few at a time. If your place is not open yet, we hold your card for 90 days." |
| `IDEA_BOX_WORDS.freeLine` | "Free to start · $5.00 of included credits · no card" | "Free to start. Your plan includes {INCLUDED} of agent work every month. You never enter a card." |
| `IDEA_BOX_ERRORS.limit` | "That is all the cards from this connection today. Sign in to keep going with your team." | "That is all the cards from this connection today. Come back tomorrow for another." |
| `IDEA_BOX_ERRORS.resting` | "The idea box is resting until tomorrow. Sign in and your team can shape it with you." | "The idea box is resting until tomorrow. Come back then and it will shape your idea." |
| `LoginForm`, under "No password, no card. We email you a link." | (nothing) | "New here? Foundmill lets new people in a few at a time. Signing in saves your place." |

**Steps:**
1. Write the failing tests: `api-error-page.test.tsx` "the not-listed page renders at 390 px" (asserts `WorksOnSmallScreens` took effect: no `needs-larger-window` with the viewport mocked at 390) and "joins once on arrival" (the mocked action is called exactly once; the `waitlist-joined` pill shows `WAITLIST_WORDS.joined`); `desktop-only.test.tsx` adds `/start`. verify: both fail on `main`.
2. `NotInvitedPage`: `<BrandFrame smallScreen …>`, render `<WorksOnSmallScreens />` first, give Sign out `className="min-h-tap"`. In `WaitlistJoin`, start the action once on mount (`useEffect` with `startTransition(() => action(new FormData()))`, guarded by a ref); keep the form and button as the retry shown only when `state.status === "error"`. The `unconfirmed` branch stays as it is (no join). verify: step 1's tests pass.
3. `OnWaitlistPage`: render the same `WaitlistJoin` (export it from `NotInvitedPage.tsx`) under the card so a person refused by the day's ceiling is stored too. `ON_WAITLIST_WORDS` is not changed here (T2 changes it). verify: a new test "the ceiling page stores the person" passes.
4. `UnreachablePage`: `smallScreen` and `<WorksOnSmallScreens />`. Add `"/start"` to `SMALL_SCREEN_PREFIXES`. verify: `desktop-only.test.tsx`.
5. Apply the copy table. verify: `rg -n "not on the invite list|Sign in to keep going|We will email you when there is room|real sources" apps/web/components/shell apps/web/components/landing packages/shared/src/idea-box.ts apps/api/src/services/access.ts` prints nothing; `node scripts/banned-terms.mjs && node scripts/us-english.mjs && node scripts/plain-language.mjs` pass.
6. Playwright: in `idea-box.spec.ts`, a 390 px case on the invite-only stack. `apps/web/e2e/README.md` shows the pattern (`invitations.spec.ts` runs against an api started with its own flags and skips otherwise): start the api with `SIGNUP_ALLOWLIST=someone-else@example.com`, sign in through `/auth/dev?as=`, assert `[data-testid="not-invited"]` is visible, `needs-larger-window` is absent, and every control is at least 44 px tall. verify: the spec passes on that stack and is skipped on the shared one.

**Tests and evals:** as above; no agent behavior changes, so no eval.
**Done when:** Done-when 1, with "Come back to check" on the page.

### [x] T2: A waitlist that admits and emails [M] [ships alone; switched on after WP-00 S1 and S2]

**Why:** FR-01 (fix 2), A9-P0-1 (steps 1 and 2, without the referral columns: T10), s2 §4.3 option B and §4.4.

**Files (create):** `packages/db/migrations/<next>_waitlist_notified.sql`, `apps/gateway/src/notify-account-email.ts`, `apps/gateway/src/__tests__/notify-account-email.test.ts`, `apps/orchestrator/src/activities/waitlist.ts`, `apps/orchestrator/src/__tests__/waitlist-sweep.test.ts`, `packages/db/src/__tests__/waitlist-admission.test.ts`.
**Files (modify):** `packages/db/src/schema/idea-box.ts`, `packages/db/src/repos/idea-drafts.ts` (`waitlistRepo`), `packages/shared/src/constants.ts`, `packages/shared/src/notify-email.ts`, `packages/shared/src/env.ts`, `.env.example`, `apps/gateway/src/app.ts`, `apps/orchestrator/src/gateway-client.ts`, `apps/orchestrator/src/schedules.ts`, `apps/orchestrator/src/workflows/schedules.ts`, `apps/orchestrator/src/activities/index.ts`, `packages/shared/src/allowlist.ts`, `apps/web/components/shell/NotInvitedPage.tsx`, `apps/web/components/landing/idea-box/IdeaBox.tsx`, `docs/DEPLOY.md` §4, `docs/ARCHITECTURE.md` §10 (the schedule list).

**Interfaces consumed (from code):**
- `waitlist_entries (id, user_id unique null, email unique, idea_draft_id, admitted_at, created_at, updated_at)`: RLS on, no policy for `authenticated` (service only). `admitted_at` is written by nothing today.
- `repos.admissions.record(db, { userId, how: "invitation" | "open" | "existing", invitationId? }) → AccountAdmission | null`, `repos.admissions.lockOpenCount(tx)`, `repos.admissions.openSince(db, since): Promise<number>` (counts `open` and `invitation`), `utcDayStart(at)` (`apps/api/src/services/access.ts`; copy the one line into the activity rather than importing across apps).
- `decideAdmission` step 3 admits any account with an `account_admissions` row on its next request; a refused person is asked again on every request (only admitted accounts are remembered), so nothing needs clearing.
- `POST /v1/notify/email` (`NOTIFY_EMAIL_ROUTE`); `apps/gateway/src/app.ts` dispatches on `kind` (`isAddressEmailKind`, `isAccountSafetyKind`, else `NotifyEmailRequest`, which requires `businessId`). `NotifyEmailResponse = { sent: true; simulated: boolean; eventId: string | null } | { sent: false; reason: NotifyEmailNotSent; message: string }`.
- From `notify-address-email.ts`, reuse as they are: the "switched on and configured" block, `notifyAddressDayKey(secret, email)`, `PLATFORM_NOTIFY_CEILING_KEY`, `suppressionHashOfEmail`, `invitationsOffToken`, `invitationsOffUrl` (the platform-wide "stop email to this address" link; `unsubscribeUrl` is required on every `platform_notify` message), `repos.channels.isSuppressed(db, businessId, { emailHash })` (pass the nil UUID: only platform-scope rows can match), `repos.founders.emailOf(db, userId)`, `connector.callTool("send_notification", { from, to, subject, text, html, unsubscribeUrl }, ctx)`, `mockResultsAllowed`.
- `SCHEDULES: readonly ScheduleDefinition[]` and `every("15m")` (`apps/orchestrator/src/schedules.ts`); `GatewayClient.notifyEmail` (`gateway-client.ts`).

**Interfaces produced:**
- Column: `waitlist_entries.notified_at timestamptz null`. RLS unchanged (service only); extend the existing closed-table RLS test to select the new column as `authenticated` and get nothing.
- `packages/shared/src/constants.ts`: `export const ACCOUNT_EMAIL_KINDS = ["waitlist_admitted", "continue_link"] as const; export type AccountEmailKind = (typeof ACCOUNT_EMAIL_KINDS)[number];` with a comment in the style of `ADDRESS_EMAIL_KINDS`: email to an account about the account itself, with no project; each answers something the person did, so no preference and not the person's three a day. (`continue_link` is used by T3; declaring both here keeps one module.)
- `packages/shared/src/notify-email.ts`: `waitlistAdmittedEmail(f: { appName: string; cardName: string | null; link: string; offLink: string }): NotifyEmailText`.
- Gateway: `AccountEmailRequest = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("waitlist_admitted"), userId: z.guid(), data: z.strictObject({ waitlistEntryId: z.guid() }) }), …T3's member])`, `isAccountEmailKind(kind)`, `sendAccountEmail(deps: GatewayDeps, input: AccountEmailRequest, service: string): Promise<NotifyEmailResponse>`. Order of checks: configured; the entry exists, belongs to `userId`, has `admitted_at` set and `notified_at` null (else `not_pending`); the address from `auth.users` (never from the request); platform suppression; once per entry (`pn:acct-item:waitlist_admitted:<entryId>`, `NOTIFY_ITEM_MARKER_MS`); three a day per address (`notifyAddressDayKey`); `PLATFORM_NOTIFY_CEILING_KEY`. Mock mode answers `simulated: true` and the log line says simulated; a simulated send never sets `notified_at` outside development and test (`mockResultsAllowed`). The address never reaches a log line.
- `waitlistRepo.admitNext(tx, { limit, now }): Promise<WaitlistEntryRow[]>` (oldest `created_at` first, `user_id is not null and admitted_at is null`, `for update skip locked`; for each: `repos.admissions.record(tx, { userId, how: "open" })`, set `admitted_at`), `waitlistRepo.admittedSince(db, since): Promise<number>`, `waitlistRepo.toNotify(db, { since, limit }): Promise<{ id; userId; cardName: string | null }[]>` (`admitted_at >= since and notified_at is null`; `cardName` from the held draft's `card->>'name'`), `waitlistRepo.markNotified(db, id, now)`. The ordering lives in one exported SQL fragment `WAITLIST_ORDER` so T10 changes one place.
- Orchestrator: env `WAITLIST_ADMIT_PER_DAY: z.coerce.number().int().min(0).max(1000).default(0)`; activity `waitlistSweep({ at? }): Promise<ScheduleResult>`; workflow `waitlistAdmissions`; schedule `{ id: "waitlist-admissions", workflowType: "waitlistAdmissions", spec: every("15m"), args: [{}], description: "Every 15 minutes: admit today's waitlist number, then email everyone admitted" }`; `GatewayClient.accountEmail(input)` beside `notifyEmail`, and in the offline client.
- No event is declared here. If WP-02's admission event exists when this branch is cut, write it inside `admitNext`'s transaction; otherwise `admitted_at` and `notified_at` are the record and WP-02 reads them.

**The sweep, exactly.** (a) In one transaction: `lockOpenCount`; `room = WAITLIST_ADMIT_PER_DAY - admittedSince(utcDayStart(now))`; when `SIGNUP_OPEN` is on for the orchestrator's env, also `room = min(room, SIGNUP_DAILY_CEILING - openSince(utcDayStart(now)))`; if `room > 0`, `admitNext({ limit: room })`. (b) Outside it: `toNotify({ since: now - 7 days, limit: 50 })`; for each, `gateway.accountEmail({ kind: "waitlist_admitted", userId, data: { waitlistEntryId } })`; on `sent: true`, or a `reason` outside `RETRY_REASONS` (`activities/notify.ts`), `markNotified`. An entry the operator admitted by hand is emailed by (b) with the number at 0.

**Admitting by hand (write into `docs/DEPLOY.md` §4 as "Admit people from the waitlist", for the Desktop session, on the founder's list of addresses):**
```sql
select email, created_at, idea_draft_id is not null as has_card from waitlist_entries where admitted_at is null order by created_at;
-- Superseded by the security review of T2 (Nov 16): the admission is 'waitlist'; docs/DEPLOY.md §4 has the SQL.
```
The api admits them on their next request and the sweep emails them within 15 minutes. This replaces "edit `SIGNUP_ALLOWLIST` on three services".

**Email copy** (US English, one purpose): Subject "Your place on Foundmill is open". Body: "Your place opened today. Sign in with this address to pick up where you left off." then, when `cardName` is set, "Your card for {cardName} is saved in your account." then "Your place does not expire." Button "Open Foundmill" to `{APP_URL}/start`. Footer link "Stop email from Foundmill to this address".

**Copy that changes in this pull request (the promise ships with the sender):**

| Where | T1 | T2 |
| --- | --- | --- |
| `WAITLIST_WORDS.joinedWithCard` | "… Come back to check; we cannot email you yet." | "Your place is saved, and your card is kept for 90 days. We email {email} the day your place opens." |
| `WAITLIST_WORDS.joined` | "Your place is saved. Come back to check; we cannot email you yet." | "Your place is saved. We email {email} the day it opens." |
| `ON_WAITLIST_WORDS` (`allowlist.ts`; its comment asks for this switch) | title "You're on the list.", body "We'll let you in as soon as there is room. Come back tomorrow to check." | title "Today's places are taken.", body "Yours opens tomorrow, and we email you when it does." Delete `ON_WAITLIST_EMAIL_PROMISE`. |
| `IDEA_BOX_WORDS.keepLead` | "… we hold your card for 90 days." | "Sign in to keep this card. Foundmill lets new people in a few at a time. If your place is not open yet, we hold your card and email you the day it is." |

**Steps:**
1. Migration and schema column; RLS test. verify: `pnpm --filter @foundmill/db test:rls` passes; the test fails if a policy is added.
2. `waitlist-admission.test.ts` first: order by `created_at`; `admitNext` skips entries without `user_id`; a second call admits nobody twice; an account that already has an admission gets `admitted_at` and no second row; then the repo. verify: the test passes on PGlite (note in the test that the row lock needs a real-Postgres run, as the invitation race tests do).
3. `notify-account-email.test.ts` first (not configured → `off`; wrong `userId` → `not_pending`; suppressed; sent once, second call `already_sent`; the fourth email to one address in a day refused; mock mode returns `simulated: true`); then the module and the `app.ts` branch. verify: the gateway suite passes; `rg -n "email" apps/gateway/src/notify-account-email.ts` shows no address in a `log.` call.
4. `waitlistAdmittedEmail` with a unit test on the words (no link in the card name: pass it through `withoutLinks` and `oneLine` as `invitationEmail` does). verify: test.
5. Activity, workflow, schedule, env; `schedules.test.ts` gains the new id; `waitlist-sweep.test.ts` (number 0 admits nobody and still emails a hand-admitted entry; number 2 admits two; under `SIGNUP_OPEN` the ceiling bounds it; a retryable refusal leaves `notified_at` null). verify: the orchestrator suite passes.
6. The copy table. verify: `rg -n "cannot email you yet|ON_WAITLIST_EMAIL_PROMISE" apps packages` prints nothing.
7. `docs/DEPLOY.md` §4 and the state table row "Waitlist". verify: `node scripts/env-example.test.mjs` passes with `WAITLIST_ADMIT_PER_DAY` listed.

**Tests and evals:** the four test files above; `apps/web/components/shell/__tests__/api-error-page.test.tsx` updated words. No eval.
**Done when:** Done-when 2, proven once by the Desktop session with the founder's own second address.
**Needs setup:** WP-00 S1 and S2 recorded done before the Desktop session sets `WAITLIST_ADMIT_PER_DAY` above 0 or admits anyone by hand with the email expected. Until then the gateway answers `off` or `simulated`, entries stay un-notified, and the sweep retries.

### T3: The wall has exits [M] [ships alone, after T2]

**Why:** FR-03 (fixes 4 and 5), A9-P0-2 (item 2), A2-01 (items 1 and 3), s2 §4.4 row "A desktop-only screen on a phone".

**Files (modify):** `packages/dugout/src/components/shell/NeedsLargerWindow.tsx` (+ its story and test), `apps/web/components/providers/DesktopOnly.tsx`, `apps/web/components/new/card/CardKeptView.tsx`, `apps/web/components/person-home/PersonHome.tsx`, `apps/api/src/routers/founder.ts` (`email` router), `apps/api/src/services/gateway.ts`, `apps/gateway/src/notify-account-email.ts`, `packages/shared/src/notify-email.ts`, `apps/web/e2e/phone-today.spec.ts`, `docs/DESIGN.md` §2 and §6 "Small screens" (one sentence each: the bare wall now carries controls).
**Files (create):** `packages/shared/src/continue-path.ts` (+ test), `apps/web/components/providers/ContinueLater.tsx`.

**Interfaces consumed:** `NeedsLargerWindow({ width?, minWidth?, className, …rest })` (server-safe, title "This needs a larger window", shows "Current width"); `DesktopOnly` returns `<NeedsLargerWindow width={width} />`; `founder.email` router has `get`, `update`, `recent` (all `protectedProcedure`); `GatewayAddressEmailRequest` and `addressEmail?` in `apps/api/src/services/gateway.ts` show the pattern for an optional gateway method; `CardKeptView` sends a person without a profile to `/onboarding` and with one to `/new/commit/<id>`; `PersonHome` links to `/new` (line 143) and `commitHref(idea.id)` (line 229); `isViewportTooSmall(useViewportWidth())`.

**Interfaces produced:**
- `NeedsLargerWindowProps` gains `title?: string`, `body?: ReactNode`, `actions?: ReactNode`, `showWidth?: boolean` (default false). Defaults: title "This part is built for a bigger screen", body "It has tables and boards that do not fit a phone yet. Open it on a computer, or go back to what works here." The pixel line shows only with `showWidth`. The component stays server-safe: `actions` is a slot.
- `packages/shared`: `CONTINUE_PATH_RE = /^\/(b\/[0-9a-f-]{36}(\/[a-z0-9-]+){0,4}|new(\/[a-z0-9-]+){0,3}|onboarding|home)$/i` and `isContinuePath(path: string): boolean` (no query, no hash, at most 200 characters).
- tRPC: `founder.email.sendLink: protectedProcedure.input(z.strictObject({ path: z.string().max(200).refine(isContinuePath) })).mutation → { sent: boolean; reason: NotifyEmailNotSent | null }`. It calls `gateway.accountEmail?.({ kind: "continue_link", userId: ctx.userId, data: { path } })`; an absent method answers `{ sent: false, reason: "off" }`.
- Gateway: the second member of `AccountEmailRequest`: `{ kind: "continue_link", userId, data: { path } }`; checks `isContinuePath` again, builds `${appUrl}${path}`, three a day per person (`pn:acct-link:<userId>:day`) plus the per-address and ceiling counts of T2. `continueLinkEmail(f: { appName; link; offLink }): NotifyEmailText`: Subject "Your link to continue on a computer"; body "You asked for this link from your phone. Open it on a computer to continue. It opens after you sign in with this address."
- Web: `ContinueLater({ pathname, signedIn })` (client): the primary button "Email me a link" (calls `founder.email.sendLink`; then reads "Sent. Check {email}." or, when not sent, "We could not send it. Copy the link instead." with a Copy link button that uses `navigator.clipboard`), and one way back: `/b/<uuid>/…` paths get "Back to Today" (`/b/<uuid>/today`); every other path gets "Go to your home" (`/home`). All controls `min-h-tap`. `DesktopOnly` passes `<ContinueLater …/>` as `actions`.

**The reroute (a stopgap WP-04 removes).** In `CardKeptView` and on `PersonHome`'s two links, when `isViewportTooSmall(width)` the button does not link into a walled route. It renders the line "The next step needs a computer for now." and the same "Email me a link" control with the path it would have opened (`/onboarding`, `/new/commit/<id>`, `/new`). Copy change in `CARD_KEPT_WORDS.lede`: "It is saved in your deck. Your team starts from your words and checks every number against real sources." → "It is saved in your deck. Your team starts from your words."

**Steps:**
1. `continue-path.test.ts` first (accepts `/b/<uuid>/product/page`, `/new/commit/<uuid>`, `/onboarding`; refuses `//evil.example`, `/b/x?next=`, `/login`, `/auth/callback`, 201 characters). verify: fails, then passes.
2. `NeedsLargerWindow`: props, defaults, story `Shell/NeedsLargerWindow` at 390 px with and without actions, test that the width line is gone by default. verify: `pnpm --filter @foundmill/dugout test -- NeedsLargerWindow`.
3. Gateway member and email words, tests added to `notify-account-email.test.ts` (a path that fails the pattern is refused before any count; the fourth link in a day is `per_person`). verify: suite passes.
4. `founder.email.sendLink` with an api test (signed out → UNAUTHORIZED; a bad path → BAD_REQUEST; the gateway double records one call with the caller's own `userId`, never one from input). verify: `pnpm --filter @foundmill/api test -- founder`.
5. `ContinueLater`, `DesktopOnly`, the reroute. verify: `desktop-only.test.tsx` "a walled route at 390 px shows two controls"; component tests for `CardKeptView` and `PersonHome` at 390 px find no `href="/onboarding"`, `href="/new"` or `/new/commit/`.
6. `phone-today.spec.ts`: replace "another project route at 390 px still asks for a larger window" with "… shows the note with Email me a link and Back to Today, and Back to Today works". verify: the spec passes.

**Tests and evals:** as listed. No eval.
**Done when:** Done-when 3.
**Needs setup:** WP-00 S1 and S2 for the email to arrive; before that the control falls back to Copy link, which is why the fallback is built.

### [x] T4: The sign-in email carries a code for a new address [S] [ships alone]

**Why:** FR-13, s1 §3.3.

**Files:** create `supabase/templates/confirm_signup.html` (same body as `magic_link.html`, first line "Welcome to Foundmill"); modify `supabase/config.toml` (add `[auth.email.template.confirmation]` with `subject = "Your Foundmill sign-in code"` and `content_path`), `scripts/supabase-config.test.mjs`, `apps/web/app/login/LoginForm.tsx`, `apps/web/e2e/login.spec.ts`.

**Interfaces consumed:** `supabase/config.toml` declares only `[auth.email.template.magic_link]`; `magic_link.html` carries `{{ .ConfirmationURL }}` and `{{ .Token }}`; the sent state in `LoginForm.tsx` reads "Check {email} for a sign-in link and open it in this browser: it signs you in to Foundmill here. Reading it on another device? Type the code from the email below."; `SignInCode({ email, next })`.

**Steps:**
1. In `supabase-config.test.mjs`, a failing test: both template sections exist, both files exist, and both contain `{{ .Token }}` and `{{ .ConfirmationURL }}`. verify: `node --test scripts/supabase-config.test.mjs` fails, then passes after the files are added.
2. `LoginForm` sent state, at small widths (`isViewportTooSmall`): put `SignInCode` first under the line "Type the 6-digit code we sent to {email}." and the link second: "Or open the link in that email on this device." Desktop keeps today's order. Before → after for the pill: "Link sent" → "Check your email". verify: `login.spec.ts` at 390 px finds the code field above the link sentence.
3. Record in `docs/DEPLOY.md` §4 that the founder pushes the file (WP-00 S10) and signs up once with a fresh address. verify: the row exists with state "waiting for S10".

**Done when:** Done-when 6 (after S10).

### T5: The landing page, rewritten for a first-timer, desktop and phone [L] [ships alone]

**Why:** FR-06, s2 §1.3 (all fifteen rows), §3; s1 §3.1, §3.2; a11 §4 (the promises table); s3 finding 9; s6 §5 items 3, 4, 7.

**Diagnosis (copywriting skill):** situation B. The live page has a real voice written for an experienced founder. Kept: the house rules, the idea box's assurances, "Never started a company?" as a stance, the dark Generate button (founder, Nov 13). Changed: the reader, the order, and every claim a new free user cannot check today.

**The hero chosen: outcome, in s2's option A, reworded so it is true for a stranger while the door is invite-only.** s2's "Leave with a page" promises a page in this sitting; that is true only for an admitted person on a laptop until WP-04. "Finish with" names the same outcome without the sitting. Options B and C were set aside: B ("Make something that is yours.") passes none of the three questions on its own, and C promises "today" on a phone.

**Files (modify):** `apps/web/components/landing/LandingPage.tsx`, `Hero.tsx`, `idea-box/IdeaBox.tsx`, `idea-box/typing.ts`, `parts.tsx`, `Thesis.tsx`, `Control.tsx`, `LiveSessions.tsx`, `HowItWorks.tsx` (strings only, for the tour), `apps/web/app/examples/[id]/page.tsx`, `apps/web/lib/auth/redirects.ts` (`PUBLIC_PREFIXES` gains `"/tour"`), `apps/web/components/landing/__tests__/LandingPage.test.tsx`, `apps/web/e2e/landing.spec.ts`, `docs/DESIGN.md` §9a (replace the section with the section list below; keep its "Glass and windows", "Dates and hydration" and "Example labels" bullets for the tour).
**Files (create):** `apps/web/components/landing/words.ts` (every string below, one export `LANDING_WORDS`), `apps/web/components/landing/FirstWeek.tsx`, `Questions.tsx`, `TourPage.tsx`, `apps/web/app/tour/page.tsx`, stories for `FirstWeek` and `Questions` at 390 px.

**Interfaces consumed:** `LandingPage({ terminalRenderer?, initialExample?, renderDay? })` branches on `isViewportTooSmall(width)` into `PhoneLanding` (the hero, a note about 1280 px, legal links); `Hero({ layout })` prints `APP_TAGLINE` as the `h1` with "real business" lit and the pill "For founders · First company or fifth, the team comes with it"; `LandingPage.test.tsx` line 62 pins `h1 === APP_TAGLINE` and line 63 the "Start your business" links; `landing.spec.ts` line 96 clicks "Start your business"; `IDEA_BOX_WORDS`; `PLACEHOLDER_IDEAS` (`typing.ts`); `IdeaCard` (`@foundmill/dugout`); `INCLUDED` (`formatMoney(includedCreditsMinor("free"))`, never a typed figure); `goToSection(id)`; `SIGN_IN = "/login"`; `LEGAL_ROUTES`.

**Structure.** One responsive page for every width: no `PhoneLanding` branch, so the server's HTML is the page a phone keeps (this also ends the desktop flash, s1 §3.2). One column, 16 px gutters under 640 px, a centered 640 px column to 1279 px, the 92 rem column above. The page stops wearing an example business's brand colors. Today's sections (ticker, Why now, four-step How it works, Your team, Live sessions, The journey, Channels, You decide, the example deck and picker) move unchanged in layout to `TourPage` at `/tour`: desktop only, `noindex`, linked from the footer on wide screens only. `/examples/[id]` renders `TourPage`.

| # | Section (`id`) | Heading | Notes |
| --- | --- | --- | --- |
| 1 | top bar | | Wordmark; "Sign in" (ghost, to `/login`); from 640 px also "Shape my idea" (focuses the field). |
| 2 | `hero` | h1 | Pill, h1, subhead, visible label, field, button, "No idea yet?", all three assurances at every width, the door line. |
| 3 | `today` | What you have to show for it | Three tiles; the first holds one example `IdeaCard` labeled Example, replaced by the visitor's card when it lands. |
| 4 | `first-week` | A first week, from $0 | `FirstWeek`: one example open, two behind "See another". Each carries the Example chip. `data-nosnippet` on the section. |
| 5 | `how` | How it works | Three steps. |
| 6 | `control` | You are in charge | The house rules. |
| 7 | `cost` | What it costs | |
| 8 | `people` | On your own, or with someone | |
| 9 | `questions` | Questions | `Questions`: native `<details>` so it works without script. |
| 10 | `start` | Start with one sentence. | A button that scrolls to and focuses the field (one idea box per page: one bot-check widget). Under 640 px a sticky "Shape my idea" appears once the hero has scrolled away. |
| 11 | footer | | Tagline (`APP_TAGLINE`), Terms, Privacy; from 1280 px "How the team works" to `/tour`. The line "Desktop only · 1280 px and wider" is deleted. |

**The copy (`LANDING_WORDS`; `{INCLUDED}` is the config figure, "$5.00" today).**

> Pill: **Free to start · No experience needed**
>
> # Start with one sentence. Finish with a page for your idea.
>
> Type what you want to make. A team of AI agents shapes it and rates it honestly while you watch, then drafts its first page for you to check and publish. It is free to start, and nothing goes out without your yes.
>
> Label: **What do you want to make?** · Placeholder on focus: "One sentence is enough. Rough is fine." · Button: **Shape my idea** · "No idea yet? **Surprise me**"
>
> Assurances: "Your first card is free and needs no sign-up" · "Your idea stays private until you choose to share it" · "Nothing moves money or signs in your name without you"
>
> Door line, under the assurances: "Foundmill lets new people in a few at a time. Your card is free now, and signing in holds your place."

> **What Foundmill is.** Foundmill is a web app where one person works with a team of AI agents to start a project of their own. The team shapes the idea, rates it honestly, drafts a public page for it and plans the next steps. It asks you before anything that spends money or acts in your name. It is for people 18 or older.

> ## What you have to show for it
>
> **A card for your idea.** Its name, a one-line pitch and ten honest ratings, each with the reason behind it. A weak rating comes with one line on what would raise it. You get this before you sign up.
>
> **A page at its own link.** Once you are in, your team drafts it from your words. You change what you like and publish it at foundmill.com/p/your-project. Hosting is free.
>
> **One decision at a time.** Your Chief of Staff, the agent that runs your team, brings you what needs your answer, with a recommendation. The team does the work in between.

> ## A first week, from $0
>
> *Example project* · **Sole Revival** · Sneaker cleaning for people at one college
> - Day 1. Idea shaped and rated: 3 stars now, 4 if a first few people sign up. Page drafted, checked and published.
> - Day 2. The founder sends the link to two group chats. Four people leave an email address on the page to follow it.
> - Day 3. The team drafts a short post with a before-and-after photo idea. The founder posts it with one tap.
> - Day 5. The project's story shows two milestones: page live, first follower.
> - Day 7. One decision waiting: clean the first pair free, or charge $5. Money spent: $0.
>
> *Example project* · **Cheap Eats Houston** · A weekly list of meals under $10
> - Day 1. Card rated. Weakest rating: standing out. Page published with a Follow form.
> - Day 3. The founder posts the link in two neighborhood groups. More people follow.
> - Day 6. The team drafts the first list. The founder reads it and decides what goes on the page.
> - Day 7. Money spent: $0.
>
> *Example project* · **Code Club Evenings** · Online coding lessons for kids, two evenings a week
> - Day 1. Card rated. Weakest rating: reaching parents. Page published.
> - Day 2. The team drafts a post for parent groups. The founder posts it.
> - Day 4. First followers. The team suggests a free trial lesson and drafts the invitation.
> - Day 7. Money spent: $0.

> ## How it works
>
> **1. Say it.** One sentence about what you want to make. No idea yet? Tap Surprise me, pick something you like and react to what comes back.
>
> **2. Check it and publish.** Your team drafts the page. You read it, change the words and publish. Nothing is public before that.
>
> **3. Decide, a little each day.** Your Chief of Staff brings you one decision at a time, with a recommendation. The team does the work in between.

> ## You are in charge
>
> Your agents work inside house rules they cannot change. They never move money, sign anything, accept terms, file anything under your name, delete anything for good or change security settings. Unless you choose otherwise, anything that reaches another person waits for your yes. One button stops every agent at once.

> ## What it costs
>
> Starting is free, and the free plan does not expire. You never enter a card.
>
> Your project gets {INCLUDED} of agent work every month. If it runs out before the month ends, your team pauses until the next month starts. Your page stays live and nothing you made is lost.
>
> Free on every plan: your page at a Foundmill address, and as many cofounders and collaborators as you like.

> ## On your own, or with someone
>
> You can do all of this by yourself. Your team covers the work. If you would like someone to build it with, invite them to your project. Adding people is free.

> ## Questions
>
> **When can I get in?** We let new people in a few at a time so every project gets real agent work. Sign in to hold your place, and we email you the day it opens. Your card is kept for 90 days.
>
> **Does it cost anything?** Starting is free and you never enter a card. Your free plan includes {INCLUDED} of agent work every month. If that runs out, your team pauses until the next month starts and your page stays live.
>
> **I do not have an idea yet.** Tap Surprise me and pick something you like. You get one honest idea to react to.
>
> **I have never done this. Will I know what to do?** Yes. Your Chief of Staff plans the work, explains a new term the first time it appears and tells you which decision is yours.
>
> **Can the agents do something in my name without asking?** No. They cannot move money, sign, accept terms, file under your identity, delete for good or change security settings.
>
> **Is my idea private?** Yes, until you publish your page. You choose what the page says and you can take it down whenever you like.
>
> **Do I need a company, a bank account or a website?** No. Foundmill hosts your page at a Foundmill address for free. You can connect your own accounts later.
>
> **Does it work on a phone?** You can shape and keep your card on a phone, and answer what needs you. Publishing your page needs a computer for now, and we can email you the link.
>
> **Can I do this on my own?** Yes, all of it.
>
> **What can it not do yet?** Take a payment, send email to a list for you, or check facts on the live web. Building an app needs your own GitHub account. Your team says so when a step needs one of these.
>
> **Who can use Foundmill?** Anyone 18 or older.

> ## Start with one sentence.
>
> Your first card is free and needs no sign-up. Button: **Shape my idea**

**After the card lands** (`IDEA_BOX_WORDS`): headline "{name} is yours to keep." (kept); group heading "Keep my card"; `keepLead` as T2 leaves it; buttons unchanged; `freeLine` as T1; the three lines "A researched version of this card, with sources" / "More directions to compare side by side" / "A team of agents to build it" → "A page for {name} at its own link" / "One decision at a time, each with a recommendation" / "A team of agents for the work you have not learned yet"; "Not now? This card waits on this device for 7 days." (kept).

**Placeholder ideas** (`PLACEHOLDER_IDEAS`, all eight replaced; each can be started with $0 and no code): "Sneaker cleaning for people at my school" · "A weekly email about cheap eats in Houston" · "Coding lessons for kids, online, two evenings a week" · "Candles that smell like places I have lived" · "Vintage band tees, found and resold" · "Meal prep for people who work nights" · "Dog walking in my neighborhood, booked by text" · "Study notes for my nursing class".

**Metadata (T6 wires it):** title "Foundmill | Start your first project with one sentence"; description "Say your idea in a sentence. A team of AI agents shapes it, rates it honestly and drafts a page you can publish. Free to start, no card."

**Removed claims (a test fails if any returns to `/` or `/tour`):**

| String today | File | Why | On `/tour` it becomes |
| --- | --- | --- | --- |
| "Agents open real pull requests on your GitHub, send email from your own accounts and reconcile your Stripe and bank data." | `Thesis.tsx` pillar 2 | a11 §4: Stripe, bank and own-account mail are not live | "With your GitHub connected, agents open real pull requests there. Every project gets a public page at a Foundmill address." |
| "Better every cycle. Agents are trained against real tests between cycles…" | `Thesis.tsx` pillar 3 | s2 §1.3 row 7: `skill_tests` has 0 rows | pillar removed (three pillars) |
| "Six departments work at once every cycle" | `Thesis.tsx` pillar 1 | free plan runs 4 agents at once | "Departments work side by side each round." |
| "Fifteen channels. The right few first." | `LiveSessions.tsx` | a11 §4: three channels can act | "Channels on one board. The few that can act for you come first." |
| "You do not need to know how to incorporate, price, run ads or keep books." | `Control.tsx` | a11 §4: none of the four is done for a founder | "Never started anything? You do not need to know the steps. Your team plans them and tells you which decision is yours." |
| "Nothing is spent until you approve it." | `HowItWorks.tsx` | s2 §1.3 row 11: the allowance is spent as agents work | "Your project's money is never spent without your approval. Agent work uses your monthly allowance." |
| "checks it against real sources", "checks every number against real sources" | `IdeaBox.tsx`, `CardKeptView.tsx` | AR-01: research is simulated | removed in T1 and T3 |
| "For founders · First company or fifth, the team comes with it", "Start your business", "Or watch an example run", the 1280 px note | `Hero.tsx`, `LandingPage.tsx` | s2 §1.3 rows 2, 4, 13 | `/tour` keeps the deck without the label |

**What each later package switches (strings stay in `words.ts`):**

| When recorded done in `docs/DEPLOY.md` | Change |
| --- | --- |
| WP-04's publish at 390 px | The phone answer → "Yes. Your idea, your page and your daily decisions all work on a phone. The full workspace, with every department's detail, is built for a computer." |
| WP-08's first email to followers | Add to the company question: "It also gives your project an address to send email from." Remove "send email to a list for you" from the limits answer. Add to Sole Revival: "Day 5. First email to the followers, sent from the project's own Foundmill address." |
| WP-07's pay button; WP-00 S6 (web research) | Remove "Take a payment" and "check facts on the live web" from the limits answer. |
| WP-09's cost report | In "What it costs", after the allowance sentence: "That covers shaping your idea, drafting your page and about N rounds of work a month (Estimate)." with the measured N. |
| WP-00 S5 with no waiting list for a week | Delete the "When can I get in?" question and the door line. |
| First real project pages, with consent (`showcase_consents`) | Replace the examples one by one; add "See a real page". |

**Steps:**
1. Rewrite `LandingPage.test.tsx` first: the `h1` is `LANDING_WORDS.hero.title`; no link named "Start your business"; the eleven section ids exist in order; at a mocked 390 px the same sections render and `landing-phone-note` is gone; `removed-claims.test.ts` (new, in `__tests__`) renders `LandingPage` and `TourPage` and fails on any left-column string above; every example block carries the Example chip and `data-nosnippet`. verify: the tests fail on `main`.
2. `words.ts`, then the sections, reusing `Container`, `Section`, `SectionHeading`, `Glass` from `parts.tsx` and design-system components only. The visible label replaces the `sr-only` one. verify: step 1's tests pass; Storybook renders `FirstWeek` and `Questions` at 390 px.
3. `TourPage`, `/tour`, `/examples/[id]`, the string fixes in the table. `app/tour/page.tsx` exports `robots: { index: false, follow: true }`. verify: the existing landing component tests (`cycle-deck-motion`, `picker`, `live-sessions`, `story-day`, `journey-story`) pass when pointed at `TourPage`.
4. Copy checks from the copywriting skill, on `words.ts`: no dash in a headline or subhead; no "not X, it's Y"; no list of negations; each claim maps to a row of the capability table in step 5. verify: `node scripts/banned-terms.mjs && node scripts/us-english.mjs && node scripts/plain-language.mjs`; `rg -n "—|–" apps/web/components/landing/words.ts` prints nothing.
5. In the pull request, a table: each sentence of the First week and Questions sections, and the code that makes it true (`IdeaCard` stars; `page.publish`; `publicPage.follow` with its confirmation; `tap-to-post.spec.ts`; the story's milestones; `PAGE_READY_NOTE`; invitations in Settings › People). A sentence with no row is cut. verify: reviewer reads it.
6. `landing.spec.ts`: at 390 × 844 and 1440 × 900 no horizontal scroll, the field and button are above the fold with the keyboard closed, the sticky button returns focus to the field, "Shape my idea" in the top bar focuses the field, `/tour` renders at 1440 and shows the note with controls at 390. verify: the spec passes.
7. `docs/DESIGN.md` §9a rewritten to the section table; one sentence that the page is written for one reader, the first-timer, and the second reader has `/tour`. verify: `node scripts/banned-terms.mjs` (it scans DESIGN.md).

**Tests and evals:** as listed. `evals/src/idea-box.ts` is unchanged (the card's prompt is untouched).
**Done when:** Done-when 4.
**Needs setup:** the Follow lines in the examples assume a follower gets the confirmation email: WP-00 S1 recorded done. If it is not, ship with "leave an email address on the page" cut from Day 2 and restore it later.

### T6: Findable by search engines and AI readers [M] [ships alone, after T5]

**Why:** FR-06 (indexing), s3 findings 1, 2, 3, 5, 9, 13, 16.

**Files (create):** `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts`, `apps/web/app/llms.txt/route.ts`, `apps/web/components/public/JsonLd.tsx`, `apps/web/lib/seo.ts`, `apps/web/app/__tests__/seo.test.ts`.
**Files (modify):** `apps/web/app/page.tsx` (metadata and the JSON-LD block), `apps/web/lib/auth/redirects.ts`, `apps/web/proxy.ts` (matcher), `apps/web/lib/__tests__/redirects.test.ts`, `apps/web/e2e/landing.spec.ts`, `apps/web/e2e/titles-not-found.spec.ts`.

**Interfaces consumed:** the root layout's `robots: { index: false, follow: false }` (kept: it protects every app screen); `app/page.tsx` exports no metadata and is `force-static`; `PUBLIC_PREFIXES` already lists `/robots.txt` and `/sitemap.xml`, and the `proxy.ts` matcher already excludes them; `decideRedirect` sends every signed-out path that is not public to `/login?next=…`; `isFounderPath(pathname)`; `SIGNED_IN_INDEX = "/start"`; `canonicalOrigin(appUrl)` (`lib/auth/canonical-origin.ts`); `APP_ORIGIN`, `APP_NAME`; `/brand/foundmill-icon-512.png` exists.

**Interfaces produced:**
- `lib/seo.ts`: `indexable(): boolean` = `canonicalOrigin(process.env.NEXT_PUBLIC_APP_URL) === APP_ORIGIN` (the origin, never `APP_ENV`: production reports `env: "staging"`, `audits/e0-production-evidence.md`); `STATIC_SITEMAP_PATHS = ["/", "/terms", "/privacy"] as const`; `export async function listedPublicPaths(): Promise<{ path: string; lastModified: Date }[]>` returning `[]` with the comment "WP-08 fills this from its listing rule".
- `app/page.tsx`: `export const metadata: Metadata = { title: { absolute: TITLE }, description: DESCRIPTION, alternates: { canonical: "/" }, openGraph: { title: TITLE, description: DESCRIPTION, url: "/", siteName: APP_NAME, type: "website", images: ["/opengraph-image.png"] }, robots: { index: indexable(), follow: indexable() } }` with T5's title and description.
- `robots.ts`: one group, `{ userAgent: "*", allow: "/", disallow: ["/api/", "/b/"] }`, `sitemap: ${APP_ORIGIN}/sitemap.xml`; when `!indexable()`, `disallow: "/"` and no sitemap line. `/login`, `/m/`, `/i/`, `/a/` stay crawlable so their `noindex` can be read. Decision 2 may add named groups.
- `sitemap.ts`: `revalidate = 3600`; the static paths plus `listedPublicPaths()`; no `priority`, no `changefreq`.
- `JsonLd({ data }: { data: object })`: `<script type="application/ld+json">` with `JSON.stringify(data).replace(/</g, "\\u003c")`. The home graph is s3 §3.1's (`Organization`, `WebSite`, `SoftwareApplication` with `offers: { price: "0", priceCurrency: "USD" }`), with `description` set to T5's "What Foundmill is" first sentence. No `FAQPage` markup.
- `decideRedirect`, inside `if (!authenticated)`, before the final redirect: `if (!isFounderPath(pathname) && pathname !== SIGNED_IN_INDEX && !pathname.startsWith("/integrations/")) return { kind: "next" };` so an address that is no app route reaches Next's 404.
- `/llms.txt`: a static `GET`, `text/plain; charset=utf-8`; `"/llms.txt"` added to `PUBLIC_PREFIXES` and to the matcher's exclusions. Body:
```
# Foundmill

> Foundmill is a web app where one person works with a team of AI agents to start a project of their own. The team shapes the idea, rates it honestly, drafts a public page for it and plans the next steps. The founder makes every decision that spends money or acts in their name.

Facts:
- For: people starting a first project, on their own or with cofounders. 18 or older.
- Cost: free to start with a monthly allowance of agent work and no card. Paid plans are not open yet.
- New people are let in a few at a time.
- Every project gets a free public page at foundmill.com/p/<name>.
- Agents never move money, sign, accept terms or file anything in the founder's name.

## Pages
- [Home](https://foundmill.com/): what Foundmill is, what it costs and example first weeks
- [Terms of Service](https://foundmill.com/terms)
- [Privacy Policy](https://foundmill.com/privacy)

## For agents
- The projects named on the home page (Sole Revival, Cheap Eats Houston, Code Club Evenings) and on /tour (Tutorlane, Glitchwick, Northwind Skincare) are examples, not customers.
```

**Steps:**
1. `redirects.test.ts` first: `decideRedirect({ pathname: "/pricing-nope", authenticated: false })` → `{ kind: "next" }`; `/.well-known/nope` the same; `/b/x`, `/home`, `/start`, `/new`, `/onboarding`, `/network`, `/communities`, `/businesses`, `/public-profile`, `/integrations/github/callback` still redirect to sign-in; signed-in behavior unchanged. verify: fails, then passes.
2. `seo.test.ts` first: `robots()` with the production origin lists the sitemap and allows `/`; with any other origin disallows everything; `sitemap()` returns exactly the three static addresses; the home metadata has `index: true` only on the production origin; the JSON-LD string contains no raw `<`. verify: passes after the files exist.
3. `titles-not-found.spec.ts`: signed out, `/pricing-nope` answers 404 with the "Nothing at this address" page. The page's description names "a business you cannot open": before → after for `app/not-found.tsx` description: "The page does not exist, or it belongs to a business you cannot open. Open one of yours or start a new one." → "The page does not exist, or it belongs to a project you cannot open." verify: the spec passes.
4. `landing.spec.ts`: one `script[type="application/ld+json"]` that parses; a canonical; `/llms.txt` is 200 `text/plain` and contains "examples, not customers". verify: passes.
5. Hand the Desktop session the five `curl` lines of s3 finding 1 and Done-when 5 for WP-00 S7. verify: recorded in `docs/DEPLOY.md`.

**Done when:** Done-when 5.
**Needs the founder:** Decision 1 (index now) and Decision 2 (training crawlers). Until Decision 1 is yes, merge with `indexable()` returning false behind one constant `HOME_INDEXED = false` and flip it in a one-line pull request.

### [x] T7: The idea box keeps its word under load [S] [ships alone]

**Why:** FR-14 (the deadline and the refusal lines; "one more try" waits on Decision 3).

**Files (modify):** `packages/agents/src/ideation.ts` (`buildIdeaBoxCardRequest`), `apps/api/src/services/idea-box.ts`, `apps/web/components/landing/idea-box/IdeaBox.tsx`, `apps/api/src/__tests__/idea-box.test.ts`, the `IdeaBox` test.

**Interfaces consumed:** the model client's `timeoutMs?: number` option (default `REQUEST_TIMEOUT_MS = 600_000`, `packages/models/src/client.ts`); `streamIdeaDraft(apiUrl, body, { signal, onEvent })`; `IDEA_BOX_ERRORS.failed` = "The card could not be finished. Try again."; `planIdeaBoxDraft` returns the held card to a browser that has one ("one card per browser", `docs/IDEA_BOX.md`, Money row).
**Interfaces produced:** `IDEA_BOX_DEADLINE_MS = 30_000` (`packages/shared/src/idea-box.ts`), passed as `timeoutMs` on the card request; in `IdeaBox`, an `AbortController` timer at `IDEA_BOX_DEADLINE_MS + 5_000` that aborts the stream, shows `IDEA_BOX_ERRORS.failed` and restores the field with the visitor's words.

**Steps:**
1. Api test first: a model double that never answers ends the stream with one `error` line, code `failed`, within the deadline (fake timers); the reserved card is not refunded (the Nov 13 P1 fix stands). verify: fails, then passes.
2. Web test first: with a stream that never ends, after the timer the field is back, holds the typed words, and `idea-error` reads the `failed` line. verify: passes.
3. If Decision 3 is yes (separate pull request): `IdeaBoxDraftRequest` gains `again: z.boolean().default(false)`; with `again: true` and a held, unclaimed card, `planIdeaBoxDraft` runs the same checks and limits and replaces the draft under the same token (`repos.ideaDrafts.replace(tokenHash, …)`, new), at most `IDEA_BOX_REDRAWS_PER_BROWSER = 2` a day counted in the limit store; the landed state gains a ghost button "Try another idea". Cost is unchanged in the worst case: the per-address 5 a day and the $20 day ceiling still bound it. verify: api test "a third redraw is refused with `limit`"; web test for the button.

**Done when:** a stalled model call ends in 35 seconds or less on the page with the words restored.

### [x] T8: The guards sign-up needs before it opens [M] [ships alone; the switch is WP-00 S5] (built on claude/wp03-t8-signup-guards; left: WP-09's per-account ceiling, then S5; the bot check's switches wait for the native app, D6)

**Why:** FR-01 (fix 3), A9-P0-1 (step 3), s2 §4.3 option C; `docs/DEPLOY.md` §4 condition "per-domain caps with a captcha"; DECISIONS 2026-11-13 "Recorded, not fixed today: one person can still use the open-mode ceiling with many addresses".

**Files (create):** `packages/db/migrations/<next>_admission_address_key.sql`, `packages/shared/src/address-key.ts` (+ test).
**Files (modify):** `packages/db/src/schema/people.ts`, `packages/db/src/repos/people.ts` (`admissionsRepo`), `apps/api/src/services/access.ts`, `packages/shared/src/env.ts`, `.env.example`, `apps/api/src/__tests__/signup-allowlist.test.ts`, `apps/web/app/login/LoginForm.tsx`, `apps/web/app/login/SignInCode.tsx`, `apps/web/components/landing/idea-box/turnstile.ts` (move to `apps/web/lib/turnstile.ts`, re-export), `docs/DEPLOY.md` §4 "Open sign-up".

**Interfaces consumed:** `decideAdmission(f: AdmissionFacts): AdmissionDecision`; `decideAndApply` takes `repos.admissions.lockOpenCount(tx)` then `openSince`; `AdmissionFacts` fields `mode, devUser, listed, emailConfirmed, admitted, existingPerson, admittedToday, ceiling`; `account_admissions (user_id unique, how, invitation_id)` is service only; `turnstileToken(siteKey, container, timeoutMs = 15_000, action = "idea_box"): Promise<string | null>`; `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` (`LoginForm.tsx` line 71).

**Interfaces produced:**
- `addressKey(email: string): string | null`: lower case; the local part cut at the first `+`; dots removed from the local part for `gmail.com` and `googlemail.com` (both stored as `gmail.com`); null when the address does not parse. `domainOfKey(key)`. `COMMON_MAIL_DOMAINS: ReadonlySet<string>` (about fifteen large mailbox providers: gmail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, proton.me, protonmail.com, aol.com, gmx.com, mail.com, zoho.com, yandex.com, fastmail.com).
- Column `account_admissions.address_key text null`, index `(address_key)`. Written by `repos.admissions.record` when `how = "open"` (new optional input `addressKey`). RLS unchanged (service only); the closed-table test covers the column.
- `repos.admissions.keyTaken(tx, key): Promise<boolean>`; `repos.admissions.openSinceForDomain(tx, since, domain): Promise<number>` (`address_key like '%@' || domain`).
- `AdmissionFacts` gains `sameAddressAdmitted: boolean`, `domainAdmittedToday: number`, `domainCeiling: number | null` (null for a domain in `COMMON_MAIL_DOMAINS`). In `decideAdmission`, between the `existingPerson` line and the ceiling line: `if (f.sameAddressAdmitted || (f.domainCeiling !== null && f.domainAdmittedToday >= f.domainCeiling)) return { outcome: "wait", reason: "ceiling" };`. The refusal is the existing `on_waitlist`, so the person is stored by T1 and can be admitted by hand. `admitThroughInvitation` passes neutral values (an invitation names its address).
- Env (api): `SIGNUP_PER_DOMAIN_PER_DAY: z.coerce.number().int().min(1).max(10_000).default(5)` (5 is an Estimate).
- Web: `LoginForm` and `SignInCode` get a token with `turnstileToken(siteKey, container, 15_000, "sign_in")` when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set and pass `options.captchaToken` to `signInWithOtp` and `verifyOtp`. A token that cannot be had shows "We could not check this browser. Reload the page and try again." (the idea box's `bot` line). Supabase checks the token only once the founder turns on its bot protection with the Turnstile secret (WP-00 S10); to my knowledge it ignores the field while that is off, and Google's own flow is not covered. Confirm both in the Supabase docs before merging and write what you found in the pull request.

**Steps:**
1. `address-key.test.ts` first (`A.b+x@GMail.com` → `ab@gmail.com`; `a+1@corp.example` → `a@corp.example`; garbage → null). verify: passes.
2. `signup-allowlist.test.ts` first, new cases for `decideAdmission`: same key already admitted → wait; sixth address of a private domain today → wait; the sixth `gmail.com` address is admitted while the day's ceiling has room; a listed address and an already admitted account are untouched; invite-only mode never reads the new facts. verify: fail, then pass.
3. Migration, schema, repo, `decideAndApply` (the two reads happen under the existing lock, only in `open` mode, only for a person not yet admitted). verify: `pnpm --filter @foundmill/db test:rls`; the api suite.
4. Web token. verify: `login.spec.ts` on the mock stack (the mock token) still signs in; a unit test asserts `signInWithOtp` receives `captchaToken` when the site key is set and none when it is not.
5. `docs/DEPLOY.md` §4: replace "per-domain caps with a captcha … not built yet" with what exists, and the order for S5: bot protection on in Supabase, then `SIGNUP_OPEN=1` and `SIGNUP_DAILY_CEILING=25` (Estimate, s2 §4.3) on api, stream and collab, then `WAITLIST_ADMIT_PER_DAY` to taste. verify: the text names every variable.

**Done when:** Done-when 7. Opening itself also waits on WP-09's per-account ceiling and Decision 4.

### [x] T9: The store-links value and its first readers [S] [ships alone] (the value and `GetTheApp` built; the landing footer built on claude/wp03-t7-stall-guard; `ContinueLater` waits on T3)

**Why:** A2-02, A9-P2-1; CLAUDE.md "through one config value for the store links (unset until launch)".

**Files (create):** `packages/config/src/app-links.ts` (+ test in `packages/config/src/__tests__/`), `packages/dugout/src/components/public/GetTheApp.tsx` (+ story at 390 px, + test). **Modify:** `packages/config/src/index.ts`, `apps/web/lib/env.ts`, `.env.example`, `apps/web/components/providers/ContinueLater.tsx` (T3), `apps/web/components/landing/LandingPage.tsx` (footer).

**Interfaces produced:**
- `parseStoreLinks(raw: string | undefined): StoreLinks | null`, `type StoreLinks = { ios: string | null; android: string | null }`. The one value is `NEXT_PUBLIC_STORE_LINKS`, two addresses separated by a comma in either order; only `https://apps.apple.com/…` and `https://play.google.com/…` are accepted; anything else, or an empty value, is null. `PublicEnv` gains `storeLinks: StoreLinks | null`.
- `GetTheApp({ links, className }: { links: StoreLinks | null; className?: string })`: server-safe; renders nothing when `links` is null; otherwise up to two 44 px buttons "Get the app for iPhone" and "Get the app for Android".
- Readers in this task: the bare wall's controls (`ContinueLater` renders `GetTheApp` first when links are set) and the landing footer under 640 px. WP-12 passes `links` to the public page components; WP-10 reads it in the phone shell. Redirecting a signed-in small screen to the store is one branch in `DesktopOnly` at launch; leave a comment there naming `publicEnv().storeLinks`, and build nothing more.

**Steps:** 1. Config test first (unset → null; one valid link; two; a link to another host → null). verify: passes. 2. Component, story, test "renders nothing without links". verify: dugout suite. 3. The two readers, each with a test with the value set and unset. verify: `node scripts/env-example.test.mjs` passes with the new variable.

**Done when:** setting one variable on Vercel makes the prompt appear in both places, and unsetting it removes every trace.

### [x] T10: Order the waitlist by who brought whom [S to M] [ships alone; only after Decision 5]

**Why:** the founder's two answers (ordered by referral); A9-P0-1 step 2's columns. Split from T2 so admission and email are not held up by it, and because DECISIONS gives it to the network session.

**Design, if this package builds it:** migration adding `waitlist_entries.code text unique` (10 characters, base32), `referred_by_entry_id uuid null references waitlist_entries(id) on delete set null`; `packages/shared/src/via.ts` gains a waitlist kind in `VIA_KINDS` only (not `ATTRIBUTION_VIA_KINDS`); `joinWaitlist` reads the `fm_via` cookie beside `fm_idea` and passes it; `waitlist.join` stores the referring entry (a self-reference is ignored); `waitlist.status` returns `{ joined, cardKept, shareUrl }` (no place number: "No public counts" is read widely); `WAITLIST_ORDER` becomes "entries that brought someone who joined first, then `created_at`"; the place-saved page gains "Bring a friend and your place opens sooner." with a Share control. Tests: join with and without a reference; order; RLS for the new columns.

**Done when:** the order test passes and the place-saved page shows the share link.

---

## Corrections to the audits

1. **No new admission kind.** (Superseded Nov 16 by T2's security review: 0111 adds `waitlist`, which has no standing to let others in under invite-only; see docs/log/2026-11/2026-11-15-claude-wp03-t2-waitlist-admits.md.) FR-01 and A9-P0-1 add `'waitlist'` to `ADMISSION_KINDS` with a migration and a change to `inviterStanding`. `how = 'open'` is right as it is: `openSince` already counts it toward the day's ceiling, and `inviterStanding` already gives it the standing an open sign-up has. `waitlist_entries.admitted_at` records the route.
2. **No sign-up mode value on the web.** FR-01 proposes a public `access.mode` query or `NEXT_PUBLIC_SIGNUP_MODE`. `app/page.tsx` is `force-static` and "asks the API nothing"; one wording ("a few people at a time") is true in both `invite_only` and `open`, so nothing is added.
3. **The admission email is not an address email.** A9 puts it on `ADDRESS_EMAIL_KINDS`. `sendAddressEmail` is bound to an invitation row, an inviter's daily count and a project's audit; a waitlist entry has an account (`waitlist.join` is a `confirmedProcedure`) and no project. A small third module is the smaller change.
4. **No `pnpm … waitlist:admit` script.** FR-01 proposes one. Nobody can run it: a cloud session cannot reach production and the laptop runs no builds. The operator way is three SQL statements through the Supabase connector plus a daily number on the orchestrator.
5. **Index on the origin, not the environment.** s3 finding 16 gates on the production origin, which is right; production reports `env: "staging"`, so any `APP_ENV` test would keep the live home page out of search.
6. **`scripts/supabase-config.test.mjs` does not check templates today** (FR-13 says "extend … to require both templates"): the check is new, not an extension.
7. **`IDEA_BOX_INTERESTS` stays.** s2 §3.4 adds four interests and renames "Surprise me". The list is a Zod enum in `IdeaBoxDraftRequest` and is read by the idea-box eval; the gain does not justify touching the contract. Cut.
8. **s2 §3.5's example weeks use things that do not exist yet:** an email to followers (AR-04: no agent path to one), a count of page visits, replies recorded by the product. T5's examples use only the card, the page, Follow with its confirmation, a drafted post the founder taps to post, milestones and a waiting decision.
9. **"Look for people here" is not true in production** (the people layer is behind the closed `liveMode` flag; `/home` shows "Opening soon", a1 §7 item 10). The solo section offers inviting someone, which works.
10. **A2-02 proposes two environment variables;** CLAUDE.md says one config value. One variable holding both links.
11. **s1 keeps the tagline as the `h1`; s2 replaces it.** s2 is followed; `APP_TAGLINE` stays in the footer, the share image and the layout default.
12. **FR-14's "up to 3 cards per browser" changes a founder answer** ("one card per browser", `docs/IDEA_BOX.md`). It is Decision 3, not a task.
13. **Platform mail is configured** (WP-00 §1: variables, DKIM, MX, 14 `notify.email_sent` events). s2 could not verify it; a11 §5 lists it as pending. What is still unproven is a real follow and ingest hearing bounces (S1, S2).
14. **`CardKeepView.tsx` makes no "real sources" claim** (FR-06 lists it). Only `IdeaBox.tsx` (`keepLead`) and `CardKeptView.tsx` (`CARD_KEPT_WORDS.lede`) do.

## Decisions for the founder

**Answered by the founder on Nov 15, 2026** (docs/log/2026-11/2026-11-15-claude-wp03-founder-decisions.md): 1 yes (index once T5 and T6 merge); 2 B; 3 yes, up to 2 redraws; 4 no (open sign-up needs T8 and WP-09's per-account ceiling; reporting gates `liveMode`); 5 this package builds T10 after T2; 6 the bot check only once the app sends a token; 7 the numbers as written; 8 keep `/tour` for now.

1. **Let search engines index the home page when T5 and T6 merge?** Recommended: yes. The page will be true, and "Built on Foundmill" links land on it. The other choice is to hold until sign-up opens.
2. **AI training crawlers.** (A) allow everywhere, or (B) allow on Foundmill's own pages and disallow on `/p/` and `/u/`. Recommended: B, which matches "we do not use your content to train AI models" for founders' words and costs no search presence. Either way one sentence goes in the Terms.
3. **A second and third try in the idea box** (T7 step 3). It replaces the card in place, inside the same per-address and daily limits. Recommended: yes; a typo should not be permanent for seven days.
4. **Is "reporting of people, profiles and messages" still a condition for opening sign-up** (Nov 11, answer 4) while the people layer is closed? Recommended: open sign-up needs T8 and WP-09's per-account ceiling; reporting (WP-12) becomes the condition for opening `liveMode`.
5. **Who builds the referral order (T10)?** DECISIONS gives it to the network session, which has no branch for it. Recommended: this package builds T10 after T2, and the network session is told.
6. **The bot check and the phone app.** Once Supabase's bot protection is on, the native app's sign-in must send a token too. Recommended: turn it on only when the mobile session confirms how the app gets one, or accept that app sign-in by email waits; Google sign-in is unaffected.
7. **The starting numbers** (all Estimates): 5 to 10 hand admissions a day now; `SIGNUP_DAILY_CEILING=25` and `SIGNUP_PER_DOMAIN_PER_DAY=5` when it opens. WP-09's cost report should replace them.
8. **Keep `/tour`?** It preserves today's page for an experienced reader at the cost of keeping eight sections and their tests alive. Recommended: keep for now, unlinked on phones; delete if nobody opens it in a month.

## Risks

- **A promise ahead of its sender.** T2's strings promise an email. If platform mail is off or ingest still refuses SendGrid's webhook, the promise is false. Guard: T2 merges with the number at 0 and the Desktop session proves one real email before anyone is admitted with the new words live; if S1 fails, revert the T2 copy table only.
- **A write on arrival.** T1 joins the waitlist without a press. The person has just signed in under a line that says signing in saves their place, and the write is their own row; say so in the Privacy Policy's list of what is stored if it is not there (check `apps/web/content/legal`).
- **Waitlist admissions create inviters.** (Closed Nov 16 for invite-only: a `waitlist` admission lets nobody in by invitation there.) An account admitted as `open` may let in three new accounts a day by invitation (`INVITATION_ADMISSIONS_PER_INVITER_PER_DAY`). That is the decided rule, and it means hand admissions grow the door faster than their own number.
- **The 404 change.** A route missing from `isFounderPath` would start answering 404 to a signed-out person instead of sending them to sign in. The redirect test lists every folder under `apps/web/app`; add a test that reads the folder names and fails on one that is neither public nor a founder path.
- **Copy drift.** Later packages must flip the strings in T5's switch table. Each row names its trigger; WP-02's nightly check can assert the limits answer against `LIVE_CONNECTORS` once DEPLOY.md records it.
- **PGlite and locks.** `for update skip locked` and the advisory lock are tested for their mechanism only; WP-11's real-Postgres CI should run T2's and T8's tests when it lands.
- **Per-domain cap and schools.** A college domain is exactly where a first cohort may come from; 5 a day would make most of a class wait. The waiting people are stored and emailed, and the number is one variable.

## Starting prompt

```
You are executing docs/holistic-plan/WP-03-the-door.md in the Foundmill repo. Read, in this order: CLAUDE.md, docs/holistic-plan/README.md, the work package, then the audit sections each task cites (docs/holistic-plan/audits/a1-first-run.md FR-01 to FR-03, FR-06, FR-13, FR-14; a9 A9-P0-1; s2 sections 3 and 4; s3 findings 1 to 3). Read the CLAUDE.md of each package before you touch it (apps/web, apps/api, apps/gateway, apps/orchestrator, packages/db, packages/shared, packages/dugout, packages/config).

Start with T1. Before writing code run the plan-change skill (it checks other branches for overlap and gives the next free migration number), then follow test-driven-development: write the task's failing test first and show it failing. One task is one pull request on a branch named claude/wp03-t<n>-<short-name>; never push to main and never merge. For T5 use the copywriting skill, then copy-editing and humanizer, and keep every string in apps/web/components/landing/words.ts exactly as the work package gives it unless a check in the task proves it false; if it is false, cut it and say so in the pull request. Follow the karpathy-guidelines skill on every change: state assumptions, make the smallest change, touch only the task's files.

Order: T1, T4, T7 (steps 1 and 2) and T9 first, in any order; then T2, then T3; then T5, then T6; then T8. Do not start T7 step 3, T10, or the HOME_INDEXED flip in T6 until docs/DECISIONS.md records the founder's answer to the matching item under "Decisions for the founder". T2, T3 and T8 are built behind their switches with the mock passing; do not ask anyone to change production.

Before saying a task is done run verify-done and report each check with its result and what the checks do not cover. In the same pull request: tick the task in this file, add one line to docs/PROGRESS.md, and record any judgment call in docs/DECISIONS.md. Then stop and wait for the founder to merge before the next task that depends on it.
```
