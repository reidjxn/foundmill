# A11 — Foundmill roadmap status matrix

Repo `/Users/reidjackson/code/founder-manager`, branch `main` at `04a0a509` (Nov 15, 2026). Read-only pass; nothing was built, run or changed.

## How to read this

- **Status words.** `done` = merged on main, with a PROGRESS entry and (where cheap) a code check. `partial` = some of the package is on main; the "remains" column says what is not. `open` = nothing on main. `dropped` = removed or declined by the founder. `off` = code is on main but does nothing in production until a setup step is done.
- **Evidence.** `P:1530` means docs/PROGRESS.md line 1530. `D:4217` means docs/DECISIONS.md line 4217. `#93` is a merged pull request on `reidjxn/foundmill`. "grep 0" means I searched `apps/` and `packages/` for the identifier and found nothing.
- **What I could not check.** The repo does not record the current production configuration. docs/DEPLOY.md §6 (the status table) was last updated on Oct 20; no setup step added since Nov 11 has a "done" mark anywhere. I did not query Vercel, Railway, Supabase or any vendor. Every "off until set up" row below is therefore "not recorded as done", not "known to be missing".
- **Stale documents (do not plan from them).** PROGRESS's top checklists (lines 5–40: BUILD Phase 1 all ☐, Phase 2 ☐) were never updated. docs/GATES.md is frozen at Oct 7 (gates 0 and 1) and Oct 20 (UX gates). docs/agent-pack/00-handover.md is from Oct 22 and still says "desktop only". docs/foundmill-plan/foundmill-plan.md "Current state" says migrations run through 0074 and lists gaps that are now closed. docs/BUILD.md and DEPLOY.md line 72 still describe leaderboards. THESIS_REVIEW §13's status notes stop at Nov 13.
- **Numbers that matter for new work.** Last migration on main: `0107_collaborator_finance_fields.sql`; next free number is 0108 (0029, 0032, 0037, 0038, 0042, 0043, 0045, 0047, 0049, 0050 and 0051 were never used). Open PRs: 7, all opened by the Foundmill app's own agents, all idle since Nov 6. One human-session branch is ahead of main with no PR (section 8).

---

## 1. THESIS_REVIEW §13 matrix (phases 0 to 7)

All eleven decisions of §14 are answered (D:3454–3500), so no package waits on a founder decision recorded there.

