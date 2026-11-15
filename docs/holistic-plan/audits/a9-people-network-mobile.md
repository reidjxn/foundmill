# A9. The people side, how the product spreads, coming back, and the phone

Audit of `/Users/reidjackson/code/founder-manager` at `main` = `04a0a509` (Nov 15, 2026, 09:52 +0100). Read-only. Remote refs as of the last fetch (`.git/FETCH_HEAD`, Nov 15, 11:39); I did not fetch. Nothing was run: no pnpm, no tests, no builds. Every claim below is from reading code and docs unless it says "inference" or "not verified". Paths are relative to the repo root.

Production facts used (measured by the caller, not by me): 19 accounts, 1 new in 14 days, 2 signed in during 14 days; `waitlist_entries` 0, `invitations` 0, `account_admissions` 0, `connections` 0, `messages` 0, `communities` 1; 13 real projects, none since Oct 25; `project_pages` 0; `founder_notifications` 14; `founder_devices` 0.

The one-paragraph answer: of the plan for this area (docs/NETWORK.md), four of the six items of wave 1 are on main and waves 2, 3 and 4 are not started; and what is on main is switched off in production by three facts that are not bugs in any single feature. (1) The door is shut: production is invite-only by an environment list, a stranger is refused after signing in, and the waitlist they are offered is a table nobody reads and nothing drains. (2) The phone path stops right after sign-in: the profile form and the "start something" doors are desktop-only and the refusal screen offers no way to continue. (3) Every "things that travel" feature of wave 1 hangs off a project's public page, and production has zero page rows, because pages are drafted only when a project is created and no project has been created since before the feature existed. The return loop has the same shape: it is built, it is aimed at events that only new work produces, and it has no message for a project or person that went quiet before it shipped.

---

## 1. How it works today (file:line)

### 1.1 Getting in

**The gate.** Every signed-in api call goes through `protectedProcedure` (`apps/api/src/trpc.ts:300-303`), which calls `admitOrWait` (`apps/api/src/services/access.ts:188`). The decision is `decideAdmission` (`access.ts:100-109`), in three modes chosen by configuration alone (`packages/shared/src/allowlist.ts:69-72`):

| Mode | Set by | Who gets in |
| --- | --- | --- |
| `unrestricted` | no `SIGNUP_ALLOWLIST`, no `SIGNUP_OPEN` | everyone (local stacks, CI) |
| `invite_only` | `SIGNUP_ALLOWLIST` set | listed addresses (confirmed), plus any account with a row in `account_admissions` |
| `open` | `SIGNUP_OPEN=1` | listed; already admitted; a profile created before migration 0093 ran (`existing`); then anyone confirmed until `SIGNUP_DAILY_CEILING` (default 200 per UTC day), after which `on_waitlist` |