### Phase 0: decide and tell the truth

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 0.1 | Founder decisions recorded | done | P:1463, P:1473, P:1481; D:3454–3500; CLAUDE.md carries every rule | Nothing |
| 0.2 | Rewrite the plan | done (doc) | P:1473 (`docs/foundmill-plan/foundmill-plan.md`, checked with `parsePlanFile`) | Re-importing it into Foundmill's own business is the founder's step and is not recorded as done. The plan's "Current state" section is stale again (migrations "through 0074"; gaps 1, 3, 4, 5, 6 partly closed since) |
| 0.3 | A mock result never reads as real | done except its eval | P:1463 (`result.simulated`, house rule 4), P:1507 (`integration_not_connected` for a person's own business) | The "done when" eval (a live agent given a mock `send_mail` says nothing was sent) does not exist: `evals/src` has no such case. It was deferred to 1.8, which is open |
| 0.4 | No fabricated channel results | done | P:1463 (`mockResultsAllowed`), P:1507 | Nothing |
| 0.5 | Remove grants nothing serves | done | P:1507 (Channel Board), P:1522 (428 grants removed; `NOT_YET_SERVED` empty; `PLANNED_GRANTS.md`) | Loose ends from the entries: businesses that already had an unavailable channel enabled keep the flag; the composer's and api's counts of enabled channels ignore availability; no eval for the Strategist's `available_channels`; skill-test mock bundles still list `sandbox.shell`, `documents.*`, `crm.entities.create` (P:1516, P:1528) |
| 0.6 | Subtext check | done | P:1463 (`scripts/banned-terms.mjs` phrase groups; CI job "Banned terms") | Nothing |
| 0.7 | Security prerequisites | partial | P:1487 (N1, SEC-10, 11, 16), P:1540 (SEC-14), #116 (SEC-9 gateway secret); SECURITY_REVIEW lines 168–191 | N2 (per-business SendGrid inbound and event keys for a founder's own SendGrid), N3 (Stripe Connect needs an account-to-business resolver before it goes live), N4 (one `SESSION_TOKEN_SECRET` signs every service's tokens), Dropbox Sign vendor confirmation before a contract is marked signed |

### Phase 1: a real first outcome that travels

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 1.1 | Project pages `/p/<slug>` | done | P:1530 (#79; migration 0077; `apps/web/app/p/[slug]`) | Nothing in the package. Later additions: story page, cards, quiz, mark (section 2) |
| 1.2 | Agents write the page | done, by a different route | P:1548 (Product Lead drafts from the founder's words; founder publishes through `page.publish`) | The package asked for a `publish_page` platform tool an agent calls through the gateway; publishing is the founder's own api call instead. "Live in under ten minutes on live models" was never measured, and the end-to-end eval is part of 1.8 |
| 1.3 | The first session ends on the link | done with gaps | P:1548 | The two sign-off notes stay two (the package wanted one); "Later" answers the note, there is no snooze (P:1553) |
| 1.4 | Real web research | open | D:3532 ("web research stays simulated in production until package 1.4") | A configuration step only: `web` in `LIVE_CONNECTORS` on the gateway and the api, and `ANTHROPIC_API_KEY` on the gateway (`packages/connectors/src/connectors/web/index.ts:108`). DEPLOY.md has no section for it. Nobody owns it |
| 1.5 | Platform email, to users and from projects | off | P:1555 (migration 0078, `platform_mail`), P:1578 and P:1661 (one sender, `POST /v1/notify/email`), P:2114 (postal address, #111) | The whole of DEPLOY §5.7 (SendGrid domain, DNS, Inbound Parse, event webhook, key, variables on four services). Also: N2 for founders' own SendGrid; dedicated IP and warm-up before real volume; quiet hours |
| 1.6 | Waitlist form and payment link | partial | Follow form with double opt-in: P:1567 (0079), Turnstile P:2035 (#119) | **Payment link not built** (`create_payment_link`: grep 0). No Stripe Connect onboarding per project; blocked by N3. Also "Not confirmed yet" in the Leads table and a daily Inbox summary of new followers (P:1576). The Follow form itself is off until Turnstile and platform mail are set up |
| 1.7 | A platform-owned repository and preview | open | Founder (D:3484): "after those are proven" | Everything. Related stale agent PRs for a deploy connector: #39, #49 |
| 1.8 | Outcome evals in CI, nightly, live | open | `.github/workflows/` has `ci.yml`, `security.yml`, `e2b-template.yml`, `evals-typed-reads.yml`; none is scheduled | Three nightly end-to-end sessions; the live smoke of GATES.md (100 live notes) has never run. Evals written and never run on a live model: social post drafts (P:1952), idea box (P:1777), Composer (GATES UX Gate 1) |

### Phase 2: reach and the person

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 2.1 | Small screens for the outer product | partial | P:1799, P:1806 (#102); `SMALL_SCREEN_PREFIXES` in `apps/web/components/providers/DesktopOnly.tsx:29` lists `/`, `/login`, `/home`, `/p/`, `/u/`, `/m/`, `/i/`, `/a/`, `/terms`, `/privacy`, `/new/card/`, `/public-profile`, `/network`, `/communities`, `/profiles/`, plus Today and the Inbox | `/onboarding` and `/new` (the studio, the doors, Commit) are still 1280 px only, so a phone that signs in from the idea box lands on its card and then meets the larger-window note (P:1777). The "kinder note with email me the link" is not built: `NeedsLargerWindow.tsx` still says only "This needs a larger window" (grep 0 for any link-by-email control). The store-links config value does not exist in code. Phone first paint flashes the desktop shell; "Explain this page" is not drawn on a phone (P:1811) |
| 2.2 | Open the door | partial | 18+ at sign-up: P:2105 (#127, 0100). Google: P:1623 (#82, off until set up). Typed email code on the web: #98. Open sign-up with a daily ceiling: #120 (`SIGNUP_OPEN`, off). Admission by invitation: #120 (0093) | The referral-ordered waitlist is not built: `waitlist_entries` (0086) stores an idea-box visitor's address and card and has an `admitted_at` column, but nothing orders it by referral, admits from it or emails anyone (`ON_WAITLIST_EMAIL_PROMISE` kept for it, P:2010). Per-domain caps and a captcha at sign-up (the stated condition for opening, DEPLOY line 147). Apple sign-in declined for now (founder, Nov 12) but see section 6. Production is allowlist-only |
| 2.3 | The person profile | partial | P:1589 (0080, `/u/<handle>`, `looking_for`, per-field visibility) | "Before you start" was not rebuilt as three plain questions (grep 0 for the new questions in `apps/web/components` and `packages/shared`). The older `public_profiles` view is still readable with the anon key (P:1596; harmless only while the Data API stays off) |
| 2.4 | Home for a person | done | P:1732 (#94), P:1762 (#99) | Sending a connection request still needs a Live project (P:1766); onboarding still continues to `/new` after the profile is saved (P:1744) |
| 2.5 | Retire "game mode"; people layer on for everyone | open | `packages/config/src/flags.ts`: `liveMode: false`; `PersonalOrLiveSection.tsx` and Commit's "Personal or live" panel still exist | Everything. This blocks NETWORK wave 2 (its stated prerequisite). Whether `LIVE_MODE=1` is set in production is not recorded |
| 2.6 | Shrink Commit | open | `CommitScreen.tsx` still has panels Name, Check the name, Logo and brand colors, Personal or live, Archetype, Business mode, Day one, What happens next | Everything |
| 2.7 | Landing and metadata | partial | Idea box (#98, P:1768), less dense (#105), Terms and Privacy linked (#97) | `Thesis.tsx:20` still promises "send email from your own accounts and reconcile your Stripe and bank data"; `LiveSessions.tsx:91` still says "Fifteen channels" (section 4). The landing page is not indexable: `apps/web/app/layout.tsx:18` sets `robots: { index: false }` and `app/page.tsx` does not override it. Examples are still Tutorlane, Glitchwick and Northwind, not week-one first-timers |

### Phase 3: build together

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 3.1 | Invitations | done | P:2001, P:2015 (#120; 0091; `/i/<token>`; email to an address), P:2043 (#124 founder notices) | Race tests need a real-Postgres run (P:2012, P:2024); tokens travel in GET query strings; stream and collab do not check a confirmed address (D:4217) |
| 3.2 | People are free | done | P:1463 (`seats: "unlimited"`) | Nothing |
| 3.3 | Cofounder and collaborator; People | done | #120 (0092 `people_roles`, 0094–0096 walls), #131 (0099), #132 (0107), Settings › People | A collaborator is not time-boxed (that is 3.5). P3 follow-ups: agents' AI cost visible on Team to a collaborator, free text that quotes money, department metrics' own walls (SECURITY_REVIEW lines 244–246) |
| 3.4 | Join requests | open | grep 0 (`join_request`) | Everything |
| 3.5 | Trial | open | grep 0 | Everything |
| 3.6 | Notes for more than one person | open | `packages/db/src/schema/inbox.ts` has no recipient column | Everything. (Email to each person about a waiting note exists, P:1578, but the note itself has no named recipient or "who decides") |
| 3.7 | People talking inside a project | open | No project thread, note comments or task assignment to a person found | Everything |
| 3.8 | Who owns what (split, founders' agreement) | open | grep 0 (`split_proposal`) | Everything |
| 3.9 | Pooled credits | open | D:3459: "Pooling is package 3.9 and not built yet" | Everything. Note: CLAUDE.md states pooling as a standing rule ("cofounders' included credits pool on a shared project"), so the product currently contradicts its own rule file |

### Phase 4: finding each other

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 4.1 | Open roles | open | grep 0 | Everything |
| 4.2 | Browse and search | open | — | Everything |
| 4.3 | Suggestions | open | — | Everything |
| 4.4 | Introductions | open | — | Everything |
| 4.5 | Ideation for one person first | open | No trace of the three plain answers in `packages/agents/src/prompts` or the studio | Everything |
| 4.6 | Referral | partial | Attribution only: P:1884, P:1929 (#93; 0088; `signup.attributed`, `referral.arrived`, the `via` code) | Credits for either side (grep 0 for `referral_credit`); moving up a waitlist. Amounts wait on 7.1 |
| 4.7 | Safety for meeting strangers | partial | 18+ (#127); per-person allowances in Redis (SEC-13) | Report a person, profile or message; a platform review queue; contact exchange after connecting; money and "investment" screening. A stated precondition for phase 4 and for NETWORK wave 3 |
| 4.8 | Communities for a purpose | open | Communities exist from BUILD phase 4, closed behind `liveMode` | Seeding by place and interest; the "looking for people" post type |
| 4.9 | Leaderboards | dropped | P:1498 (migration 0076) | Nothing. BUILD.md, DEPLOY.md line 72 and old docs still mention them |
| 4.10 | One home for the people side | open | `apps/social/src` is still a 295-line skeleton | The decision itself (keep as the public-read and matching service, or remove) |

### Phase 5: coming back

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 5.1 | Notifications | partial | Push: #75 (OneSignal connector, off until keys). Email kinds on main: `decision_waiting`, `win`, `milestone`, `run_finished`, `credits`, `daily_brief`, `weekly_review`, `invitation_accepted` (`packages/shared/src/constants.ts:621`), plus invitations and founder notices | The people kinds (a join request, a message, "your page had visitors"); quiet hours (P:1587). All email is off until 1.5's setup |
| 5.2 | The weekly letter | partial | A Monday `weekly_review` email exists (P:1641, P:1661); the morning brief on real outcomes (P:1975, #112) | The Composer-written letter with who visited and one suggestion of a person or project |
| 5.3 | Milestone cards | partial | P:1895 (#93): "Page live", "First follower" (`packages/journey/src/trophies.ts:75–76`), public card `/m/<id>`, story `/p/<slug>/story` | First conversation with a customer, first dollar (needs a real payment, so needs 1.6), first collaborator, first cofounder; the week card |
| 5.4 | Build log | open | grep 0 | Everything (the story page is the timeline it would continue) |
| 5.5 | The native app is the phone's home | in flight outside the repo | #75 (backend), `docs/mobile` prompt pack for Newly | OneSignal app and keys; `supabase config push` for the mobile redirect and the six-digit code; universal-link files (`apple-app-site-association`, `assetlinks.json`: not in `apps/web/public`); the store-links value; store listings. 11 unmerged pack commits on `claude/zealous-rubin-8q52gr` |
| 5.6 | The mobile prompt pack follows the thesis | done (corrective part) | P:1518, P:1605 | The people screens are not in the pack; edits must be re-pasted into the Newly project by hand (P:1614) |

### Phase 6: the inside, re-cut for a first-timer

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 6.1 | Show by stage | partial, by earlier work | Founder areas (#67: about 15 tabs instead of 50) and Builder view (#65, #66) shipped Nov 8–9, before the thesis | Tabs that appear when their data exists or their moment arrives |
| 6.2 | Earnings first | open | grep 0 for the new Money wording | Everything |
| 6.3 | Founder tasks (one human thing a day) | open | grep 0 | Everything |
| 6.4 | Chief of Staff as mentor | open | No mentor register in `packages/agents/src/prompts` | Everything |
| 6.5 | Personal goals | open | grep 0 | Everything |
| 6.6 | One switch for supervision | open | Settings › What the team can do exists (#61), not one switch | Everything |
| 6.7 | Money defaults from the profile | open | "I have no budget yet" exists on the profile (`profile-form.ts:65`); nothing scales from it | Everything |
| 6.8 | New example projects | open | Seeds are still Northwind and Ledgerly; landing examples Tutorlane, Glitchwick, Northwind | Everything |
| 6.9 | Management-game wording stays | decided; one fix owed | D:3484 | `package.json` line 5 still reads "…with a squad of AI agents" |
| 6.10 | Copy pass | open | — | Everything |

### Phase 7: economics and reach

| Id | Title | Status | Evidence | What remains |
| --- | --- | --- | --- | --- |
| 7.1 | Prices and credits from measured cost | partial | Credit saver: P:2141 (#118). `pnpm --filter @foundmill/db report:retention` exists for activation | Cost per first session and per week was never measured; `packages/config/src/pricing.ts` still has `priceMonthly: "TBD"` for Pro and Scale |
| 7.2 | Working top-ups and paid plans | partial | Checkout through the gateway (`stripe_billing`), credit lots kept 12 months (P:2087, #106, 0098) | Stripe setup (section 5); paid tiers cannot be chosen while prices are "to be announced". Until then a person out of credits has only "bring your own key" |
| 7.3 | More places | open | English only is decided | Payout and incorporation routes for more countries |
| 7.4 | Load and moderation capacity | open | No load baseline recorded | Everything |

### §15 measures and §11 engineering observations

- **§15.** The review said "none exists today". Since then: presence, sessions, activation and habit (P:1641, 0083), sign-up attribution (P:1884), post-to-outcome attribution (P:2154, #128, 0106), the list of real-outcome events used by the morning brief (`packages/shared/src/morning-brief.ts:44`). Not found: a query or report for the north star itself (weekly active projects with one real outcome), the solo split, first-dollar share, or four-week retention of people. foundmill-plan lists "Measure the north star" under Next; nobody owns it.
- **§11.** "Two homes for the people side" is undecided (4.10). "Rules that block" are all changed in CLAUDE.md. "Stale documents" is worse now than on Nov 11 (see the list at the top).
- **§16 risks with no owner.** Risk 1 (safety between strangers: 4.7 unbuilt). Risk 2 (cost on the platform's key: per-domain caps and a captcha unbuilt). Risk 3 (promising what agents cannot do: the landing page still does, 2.7). Risk 5 (the console keeps growing: the review asked to freeze new console surfaces until phase 3 ships, and Nov 12–15 added Team call, the page quiz, showcase videos, ready-to-post kits and media connectors, none of which is a roadmap package).

---

## 2. NETWORK.md matrix (21 features, four waves)

All sixteen questions of §14 are answered (D:4005–4025). The network session's branches are all merged: `claude/bold-johnson-hjxopx` (#93), `claude/waitlist-invitations` (#120), `claude/founder-notices` (#124). **No branch is in flight for any network feature today**, so every `open` row below is unowned.

### By build order (§13)

| Wave | # | Item | Status | Evidence | What remains | Branch in flight |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | Attribution and the events of §11 | done | P:1884, P:1929 (#93, 0088); person-level event store P:1672 (#86, 0085); relay back on P:1817 (#96); post-to-outcome P:2154 (#128, 0106) | Share buttons for visitors on the story and card pages (P:1925). "A person can read their own account events" awaits the founder's confirmation (P:1937) | none |
| 1 | 2 | F2 the mark and the story | done | P:1861, P:1876, P:1895 (#93; `tierShowsBuiltOnMark`; `/p/<slug>/story`) | The log (THESIS 5.4) | none |
| 1 | 3 | F3 cards with four early milestones | partial | P:1895, P:1908 (tap-to-post), P:1941 (the social agent's drafts), P:2123 (kits, #125) | Only two of the four early milestones exist (Page live, First follower). First reply and first dollar need a real reply and a real payment (1.5 setup, 1.6 payment link). The week card and the chapter recap. A Follow button on the card itself (P:1905) | none |
| 1 | 4 | F4 feedback links, with the return message | open | grep 0 (`feedback_link`) | Everything. The spec calls it "the widest way in" for week one | none |
| 1 | 5 | F5 invitations, with cofounder and collaborator roles | done | #120, #124 (section 1, rows 3.1 and 3.3) | Group links for cohorts; the referral-ordered waitlist | none |
| 1 | 6 | F6 credit for bringing people | open | Attribution exists; grep 0 for any credit grant | Everything; amounts wait on THESIS 7.1 | none |
| 2 | — | Prerequisites: 2.1, 2.4, 2.5 | 2.1 partial, 2.4 done, **2.5 open** | Section 1 | The people layer is still behind `liveMode` | none |
| 2 | 7 | F1 the record | open | `PersonPage.tsx` has no record section | Everything | none |
| 2 | 8 | F7 Latest with "Share it", F8 signals | open | grep 0 | Everything | none |
| 2 | 9 | F12 cohorts | open | The community kind `cohort` exists | Everything | none |
| 2 | 10 | F20 people notifications and the weekly letter | partial | Invitation email, `invitation_accepted`, founder notices (#120, #124) | Every other people kind; the letter | none |
| 3 | 11 | F21 safety | partial | 18+ (#127) | Reports, block everywhere, review queue, money screening, Redis limits for requests and asks | none |
| 3 | 12 | F10 asks | open | grep 0 | Everything | none |
| 3 | 13 | F17 message requests | open | — | Everything; needs its own security review before merge (D:4049) | none |
| 3 | 14 | F13 build hours, version one | open | grep 0 | Everything | none |
| 3 | 15 | F14 communities for a purpose | open | — | Everything | none |
| 4 | 16 | F15 open roles; F18 ask to join, trial, parting | open | grep 0 | Everything | none |
| 4 | 17 | F16 Find people (browse, Five today, Say hi) | open | — | Everything | none |
| 4 | 18 | F18 cofounders, the split, pooled credits; F19 Built with | open | Roles exist (3.3); the rest grep 0 | Everything | none |
| Later | — | F11 starting points; chapter recap; voice and video in build hours | open | — | Everything; a calling vendor behind the gateway is not chosen | none |
| — | — | F9 "Shipped this week" | dropped | §14 answer 3 | — | — |

### By feature (§7), short form

| F | Feature | Status | F | Feature | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | The record | open | F12 | Cohorts | open |
| F2 | Story and mark | done (log open) | F13 | Build hours | open |
| F3 | Cards, tap-to-post | partial | F14 | Communities for a purpose | open |
| F4 | Feedback links | open | F15 | Open roles | open |
| F5 | Invitations | done (group links, waitlist open) | F16 | Find people | open |
| F6 | Credit for bringing people | open | F17 | Messages and requests | open (direct messages exist behind `liveMode`) |
| F7 | Latest | open | F18 | Trial to cofounders | open (roles only) |
| F8 | Signals | open | F19 | Built with | open |
| F9 | — | dropped | F20 | Notifications, weekly letter | partial |
| F10 | Asks | open | F21 | Safety | partial (18+ only) |
| F11 | Starting points | open | | | |

### Built on the network side but not in NETWORK.md

These came from the Nov 13 "Claude Code tips review" list (items numbered 2, 4, 6, 8–13, 15 in PROGRESS; the list itself is not in the repo, and items 1, 3, 5, 7 and 14 are not accounted for anywhere I could find).

| Thing | Evidence | Loose end |
| --- | --- | --- |
| "Which one is for you?" quiz on a public page | P:2146 (#122, 0105) | — |
| Ready-to-post kits (video and voiceover on a draft) | P:2123 (#125, 0102) | Founder's own Runway and ElevenLabs keys only |
| Buffer connector (the team queues posts) | P:2073 (#126) | `buffer` is in no `LIVE_CONNECTORS` (D:4433); never called for real; daily cap and duplicate guard are per process (D:4435) |
| Showcase videos | P:2131 (#130, 0103) | "Real media waits on #125" (merged the same day; not re-checked) |
| Post-to-outcome attribution | P:2154 (#128, 0106) | — |
| Sharing an idea card publicly (`ideaShare.publish`) | A slot only, in `apps/web/app/new/card/[ideaId]/page.tsx` | Not built; left to "the network session" (P:1777), which has no branch |

### §15 "what not to build": still respected

No rankings, counts, sample people or second streak were found. One watch item: the Board treats "you post it" (tap-to-post) as an available social channel, which the founder confirmed with a test for "available" (D:4082).

---

## 3. UX_AUDIT_AND_PLAN.md matrix

### Phases (§10) and gates (GATES.md "UX plan gates")

| Phase | Status by the docs (Oct 20) | Checked now | What remains |
| --- | --- | --- | --- |
| 0 Words only | done | Spot-check of 12 old strings in the UI roots: "Work email", "Create fork", "Kill switch", "Apply accepted hunks", "Start supervised session", "Advance a business cycle", "Upgrade to Opus", "Re-score", "drive the jurisdiction recommender" all gone | UX Gate 0 is still PARTIAL on paper: the `docs/ux-audit/` walkthrough was never re-run with screenshots |
| 1 The guided layer | done, "unverified in the browser" | `DataTable` `meta.term` exists (the wave C leftover is closed); CI runs Playwright in three shards on every PR, so the specs "written blind" now run | Live Composer eval with a key (rubric threshold 0.75 untuned); the live half of `because` |
| 2 Depth and enforcement | built except the sweep | CI runs `node scripts/plain-language.mjs --gate`; the last committed sweep (Oct 21) shows 921 define-tier hits overall and 19 in the UI roots, under the gate's 300 | The committed `docs/PLAIN_LANGUAGE_SWEEP.md` is from Oct 21; PROGRESS later quotes 1006 hits (P:1527), so the file is stale |
| 3 Teaching by doing | built, two seams open | `KitBar` has `continueSlot`; `guidance.tour_completed`, `guidance.explainer_dismissed`, `guidance.term_opened` are declared in `packages/events/src/catalogue.ts` | **UX Gate 3 is open: the second external 30-minute user test (§11) has no record of having run.** Nothing reads the `guidance.*` signals |

§12's six decisions were all taken on Oct 20. §11's product signals are declared; no report or screen uses them.

### A second plan the sources do not list: the first-time founder report (Nov 8)

PROGRESS and DECISIONS refer to "the first-time founder report" ("Maya's First Day on Foundmill", D:3300) with its own Phase 1 to 3. It is not a file in `docs/`. It was delivered as PRs #56–#74 (Nov 7–10): the Inbox only asks, one press of Continue, the goal, Today, Settings › What the team can do, one name per agent, leads first, Builder view, founder areas (about 15 tabs), one opening sentence per area, "Explain this page", Ask the Chief of Staff, the first-week timeline, the sample marker. Status: done. Its own leftovers: Inbox notes and the Chief of Staff still count their own customer windows (P:1440); the sample roll-forward has no concurrency test (P:1452); Development › Pull requests and Environments empty states (P:1430).

### Appendix findings A to C: which remain open

The docs claim every copy-only High finding closed in wave A. I verified a sample in code and found no reopened copy finding. What is still open is structural, and the thesis roadmap now owns it:

| Finding | State | Where it lives now |
| --- | --- | --- |
| A1 profile asks 15 things before value | Softened (two passes), not solved | THESIS 2.3: three plain questions, not built |
| A3 eight decisions on Commit | Softened ("How it runs" chips), not solved | THESIS 2.6, not built |
| A5 first contact with Continue is red | Kept by decision (§12 item 2), then changed by the Nov 7 "Inbox only asks" work | Closed |
| A11 EUR default, "25k works too" | Fixed ("I have no budget yet", `profile-form.ts:65`); the budget hint still says "like 25000 or 25k" (`profile-form.ts:363`) | THESIS 2.3 asked to remove the 25,000 example |
| "No sample business for signed-in founders" | Fixed (example business, 0065) | Stale agent PRs #24 and #38 for its hydration error are still open |
| B4 day one is zeros | Fixed by Today, the first-week timeline and `emptyWhy` (P:1422) | Closed |
| B10 "Business health" is team health | Visible text fixed; `TodayScreen.tsx:242` still has `aria-label="Business health"` | Minor |
| B13 "CRM", "Anthropic key", LIVE label | Fixed (`apps/web/lib/sidebar.ts`) | Closed |
| B22, C2 leaderboard items | Moot: leaderboards removed | Closed |
| C12 dead Negotiation form | Hidden; negotiation is "dormant" by decision | Closed unless negotiation returns |
| C18 invite by account id or by email | Fixed by invitations (#120) | Closed |
| C20 "Heartbeat" | Label is "Last active"; only identifiers keep the word | Closed |
| C23 no "start here" per module | Fixed (Explainers, then one "Explain this page" button, P:1409) | Not drawn on a phone (P:1811) |
| GATES "open issues" 1–11 (Oct 7) | Not re-verified one by one. CI is green on main (P:2177), so the spec-level items (2–9) are presumably fixed; item 11 (the relay against a real Redis) and the 100k-entity search latency (AC-11.12.1) have no later evidence | See section 4 |

---

## 4. Original BUILD.md scope: not built, and not superseded

BUILD §16 is a plan for a console for one experienced founder. The thesis replaced its priorities but did not cancel its promises, and the landing page still makes several of them. GATES.md's verdicts: Gate 0 PASS (Oct 7), Gate 1 NOT PASSED (Oct 7, never re-run), gates 2 to 5 never attempted.

### What the landing page says today, against what a founder can do in production

| Promise (where) | Reality on main | Superseded? |
| --- | --- | --- |
| "Agents open real pull requests on your GitHub" (`Thesis.tsx:20`) | True. GitHub App live since Oct 9; branch, commit, CI checks, founder-only merge | — |
| "send email from your own accounts" (`Thesis.tsx:20`) | Not true as far as the repo records. The Gmail connector exists, but Google's OAuth app has no record of being registered (DEPLOY §6 row "Live connectors": open on Oct 20, never updated). A founder's own SendGrid or Resend key can be entered, but `sendgrid` and `resend` are in no `LIVE_CONNECTORS` on record, and Resend needs the platform mail settings to sign an unsubscribe link (P:1797) | Partly: the thesis answer is the Foundmill sending address (1.5), itself off until set up |
| "reconcile your Stripe and bank data" (`Thesis.tsx:20`) | Not true. `stripe`, `tink` and `plaid` connectors exist with real and mock halves; none is live; no keys. Money says "connect your bank" (D:3153), and no bank connector is live, so a real bank cannot be connected | No. THESIS 6.2 only reorders Money; it assumes a bank can be connected |
| "Fifteen channels. The right few first." (`LiveSessions.tsx:91`) | Fifteen engines run in mock for samples. For a real project the Board shows only channels that can act: Email (off until 1.5 setup), SEO and GEO (through `github:commit_files`, so only with the founder's own repository), and Social by tap-to-post. The other twelve have no publisher | Yes in the product (founder, Nov 11); **not in the landing copy** |
| "You do not need to know how to incorporate, price, run ads or keep books" (`Control.tsx:149`) | Incorporation: a workflow that prepares and stops at the founder's submit (mock registries; no Atlas or Companies House web adapter; no Browserbase). Ads: no ads connector. Books: no ledger connector (Codat or Merge absent) | Partly: THESIS 6.1 hides "incorporate" until relevant; the capability is still absent |
| "Committing creates the departments, hires the team and drafts the first roadmap" (`HowItWorks.tsx:36`) | True | — |
| "a customer was won" (the hero's example run) | A real project gets a real contact only through its page's Follow form (off until set up), and a payment cannot be taken through the product; other signups and payments exist only through Simulate, which is for staging | No |

### BUILD §16 items with nothing behind them

| BUILD item | State | Superseded by the thesis? |
| --- | --- | --- |
| §16.2 Gate 1 leftovers: AC-11.5.2 server proof, AC-11.1.1 profile-gate branch, AC-11.12.1 search latency on 100k entities, AC-11.5.3 and 11.5.4 server halves | Not re-verified since Oct 7. The golden path now carries an AC-11.5.2 test (`e2e/tests/golden-path.spec.ts:440`) | No |
| Live smoke: 100 consecutive live notes with valid links (HUMAN CHECKPOINT) | Never run | Restated as THESIS 1.8 |
| §16.3.2 engines for lead generation, SEO, content | Mock engines; lead data via the founder's own Apollo key (never called for real) | Partly (0.5) |
| §16.3.3 Stripe Connect; real signups, activations and payments events | Connector only; N3 open; events arrive only through Settings › Integrations › Simulate | Restated as THESIS 1.6 (payment link) |
| §16.3.4 Finance on Tink, Plaid and Stripe revenue | Connectors only, no keys | No |
| §16.3.8 Pricing tiers, Stripe Billing | Free tier and credits work; Pro and Scale "Price to be announced"; billing live only after setup | Restated as THESIS 7.1, 7.2 |
| Gate 2: SendGrid sandbox sequence; Stripe test payment plays a Customer Update | Never run | Restated as 1.5, 1.6, 1.8 |
| §16.4.1 the remaining 11 channel engines | Mock only; grants removed (`PLANNED_GRANTS.md`) | Yes for now |
| §16.4.3 Legal: `IncorporationProvider` with Stripe Atlas and Companies House web adapters, company import from all registries, contracts with e-signature | Workflow and screens exist; registries and Dropbox Sign are mock; no adapters | Deferred (THESIS 7.3) |
| §16.4.4 Ledger via Codat or Merge | Absent | No |
| §16.4.5 custom MCP servers per business | Not checked; SEC-19 says per-business policies are never loaded | No |
| §16.4.7 64 concurrent agents for an hour | Not attempted. Defaults: `ORCHESTRATOR_MAX_SESSIONS=16`; the Scale tier advertises 64 | Restated as THESIS 7.4 |
| §16.5 LIVE: B2B negotiation, benchmarks, verification | Negotiation dormant and hidden; leaderboards removed; the rest behind `liveMode: false` | Mostly replaced by NETWORK.md |
| Gate 4: closed beta with 50 founders; moderation response under 24 h | Not run | Replaced by the waitlist and F21 |
| §16.6 and §18 launch readiness: penetration test, SOC 2 readiness, status page, runbooks and on-call, DPA and sub-processor list, kill-switch drill | None recorded. Terms and Privacy are published (#97, #103, #108). An internal audit ran Nov 13 (#116) | No. foundmill-plan keeps "Penetration test" under Later |
| §19 open decisions | Name decided (Foundmill). Pro and Scale prices and credit sizes still TBD | — |

### Foundmill building itself (docs/agent-pack/00-handover.md, Oct 22)

| Open item in the handover | State |
| --- | --- |
| 1. Merge PR #13 (`run_checks`, `get_checks`) | Done |
| 2. First live loop (agent branches, commits, checks, PR, founder approves) | Done: PRs #24–#52 were opened by `app/foundmill`; the loop was followed by 25 platform-fix PRs from one session (within #25–#55) |
| 3. Railway deploy connector | Not built. Agent PRs #39 and #49 (contract only) are open and conflicting; branches `agent/b487387a…` and `agent/bebc845b…` hold an unreviewed provider |
| 4. Example chip hydration mismatch | Agent PRs #24 (conflicting) and #38 (mergeable) still open |
| 5. Responsibilities copy about delegating merges | Agent PR #52 (founder-only merge handler, mergeable) still open |
| 6. Scalability baseline | Not done |
| 7. Go-to-market plan | Superseded by NETWORK.md and foundmill-plan "Go-to-market" |

### NEEDED_DEPS.md, still "Open" (all from Oct 7, none blocking)

`@foundmill/entity-linker` for dugout and as a db devDependency; `@foundmill/events` for dugout; `jose` or the gateway client for the orchestrator; the Tiptap and Yjs set for `packages/modules` (the Specification editor is supplied by the host instead); `@electric-sql/pglite` and `pglite-pgvector` to move from dev to runtime dependencies of `packages/db`; `pglite-socket`; `@foundmill/sandbox` for the api's replay. Not re-verified against the lockfile; the file has not been touched since Oct 12.

---

## 5. Pending setup steps (accounts, keys, DNS, dashboards)

None of these is recorded as done. "API" means the vendor has an API or CLI that could do it once a person has created the account and an admin token; a secret value must still be pasted by the founder straight into its destination, never through a chat. Connectors named are the ones a Claude session can have: Vercel, Railway, Supabase, GitHub (`gh`). In this session the Railway connector was available, the Vercel and Supabase connectors were present but not authorized, and the GitHub MCP server failed to connect (the `gh` CLI works). DNS for foundmill.com is at Spaceship, for which there is no connector.

### A. Blocks a real outcome for a founder

| # | Step | Unblocks | Documented | Can it be automated? |
| --- | --- | --- | --- | --- |
| A1 | SendGrid: authenticate `mail.foundmill.com` (3 CNAMEs), DMARC TXT, MX to `mx.sendgrid.net`, Inbound Parse to `ingest.foundmill.com/mail/inbound`, signed Event Webhook, a restricted Mail Send key | Email from every project; follow confirmations (so anyone can become a follower at all); every email from Foundmill to a person (waiting decision, briefs, invitations, founder notices) | DEPLOY §5.7 steps 1–5 | SendGrid: API for domain authentication, parse settings, event webhook and keys, after a person creates the account and a full-access key. DNS: Spaceship dashboard (person), or its API with a key |
| A2 | Railway variables for platform mail: gateway (`PLATFORM_MAIL_DOMAIN`, `PLATFORM_MAIL_SIGNING_SECRET`, `SENDGRID_API_KEY`, `INGEST_PUBLIC_URL`, `sendgrid` in `LIVE_CONNECTORS`), ingest (domain, same secret, `PLATFORM_MAIL_INBOUND_TOKEN`, `PLATFORM_MAIL_EVENT_PUBLIC_KEY`), api and orchestrator (domain, `LIVE_CONNECTORS`) | Same as A1. The gateway and ingest refuse to start with the domain set and no 32-character secret | DEPLOY §5.7 step 6 | Railway connector or API for names and non-secret values; the founder pastes the two secrets |
| A3 | Cloudflare Turnstile widget; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel (Production and Preview); `TURNSTILE_SECRET_KEY` on the gateway | The landing page's idea box and the Follow form: both refuse every request on production until set | DEPLOY §3 "The landing page's idea box: setup"; IDEA_BOX.md | Cloudflare: API with a token (person creates the account and token). Vercel and Railway: connector |
| A4 | `IDEA_COOKIE_DOMAIN=foundmill.com` on the api and on Vercel | The idea card survives sign-in on another tab or device cleanly | Same section, steps 2 and 4 | Connector |
| A5 | Web research live: `web` in `LIVE_CONNECTORS` (gateway and api, by DEPLOY §5.6's general rule; not verified end to end), `ANTHROPIC_API_KEY` on the gateway | Research and fact checks that cite real pages (THESIS 1.4) | **Not documented in DEPLOY.md**; the requirement is in the connector's code | Railway connector |
| A6 | Stripe for credit top-ups: `stripe_billing` in `LIVE_CONNECTORS` (api, gateway), `STRIPE_SECRET_KEY` (gateway), webhook endpoint `ingest.foundmill.com/billing/stripe` with four events, `STRIPE_BILLING_WEBHOOK_SECRET` (ingest) | Buying credits. Without it the Billing tab says top-ups are not available | DEPLOY §5.5 | Stripe: API for the webhook endpoint, after a person opens the account and passes verification. Railway: connector |
| A7 | Supabase: push `supabase/config.toml` (mobile redirect `foundmill://auth/callback`, six-digit code, 900 s expiry, magic-link template with `{{ .Token }}`); narrow the redirect list in the dashboard | Phone-app sign-in; closes the audit's "Supabase redirect wildcard" finding ("fixed in file; dashboard step pending") | DEPLOY §4; §6 row "Mobile sign-in"; SECURITY_REVIEW line 209 | Supabase CLI or Management API (the Supabase connector needs authorizing first); the founder must run or approve it |
| A8 | Google sign-in: OAuth consent screen and Web client in Google Cloud; provider on in Supabase; `SUPABASE_ANON_KEY` on the api; `NEXT_PUBLIC_AUTH_GOOGLE=on` on Vercel Production, then redeploy | "Continue with Google" (THESIS 2.2) | DEPLOY §4 "Signing in with Google", nine steps | Google Cloud consent screen and client: a person in a browser. Supabase provider: Management API or dashboard (DEPLOY says the dashboard is the record). Vercel and Railway: connector |
| A9 | Opening sign-up: `SIGNUP_OPEN=1` (api, stream, collab), `SIGNUP_DAILY_CEILING` | Anyone can get in | DEPLOY §4 "Open sign-up" | Connector, but **held by code not yet written**: per-domain caps and a captcha (DEPLOY line 147), and reporting (IDEA_BOX.md) |

### B. Blocks a feature that is already merged

| # | Step | Unblocks | Documented | Can it be automated? |
| --- | --- | --- | --- | --- |
| B1 | OneSignal app; `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` and `onesignal` in `LIVE_CONNECTORS` on the gateway; connect it in the Newly project | Push to phones | DEPLOY §5.6; §6 row "Mobile push" | Person (OneSignal, Newly); Railway connector for variables |
| B2 | Universal links: `apple-app-site-association` and `assetlinks.json` under `apps/web/public/.well-known/` | Email links and one-click answers open the app | docs/mobile/BACKEND_CHANGES.md §5 | A code change, once the bundle id and Apple Team ID exist (person) |
| B3 | Store links value for the small-screen hand-over | The web sends a signed-in phone to the app | CLAUDE.md "Small screens" | The config value does not exist in code yet; then one variable |
| B4 | `ELEVENLABS_API_KEY` and `elevenlabs` in `LIVE_CONNECTORS` (gateway, api) | Team call with real voices (otherwise the browser's speech) | DEPLOY §5.6 | Person for the key; connector for the rest |
| B5 | `OPENAI_API_KEY` and `openai_images` live (gateway, api) | Real agent faces instead of placeholder silhouettes | DEPLOY §5.6 | Same |
| B6 | `buffer` in `LIVE_CONNECTORS` (gateway, api, orchestrator), only with the typed-read evals green | The team queues posts on a founder's Buffer | DEPLOY §5.6; D:4433 | Connector; the eval workflow needs the `ANTHROPIC_API_KEY` repository secret |
| B7 | The founder's-own-key connectors (`apollo`, `vercel`, `serpapi`, `firecrawl`, `openai`, `gemini`, `perplexity`, `posthog`, `resend`, `indexnow`, `runway`, `elevenlabs_voice`) into `LIVE_CONNECTORS`, the typed-read ones only with their injection evals green | Every "founder's own key" connector; none has ever called its vendor (P:1730, P:1797) | DEPLOY §5.6 | Connector, after one live run per vendor with a real key (person supplies the keys) |
| B8 | OAuth apps for Google (Gmail, Calendar, Drive), Notion, Shopify, with redirect `https://foundmill.com/integrations/oauth/callback` | Those connectors, and the landing page's "your own accounts" | DEPLOY §5.6 "OAuth apps"; §6 row "Live connectors" | Person in each vendor's console (Google's needs verification for Gmail scopes) |
| B9 | Registries (`COMPANIES_HOUSE_API_KEY`, OpenCorporates, Bolagsverket), Tink, Plaid, Stripe Connect (`STRIPE_CONNECT_CLIENT_ID`), Dropbox Sign, Cloudflare DNS | Legal lookups, bank data, payments per project, e-signature, DNS | DEPLOY §5.6 | Person for each account; Stripe Connect also needs N3 in code |
| B10 | `E2B_TEMPLATE=foundmill-sandbox` after running the "E2B sandbox template" workflow (needs the `E2B_API_KEY` repository secret) | Faster code-task acceptance runs with a browser | DEPLOY §5.3 | `gh workflow run`, then the Railway connector |
| B11 | Vercel Firewall rule: `POST /p/*`, 10 a minute per IP | A per-visitor limit on the Follow form | DEPLOY §2, last paragraph | Vercel connector (firewall configuration), if the plan offers rate limits |
| B12 | Re-import `docs/foundmill-plan/foundmill-plan.md` into Foundmill's own business | Foundmill's agents plan from the thesis | THESIS 0.2 | The founder, in the product |

### C. Hygiene and risk (from DEPLOY §6 and later entries)

| # | Step | Why | Can it be automated? |
| --- | --- | --- | --- |
| C1 | Railway "Wait for CI" on six services; branch protection on `main` | Three red commits shipped in October; `security.yml` is "not required yet" | Railway API (`deploymentTriggerUpdate`); `gh api` for protection (a paid GitHub plan is needed on a private repository) |
| C2 | Watch Paths in each Railway service's settings | **Railway stops reading `railway.toml` on Dec 1, 2026.** Healthchecks and teardown were moved into settings in October; Watch Paths were not, so every push still redeploys all six services and restarts agent sessions | Railway connector or API |
| C3 | Delete from the api service every connector platform key (SEC-14 list, DEPLOY §3); remove `SESSION_TOKEN_SECRET` and `DEV_MASTER_KEY` from stream and composer; delete `DATA_REGION` | Least privilege | Railway connector |
| C4 | A separate api-only token secret (N4) | Any service with the shared secret can act as the api | Code plus one new variable |
| C5 | `INGEST_URL` on the api | Simulate fails with `ingest_unreachable` without it | Railway connector |
| C6 | `SENTRY_DSN`, OTLP endpoint and headers on six services | Errors are only in Railway's logs | Person creates Sentry and Grafana projects; connector for variables |
| C7 | Redis `maxmemory` and an alert | `maxmemory 0`, `noeviction` on Oct 11 | Railway |
| C8 | Monthly spend limits on the Anthropic account and the E2B team | The backstop behind per-account allowances | Person, in each console |
| C9 | DMARC for foundmill.com from `p=none` to `p=quarantine` | Planned for "a week after" Oct 20 | Spaceship DNS (person) |
| C10 | Confirm `privacy@foundmill.com` is a read mailbox; lawyer review of Terms and Privacy "after launch" | The Privacy Policy promises deletion and export by email (P:1760) | Person |
| C11 | Keep "Confirm email" on and the Data API off in Supabase; re-check `/rest/v1/` answers 503 after any project change | Collaborator walls and 18+ depend on it (DEPLOY §4; D:4485) | A scripted check with the anon key |

---

## 6. Founder decisions still unanswered

THESIS §14 (11 of 11), NETWORK §14 (16 of 16) and UX §12 (6 of 6) are all answered. What is still waiting for the founder, from everywhere else:

| # | Decision | Source | Blocks |
| --- | --- | --- | --- |
| 1 | Prices for Pro and Scale, and the size of included credits | BUILD §19; `pricing.ts` ("TBD"); foundmill-plan "Set Pro and Scale prices from measured cost" | Paid plans (7.2); the free allowance (7.1); referral and helper credit amounts (F6, F10) |
| 2 | Sign in with Apple in the iOS app | docs/mobile/BACKEND_CHANGES.md §12: "a decision for the founder". The Nov 12 answer was Google on the web only, no Apple, the phone keeps the email code (P:1625). It reopens the day Google sign-in is added to the app (mobile prompt 13B), because App Store guideline 4.8 then asks for an equivalent private option | Google in the app; possibly store review (5.5) |
| 3 | When to open sign-up, and whether the two conditions (per-domain caps with a captcha; reporting) are the bar | DEPLOY §4; IDEA_BOX.md table row "Sign-up" | Everyone not on the list |
| 4 | May a person read their own account events (who arrived through their page, and when)? | P:1937 "For the founder to confirm" | F6's private line "Three people started because of you" |
| 5 | The fate of `apps/social` | THESIS 4.10, §11 "Decide once" | Where wave 2's public reads and matching jobs live |
| 6 | The four readings the network session made of the founder's answers (no public counts read widely; cohorts stay; Latest keeps a quiet line; the mark's words) | NETWORK §14, "to be corrected if wrong" | Waves 2 and 3 design |
| 7 | The seven open agent PRs (#24, #30, #38, #39, #45, #49, #52): merge, rebase or close. Agents never merge | `gh pr list` | The Foundmill-builds-Foundmill loop; a Railway deploy connector the founder had asked for (handover, Oct 22) |
| 8 | Apply to OpenAI's partner program for "use your own plan" funding? | D:4540; `OWN_PLAN_PROVIDERS` is empty | Item 12 of the tips list (the seam is merged and off) |
| 9 | A calling vendor for voice and video in build hours | D:4048 | NETWORK "Later" |
| 10 | Tips-review items 1, 3, 5, 7 and 14 | Not in the repo | Unknown: ask what they were and whether they are done |
| 11 | Account deletion and full export: stay "by email request", or build the flow? | P:1760, P:1688 | Privacy promises once sign-up opens |
| 12 | The second external user test (UX Gate 3): run it, or retire the gate in favor of THESIS §15's measures | UX plan §11 | Knowing whether the first-timer work landed |

---

## 7. Loose ends since Nov 8 (deduplicated)

Every "Not done", "Open", "Next", "Follow-up", "Not verified" and "Recorded, not fixed" note in PROGRESS from line 1409 to the end, and in DECISIONS from line 3394 to the end. Items that a later entry closed are listed at the bottom so they are not picked up again. P = PROGRESS line, D = DECISIONS line, SR = SECURITY_REVIEW line.

### 7.0 SECURITY_REVIEW.md: findings with no recorded fix (id, title)

| Id | Title | Note |
| --- | --- | --- |
| SEC-8 | RLS write policies wider than the api's role model | Not fixed in the policies; held by a deployment condition (the Supabase Data API stays off) plus 0087's client grants (#101) |
| SEC-9 | `APP_ENV` trust paths | Narrowed (Nov 11) and the gateway's development secret fixed (#116); the api and collab still log nothing when `DEV_AUTH_USER_ID` is honored |
| SEC-11 | Vendor-scheme weaknesses | Dropbox Sign's `event_hash` does not cover the request id; the vendor confirmation is not built |
| SEC-15 | Logging and storage hygiene | One-level log redaction; `approvals.args` stores raw arguments |
| SEC-17 | Session-token lifecycle | No revocation list (SEC-1's state check covers stopped agents) |
| SEC-18 | The seed disables the audit trigger | Accepted for demo rebuilds; keep `SEED_ON_BOOT` off in production (DEPLOY §6 shows it set to 1, on Oct 8, on the one environment that serves foundmill.com, which runs as `APP_ENV=staging`) |
| SEC-19 | Per-business policies unused | Table and repo exist; never loaded |
| N2 | No per-business SendGrid inbound token or event key | Open for founders' own SendGrid |
| N3 | Stripe Connect posts every account's events to one URL | Open; blocks Connect |
| N4 | Any service with `SESSION_TOKEN_SECRET` can mint the api's service token | Open |
| Nov 13 audit | Supabase redirect wildcard | Fixed in file; dashboard step pending |
| #131 | 0099 cannot hide one field of an `events` row a collaborator reads directly | P3, open |
| #132 | Agents' AI cost on Team; free text that may quote money; department metrics' walls | Three P3s, open |

### 7.1 Security and correctness

| # | Loose end | Source |
| --- | --- | --- |
| S1 | One `SESSION_TOKEN_SECRET` signs every service's tokens (N4); the api still holds the vault key to seal a founder's Anthropic key | P:1546; SR:191 |
| S2 | Founders' own SendGrid: no per-business inbound token or event key is stored (N2) | P:1565; SR:189 |
| S3 | Stripe Connect needs an account-to-business resolver before it goes live (N3) | SR:190 |
| S4 | Dropbox Sign: confirm the request with the vendor before a contract is marked signed | P:1496 |
| S5 | stream and collab admit by an allowlisted email without the confirmed-address rule | P:1631; P:2013; D:4217 |
| S6 | Invitation and "off" link tokens travel in GET query strings | P:2013 |
| S7 | One person can take open sign-up's day ceiling with many addresses: per-domain caps and a captcha before opening | P:2013; DEPLOY line 147 |
| S8 | Invitation and role races are shown on PGlite's one connection only; they need a real-Postgres run | P:2012; P:2024 |
| S9 | Attribution on account events never ran on real Postgres; a database that applied an earlier 0088 needs the function redefined by hand | P:1938 |
| S10 | The older `public_profiles` view is readable with the anon key; a profile inserted through the Data API skips the 18+ step. Both safe only while the Data API is off | P:1596; D:4485 |
| S11 | Supabase redirect list: narrowed in `supabase/config.toml`, the dashboard step is pending | SR:209 |
| S12 | Account events: hashed idempotency keys, a caller for `deleteAccountStream`, an alert for a row that fails forever, ordering after a transient failure, the record-id oracle; no check constraint for the handle rule | P:1704 |
| S13 | No account-deletion flow and no account-level export in the api; the Privacy Policy handles both by email | P:1688; P:1760 |
| S14 | The api's pool: not raised; the postgres.js slot leak was never reproduced | P:1719 |
| S15 | Collaborator walls, P3: one field of an `events` row read directly; agents' AI cost on Team; free text that quotes money; department metrics' walls | SR:226, 244–246; P:2164 |
| S16 | `published_by` on a page is still client-written | P:1967; D:4148 |
| S17 | Buffer: the untrusted-recipient rule matches exact URLs only; daily cap and duplicate guard are per process; the approval shows a channel id, not its name; a shared per-tool limit in the gateway; media storage for queued pictures | D:4435; P:2075 |
| S18 | Vercel connector: a production redeploy in automated mode runs without asking; not pinned to one project | P:1797 |
| S19 | A founder's own Resend: bounces and complaints do not reach the project's suppression list | P:1797 |
| S20 | No daily estimated-spend ceiling across founder-key connector calls; no deployment-wide ceiling on hosted IndexNow submissions | P:1730 |
| S21 | Post drafts: a trigger that fires while the workflow service is down is lost, with no retry | P:1953 |
| S22 | Idea box: the claim token stays in the sign-in link's URL; CORS still lists localhost | D:3899 |
| S23 | CI security scans (gitleaks, `pnpm audit`) are not required checks; non-critical advisories await triage | #138; SR:237 |
| S24 | SEC-9 residue: the api and collab log nothing when `DEV_AUTH_USER_ID` is honored. SEC-15, 17, 18, 19 (log redaction depth, token deny-list, seed and audit trigger, per-business policies never loaded) have no recorded fix | SR:174; SR:129–133 |
| S25 | Playbook triggers and vacation wake events accept an account-scoped event type that will never fire; the business `writeEvent` in packages/events "still fails on the real tables" | P:1688 |

### 7.2 Written, never run or verified

| # | Loose end | Source |
| --- | --- | --- |
| V1 | No founder-key connector has called its vendor (OpenAI, Gemini, Perplexity, SerpApi, Firecrawl, IndexNow, Apollo, Vercel, PostHog, Resend, Buffer, Runway, ElevenLabs voice). Unconfirmed field names and enums are listed per vendor | P:1730; P:1797; D:3927; D:4432 |
| V2 | The social post-draft eval was written and not run; the social template's standing instructions pull against the post prompt | P:1952 |
| V3 | The idea box's live eval (the 2 s and 10 s bar) has not run | P:1777 |
| V4 | No eval for the Strategist's `available_channels`; no eval that a simulated send is reported as not done | P:1516; THESIS 0.3 |
| V5 | Whether search engines accept a hosted page's key file under `/p/<slug>/` needs one check on a real deployment | P:1730 |
| V6 | Settings › Integrations rows for the new connectors were never looked at in a browser | P:1730; P:1797 |
| V7 | The Share control on a drafted post has unit tests only; Storybook was not built for the share panel | P:1924; P:1926 |
| V8 | `screens-plain.spec.ts:77` (Milestones) timed out on the network branch and its base; `server-path.spec.ts` "a last business that no longer opens is forgotten" failed with and without the retention change. Neither is named in the later flake fixes (#135, #140, #141) | P:1953; P:1651 |
| V9 | No replay fixture of a workflow history recorded before the "draft the page first" step | P:1553 |
| V10 | The sample roll-forward's shared lock has no concurrency test | P:1452 |

### 7.3 Product gaps the entries name

| # | Loose end | Source |
| --- | --- | --- |
| G1 | `/onboarding` is desktop only: a phone that signs in from the idea box lands on its card, then meets the larger-window note | P:1777 |
| G2 | The invite-only refusal page asks for a larger window on a phone | P:1631 |
| G3 | Phone shell: desktop first paint flashes; "Explain this page" not drawn; the Goal panel sits above Needs you; no saved views or bulk actions | P:1811; P:1804 |
| G4 | Sending a connection request still needs a Live project; onboarding still continues to `/new` after the profile is saved | P:1766; P:1744 |
| G5 | The waitlist keeps an idea card only on the browser that made it, promises no email, and nothing admits anyone from it | P:1777; P:2010 |
| G6 | Sharing an idea card publicly (`ideaShare.publish`) is not built | P:1777 |
| G7 | The two sign-off notes are still two; "Later" answers a note instead of snoozing it | P:1553 |
| G8 | "Not confirmed yet" is not shown in the Leads table; no daily Inbox summary of new followers | P:1576 |
| G9 | Email: no quiet hours; prose such as "Node.js" is cut as a link | P:1587 |
| G10 | A business that already had an unavailable channel enabled keeps the flag; enabled-channel counts ignore availability | P:1516 |
| G11 | Agents still describe internal steps no tool performs (CRM records, the Strategist starting engines, a costing model); covered by the house rule only | P:1528 |
| G12 | Connecting to a business (not a person) has no entry point since leaderboards went | P:1505 |
| G13 | Milestone card: no Follow button of its own; nothing in the console links to the tall image; a business in the old "Live" mode shows two "Share" controls; no share buttons for visitors | P:1905; P:1925; P:1927 |
| G14 | A figure the founder states on their own page can be repeated in a post | P:1953 |
| G15 | Whether the team's tap-to-post drafts continue once Buffer makes the social channel act | D:4435; P:2075 |
| G16 | Sample business: Inbox notes and the Chief of Staff count their own customer windows; text period keys and JSON timestamps do not roll | P:1440 |
| G17 | Mobile: Newly's skills need re-pasting after every pack change; the people screens are not in the pack; `business.areas.words` is in the repo but its deploy was never confirmed | P:1614; P:1520; BACKEND_CHANGES §8 |
| G18 | No network feature, notification or screen reads the person-level events yet; no api procedure serves a person their own events | P:1688 |
| G19 | Buffer, version one, leaves out video, documents, several channels in one call, first comments, Instagram stories and reels | D:4424 |
| G20 | Legal pages: the founder's lawyer reviews both texts after launch; `privacy@foundmill.com` must be a read mailbox | P:1760 |

### 7.4 Closed by a later entry (do not pick up)

- "On a real project the social agent drafts nothing yet" (P:1923): closed by P:1941 (#93).
- "The account relay is off" (P:1710, P:1939): closed by P:1817 (#96).
- "A page's published date can be backdated" (P:1906): closed by P:1955 (0090).
- "The person page still ends with Made with Foundmill" (P:1874): closed by P:1876.
- "The (live) layout still sends a person with no project to /new" (P:1744): closed by P:1762 (#99); "the person frame is desktop only" (P:1766): closed by P:1799 (#102).
- "The one-click page and the pause page ask for a larger window on a phone" (P:1651): closed by P:1653.
- "P2-3, telling every founder" (P:2025; D:4234): closed by P:2043 (#124).
- "18 or older waits for package 2.2" (P:1485; P:1596): closed by P:2105 (#127).
- "A postal address in the footer" (P:1565; DEPLOY §5.7 closing line, which still says "not handled"): closed by P:2114 (#111).
- "Paid top-ups expire at the end of the month" (P:1760): closed by P:2087 (#106). "The registered postal address" (P:1760): closed by P:1813 (#103).
- "The post-draft integration waits for #93" (P:2041): closed by P:2123 (#125).
- "SEC-14" and "0.5" in the phase 0 "Not done" lists (P:1471, P:1479, P:1496): closed by P:1540, P:1507, P:1522.
- Daily streak, early milestones, idea box, Google sign-in, code sign-in "are the next parts" (P:1651): all merged.

---

## 8. In-flight work

### 8.1 Human-session branches ahead of main

| Branch | Session | Purpose | Last commit | Ahead / behind main | Touches (top-level) | Migrations | PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude/blissful-fermat-q03yq1` | `https://claude.ai/code/session_01CJRTqSdBxfu47H228pNqbF` (from the commit trailer) | "From the legal checklist review (items D and F)": a privacy notice for project followers (Privacy Policy section "Following a project", a link under the Follow form's consent box); axe accessibility checks over every Storybook story and the outer pages, wired into CI's Storybook job; fixes for landmarks, one h1 per page and contrast | Nov 15, 11:04 UTC | 1 / 0 | `.github/workflows/ci.yml`, `apps/web` (content/legal, e2e, landing, shell), `packages/dugout` (a11y, public, shell, `dugout.css`), `packages/shared/src/project-page.ts`, `docs/` (DECISIONS, DESIGN, PROGRESS), `pnpm-lock.yaml`, `pnpm-workspace.yaml` | none | none yet |
| `claude/zealous-rubin-8q52gr` | the mobile session | 11 commits to the Newly prompt pack (`docs/mobile`: batch cap of 4 procedures, Google sign-in rule, start-flow shapes, retention shapes) plus "round of work" wording in `packages/shared/src/autopilot.ts` and three tests | Nov 12 | 11 / 198 | `docs/mobile`, `docs/` (DECISIONS, PROGRESS), `packages/shared`, `apps/api` (test), `apps/web` (test, e2e) | none | none (last merged PR from it: #77) |
| `claude/beautiful-bohr-7r9npy` | unknown | "api: in-process drafting outlives the request that started it" | Nov 13 | 1 / 186 | `apps/api` (tx-gate, foundations, personas, product-research), `docs/` | none | none. **Superseded** by #123, which merged the same fix (`ungated(db)`) |
| `claude/busy-lovelace-nbx2p6` | the Team call session | One docs commit recording the hold fix | Nov 12 | 1 / 195 | `docs/` | none | #90, closed Nov 15 (its entry was folded in by #136) |

Collision notes for a new plan: `claude/blissful-fermat-q03yq1` edits `.github/workflows/ci.yml`, `packages/dugout/src/components/shell/{AppShell,KitBar,Panel,PhoneBar}.tsx`, `packages/dugout/src/components/public/*` and `ProjectFollowForm`, so any work on the phone shell, public pages or CI should wait for it or rebase on it. Nothing in flight holds a migration number; 0108 is free. Every other `claude/*` and `connectors-*` branch updated since Nov 8 is at the head of a merged PR (or, for `claude/vibrant-euler-uua9pw` and `claude/relaxed-fermi-oip5am`, zero commits ahead of main) and can be deleted.

### 8.2 Open pull requests (all opened by `app/foundmill`, Foundmill's own agents; none touched since Nov 6)

| PR | Branch | Agent | Purpose | Last commit | Mergeable | Touches | Migrations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #52 | `agent/4e78440a…` | Backend Engineer | API: enforce the founder-only handler for merges | Nov 6 | yes | `apps/api` (2 files) | none |
| #49 | `agent/9732ee22…` | QA Engineer | Rebase of the deploy-contract branch (#39) | Nov 2 | conflicting | `apps/gateway` (4), `docs/` | none |
| #45 (draft) | `agent/ec01d985…` | Integration Agent | Orchestrator: refuse an acceptance run when changed files sit outside every package | Nov 6 | conflicting | `apps/orchestrator` (2), `docs/` | none |
| #39 | `agent/a5444581…` | Engineering Lead | Deploy connector contract and tool schemas (`deploy_service`, `get_deploy_status`, a production allowlist) | Nov 6 | conflicting | `apps/gateway` (4), `docs/` | none |
| #38 | `agent/56a192f8…` | QA Engineer | Assert no hydration errors in the example-business Playwright spec | Oct 30 | yes | `apps/web` (1) | none |
| #30 | `agent/45f17158…` | Infrastructure Engineer | Sandbox: no double clone in `prepareAgentWorkspace` | Nov 6 | conflicting | `packages/sandbox`, `apps/orchestrator`, `docs/` | none |
| #24 | `agent/c9db3af1…` | Frontend Engineer | Example chip hydration mismatch | Nov 2 | conflicting | `apps/web` (4) | none |

Agent branches with no PR: `agent/cae72a00…` (QA Engineer, Nov 6, 17 files across gateway, api, shared, connectors), `agent/b487387a…` ("Add Railway deploy provider with gateway-only RAILWAY_TOKEN config", Oct 30), `agent/bebc845b…` (Engineering Lead, gateway, Oct 30), `agent/355d9518…`, `agent/261f22f6…`, `agent/8752a67a…` (a `PR_NOTE.md`), `agent/fdf54366…` (agent-pack skills). All are far behind main; the docs they would touch (PROGRESS, DECISIONS) have since been restructured by #136.

### 8.3 Sessions named in the docs, and what each owned (D:4036–4067)

| Session (branch) | Owned | State on Nov 15 |
| --- | --- | --- |
| Roadmap (`claude/vibrant-euler-uua9pw`) | Rebuild phases 0–2, Google sign-in, small screens (2.1), home for a person (2.4) | Fully merged (last #115, Nov 13); branch even with its merges. No successor branch for 1.4, 1.6, 1.7, 1.8, 2.3 part two, 2.5, 2.6, 2.7 |
| Network (`claude/bold-johnson-hjxopx`, `claude/waitlist-invitations`, `claude/founder-notices`) | NETWORK waves, invitations (3.1), the referral-ordered waitlist | Merged (#93, #120, #124). The waitlist, F4, F6 and waves 2–4 have no branch |
| Retention (`claude/brave-allen-52yii5`) | Measurement, founder email, streak, idea box, Terms and Privacy, credit lots | Merged (last #106, Nov 14) |
| Mobile (`claude/zealous-rubin-8q52gr`) | `docs/mobile`, the Newly app | 11 commits unmerged |
| Team call (`claude/busy-lovelace-nbx2p6`) | Team call | Merged (#81, #83, #88) |
| Connectors (`connectors-byo-key`, `-2`, `connectors-buffer`) | Founder's-own-key connectors, typed reads, Buffer | Merged (#85, #89, #126) |
| Tips (`claude/tips-*`, 23 branches) | The Nov 13 tips-review list and the Nov 13 security audit | All merged (PRs between #108 and #142) |
| Alignment or coordinating session | Merge order, migration numbers, ownership | Leaves entries in DECISIONS only; no branch |
| Legal checklist (`claude/blissful-fermat-q03yq1`) | Items D and F of a legal checklist review that is not in the repo | In flight (8.1) |

### 8.4 Uncommitted changes in the working tree (seen at the end of this pass; not made by it)

`git status` was clean when this pass started. At about 12:13 local time on Nov 15 another session wrote to the same checkout, on `main`, uncommitted:

| Path | Change |
| --- | --- |
| `CLAUDE.md` | Two "Always" lines added: follow the `karpathy-guidelines` skill on every code change, and "Outside Claude Code skills and plugins are used freely (founder, 2026-11-15; this replaces the 2026-11-13 rule that they be vetted first)". The "Never install or run an outside Claude Code skill…" line is removed |
| `.claude/skills/vet-third-party-skill/SKILL.md` | Deleted (staged) |
| `.claude/skills/` | 30 new skill folders copied from installed plugins (superpowers, marketing-skills, claude-seo, humanizer, frontend-design, taste-skill, karpathy-guidelines), plus `THIRD_PARTY_NOTICES.md` with sources, commits and licenses |
| `docs/holistic-plan/` | New, with `audits/` and `skills/` folders |

A new plan should know this is in flight: it changes a rule this report quotes (CLAUDE.md "Never"), it is not on any branch yet, and it sits in the same checkout every local session reads. This pass invoked no skill or plugin, as instructed.

---

## 9. The ten most important unowned items for the target user reaching a real outcome

A real outcome, by the north star, is a page live, an email sent, a post published, a payment taken or a customer's reply. Ordered by how directly each one stands between a young first-time founder on a phone and one of those.

| # | Item | Why it ranks here |
| --- | --- | --- |
| 1 | **Set up the Foundmill sending domain** (DEPLOY §5.7; section 5, A1 and A2) | All the code is merged and does nothing. Without it no visitor can confirm a follow, so "First follower" and "a customer's reply" cannot happen for anyone, the Email channel does not exist, and Foundmill cannot email a person about a waiting decision, a brief or an invitation. Pure setup, about a dozen dashboard actions and variables |
| 2 | **Turnstile keys** (section 5, A3) | The idea box is the front door the founder called "the most important hook we have", and the Follow form is the only way a stranger becomes a contact. Both refuse every request in production until two keys are pasted |
| 3 | **The phone path dead-ends after sign-in** (THESIS 2.1 remainder; G1, G2) | The target user arrives on a phone. Landing, idea box, sign-in, `/home`, Today and Needs you work at 390 px, but `/onboarding`, the studio and Commit do not, and the note there offers no "email me the link". The native app that is meant to take over is not launched. A phone visitor today cannot create a project |
| 4 | **A payment link** (THESIS 1.6 second half; N3; 5.3 "first dollar") | "First dollar" is the outcome this user wants most and the product has no way to take one: no `create_payment_link`, no Stripe onboarding per project, and the Connect webhook design is an open security item. No session owns it |
| 5 | **Switch real web research on** (THESIS 1.4; section 5, A5) | Every plan, market claim and ideation card for a real project rests on research that is simulated or refused. It is one configuration change and it is not even written down in DEPLOY.md |
| 6 | **Open the door: a waitlist that emails, per-domain caps and a captcha** (THESIS 2.2 remainder; S7) | Production is allowlist-only. A stranger who shapes an idea on the landing page is kept on a list that is never read: the panel says "come back tomorrow to check" and no email ever follows. The network session that owned this has no branch left |
| 7 | **Make the landing page true** (THESIS 2.7; section 4) | It still promises email from your own accounts, Stripe and bank reconciliation and fifteen channels. A first-timer who signs up for that meets "not connected". Fixing the copy is a day; it is also the review's own risk 3. The page is also `noindex`, so search cannot find it |
| 8 | **Nightly outcome checks on live models, and the live smoke** (THESIS 1.8; V1–V4) | Nothing proves that page publishing, email or research work end to end on live models, and several agent behaviors shipped with evals that never ran. For a user with no experience, a silent failure reads as their own |
| 9 | **A way to keep going when credits run out, and a free allowance sized from measured cost** (THESIS 7.1, 7.2; section 5, A6; decision 1 in section 6) | The free tier is $5.00 of credits a month. Nobody has measured whether that reaches a first outcome and a first week. When it runs out the only exits are top-ups (off until Stripe is set up) and "bring your own key", which this user will not have |
| 10 | **Shorten the first run: three profile questions and "name and go"** (THESIS 2.3 part two, 2.6) | Between the idea card and the first page there is still a long profile form and an eight-panel Commit screen written for an operator. The review's target is a live link in the first session; these two packages are what stand in the way and neither has started |

Two things just below the line: **switching the people layer on for everyone (2.5)**, because all of NETWORK wave 2 waits on it and nobody owns it; and **one current record of what is configured in production**, because DEPLOY §6 stopped on Oct 20 and that is why items 1, 2 and 5 could sit undone without anyone seeing it.