**Production is `invite_only`.** docs/DEPLOY.md:148 ("Production stays invite-only. `SIGNUP_ALLOWLIST` set, and `SIGNUP_OPEN` stays unset on the api, stream and collab until both of these are on main: the fix that stops open-admitted inviters going past the day's ceiling ... and per-domain caps with a captcha"). The first condition is on main (#120). The second is not built anywhere: no per-domain cap in `access.ts`, no bot check on `/login` (grep for `per-domain`, `perDomain`: no hits in apps/api or packages/shared). No remote branch contains it.

**What a stranger sees, step by step.**
1. `/` (landing): "Sign in" and "Start your business", both to `/login` (`apps/web/components/landing/LandingPage.tsx:96,149,152`; `parts.tsx:10`). Nothing on the landing page says the product is invite-only.
2. `/login` (`apps/web/app/login/LoginForm.tsx:99`): panel "Sign in", an email field, "Send sign-in link", "No password, no card. We email you a link.", the 18-or-older and Terms line (`:164`), and the footer "Sign-in works on any screen. The workspace itself is built for screens 1280 px wide or more." "Continue with Google" shows only with `NEXT_PUBLIC_AUTH_GOOGLE=on` and Google enabled in Supabase. No word about invitations or a list.
3. `supabase.auth.signInWithOtp` (`LoginForm.tsx:71`) creates the Supabase account for any address (sign-ups are on unless the dashboard switch was turned off, DEPLOY.md:145) and sends a link, with a six-digit code once the Supabase email template is pushed (DEPLOY.md status table: still the founder's step).
4. The link lands on `/`, rewritten to `/start` (`apps/web/app/start/page.tsx`), whose first api call (`founder.profile.get`) is refused with `not_invited` / `not_listed`. `ApiErrorPage` renders `NotInvitedPage` (`apps/web/components/shell/NotInvitedPage.tsx:19`): panel title "Invite only for now", "‹email› is not on the list", the api's message "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it." (`access.ts:46`), then the offer "Join the waitlist and we will let you in as soon as there is room. If you made a card on the home page, it is kept for you." with a "Join the waitlist" button (`NotInvitedPage.tsx:35`), Sign out, and the footer "Foundmill is open to invited founders while it is in preview."
5. The button calls `waitlist.join` (`apps/api/src/routers/idea-box.ts:49-54`), which upserts one row in `waitlist_entries` (`packages/db/src/repos/idea-drafts.ts:207-234`) and holds their landing-page card 90 days. The pill then reads "You are on the waitlist. We will email you when there is room." (`NotInvitedPage.tsx:38`).
6. Nothing else ever happens. `waitlist_entries.admitted_at` (`packages/db/src/schema/idea-box.ts:58`) is written by no code (grep `admittedAt|admitted_at` outside the schema: no hits). No email kind exists for it. No screen lists entries. No schedule reads them. Admitting someone is "adding the address to SIGNUP_ALLOWLIST" (docs/DECISIONS.md:3879-3900, "A minimal waitlist"), an environment variable on three services (api, stream, collab), each of which redeploys.

**Why the three tables are empty.** The code is merged and needs no flag: the waitlist offer appears on every `not_listed` refusal (#98, Nov 13), and `account_admissions` gets a row only when a non-listed account accepts an invitation in `invite_only` mode, or under `SIGNUP_OPEN`. The tables exist in production (the caller could count them), so the migrations through 0091 ran and the api is on #120 or later. Zero rows therefore mean: almost nobody reaches step 4 (one new account in 14 days), nobody who did pressed the button, and no listed founder has made an invitation (the only control is Settings › People, a desktop-only screen, and only two accounts have signed in). It is a traffic and closed-door problem, not a defect in the join. An operator can admit one account today without a deploy by inserting a row: `account_admissions (user_id, how)` with `how` in `invitation | open | existing` (`packages/db/migrations/0091_invitations.sql:126-136`); `decideAdmission` step 3 then admits them on their next request. Note `how = 'existing'` also makes the account a trusted inviter (`access.ts:275-283`).

**What an invited person sees.** `/i/<token>` (`apps/web/app/i/[token]/page.tsx`, `apps/web/components/people/InvitationScreen.tsx`) is public, works from 390 px, never indexed. Signed out: the project's name, who invited them, the role in one sentence (`packages/shared/src/people.ts:30-33`), and "Sign in to accept", which goes to `/login?next=/i/<token>` and comes back. Signed in: an "I am 18 or older" box when none is on record, Accept, Not now, Decline. `invitation.accept` (`apps/api/src/routers/people.ts:37-39`) is a `signedInProcedure` (admission not required), adds the membership, and admits the account through `admitThroughInvitation` (`access.ts:306-336`): in `invite_only` mode only when the inviter is a listed address (or holds an `existing` or `open` admission), three new accounts per inviter per UTC day; otherwise `invitation_cannot_admit` or `invitation_admissions_limit`. An invitation that names an address is accepted only by the account signed in with that address; a cofounder invitation must name one (0093).

After Accept the page pushes to `/b/<id>/today` (`InvitationScreen.tsx`, `onSuccess`). The business layout then redirects any account with no founder profile to `/onboarding` (`apps/web/app/b/[bid]/layout.tsx:67`). `/onboarding` is the old four-question founder profile (name, experience, time, where you live; `apps/web/components/onboarding/OnboardingScreen.tsx:307`, a `StudioFrame` without `smallScreen`), so on a phone it renders "This needs a larger window". On a desktop, saving the profile ends with `router.push("/new")` and the toast "Next: ideate a concept or import what already exists." (`OnboardingScreen.tsx:179-186`): the invited person is sent to start their own project, not to the project they just joined. The e2e test knows about the detour (`apps/web/e2e/invitations.spec.ts:166-168` accepts either `/b/<id>/` or `/onboarding`).

**18 or older.** One record per account (`adult_confirmations`, 0100, #127). Asked on the profile form, on an invitation, and once (`AdultStep`, works from 390 px) for people from before. `startDestination` treats a profile as complete only with it (`apps/web/lib/auth/start-destination.ts`), so each of the 19 existing accounts meets the step on their next visit. Refusal code `adult_unconfirmed`.

### 1.2 The person

- **Columns** (`packages/db/migrations/0080_person_profiles.sql:35-58`, on `founder_profiles`): `handle`, `headline`, `about`, `strengths text[]`, `wants_to_learn text[]`, `looking_for` (`on_my_own` default, `open_to_people`, `looking_for_cofounder`, `looking_to_join`), `place`, `public boolean`, `published_at`. Visibility is one switch for the whole page, not per field. No picture, no links, no hours.
- **Public view** `public_person_profiles` (0080, redefined in 0092 and 0100): ten columns, service role only, requires an `adult_confirmations` row; projects listed only where the person is owner or cofounder and the project page shows its founders.
- **`/u/<handle>`** (`apps/web/app/u/[handle]/page.tsx`, Dugout `PersonPage`): from 390 px, indexable only when public, no footer and no mark (founder, Nov 12). "Building on my own" prints nothing about people (`packages/shared/src/person-profile.ts`, `lookingForLine`).
- **`/public-profile`** (`apps/web/components/profile/PublicProfileScreen.tsx`; api `founder.publicProfile.get|update|publish|unpublish`, `apps/api/src/routers/founder.ts:267-271`): from 390 px. Reachable from the business switcher, Settings › Preferences and the palette (`BusinessShell.tsx:810`, `PreferencesTab.tsx:327`, `lib/search.ts:142`). A person with no project has no link to it: `/home` and `PersonLiveFrame` (`apps/web/components/live/PersonLiveFrame.tsx:16-19`) link only Home, Network and Communities.
- **`/home`** (`apps/web/app/home/page.tsx`, `apps/web/components/person-home/PersonHome.tsx:113-175`): "Start something" (to `/new`) and "Find a project or people" (to `/network`, or the chip "Opening soon" when the people layer is closed), "Waiting for you" and "Pick up where you left off" only when non-empty. No suggestions of people. From 390 px. But `/new` is desktop-only, so on a phone the main action leads to "This needs a larger window".
- **People pages** (`apps/web/app/(live)/layout.tsx:63-78`): `/network`, `/communities`, `/profiles/...` render in the person frame for someone with no project and in the business shell otherwise, from 390 px (#99, #102). They are the pre-thesis network unchanged underneath: every `live.*` procedure is behind `liveGate` (`apps/api/src/trpc.ts:414-417`), which is closed unless `LIVE_MODE=1` (`packages/config/src/flags.ts:3,34`; DEPLOY.md:72 says leave it unset). Search is by name over the old `public_profiles` view, in which a person exists only as owner, cofounder or admin of a Live, committed business (`apps/api/src/routers/live.ts:479-482`). Asking to connect still needs Live-section write in a Live business (`live.ts:163-166`), so a person with no project can read and answer but cannot reach out. Messages go only to connections (`live.ts:247`).
- **Two identity systems.** The old one: `founder_profiles.visibility` set in Network's `VisibilityPanel` (`apps/web/components/live/NetworkScreen.tsx:154`; `live.profile.visibility.set`, `live.ts:515`) feeding `public_profiles`. The new one: `founder_profiles.public` + `handle` feeding `public_person_profiles`. Network search does not find a person who published `/u/<handle>`, and `/profiles/founder/<id>` does not show their headline, strengths or "looking for".

**The solo guard (NETWORK §10), checked in code.**

| Guard (right-hand column) | State in code | Evidence |
| --- | --- | --- |
| No empty "Built with", "People" or "Open roles" slot | Holds: none of the three exists. Team › People always lists at least the founder | `packages/modules/src/team/StaffScreen.tsx` |
| No "Invite someone" step anywhere | Holds: the only invite control is Settings › People | `apps/web/components/settings/MembersTab.tsx:197`; grep of UI strings finds no other; no checklist item |
| No suggestions of people; no open roles in Latest | Holds trivially: neither exists. `/home` and Network suggest nobody | `PersonHome.tsx`, PROGRESS 1762 |
| No second question about people after a no | Holds: `looking_for` is asked only on `/public-profile`; onboarding does not ask about people at all | `OnboardingScreen.tsx` |
| No tile or card that reads differently with two | Holds for what exists. Milestones have no "first cofounder" key | `packages/journey/src/trophies.ts:75-84` |
| Matcher never treats solo as lesser | Not applicable: no matcher | |
| Agents never propose finding a partner | Holds in the Team call prompt; no other prompt mentions it | `packages/agents/src/prompts/team-call.ts:217,253` |

Tests of the right-hand column exist only for the person page ("on my own" prints nothing: `person-page.spec.ts`, `PersonPage.test.tsx`, `person-profile.test.ts`) and the home (`person-home.spec.ts`: no suggestions, unbadged). There is no test that a one-person project's Today, checklist and Needs you contain no people prompt.

### 1.3 Building together

| Piece | State | Where |
| --- | --- | --- |
| Invitations (link and email, 14 days, revoke, decline, admission) | Built, merged #120 | `apps/api/src/services/invitations.ts`, `routers/people.ts`, 0091, `apps/gateway/src/notify-address-email.ts` |
| Roles `cofounder` (owner-equivalent) and `collaborator` (Product and Customers write; plan and Team read; nothing of Money, Legal, Settings) | Built, #120, with walls in 0094, 0095, 0099, 0107 | 0092; `packages/shared/src/people.ts`, `permissions.ts` (`COLLABORATOR_SECTIONS`) |
| Nobody grants access they lack | Built, #113 and #120 | `apps/api/src/services/grants.ts`, 0096 |
| Founder notices (a founder lowered or removed, deletion asked or canceled; a removed founder can cancel) | Built, #124 | 0097 `founder_departures`, `founder_cancel_links`; `apps/gateway/src/notify-founder-notice.ts`; `founder.formerProjects.*` |
| "Come see" invitation (no role) | Not built | `INVITATION_ROLES = ["cofounder", "collaborator"]` (`people.ts:16`) |
| Trial (two weeks, brief, midpoint, private answers, parting) | Not built. Only `memberships.expires_at` exists; a collaborator invitation creates a membership with no end date (`people.ts:39-41`) | |
| Join requests | Not built (no table, no procedure, no `/p/<slug>` control) | |
| Ownership split, founders' agreement | Not built | |
| Pooled credits for cofounders | Not built: the pool is per founder who took charge (`packages/db/src/tiers.ts:91-95`) | |
| Notes for more than one person | Substrate only: `inbox_items.for_user_id` (0103, added for showcase asks). The Composer still reads one owner's experience (`apps/composer/src/context.ts:46`); no "who decides", no group address | |
| Project thread, comments on notes and tasks, tasks assigned to a person | Not built (`tasks.assignee_agent_id` only) | |

What a solo founder sees of all this: the Settings › People tab (their own row and an "Invite someone" section) and the Team › People table with one row. Nothing on Today, Needs you, the checklist or any note. That is the intended amount.

### 1.4 Spreading

- **The mark.** `tierShowsBuiltOnMark` (`packages/config/src/pricing.ts:119`): free plan carries it, paid removes it. Placed on the page foot, after a follow, in the confirmation email and page (`apps/ingest/src/platform-mail.ts:352`), in the share image, once in the console preview. Words in `packages/shared/src/project-page.ts` (`builtOnWords`).
- **Attribution.** The web proxy keeps the first valid `?via=` in the httpOnly `fm_via` cookie for 30 days (`apps/web/proxy.ts:26`; `packages/shared/src/via.ts`). Kinds: `p.<slug>`, `u.<handle>`, `s.<code>` (a shared team post). It is recorded once, on the save that creates the founder profile (`founder.profile.update` → `onPersonCreated` → `recordInvitationAttribution` then `recordSignupAttribution`, `apps/api/src/services/attribution.ts:82,100`; table `attributions`, 0088, service role only) with account events `signup.attributed` and `referral.arrived`. Consequence: a visitor who is refused at the door never creates a profile, so nothing is ever attributed while production is invite-only, except invitees.
- **Milestones in public.** Two early milestones recorded from real events, "Page live" and "First follower" (`trophies.ts:75-76`); only these are showable (`isShowableTrophyKey`, `trophies.ts:153`). `journey.showMilestone` / `hideMilestone` (`apps/api/src/routers/journey.ts:164-166`), view `public_project_milestones` (0089).
- **Story and cards.** `/p/<slug>/story` and `/m/<id>` with wide and tall images (`apps/web/app/p/[slug]/story/page.tsx`, `apps/web/app/m/[id]/`); api `publicPage.storyBySlug`, `publicPage.cardById` (`apps/api/src/routers/page.ts:58-59`). The story is the list of shown milestones, not a drafted timeline.
- **Share panel, tap-to-post.** Dugout `SharePost` on a shown milestone, the live page and a drafted social post; `share.opened` records a press, never a post (`apps/api/src/routers/share.ts`). X, Threads, Bluesky open filled in; LinkedIn, Facebook, Reddit with the link; Instagram and TikTok copy-and-download.
- **The team's post drafts** (`apps/orchestrator/src/workflows/postDraft.ts`; caps 2 a day and 5 a week, `packages/shared/src/team-posts.ts:52`), media kits (#125), post-to-outcome attribution (0106, #128), Buffer on the founder's own key (#126), a page quiz (0105, #122), Turnstile on the Follow form (#119).
- **Referral credits.** Not built. No `referral.credited` event, no credit grant, no "people started because of you" line.
- **All of it needs a published page, and production has none.** A `project_pages` row is written only by the founder saving or publishing in Product › Public page (`page.saveDraft`, `page.publish`, `apps/api/src/routers/page.ts:50-52`) or by the first-session drafting step (`apps/orchestrator/src/workflows/businessFoundations.ts:94`; `apps/api/src/services/foundations.ts:274-276`), which runs once at commit. The 13 real projects were committed before Oct 25; the page feature merged Nov 12 (#79). No catch-up drafts a page for an existing project. Today's quiet line "Your project's public page is ready to check" links to Product › Public page (`apps/web/components/today/TodayScreen.tsx:230`), a department tab that is desktop-only, and the page-ready note's options are "check" (open that tab) or "later" (`packages/shared/src/project-page.ts:261-264`): a page cannot be published from a phone.

**Email from Foundmill (one sender).** `POST /v1/notify/email` in the gateway (`apps/gateway/src/notify-email.ts`), asked by the api's five-minute pass for waiting decisions (`apps/api/src/services/push/email-pass.ts`, started at `apps/api/src/index.ts:239-240` only when `PLATFORM_MAIL_DOMAIN` is set and `NOTIFY_EMAIL` is not `off`) and by the orchestrator's schedule `founder-notifications` every five minutes for the rest (`apps/orchestrator/src/schedules.ts:48`, `activities/notify.ts`, `notify/rules.ts`).

| Thing | Value | Where |
| --- | --- | --- |
| Kinds to an account | `decision_waiting`, `win`, `milestone`, `run_finished`, `credits`, `daily_brief`, `weekly_review`, `invitation_accepted` | `packages/shared/src/constants.ts:621` |
| Kinds to an address | `invitation` | `constants.ts:638` |
| Safety notices | `founder_notice` (no switch, own ceilings) | `packages/shared/src/founder-notices.ts` |
| Per person per day | 3, across kinds and projects; briefs and `invitation_accepted` do not count | `packages/shared/src/notify-email.ts:33`, `constants.ts:630` |
| Per person per project per day | 1 | `notify-email.ts:27` |
| Waiting decision | 30 minutes after the person left when it holds up the team, else 24 hours; once per note, ever; notes older than 7 days are never looked at | `notify-email.ts:17-21` |
| Win, milestone, finished run | only within 24 hours of happening | `packages/shared/src/founder-notifications.ts:24-26` |
| Brief | at the person's hour (default 8), a three-hour window, only with news: a real outcome, work done, something waiting, or something due | `notify/rules.ts`, `packages/shared/src/morning-brief.ts:391` |
| Who | owners and admins with Inbox read, of a committed, non-sample project | `activities/notify.ts` |
| Preferences | one switch per kind, the brief's hour, a pause | Settings › Preferences › Email; `founder.email.get|update|recent` (`founder.ts:290-293`) |
| Off links | per-kind off (ingest `/mail/notify/off`), pause page `/email/pause`, RFC 8058 `/email/unsubscribe`, "Don't send me invitations" (ingest `/mail/invitations/off`) | |
| One-click answer | `/a/<token>` then `email.action.answer`: recommended, reversible, free, internal-only options; 48 hours, once | `apps/api/src/routers/email.ts:124` |

No kind exists for people (a follow, a message, a request), for a person with no project, or for someone on the waitlist. `founder_notifications.business_id` is `not null` (0083), so the record cannot hold an email about a person without a project.

**Push.** The api's push notifier (`apps/api/src/services/push/notifier.ts`, words in `decide.ts:67-151`) handles seven project events (decision, approval, customer, agent down, runway, run finished, goal) through the gateway's `POST /v1/push/send` and the `onesignal` connector. `founder_devices` has 0 rows, the OneSignal keys are not set (DEPLOY.md status table: "keys wait for the OneSignal app"), and there is no app in the stores. Push reaches nobody.

### 1.5 Coming back

Built and on main: presence and visit days (`founder_presence`, `founder_visit_days`, 0083), "Since you were last here" (`today.sinceLastVisit`), the daily streak (`today.streak`, `packages/shared/src/streak.ts`), the Needs you count in the tab title, opt-in browser notifications, the Overnight shift (Autopilot at about 2 AM, one round, on by default at Commit), the morning brief in four sections with real outcomes only (#112, `packages/shared/src/morning-brief.ts`), "When the team stops" (read-only list in Settings › What the team can do, `apps/web/components/settings/TeamCanDoTab.tsx`), Today and Needs you from 390 px (#102).

Whether any email actually leaves production cannot be read from the repo. Evidence: THESIS_REVIEW.md:395 says the sending address is "off until its DNS and SendGrid setup"; the DEPLOY.md status table still says "every service runs `mock` except GitHub"; no entry records the setup as done. Against that, 14 `founder_notifications` rows exist, no code writes a `browser` row (so all 14 are email rows), and the orchestrator records a row only for a lasting refusal or a send (the answers `off` and `unconfigured` are retried and leave no row, `activities/notify.ts:22`), which suggests `PLATFORM_MAIL_DOMAIN` is set on the gateway. If the domain is set while `sendgrid` is not in the gateway's `LIVE_CONNECTORS`, the gateway answers `simulated` for a real project (`notify-email.ts:198`), which is not a retry reason: the email is recorded as skipped and never asked for again. The query that settles it: `select channel, kind, status, skip_reason, mode, count(*), min(created_at), max(created_at) from founder_notifications group by 1,2,3,4,5 order by 6 desc;`.

### 1.6 The phone

Routes that work from 390 px on main (`apps/web/components/providers/DesktopOnly.tsx:29-61`): `/` (the hero and idea box only), `/login`, `/home`, `/p/...`, `/u/...`, `/m/...`, `/i/...`, `/a/...`, `/email/pause`, `/terms`, `/privacy`, `/new/card/...`, `/public-profile`, `/network`, `/communities`, `/communities/...`, `/profiles/...`, and inside a project `/b/<id>/today` and `/b/<id>/inbox[/<item>]`. Two components opt in wherever they render: the on-waitlist page and the one-step 18-or-older confirmation.

Everything else renders `NeedsLargerWindow` (`packages/dugout/src/components/shell/NeedsLargerWindow.tsx:31-34`): "This needs a larger window. Foundmill is built for desktop screens at least 1280 px wide. Widen the window or move to a larger display." It has no link, no "email me the link", no way to continue later. That includes `/onboarding` (the form), `/new` and everything under it except the kept card, `/businesses`, every department tab, Settings, Milestones (where Share lives) and the public page editor.

---

## 2. Status matrices

Legend. **Merged**: on `main` at `04a0a509`. **In flight**: commits on a remote branch that are not on main (branch, count, last commit). **Not started**: no code on main and none on any remote branch. "Substrate" means a table or column exists and no feature uses it.

How "merged" was decided for squash-merged branches: the tree of the branch tip was compared with the tree of its squash commit on main (`git diff --stat <squash> <branch>`); the only differences were files other pull requests had added to main. By that test `claude/waitlist-invitations` (#120, squash `3bcec32d`, Nov 14 01:09), `claude/founder-notices` (#124, `29d0f89c`, Nov 14 11:37) and `claude/bold-johnson-hjxopx` (#93, `f924098f`, Nov 13 20:28) are fully on main and have had no commit since. As of the last fetch nothing in this area is in flight except the two branches named in section 4.

### 2.1 NETWORK.md §7: the twenty-one features

| ID | Feature | Status | What is on main | What is missing | Owner or branch |
| --- | --- | --- | --- | --- | --- |
| F1 | The record on `/u/<handle>` | Partly merged (#79) | The person page, its editor, 0080, the 18+ filter (0100) | The record itself: verified lines, first outcomes by kind, asks answered, "Verified by Foundmill" per line, picture, proven links, Built with | Nobody. No branch |
| F2 | The mark and the project story | Merged (#93) | The mark in all five places; `/p/<slug>/story` from shown milestones; dates recorded by the database (0090) | A drafted timeline ("the idea, in ‹name›'s words"); the log (5.4); the open role at the story's end | Nobody for the rest |
| F3 | Cards | Mostly merged (#93, #125, #126, #128) | `/m/<id>`, wide and tall images, tap-to-post, the team's post drafts, media kits, post attribution | "First reply from a customer" and "first dollar" as verified milestones; the week card; the chapter recap; a Follow button on the card page; share controls for visitors; the phone's share sheet | Nobody |
| F4 | Feedback links (`/f/<id>`) | **Not started** | Nothing (no route, table or event). The page quiz (#122) is a different object | All of it, including the return message | Nobody. Wave 1 item 4 |
| F5 | Invitations | Merged (#120) | Cofounder and collaborator invitations by link and email, `/i/<token>`, admission | "Come see"; group links for cohorts; the referral-ordered waitlist (only the minimal list of #98 exists) | Network session by decision (DECISIONS 4036); no branch |
| F6 | Credit for bringing people | **Not started** | Substrate: `attributions`, `signup.attributed`, `referral.arrived` | Credits to both sides, monthly cap, the private line on the Network page, moving up the waitlist | Nobody. Wave 1 item 6; amounts wait for package 7.1 |
| F7 | Latest (the feed) | Not started | | `feed_items`, sources, "Share it" into the feed | Nobody |
| F8 | Signals | Not started | | `signals`, the four responses, Customers evidence | Nobody |
| F9 | (Shipped this week) | Not built by decision | | | |
| F10 | Asks | Not started | | `asks`, `ask_answers`, routing, thanks, credits | Nobody |
| F11 | Starting points | Not started (Later) | | | Nobody |
| F12 | Cohorts | Not started | The community kind `cohort` only | Cohort assignment, the week view, check-ins, private cohort links | Nobody |
| F13 | Build hours | Not started | | Tables, presence, clock. Must never use "call" or `/calls` | Nobody |
| F14 | Communities for a purpose | Not started | The pre-thesis communities (create, join, posts, moderation), closed unless `LIVE_MODE=1` | Seeding by place and audience, post types, public `/c/<slug>`, the weekly prompt | Nobody |
| F15 | Open roles | Not started | | `open_roles`, the role writer, `/p/<slug>/roles/<id>` | Nobody |
| F16 | Find people | Not started | Name-only search over the old view | Browse, Five today, Say hi, the matcher and its evals | Nobody |
| F17 | Messages and requests | Not started | Direct and group messages between connections only, closed unless `LIVE_MODE=1` | Requests from non-connections, the project thread, comments, contact exchange, push and email for a first message. Needs its own security review before merge (DECISIONS 4049) | Nobody |
| F18 | From trial to cofounders | Substrate merged (#120, #124) | The two roles, `memberships.expires_at`, founder notices | Ask to join, the trial and its brief, parting, the split helper, pooled credits | Nobody |
| F19 | Built with | Not started | | | Nobody |
| F20 | Notifications and the weekly letter | Partly merged (#84, #112, #120, #124) | Eight email kinds, the address kind, safety notices, preferences, limits, one-click answer, seven push kinds | Every people kind; bundling; quiet hours; vacation silencing email; the letter with who responded and a suggestion; people lines in "Since you were last here" | Retention session owns the sender and the kinds list; no branch |
| F21 | Safety for meeting strangers | Partly merged (pre-thesis, #127) | Report a post, community moderation queue, block a person, post screening, 18+ once, per-person limits in Redis | Report a person, profile, message, ask or answer; a platform review queue; money-request screening in messages; new-account limits; private signals to a matcher | Nobody |

### 2.2 NETWORK.md §13: the four waves

| Wave | Item | Status |
| --- | --- | --- |
| 1 | 1. Attribution and the events of §11 | Partly merged. Recorded: `signup.attributed`, `referral.arrived`, `share.opened`, `visit.attributed` (shared posts), `invitation.sent|accepted|declined`, `milestone.shown|hidden`, `post.drafted`. Of the 26 events §11 names, 5 are declared (`share.opened`, `visit.attributed`, `signup.attributed`, `invitation.sent`, `invitation.accepted`); the other 21 are not. `invitation.declined`, `referral.arrived`, `post.drafted` and `milestone.shown|hidden` are declared and are not in §11's list. `via` has no letter yet for a card, a feedback link or an invitation |
| 1 | 2. F2 the mark and the story | Merged |
| 1 | 3. F3 cards with the four early milestones | Merged with two of the four |
| 1 | 4. F4 feedback links | **Not started** |
| 1 | 5. F5 invitations with the two roles | Merged |
| 1 | 6. F6 credit for bringing people | **Not started** |
| 2 | Preconditions: 2.1 small screens, 2.4 home, 2.5 people layer open | 2.4 done; 2.1 partly; 2.5 not started (`FLAGS.liveMode = false`) |
| 2 | 7. F1 the record · 8. F7 Latest and F8 signals · 9. F12 cohorts · 10. F20 people notifications and the letter | Not started (F20's project half is merged) |
| 3 | 11. F21 safety · 12. F10 asks · 13. F17 requests · 14. F13 build hours · 15. F14 communities | Not started |
| 4 | 16. F15 and F18 ask to join, trial, parting · 17. F16 Find people · 18. F18 cofounders, split, pooled credits, F19 | Not started |

Wave 1 is the only wave begun, and its two unbuilt items are the two that reach people who are not customers of a project: the feedback link (the widest loop, L2, started by a solo founder in week one) and the reward for bringing someone (L7).

### 2.3 THESIS_REVIEW.md §13, phase 2: reach and the person

| Pkg | Title | Status | Evidence and what is left |
| --- | --- | --- | --- |
| 2.1 | Small screens for the outer product | Partly merged (#82, #84, #94, #99, #102, #120) | Done: the list in 1.6. Left: the profile form (`/onboarding`), the doors (`/new`, ideation, commit), the kinder note with "email me the link" on every desktop-only route, the store-links value, Playwright phone projects (specs set a viewport by hand today) |
| 2.2 | Open the door | Partly merged | Done: 18+ once (#127); Google on the web (#82, off until set up); the open mode with a daily ceiling (#120, switched off); the email link and code work on any device. Left: the two conditions for switching open sign-up on (per-domain caps, a bot check); a waitlist that records who referred whom, orders by it, admits and tells people. Apple: declined by the founder (Nov 12) |
| 2.3 | The person profile | Partly merged (#79) | Done: `/u/<handle>`, `/public-profile`, 0080. Left: "Before you start" as three plain questions (the form still asks experience, time, residence, and offers skills 1 to 20, a budget hinted "25,000 or 25k" at `OnboardingScreen.tsx:622`, markets, risk); per-field visibility; replacing the `public_profiles` view; the profile after the first idea (decided Nov 11, done only for the idea-box card path) |
| 2.4 | Home for a person | Merged (#94, #99) | `/home`, the person frame for the people pages |
| 2.5 | Retire "game mode", open the people layer | **Not started** | `gameMode` personal or live is still on Commit (`CommitScreen.tsx:702`) and in `business.setGameMode` (`apps/api/src/routers/business.ts:338`); `FLAGS.liveMode = false`; connecting needs a Live business |
| 2.6 | Shrink Commit | **Not started** | Commit still has Name, name checks, Logo and brand colors, Personal or live, Archetype, Business mode, spend cap (`CommitScreen.tsx:538-745`, 975 lines) |
| 2.7 | Landing and metadata | Partly merged (#98, #105) | The idea box and a less dense page. Not checked here: the promise per §12.1 and per-route indexing (root layout is `robots: index false`, `apps/web/app/layout.tsx:18`, with public routes overriding) |

### 2.4 Phase 3: build together

| Pkg | Title | Status | Evidence and what is left |
| --- | --- | --- | --- |
| 3.1 | Invitations | Merged (#120) | Defect in the landing after Accept: A9-P1-2 |
| 3.2 | Seats: people are free | Merged (early, #79) | `seats: "unlimited"`, PROGRESS 1470 |
| 3.3 | Cofounder and collaborator | Merged (#120, #131, #132) | 0092 to 0096, 0099, 0107. Left: the Staff screen still offers an admin every level and shows the api's refusal (DECISIONS 4236) |
| 3.4 | Join requests | Not started | |
| 3.5 | Trial | Not started | `memberships.expires_at` only |
| 3.6 | Notes for more than one person | Substrate | `inbox_items.for_user_id` (0103). Composer and prompts unchanged |
| 3.7 | People talking inside a project | Not started | |
| 3.8 | Who owns what | Not started | |
| 3.9 | Pooled credits | Not started | |

### 2.5 Phase 4: finding each other

| Pkg | Title | Status | Evidence and what is left |
| --- | --- | --- | --- |
| 4.1 | Open roles | Not started | |
| 4.2 | Browse and search | Not started | `live.people.search` is name-only (`live.ts:479`) |
| 4.3 | Suggestions | Not started | |
| 4.4 | Introductions | Not started | |
| 4.5 | Ideation for one person first | Not started, as far as the prompt shows | `packages/agents/src/prompts/ideation.ts` has no "start for free", "run alone" or optional-partner line (grep). Outside this area: confirm with the ideation auditor |
| 4.6 | Referral | Substrate (#93) | Attribution recorded; no credit |
| 4.7 | Safety for meeting strangers | Partly merged | See F21. Limits: the per-pair and per-thread windows are in the shared store (`apps/api/src/services/live-limits.ts`), but `takeLive` still counts in process memory (`apps/api/src/services/live.ts:58-64`) |
| 4.8 | Communities for a purpose | Not started | |
| 4.9 | Leaderboards | Removed (0076) | |
| 4.10 | One home for the people side | Not started | `apps/social` is still one read route and 501 placeholders (`apps/social/src/app.ts`) |

### 2.6 Phase 5: coming back

| Pkg | Title | Status | Evidence and what is left |
| --- | --- | --- | --- |
| 5.1 | Notifications | Mostly merged for projects (#75, #84, #112, #120, #124) | Left: quiet hours; "your page had visitors"; a request to join and a message (the features do not exist); one vocabulary for push and email kinds; anything for a person with no project |
| 5.2 | The weekly letter | Partly merged (#84) | `weekly_review` on Mondays from templates. Left: written by the Composer, who visited, one suggestion for someone looking |
| 5.3 | Milestone cards | Partly merged (#93) | Page live and first follower. Left: first conversation with a customer, first dollar (need a real payment to verify), first collaborator, first cofounder |
| 5.4 | Build log | Not started | No `/p/<slug>/log` |
| 5.5 | The native app is the phone's home | Not launched | Backend on main: `founder_devices` (0075), `founder.devices.*`, the push fan-out, the six-digit code. Missing: the store-links value, the universal-link files, the OneSignal app and keys, an app |
| 5.6 | The mobile prompt pack follows the thesis | Corrective part merged Nov 11 (#77); stale again | See A9-P1-7 and section 4.3 |

---

## 3. Findings

Severity: P0 stops the target user getting in or reaching a real outcome, or breaks trust. Each fix names files, procedures, tables, flags and tests. "Owner" is who the repo's own records say holds the area; where they disagree it says so.

### A9-P0-1. The door is shut, and the way to open it is not built and has no owner

**Evidence.** Production is `invite_only` (DEPLOY.md:148). A stranger is refused after sign-in and offered a waitlist that only stores a row (1.1, steps 4 to 6). Opening sign-up is blocked on "per-domain caps with a captcha", which exist nowhere. The decided waitlist ("one list ordered by who brought whom", NETWORK F5, founder Nov 11 and 12) is not built: `waitlist_entries` has no referrer, no order, no admission, no email. Ownership is contradictory: `access.ts:34` and 0091's header say "the waitlist is the retention team's"; DECISIONS 4036 says the network session "owns invitations and the referral-ordered waitlist"; the idea-box entry (DECISIONS 3879) says of the minimal list "The network session was told and owns nothing here". No remote branch touches it. A second recorded condition sits beside it: "sign-up stays invite-only until spend ceilings and reporting land" (same entry).

**Impact.** One new account in 14 days. Every loop in NETWORK §5 ends at this door: a visitor from a page, a card or a shared post who taps "Start your own" signs in and is told they are not on the list. Attribution is never recorded for them (it is written at profile creation, which they never reach). The landing page's idea box, called "the most important hook we have" (docs/IDEA_BOX.md:5), ends in the same refusal.

**Fix, in three steps.**
1. *Today, no deploy.* Read the list and admit by hand. `select email, created_at, idea_draft_id is not null as has_card from waitlist_entries where admitted_at is null order by created_at;` then, per person, `insert into account_admissions (user_id, how) select id, 'open' from auth.users where lower(email) = lower('<address>') on conflict (user_id) do nothing;` and `update waitlist_entries set admitted_at = now() where email = lower('<address>');`. The api admits them on their next request (`decideAdmission` step 3). Write this into DEPLOY.md §4 as the operator's procedure; today the documented procedure is editing an environment variable on three services.
2. *The waitlist as decided* (one pull request; migration 0108 or the next free number).
   - `waitlist_entries`: add `code text unique` (their own share code), `referred_by_entry_id uuid null`, `via_kind text null`, `via_ref text null`, `notified_at timestamptz null`. `account_admissions.how`: add `'waitlist'` to the check.
   - `packages/shared/src/via.ts`: a letter for a waitlist code (`w.<code>`), added to `VIA_KINDS` only (not `ATTRIBUTION_VIA_KINDS`).
   - `waitlist.join` (`apps/api/src/routers/idea-box.ts:49`): take the `fm_via` value the Server Action reads (`apps/web/components/shell/waitlist-actions.ts`), resolve it as `recordSignupAttribution` does, store it; `waitlist.status`: return `{ joined, cardKept, place, shareUrl }`.
   - Admission: an orchestrator schedule (`apps/orchestrator/src/schedules.ts`; the api must not run a timer, `access.ts` file comment) that once a day admits the first `WAITLIST_ADMIT_PER_DAY` entries ordered by people they brought, then by `created_at`; it writes `account_admissions (how 'waitlist')` and `admitted_at` in one transaction under `repos.admissions.lockOpenCount`, then asks the gateway to send "You're in" on the address path (`ADDRESS_EMAIL_KINDS`, `apps/gateway/src/notify-address-email.ts`, its own share of the ceiling) and stamps `notified_at`.
   - Words: `ON_WAITLIST_WORDS.body` becomes `ON_WAITLIST_EMAIL_PROMISE` in this same change, as `packages/shared/src/allowlist.ts:101-105` instructs; `NotInvitedPage` shows the place and the link to share.
   - Tests: api `waitlist.test.ts` (join with and without a reference, a self-reference ignored, order, admitted once, a second run admits nobody twice); db RLS for the new columns (service only); gateway address-email kind; orchestrator schedule; Playwright `waitlist.spec.ts` on a stack started with `SIGNUP_ALLOWLIST` naming someone else (today no e2e stack runs invite-only, section 6).
3. *Open sign-up.* The two conditions: Supabase Auth's own bot check (Turnstile is already the project's vendor, `TURNSTILE_SECRET_KEY`) with `captchaToken` passed in `signInWithOtp` and the Google start (`LoginForm.tsx:71`), since a check only on our page does not protect Supabase's endpoint; and a per-domain count inside `decideAndApply` (`access.ts:201-232`) under the existing advisory lock (`SIGNUP_PER_DOMAIN_PER_DAY`, plus-tags and Gmail dots normalized before counting). Then `SIGNUP_OPEN=1` on api, stream and collab with a small `SIGNUP_DAILY_CEILING`. With the open mode on, step 2's schedule simply admits within the same ceiling.
   Decision needed from the founder first: whether "spend ceilings and reporting" (the idea-box entry's condition) is met by the credits gate and per-account ceilings that exist, or is still a blocker.

### A9-P0-2. On a phone the path ends immediately after sign-in

**Evidence.** The target user "lives on a phone" (NETWORK §2). `/login` works at 390 px; the next screen for a new person is `/onboarding`, a `StudioFrame` without `smallScreen` (`OnboardingScreen.tsx:307`), so it renders `NeedsLargerWindow`, which has no link and no way to continue (`NeedsLargerWindow.tsx:31-34`). The same holds for the landing page's own flow (idea box card, sign in, "Keep this card", then the profile questions, docs/IDEA_BOX.md:17,90), for `/home`'s main action "Start something" (`PersonHome.tsx`, to `/new`), for Today's "Your project's public page is ready to check" (`TodayScreen.tsx:230`, to a department tab) and for "A post is ready to share" (`TodayScreen.tsx:231`). CLAUDE.md: "never leave a small screen at a dead end ... says so kindly with a way to continue later"; THESIS 2.1 lists "profile, the doors" among the small-screen routes and asks for "email me the link".

**Impact.** A person on a phone can read public pages, sign in, and then do nothing: no profile, no project, no page, no share. The first real outcome (a page live) cannot be reached or shown from the device this user owns.

**Fix.**
1. *A short profile that works at 390 px.* The api needs only a name and the confirmation to create a profile (`FounderProfileInput`, `packages/db/src/repos/founders.ts:14-35`: only `displayName` is required; `confirmAdult: true` on create). Make the first pass of `OnboardingForm` exactly that (name, "I am 18 or older") in `StudioFrame smallScreen`, add `/onboarding` to `SMALL_SCREEN_PREFIXES` (`DesktopOnly.tsx:29`), and move experience, time and residence to the optional section and to Settings. This is also the first third of package 2.3.
2. *A way on from every desktop-only screen.* `NeedsLargerWindow` gains two controls: "Email me a link to this page" (a new api procedure that asks the one sender for an address-path email carrying the current path; rate-limited per person) and "Back to Today" or "Back to home". Story at 390 px; unit test; `phone-today.spec.ts` asserts no route reachable from Today or `/home` at 390 px ends without one of the two.
3. *Publish from the phone.* Add a third option to the page-ready note, "Publish it as drafted" (`PAGE_READY_NOTE`, `packages/shared/src/project-page.ts:261`; decided in `apps/api/src/services/pages.ts:280`), which calls `publishPage` with the saved draft as the founder's own press in Needs you (it already requires an owner or an admin with Product write). The note's body shows the pitch and the address. Test: api `pages.test.ts` (the option publishes once, a member is refused), `phone-today.spec.ts` (publish at 390 px, then the page opens).
4. *Share from the phone.* After "Page live" or "First follower", Today shows one line with "Share" that opens the existing `SharePost` panel (`packages/dugout/src/components/share/SharePost.tsx`) in place, in a sheet at 390 px, instead of linking to Milestones or Creative. On a device with `navigator.share`, offer the system sheet first (NETWORK F3: "One tap opens the phone's share sheet").
5. The doors (`/new`, ideation, commit) at 390 px are the rest of package 2.1 and are larger; they belong with 2.6 (shrink Commit). Until then item 2 covers them.

### A9-P0-3. No real project has a public page, so nothing built in wave 1 can run

**Evidence.** `project_pages` is empty in production. A page is drafted only inside `businessFoundations` at commit (`apps/orchestrator/src/workflows/businessFoundations.ts:94`) or saved by hand in a desktop tab. All 13 real projects predate the feature. `today.get().pageReady` is true only when a draft is waiting, so nothing prompts an existing project. The mark, the story, cards, the share panel, the Follow form, the first-follower milestone, the team's post drafts, post attribution, the quiz and `via=p.<slug>` all need a published page.

**Impact.** The spread engine (#93 and five follow-ups) has zero surface area. The measured production state says nothing about whether it works.

**Fix.** A catch-up, run once and then kept as a standing rule: for every committed, open, non-sample project with no `project_pages` row, start the existing drafting step (`draftProjectPage`, `apps/orchestrator/src/activities/foundations.ts:197`; confirm it writes nothing when a row exists) so the draft and the page-ready note are written through the outbox. It costs one small model call per project on the `projectPage` route (Estimate: about one cent each, PROGRESS 1941's figures) and passes the credits gate like any call. Put it in the orchestrator as a schedule over businesses with no row rather than a script, so a project imported or created by another path later is caught too. With P0-2 item 3 the founder can publish from the email's link on a phone. Tests: orchestrator workflow test (no row, then a draft and one note; an existing row, nothing), api `today.test.ts` (`pageReady`), never for a sample or an archived project.

### A9-P0-4. Nothing reaches a founder or a person who went quiet

**Evidence.** Eleven of 13 real projects were never opened after their first day. The return loop is aimed at fresh events: a waiting decision is emailed once and never if the note is older than 7 days (`notify-email.ts:21`); a win, milestone or finished run only within 24 hours (`founder-notifications.ts:26`); the brief only with news (`morning-brief.ts:391`). Every real project is older than the notifier (Nov 12). The Overnight shift is a default at Commit, so projects committed before it have no nightly work and so no news. No kind exists for "you have not been back". A person with no project gets nothing, ever: recipients are read per business (`activities/notify.ts`), and `founder_notifications.business_id` is `not null`. Whether the sender is live at all is not recorded (1.5); if the domain is set while SendGrid is mock, every email for a real project is written off as `simulated` and never retried (`notify-email.ts:198`, `activities/notify.ts:22`). Push has no devices. Vacation is not read by either notifier (no reference to it in `notify/rules.ts`, `activities/notify.ts`, `notify-email.ts` beyond the streak, or `services/push/`).

**Impact.** The north star counts projects with a real outcome each week. Nothing the product does can bring one of the 11 back.

**Fix.**
1. *Find out what production sends.* Run the query in 1.5. Check on Railway: gateway `PLATFORM_MAIL_DOMAIN`, `SENDGRID_API_KEY`, `LIVE_CONNECTORS` containing `sendgrid`, https `APP_URL` and `INGEST_PUBLIC_URL`, `REDIS_URL`; api `PLATFORM_MAIL_DOMAIN` and `NOTIFY_EMAIL`. DEPLOY.md §5.7 steps 1 to 6 are the setup. Record the result in a "what is switched on in production" table in DEPLOY.md (the status table there is from Oct 8 and does not cover any switch added in November).
2. *Stop losing email silently.* Add `simulated` to `RETRY_REASONS` (`apps/orchestrator/src/activities/notify.ts:22`) and log one warning per sweep when it is the answer for a non-sample project. Test in `notify-sweep`.
3. *A quiet-project email* (kind `project_quiet`): planned by `notify/rules.ts` when the person has not opened the project for 3, 7 and 14 days (three emails, then never again for that silence), and only when there is one true next step to name: a decision waiting (any age), the page ready to publish, credits used up, or the team stopped (the reasons in `packages/shared/src/loop-stops.ts`). It carries the one-click answer when the rule allows one. Outside the three-a-day count, like the briefs, with its own switch. Touches `EMAIL_NOTIFICATION_KINDS` and the defaults (`constants.ts:621-624`), the `founder_notifications.kind` check (a migration; 0091 and 0097 extended it the same way), `retentionEmail` words (`packages/shared/src/notify-words.ts`), the gateway's plan (`notify-email.ts`, `retentionPlanOf`), the Preferences section. Tests: `notify-rules` (stages, stops after three, nothing without a next step, nothing on vacation), gateway `notify-email`, `return-loop.spec.ts`.
4. *A person with no project.* One email a day after the profile is created with no project ("one line is enough to start", or "your card is kept" when `ideaBox.preview` finds one), one at day 7. Needs the record to allow a null business: make `founder_notifications.business_id` nullable with a check per kind and keep its row policy (the person's own rows). The sweep then also walks accounts with a profile and no membership.
5. *Vacation.* `planNotifications` and the push notifier skip a person whose project is on vacation, except safety notices.
6. *Order.* Run P0-3's catch-up before item 3 ships, so the first quiet-project email to each of the 11 names a page that is ready.

### A9-P1-1. The waitlist tells people they will be emailed; nothing sends one

**Evidence.** `NotInvitedPage.tsx:38`: "You are on the waitlist. We will email you when there is room." The decision of the same day (DECISIONS 4199, last bullets) is that the line "promises no email until the waitlist that sends it exists", and `ON_WAITLIST_WORDS` follows it; this second string was missed.
**Impact.** A promise to a stranger at the first moment of contact, not kept.
**Fix.** Use `ON_WAITLIST_WORDS.body` here until P0-1 step 2 ships; assert the words in `apps/web/components/shell/__tests__/api-error-page.test.tsx`. Three lines.

### A9-P1-2. An invited friend with a new account is sent to the old founder form, then to "start your own"

**Evidence.** 1.1, "What an invited person sees": `apps/web/app/b/[bid]/layout.tsx:67` redirects to `/onboarding`; the form is desktop-only and asks experience, time and residence; its save ends at `/new` (`OnboardingScreen.tsx:179-186`).
**Impact.** NETWORK calls invitations "the strongest conversion of any loop" and says the invitation "lands them in the project". On a phone the friend lands on "This needs a larger window" immediately after accepting. On a desktop they land in the idea studio.
**Fix.** Ask "What should we call you?" on the invitation card when the account has no profile, and after `invitation.accept` succeeds call `founder.profile.update({ displayName, confirmAdult: true })` before pushing to Today (`InvitationScreen.tsx`; `onPersonCreated` then records the invitation's attribution, `apps/api/src/services/person-created.ts`). As a second guard, give `/onboarding` a `next` parameter (clamped by the existing `next` rules in `apps/web/lib/auth/redirects.ts`) that the business layout sets and the save honors. Tests: `invitations.spec.ts` "a second account signs in, accepts, and is taken into the project" must end on `/b/<id>/today` at 390 px with no detour; unit test for the card's name field.

### A9-P1-3. The people layer is still the pre-thesis network behind a closed flag, with two identities for one person

**Evidence.** 1.2: `FLAGS.liveMode = false`; reaching out needs a Live business; search reads the old view; a person who published `/u/<handle>` is not found by Network search; `VisibilityPanel` and `/public-profile` are two switches. With the layer open, `/home` says "Join someone's project, or meet people to build yours with" (`PersonHome.tsx`), and neither is possible: there are no projects to browse, no request to join, and a person with no project cannot send a connection request.
**Impact.** NETWORK's "three kinds of member, all full members from the first minute" does not hold for the joiner. Package 2.5 is a precondition of wave 2 and has not started.
**Fix.** Package 2.5 as its own change, in this order: (a) one identity: `live.people.search`, `live.people.profile` and `repos.social.lookupPeople` read `public_person_profiles` and `public_project_pages`; `VisibilityPanel` is replaced by the state of `/public-profile`; the old view stays only for existing connections' names. (b) The copy on `/home` says only what is true. (c) `connections.request` for a person without a business is F17 and must wait for its own security review and for A9-P1-6. (d) Only then set `LIVE_MODE=1`, and later remove the flag. Add the link to `/public-profile` on `/home` and in `PersonLiveFrame` in the same change (today a person with no project has none).

### A9-P1-4. Wave 1's two loops that need nobody but a solo founder are not built and not owned: feedback links (F4) and credit for bringing people (F6)

**Evidence.** 2.1 and 2.2. No route, table, event or branch for either.
**Impact.** NETWORK §5 rests growth on L1, L2 and L3 because they need no second person. L2 (the feedback link) is named "the widest way in"; its return message is called "the single best re-engagement of an outsider the product has". Neither exists.
**Fix (F4).** Tables `feedback_links` and `feedback_responses` (business-scoped, RLS, cross-tenant test, export); public procedures beside `publicPage` (`publicFeedback.byId`, `publicFeedback.answer`, with Turnstile through the gateway and per-caller limits as the Follow form has, `apps/api/src/services/pages.ts`); route `/f/[id]` added to `PUBLIC_PREFIXES` (`apps/web/lib/auth/redirects.ts:26`) and `SMALL_SCREEN_PREFIXES`; a `via` letter; events `feedback.requested`, `feedback.answered`, `feedback.acted_on`; one summary note in Needs you; answers stored as untrusted content and shown in Customers; a guard and a test that an answer never counts as a real outcome (the brief's "What worked", `packages/db/src/brief-facts.ts`); the Chief of Staff's "ask five people" task offers the link. **Fix (F6).** Needs measured cost first (package 7.1, outside this area); until then record only, as today.

### A9-P1-5. Share and "show on your page" live only on desktop screens, and the story needs a manual step first

**Evidence.** Share is on Plan › Milestones, Product › Public page and Customers › Creative (PROGRESS 1908), none of which works below 1280 px. A milestone appears on the story or as a card only after an owner presses "Show on your page" in Milestones (`journey.showMilestone`), so the mark's "See how it was made" link exists only for founders who found that button.
**Impact.** The "minutes" hook in NETWORK §6 (the team finishes something real, the founder taps Share) cannot happen where the founder is.
**Fix.** A9-P0-2 item 4, plus: when "Page live" or "First follower" is recorded, the milestone's note in Needs you offers "Show it on your page" as its recommended option (reversible, free, internal: it also qualifies for the one-click answer by email). Tests: `milestones-show` api test for the note's option; `phone-today.spec.ts`.

### A9-P1-6. Safety for meeting strangers is mostly unbuilt (only 18 or older was added since the thesis), and the product has no operator surface at all

**Evidence.** Only a post can be reported (`live.ts:458`); there is no report of a person, profile or message, no platform queue, and no role above a project's owner anywhere in the api (`adminProcedure` is per business, `apps/api/src/trpc.ts:401`). `takeLive` counts in process memory (`apps/api/src/services/live.ts:58-64`) beside the shared-store limits.
**Impact.** NETWORK orders F21 first in wave 3 and says nothing after it reaches strangers without it. The same missing operator surface is why the waitlist cannot be read or drained and why a report would have nowhere to go.
**Fix.** Build the smallest operator surface once and use it three times: a `platformProcedure` gated on an environment list of operator account ids (never a database role a client could reach), with a desktop-only `/operator` area for (1) the waitlist, (2) reports, (3) the production switches read back from the services. Then `reports` (platform-scoped, service role only), `live.report` for a person, profile and message, a response-time target shown in the queue, and `takeLive` moved to `ctx.limits`. F17 keeps its separate security review.

### A9-P1-7. The mobile prompt pack no longer matches main, and its latest corrections are stranded on a branch

**Evidence.** `docs/mobile/skills/foundmill-backend/SKILL.md` on main has no mention of `invitation.*`, `founder.adult.*` or `adult_unconfirmed`, `on_waitlist`, `publicPage.storyBySlug|cardById`, `publicPerson.byHandle`, `share.opened`, `today.sinceLastVisit` or `founder.presence.ping` (grep counts: 0 each). BACKEND_CHANGES.md §9 still says the role enum "stays `owner | admin | member | viewer | advisor` until 3.3", which merged on Nov 14. `founder.profile.update` now refuses to create a profile without `confirmAdult: true` (#127), so an app built from prompt 14 as written fails at its first save. Branch `claude/zealous-rubin-8q52gr` holds 11 unmerged commits (Nov 11 to Nov 12 20:14) with the retention shapes, the four-procedures-per-batch rule, the Google rule and the start-flow shapes; it also carries a user-facing wording fix main lacks (`packages/shared/src/autopilot.ts`: "New rounds of work start on their own", main still says "New cycles").
**Impact.** THESIS 5.5 makes the native app the phone's home. The pack is the only specification Newly gets.
**Fix.** The mobile session rebases and merges its branch (outside `docs/` it changes four files by one line each: a string in `packages/shared/src/autopilot.ts` and the three tests that quote it), then adds the missing shapes. Add a contract test so it cannot rot unnoticed: `apps/api/src/__tests__/mobile-contract.test.ts` reads every backticked `a.b.c` procedure name in the skill and asserts it exists on the app router; and a line in the `ship-change` skill: a change to a procedure the skill names updates the skill in the same pull request (BACKEND_CHANGES §11 already says so).

### A9-P2-1. The hand-over to the native app is not "one change"

**Evidence.** CLAUDE.md: "through one config value for the store links (unset until launch). Build the small-screen web so that switch is one change." No such value exists (grep for store links in apps/web, packages/config, packages/shared, packages/dugout: none). `apps/web/public/.well-known/` does not exist, so no universal links (BACKEND_CHANGES §5: "needed now: founder email will carry links and one-click answers").
**Fix.** `STORE_LINKS` in `packages/config` (`{ ios, android } | null`, from one public env value), a Dugout `GetTheApp` prompt rendered by the public pages when set, and one branch in `DesktopOnly` and the phone shell that sends a signed-in small screen to it. The two `.well-known` files once the bundle id and team id exist. Tests with the value set and unset.

### A9-P2-2. Attribution is written only when a founder profile is created

**Evidence.** `apps/api/src/services/person-created.ts`; `via` is not read by `waitlist.join`; the native app must pass it itself (PROGRESS 1892). With the profile moving later (2.3) and the door shut, most first touches are lost.
**Fix.** Record the first touch at the first signed-in request that has the cookie (the waitlist join, the invitation accept, the profile save, whichever comes first) through the same `recordSignupAttribution`; keep "once per account".

### A9-P2-3. In invite-only production only a listed founder's invitation admits anyone

**Evidence.** `inviterStanding` (`access.ts:275-283`): `trusted` needs the list or an `existing` admission, and `existing` rows are written only in open mode (`access.ts:216-225`). An account let in by an invitation can never let a new account in. Three per inviter per day.
**Impact.** Correct as designed (it bounds spend), but the invitation loop is one hop deep while the door is shut, and the invitee is told "This invitation can't let a new account into Foundmill by itself" with no next step.
**Fix.** That refusal offers the waitlist (it already holds the inviter's reference for ordering). No change to the rule.

### A9-P2-4. A collaborator invitation is not a trial

**Evidence.** `invitationMembership` sets no end date (`people.ts:39-41`); the role sentence says "Works with you on Product and Customers" with no time box; NETWORK F5 and F18 call it "a collaborator on a trial".
**Fix.** Until 3.5 is built, keep the words as they are (they are true). When 3.5 starts, `trials` carries the brief and the membership's `expires_at` is set at accept.

### A9-P3. Smaller points

- **P3-1.** The email notifier and the push notifier use two vocabularies (`NOTIFICATION_KINDS` and `EMAIL_NOTIFICATION_KINDS`, `constants.ts:610,621`); DECISIONS 3711 lists folding them as a follow-up. Do it before adding people kinds.
- **P3-2.** `apps/stream` and `apps/collab` admit by address without the confirmed-address rule (PROGRESS 2001, "Recorded, not fixed"). Outside this area's fix list but on the same door.
- **P3-3.** `docs/ARCHITECTURE.md` §16 item 7 still says small screens are "not built yet".
- **P3-4.** DEPLOY.md's status table (§6) is dated Oct 8 and has no rows for `SIGNUP_ALLOWLIST`, `LIVE_MODE`, `PLATFORM_MAIL_DOMAIN`, `NEXT_PUBLIC_AUTH_GOOGLE`, `TURNSTILE_SECRET_KEY` or the Supabase `config push`. A planner cannot tell from the repo what production has on.

---

## 4. In-flight branches and ownership map

### 4.1 Who owns what (from docs/DECISIONS.md and the files' own headers)

| Session (its branches) | Owns | Source |
| --- | --- | --- |
| Network (`claude/bold-johnson-hjxopx` #93, `claude/waitlist-invitations` #120, `claude/founder-notices` #124) | docs/NETWORK.md and its four waves; invitations (3.1); "the referral-ordered waitlist (the waitlist half of 2.2)"; the people roles; attribution; the mark, story, cards, tap-to-post; message requests (F17, with their own security review) | DECISIONS 4036-4050 |
| Roadmap (`claude/vibrant-euler-uua9pw` #79, then #82, #94, #99, #102, #112) | Phases 0 to 2 of THESIS_REVIEW: Google sign-in, small screens (2.1), the home for a person (2.4), the person profile (2.3); the sign-up and access code until #82 merged | DECISIONS 4042; THESIS_REVIEW.md:417 |
| Retention (#84, #98) | The one sender (`POST /v1/notify/email`, `EMAIL_NOTIFICATION_KINDS`, the one preference map), `founder_notifications`, presence, the streak, the idea box and its minimal waitlist; by `access.ts:34` also "joining the waitlist and the email when there is a place" | DECISIONS 3711, 3738, 3879; `access.ts:34` |
| Mobile (`claude/zealous-rubin-8q52gr`) | Everything under `docs/mobile/`; other sessions send it new shapes rather than editing the pack | DECISIONS 4046 |
| Alignment, also called the coordinating session | Merge order and migration numbers; relays the founder's answers between sessions | DECISIONS 4064; commit messages "the coordinator's final order" |
| "tips" (`claude/tips-*`, #108 to #142) | The audit's numbered items: the morning brief (item 10), 18 or older (#127), Follow form bot check (#119), post attribution (item 8), showcase videos (item 15), the quiz, credits routing, security fixes, CI | PROGRESS 1975-2191 |
| Connectors (`connectors-byo-key`, `connectors-byo-key-2`, `connectors-buffer`) | Connectors on the founder's own key, Buffer; shares `packages/shared/src/post-draft.ts` with the network session | PROGRESS 1908 |
| Team call (#81, #83, #88) | `/calls`, the word "call" | docs/TEAM_CALL.md |

**The waitlist has two owners on paper and none in practice** (A9-P0-1). A new plan should name one before any code.

### 4.2 Files and numbers a new plan must not touch without coordination

- **Migrations.** Main ends at `0107_collaborator_finance_fields`. No remote branch adds a later one. The next free number is 0108, final only at the rebase before merge, with a journal `when` strictly later than the last applied (DECISIONS 4064: the migrator skips an entry older than the last one applied). `fm_account_event_types()` is redefined by each migration that adds an account event (0088, 0097): a new account event needs the same, and the test that holds it equal to `ACCOUNT_EVENT_TYPES` (`packages/shared/src/constants.ts:532`).
- **The door.** `apps/api/src/auth.ts`, `apps/api/src/services/access.ts`, `apps/web/app/login/**`, `apps/web/lib/auth/redirects.ts`, `packages/shared/src/allowlist.ts`. Roadmap session by the Nov 12 split; the network session since #120. Agree before editing.
- **The two "one place" files.** `apps/web/lib/auth/start-destination.ts` (each session adds one branch, never edits the page) and `apps/api/src/services/person-created.ts` (each session adds one step).
- **The one sender.** `apps/gateway/src/notify-email.ts`, `notify-address-email.ts`, `notify-founder-notice.ts`, `packages/shared/src/constants.ts:610-650` (the kinds), `packages/shared/src/notify-email.ts`, `notify-words.ts`, the `founder_notifications.kind` check. A new kind goes through the retention session's lists; no second channel (DECISIONS 4047).
- **`docs/mobile/**`.** The mobile session's. Send shapes; do not edit.
- **The small-screen list.** `apps/web/components/providers/DesktopOnly.tsx:29-61`. One list; append, and add the route's Playwright check at 390 px in the same change.
- **Words that are taken.** "Call" and `/calls` (Team call); "Live sessions" (agents' sessions); `live` in identifiers means the old network mode.
- **Files the in-flight branch below changes** (rebase after it merges, or agree first): `packages/dugout/src/components/public/{ProjectFollowForm,PersonPage,MilestoneCard,ProjectPage,ProjectStory,LegalPage}.tsx`, `packages/dugout/src/components/shell/{AppShell,PhoneBar,Panel,KitBar}.tsx`, `packages/dugout/src/dugout.css`, `apps/web/components/shell/BrandFrame.tsx`, `apps/web/content/legal/privacy.ts`, `packages/shared/src/project-page.ts`, `apps/web/e2e/public-page.spec.ts`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`.
- **The Supabase Data API stays off** (DEPLOY.md:149). Collaborator walls and admission rest on it. A plan must not propose reading tables from the browser.

### 4.3 Remote branches updated since Nov 10

State is against `origin/main` at `04a0a509`. "Merged as #N" means its content is on main (squash or merge); such branches are stale and safe to ignore. Only three hold work that is not on main.

| Last commit | Branch | Purpose | State |
| --- | --- | --- | --- |
| Nov 15 11:04 | `claude/blissful-fermat-q03yq1` | A privacy notice for project followers linked from the Follow form; axe accessibility checks in CI over every story and the main pages; landmark and heading fixes | **In flight: 1 commit, not merged.** 39 files, listed in 4.2 plus `apps/web/e2e/{accessibility.spec.ts,axe.ts}`, `packages/dugout/a11y/**`, `packages/dugout/.storybook/*`, docs |
| Nov 15 | `claude/date-params-followup` | Date parameters in raw SQL, review notes | Merged as #137 |
| Nov 15 | `claude/tips-zod-limits` | Every api list bounded before validation | Merged as #142 |
| Nov 14 | `claude/tips-final-docs` | Folded every PR's doc entries into the docs; per-package CLAUDE.md | Merged as #136 |
| Nov 14 | `claude/tips-ci-scanning`, `claude/tips-ci-timing` | Secret and dependency scans in CI; four flaky tests | Merged as #138, #135 |
| Nov 14 | `claude/entity-profile-main-fix`, `claude/tips-inbox-initials` | e2e fixes that turned main green | Merged as #140, #141 |
| Nov 14 | `claude/tips-zod-dos`, `claude/tips-next-security` | Security fixes (zod memory, Next.js, dompurify) | Merged as #139, #133 |
| Nov 14 | `claude/collaborator-finance-fields`, `claude/events-collaborator-walls` | A collaborator reads no Finance figure (0107) and only their sections' events (0099) | Merged as #132, #131 |
| Nov 14 | `claude/date-params` | A Date in a raw SQL template | Merged as #134 |
| Nov 14 | `claude/tips-adult-at-signup` | 18 or older once at sign-up (0100) | Merged as #127 |
| Nov 14 | `claude/tips-mail-address`, `claude/tips-draft-media`, `claude/tips-showcase-videos`, `claude/tips-credits-routing`, `claude/tips-project-quiz`, `claude/tips-post-attribution` | Postal address in marketing email (0101); post media kits (0102); showcase videos (0103); credits routing and funding source (0104); the page quiz (0105); post-to-outcome attribution (0106) | Merged as #111, #125, #130, #118, #122, #128 |
| Nov 14 | `claude/tips-linear-address-scan` | Linear scan of untrusted content | Merged as #129 |
| Nov 14 | `claude/brave-allen-52yii5` | Bought credits as lots (0098) | Merged as #106 |
| Nov 14 | `connectors-buffer` | Buffer on the founder's own key | Merged as #126 |
| Nov 14 09:01 | `claude/founder-notices` | Founder notices and the former founder's cancel (0097) | Merged as #124. No commit since |
| Nov 14 | `claude/tips-design-check`, `claude/tips-media-connectors`, `claude/tips-follow-turnstile` | Design check on agent-built UI; Runway and ElevenLabs voice connectors; Follow form bot check | Merged as #114, #109, #119 |
| Nov 13 | `claude/post-drafts-flake` | Work that outlives its request runs on the database | Merged as #123 |
| Nov 13 22:16 | `claude/waitlist-invitations` | Invitations, admission, the people roles (0091 to 0096) | Merged as #120. No commit since. Despite its name it holds no waitlist work |
| Nov 13 | `claude/tips-reask-followup`, `claude/tips-second-read`, `claude/tips-security-fixes`, `claude/tips-outcome-brief`, `claude/tips-dmca` | Entity-link fallback; the second read; the Nov 13 audit fixes; the morning brief; copyright complaints | Merged as #121, #117, #116, #112, #108 |
| Nov 13 | `claude/vibrant-euler-uua9pw` | The roadmap session's branch | At a commit that is on main |
| Nov 13 18:06 | `claude/bold-johnson-hjxopx` | Network wave 1 | Merged as #93 |
| Nov 13 | `claude/affectionate-tesla-iaarqx` | Page dates recorded by the database (0090) | Merged inside #93 |
| Nov 13 | `claude/role-grant-hotfix`, `claude/definer-grants` | Nobody grants access they lack; client grants (0087) | Merged as #113, #101 |
| Nov 13 | `claude/inspiring-maxwell-nc321v`, `claude/vigilant-pascal-44x098`, `claude/loving-clarke-m5v5by`, `claude/youthful-volta-05ibse` | Claude Code workflow skills; landing less dense; idea box button; e2e tap-target helper | Merged as #107, #105, #104, #100 |
| Nov 13 15:33 | `claude/beautiful-bohr-7r9npy` | api: in-process drafting outlives the request that started it | **Not merged as written** (1 commit, 9 files: `apps/api/src/services/{tx-gate,foundations,personas,product-research}.ts`, `routers/business.ts`, two tests, docs). #123 fixed the same problem another way; treat as superseded, confirm with its owner |
| Nov 13 | `claude/account-relay-on`, `connectors-byo-key-2`, `connectors-byo-key` | The account relay back on; connectors on the founder's key | Merged as #96, #89, #85 |
| Nov 12 20:14 | `claude/zealous-rubin-8q52gr` | The mobile session: the pack follows the retention work, the Google rule, a batch cap, the start flow's shapes; "rounds of work" wording | **Not merged: 11 commits.** Files: `docs/mobile/{BACKEND_CHANGES,PROMPTS}.md`, `docs/mobile/skills/foundmill-backend/SKILL.md`, `packages/shared/src/autopilot.ts`, `apps/api/src/__tests__/cycle.test.ts`, `apps/web/components/shell/__tests__/business-shell.test.ts`, `apps/web/e2e/home.spec.ts`, docs |
| Nov 12 | `claude/event-scope-tests`, `claude/account-relay-off`, `claude/account-events`, `claude/relaxed-fermi-oip5am` | Event scope tests; the relay hotfix; the person-level event store (0085); sample marker | Merged as #92, #91, #86, #80 |
| Nov 12 | `claude/busy-lovelace-nbx2p6` | Two doc lines recording the Team call hold fix | Docs only; merged as #90 by PROGRESS 1785 (not compared line by line) |
| Nov 9 | `claude/eager-davinci-9knr1l` | Phase 3 for first-time founders | Merged (#72 and the parts after it, through #74) |

Older `agent/<uuid>` branches (Oct 30 to Nov 6) are code saved by the product's own agents for Foundmill's own project, not session work.

**What nobody is building, as of this fetch:** the waitlist and open sign-up (P0-1); the phone path after sign-in (P0-2); the page catch-up (P0-3); any win-back (P0-4); feedback links and credit for bringing people (wave 1 items 4 and 6); package 2.5; every item of waves 2, 3 and 4; the store-links value. The caller named `claude/waitlist-invitations` and `claude/founder-notices` as in flight; in the refs I have they are merged and idle since Nov 13 and 14. If those sessions have unpushed work, it is invisible here: fetch before planning.

---

## 5. Interfaces a planner must know

### 5.1 Access and admission

| Thing | Value |
| --- | --- |
| Env, api | `SIGNUP_ALLOWLIST` (addresses and `@domains`, comma-separated), `SIGNUP_OPEN` (1/true/yes/on), `SIGNUP_DAILY_CEILING` (default 200), `SIGNUP_EXISTING_BEFORE` (ISO time; else `admission_existing_before()` from 0093), `SUPABASE_ANON_KEY` (to read "Confirm email"), `DEV_AUTH_USER_ID` (development and test only) (`packages/shared/src/env.ts:217-233`) |
| Env, stream and collab | The same `SIGNUP_ALLOWLIST` and `SIGNUP_OPEN`; they read `account_admissions` (`liveChannelAdmit`, `allowlist.ts:80-92`) |
| Env, web | `NEXT_PUBLIC_AUTH_GOOGLE=on` |
| Refusal codes | `not_invited` (details.reason `not_listed` or `email_unconfirmed`), `on_waitlist` (reason `ceiling`), `adult_unconfirmed`, `invitation_unavailable`, `invitation_other_address`, `invitation_cannot_admit` (403), `invitation_admissions_limit` (429) |
| Procedures | `protectedProcedure` (admitted), `signedInProcedure` (signed in, confirmed address, admission not required: `invitation.accept`, `founder.adult.get|confirm`), `confirmedProcedure` (local to `idea-box.ts`: `waitlist.join|status`) |
| Tables | `account_admissions (user_id unique, how invitation|open|existing, invitation_id)` service role only; `waitlist_entries (user_id unique null, email unique, idea_draft_id, admitted_at)` service role only; `adult_confirmations (user_id unique, confirmed_at)` own row |
| Limits | 3 new accounts per inviter per UTC day; 50 a day past the ceiling for trusted inviters together (`access.ts:253,258`) |
| Web | `ApiErrorPage` picks `OnWaitlistPage`, `NotInvitedPage` or `UnreachablePage`; `lib/trpc.ts:229,245` (`isNotInvited`, `isOnWaitlist`) |

### 5.2 Invitations and people

| Thing | Value |
| --- | --- |
| Procedures | `invitation.create|list|revoke` (`sectionAdmin("team")`), `invitation.byToken` and `invitation.decline` (public, rate-limited), `invitation.accept({ token, confirmAdult? })` → `{ businessId, ... }`; `team.humans.list|role|remove` (`apps/api/src/routers/team.ts:259-333`); `founder.formerProjects.list|cancel` |
| Tables | `invitations (business_id, token_hash, role cofounder|collaborator, invited_by_user_id, email, state pending|accepted|declined|revoked|expired, expires_at)`; `memberships.role` adds `cofounder`, `collaborator`; `memberships.expires_at` (collaborator only); `founder_departures`, `founder_cancel_links` (0097); `inbox_items.for_user_id` (0103) |
| SQL helpers | `is_member`, `has_role` (a cofounder counts as owner, a collaborator as member, an ended row as nothing), `is_member_not_collaborator`, `lock_my_membership`, `fm_collaborator_event_types()` |
| Shared | `packages/shared/src/people.ts` (`INVITATION_ROLES`, `INVITATION_TTL_MS` 14 days, `invitationMembership`, `mayMakeInvitation`), `permissions.ts` (`COLLABORATOR_SECTIONS`, `hasSectionAccess`), `people-email.ts`, `founder-notices.ts` |
| Events | `invitation.sent`, `invitation.accepted`, `invitation.declined`, `membership.changed` (business); `founder_notice.sent` (account) |
| Routes | `/i/[token]` (public, 390 px, never indexed); Settings › People (`MembersTab.tsx`); Team › People (tab slug `staff`) |
| Rule | Whoever changes a role or sections goes through `assertWithinGrantorAccess` (`apps/api/src/services/grants.ts`) inside the transaction, after `lockOwners` |

### 5.3 The person

| Thing | Value |
| --- | --- |
| Procedures | `founder.profile.get` → `{ userId, profile, complete, adultConfirmed, email, memberships, businesses, features: { liveMode } }` (`founder.ts:168-175`); `founder.profile.update` (create needs `displayName` and `confirmAdult: true`; optional `via`, `ideaDraftToken`); `founder.publicProfile.get|update|publish|unpublish`; `publicPerson.byHandle` (public); `founder.adult.get|confirm` |
| Tables and views | `founder_profiles` person columns (0080); `person_handle_releases` (a left handle is held 90 days); view `public_person_profiles` (service role); old view `public_profiles` |
| Events (account) | `profile.published`, `profile.unpublished` |
| Flags | `FLAGS.liveMode` (false) and env `LIVE_MODE` open every `live.*` procedure and the Network links |
| Old network | `live.connections.list|request|respond|remove|block`, `live.messages.threads|thread|list|send|unread|leave|mute`, `live.communities.*`, `live.posts.*` (including `report`), `live.people.lookup|search|profile`, `live.profile.confirmAdult`, `live.profile.visibility.get|set`, `live.summary`; tables in `packages/db/src/schema/social.ts` |

### 5.4 Spreading and attribution

| Thing | Value |
| --- | --- |
| `via` | Param `via`, cookie `fm_via` (httpOnly, first touch, 30 days), cookie `fm_post` (last shared-post code, 7 days); kinds `p.<slug>`, `u.<handle>`, `s.<code>`; `parseVia`, `formatVia`, `withVia` (`packages/shared/src/via.ts`) |
| Tables | `attributions` (one per account, service role only, 0088); `post_links`, `post_attributions` (0106); `project_pages` (0077), `page_followers` (0079), view `public_project_pages`; view `public_project_milestones` (0089); `milestones` guard |
| Procedures | `page.get|saveDraft|setSlug|publish|unpublish`; `publicPage.bySlug|storyBySlug|cardById|follow|visited|indexNowKeyFile`; `journey.showMilestone|hideMilestone`; `share.opened`; `pageQuiz.*` |
| Events | Business: `page.published`, `page.unpublished`, `page.followed`, `milestone.shown`, `milestone.hidden`, `share.opened`, `visit.attributed`, `post.outcome_attributed`, `post.drafted`. Account: `signup.attributed`, `referral.arrived` |
| Rules | `tierShowsBuiltOnMark(tier)`; `isShowableTrophyKey` (only `page_live`, `first_follower`); `TEAM_POST_CAPS` (2 a day, 5 a week); a share press is never a post and never a real outcome |
| Routes | `/p/[slug]`, `/p/[slug]/story`, `/m/[id]`, `/m/[id]/story-image`, `/u/[handle]` |

### 5.5 Notifications

| Thing | Value |
| --- | --- |
| Gateway routes (service token) | `POST /v1/notify/email` (`{ userId, kind, businessId, data }`), the address path for `invitation`, the founder-notice path, `POST /v1/push/send` |
| Kinds | Email to an account: `EMAIL_NOTIFICATION_KINDS` (8). To an address: `ADDRESS_EMAIL_KINDS` (`invitation`). Push: `NOTIFICATION_KINDS` (7). Safety: `founder_notice` |
| Preferences | `account_preferences.notifications` (push kinds and the `email` map), `emails_paused_at`, the brief's hour and zone; `founder.email.get|update|recent`, `founder.preferences.notifications|update` |
| Record | `founder_notifications (user_id, business_id not null, kind, channel email|browser, dedupe_key unique per user, status queued|sent|skipped|failed, skip_reason, mode mock|live, action_* for the one-click answer)` |
| Env, gateway | `PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_SIGNING_SECRET`, `SENDGRID_API_KEY`, `LIVE_CONNECTORS` (must contain `sendgrid`), `APP_URL`, `INGEST_PUBLIC_URL`, `REDIS_URL`, `PLATFORM_NOTIFY_LOCAL_PART` (default `hello`), `PLATFORM_NOTIFY_DAILY_CEILING` (1,000), `PLATFORM_SAFETY_DAILY_CEILING` (5,000), `PLATFORM_SAFETY_RESERVED_DAILY_CEILING` (20,000), `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `TURNSTILE_SECRET_KEY` |
| Env, api | `PLATFORM_MAIL_DOMAIN` (starts the waiting-decision pass), `NOTIFY_EMAIL=off` stops it |
| Schedules | Orchestrator `founder-notifications`, every 5 minutes (`schedules.ts:48`); the api's pass every 5 minutes; no other timer may be added to the api |
| Not-sent answers | Retried: `off`, `unconfigured`, `present`, `per_project`, `per_person`, `ceiling`, `busy`, `store`, `vendor`. Recorded as skipped and never asked again: everything else, including `simulated`, `nothing_new`, `not_started`, `paused` |
| Web | `/a/[token]` (`email.action.*`), `/email/pause`, `/email/unsubscribe`; ingest serves the per-kind off link and "Don't send me invitations" |
| Devices | `founder_devices` (0075), `founder.devices.list|register|unregister` |

### 5.6 Rules that bind any new work here

- Anything another person wrote (answers, feedback, messages, posts) is untrusted content: quarantined reader only, never an instruction; work from it starts by a founder's tap.
- Agents never send a message between people; drafts only.
- No public counts on a person or a project; no ranking of any kind; one streak.
- A person's facts go to the account event store, never the project's.
- New table: `business_id` when project-scoped, RLS, cross-tenant test, export, in the same change. New event: declared in `packages/events` with Zod, written through the outbox.
- New agent behavior: an eval (silence for a founder who is not looking; no partner suggested from an ask; a refusal to recommend split terms; no claim from a simulated result).
- Email about people is new kinds on the one sender, inside three a day.

---

## 6. Tests and gaps

**What exists (by file; none were run for this audit).**

| Area | Tests |
| --- | --- |
| Admission | `apps/api/src/__tests__/invitations-admission.test.ts`, `people-races.test.ts` (real Postgres only, skipped on PGlite), `packages/shared/src/allowlist.test.ts` |
| Invitations and roles | `packages/db/src/__tests__/rls/invitations.test.ts`, `rls/people-roles.test.ts`, `migration-0096.test.ts`, api `grant-access.test.ts`, `team-roster.test.ts`; Playwright `invitations.spec.ts` (7, one needs its own stack with `SIGNUP_OPEN=1 SIGNUP_DAILY_CEILING=0`), `founder-notices.spec.ts` |
| Waitlist | One api case (`idea-box.test.ts:223`), RLS `idea-drafts.test.ts`, unit `api-error-page.test.tsx` |
| Person | api `person-profile.test.ts`, `person-created.test.ts`, shared `person-profile.test.ts`, Dugout `PersonPage.test.tsx`; Playwright `person-page.spec.ts`, `person-home.spec.ts`, `adult-signup.spec.ts`, `onboarding.spec.ts` |
| Spreading | api `attribution.test.ts`, `pages`, `page-follow`, `milestones-show`; RLS `attributions`, `project-pages`, `public-milestones`; Playwright `attribution.spec.ts`, `public-page.spec.ts`, `project-story.spec.ts`, `milestones.spec.ts`, `tap-to-post.spec.ts`, `post-drafts.spec.ts`, `page-quiz.spec.ts` |
| Coming back | shared `founder-return`, `streak`, `notify-words`, `morning-brief`; orchestrator `notify-rules`, `notify-sweep`; gateway `notify-email`; api `notify-email-pass`, `since-last-visit`, `streak`; Playwright `return-loop.spec.ts`, `preferences.spec.ts`, `platform-mail.spec.ts` |
| Phone | Playwright `phone-today.spec.ts`, 390 px cases inside `login`, `person-home`, `person-page`, `public-page`, `invitations`, `return-loop`; web `components/live/__tests__/SmallScreen.test.tsx`, `desktop-only` unit tests |
| Old network | api `live-social.test.ts`; Playwright `live.spec.ts` (CI sets `LIVE_MODE` for it) |

**Gaps.**
1. **No test runs the product the way production runs.** The CI and local stacks are `unrestricted` (`.github/workflows/ci.yml:161-241`; no `SIGNUP_ALLOWLIST` in the Playwright stack). A stranger's whole path in `invite_only` mode (landing, sign in, refused, join the waitlist) has no end-to-end test. Add a small Playwright project with its own api started with `SIGNUP_ALLOWLIST=owner@foundmill.local`.
2. **No phone journey test.** Each 390 px test checks one screen. Nothing walks sign-in → profile → first screen at 390 px, which is how P0-2 went unnoticed. Add `phone-journey.spec.ts` that fails on any `needs-larger-window` between `/login` and the first screen the person can act on, and on any link from Today or `/home` that ends there without a way on.
3. **The invitation test accepts the detour.** `invitations.spec.ts:166-168` treats `/onboarding` as a pass. Tighten it with the fix for P1-2, and run the accept at 390 px.
4. **The solo guard is tested only on the person page and the home.** NETWORK §10: "Each feature ships with a test of the right-hand column." Add one standing test: a one-person project's Today, Needs you, first-week checklist and every note the seed's foundations write contain none of "invite", "cofounder", "collaborator", "partner", "team up"; and Settings › People is the only screen with an invite control. It then guards every later feature.
5. **Races need real Postgres.** `people-races.test.ts` is skipped on PGlite and CI runs PGlite. A weekly or pre-release job with `RLS_TEST_DATABASE_URL` is the only way they run.
6. **Email is tested on the mock.** Nothing checks the production combination (domain set, SendGrid mock, a real project) except by reading `notify-email.ts:198`. Add the gateway case: that combination answers `simulated`, and the sweep retries it.
7. **No eval exists for any people-side agent** (role writer, matcher, introducer, split helper): none of those agents exists. The post-draft eval was written and not run on a live model (PROGRESS 1941).
8. **The mobile pack has no contract test** (A9-P1-7).
9. **Not verified by me:** anything about the live database beyond the caller's counts; whether Google sign-in, the Supabase `config push`, Turnstile, SendGrid or `LIVE_MODE` are on in production; whether `draftProjectPage` is idempotent when a page row exists; package 4.5's state beyond a grep of one prompt file; package 2.7's indexing.

---

## 7. Surprises

1. **The branch called `waitlist-invitations` contains no waitlist.** It built invitations and admission. The waitlist table came from the idea-box change (#98) as a stopgap, and both sides' file headers say the real one is the other's.
2. **The decided waitlist words and the shipped waitlist words disagree in the same week.** "It promises no email" was decided and applied to one string (`ON_WAITLIST_WORDS`), and the other string a stranger actually meets in production (`NotInvitedPage.tsx:38`) promises one.
3. **Wave 1 shipped onto zero rows.** Six pull requests of spread features (#93, #119, #122, #125, #126, #128) depend on a published project page; production has no page of any kind, and nothing would ever create one for an existing project.
4. **The first real outcome cannot be reached on a phone, by construction.** Today works at 390 px and shows "Your project's public page is ready to check"; the link goes to a desktop-only tab. The same for "A post is ready to share". The small-screen work made the reading surfaces work and left every acting surface that produces an outside outcome on the desktop.
5. **The refusal screen is the oldest component in the path and was never revisited.** `NeedsLargerWindow` still says "Foundmill is built for desktop screens", with the measured width in mono, three days after the rule "never leave a small screen at a dead end" was written.
6. **An invited friend is asked the old operator questions.** The first thing a new cofounder sees after Accept is "experience", "time you can give" and "where you live", then the idea studio. The api needs only a name.
7. **Two people systems live side by side.** A person can publish `/u/<handle>` with strengths and "looking to join a project", and be invisible in Network search, which still lists only owners of Live businesses by name; and there are two visibility switches for the same person.
8. **`LIVE_MODE` is still documented as "leave it unset while the social layer is unfinished"** (DEPLOY.md:72, still naming leaderboards), while THESIS 2.4 is recorded as done and `/home` advertises finding people. With one community row in production and zero connections and messages, the layer is either closed or unused; the home's second card then reads "Opening soon" to everyone.
9. **A lasting skip for a temporary condition.** `simulated` (the sender configured but not live) is recorded as final, so the day the sender is switched on, everything that was due before is already written off. It is the only refusal in the list whose cause is purely configuration and that is not retried.
10. **There is no operator anywhere.** No role above a project's owner, no screen, no procedure. The waitlist, a future report queue and "what is switched on" all need one, and each has so far been deferred to SQL and environment variables.
11. **The mobile pack's own corrections never merged.** The session that keeps the pack current did its Nov 12 updates on a branch that was left behind when the docs were folded into main (#136 added seven lines to BACKEND_CHANGES.md and nothing to the skill), so the pack on main describes neither the retention procedures nor 18 or older, both of which the app meets on its first screens.
12. **Attribution's only writer is the step the product is trying to move later.** It is recorded on the save that creates the founder profile; the retention plan moves the profile after the first idea, the waitlist sits before it, and the native app has no cookie.
