---
date: 2026-11-17
branch: claude/wizardly-turing-skic24
title: The waitlist opens in batches, with a public page, the batch sentence, the note record, the measures and three named invitations with no reward (WP-14 T15)
areas: [db, api, orchestrator, web, docs]
supersedes: ["Three invitation admissions a UTC day per inviter (2026-11-13), for three in total", "Credits for both sides of an invitation (docs/NETWORK.md F6 and L7)", "No admission in weekly cohorts (2026-11-12, answer 7), for the waitlist", "No public counts (2026-11-12, answer 4), for the waitlist page", "Indexing follows SIGNUP_OPEN (wp03-founder-decisions), for /waitlist only"]
---
## What changed
- Migration 0145: `waitlist_batches` (number, UTC day, places; service only, RLS on with no policy), `waitlist_entries.batch_id` and `waitlist_entries.personal_note_at`.
- Step 5: `personal_note_at` records that the founder's own personal note was sent; the operator sets it (docs/DEPLOY.md §4). Foundmill sends nothing.
- Step 6: `docs/holistic-plan/WP-14-T15-measures.md` defines the three measures, where each figure comes from, and a stop rule for each.
- `repos.waitlist.batchesWithPlaces` returns the batches that still have places with a real count of what is left; `admitNext` takes a `batchId`.
- The `waitlist-admissions` sweep admits into every open batch, in the waitlist's order (WP-03 T10, unchanged), before the daily number, under the same lock and ceiling.
- `waitlist.batch` (signed-out readable) answers the next batch with places, or null. Four fields, nothing about a person.
- `/waitlist` is a public page from 390 px: "Foundmill opens in batches. Batch N opens <day>. <n> places.", or the plain statement that no batch is set.
- robots.txt opens `/waitlist` alone before `SIGNUP_OPEN`, on the production origin only; the sitemap names that one page until sign-up opens.
- The not-invited page says the batch sentence only while the api reports that the waitlist emails (`waitlistEmails`); otherwise today's sentence stays.
- Tests: `rls/idea-drafts.test.ts`, `waitlist-sweep.test.ts` (three batch cases), `idea-box.test.ts` (`waitlist.batch`), `seo.test.ts`, `words.test.ts`, `api-error-page.test.tsx`, `e2e/waitlist.spec.ts`.

## Decisions
### What "places" counts
The figure is the batch's `places` less `taken`, a count of the new accounts it admitted that only goes up. An account that was already in takes no place. The security review found that counting live entries gave a place back when an account was closed, so a batch could admit more than it published; the counter and a database check (`taken <= places`) close that.
### The sweep warns while a batch is open and SIGNUP_OPEN is not on the orchestrator
Before this change an unset `WAITLIST_ADMIT_PER_DAY` meant the sweep admitted nobody. A batch row now admits by itself, so the boot warning's case (the api open, the orchestrator not) applies to a batch too. The sweep logs it on each run that has an open batch (security review).
### `/waitlist` is public as one exact address
The public list matches by prefix; the page is matched exactly, so a later `/waitlist…` route is not public by accident (security review).
### No rate limit on `waitlist.batch`
The reviewer rated it low: the read is one indexed query, returns four fields, and other public reads (`page.bySlug`) have none either. Left as it is.
### A batch stays open until its places are taken
If fewer people wait than a batch has places, the batch stays open and the next sweep admits whoever joins. The alternative, closing a batch at the end of its day, would leave published places that nobody could take.
### The page shows the lowest-numbered batch that still has places
Before its day it reads "Batch N opens <day>. <n> places." From its day it reads "Batch N opened <day>. <n> places left.", because "opens" would be untrue. With none it says the next batch has no date and shows no number.
### The operator sets a batch by SQL for now
`OPERATOR_USER_IDS` and the operator procedure are in #208, which is open. Building a second operator check on main would duplicate it and conflict with it. A batch is one row, written as hand admissions are today (docs/DEPLOY.md §4). A screen belongs in the operator queue once #208 merges.
### The robots rule
`Allow: /waitlist$` beside `Disallow: /`. A crawler that does not read `$` finds no rule for the page and stays out, which is the safe side. `/_next/static/` and the share image are allowed too so a crawler can render and preview the page; those are files, not pages.
### The sitemap before sign-up opens
It names `/waitlist` alone, so it never lists an address robots.txt closes. Before this change it listed the home and legal pages while robots.txt closed them.
### Joining stays signing in
The page's one action goes to `/login`; the not-invited page saves the place on arrival, as before. The page has no form and stores nothing, so it adds no new way to write to the database signed out.
### The page promises no email
Whether the waitlist emails is the api's switch. The page says only that signing in saves a place, which is true either way. It does not describe the order: the waitlist puts people who brought someone first (WP-03 T10), and a short sentence about order would be wrong.
### The batch sentence keeps the automatic join
The founder's sentence says "Join the waitlist"; the page still saves the place on arrival and then shows the saved line. Asking for a press would undo WP-03 T1 for no gain.
### The answer is cached for a minute
A public, indexable page should not call the api on every crawler request. The numbers are live to the minute.

### The personal note is recorded on the waitlist entry
The first hundred come through batches, so each has a waitlist entry. One nullable timestamp there is enough, and it is where the batch is recorded too.
### The measures are a document, not code in the nightly report
`repos/metrics.ts` and `metrics-report.ts` are changed by #208, #217 and WP-14 T12, and the coordinating session asked that their files be left until they merge. Measure 1 is readable from the database now; the invitation half of measure 2 waits for step 4; measure 3 waits for analytics.
### The stop rules are the founder's
The brief asked for a stop rule on each measure and gave no numbers; the first draft proposed them. The founder confirmed them as M1 to M3 on Nov 19, 2026, so the document no longer calls them Estimates.

### Step 4 (Nov 19 rebase): three named invitations, no reward
#290 changed only STATUS.md and built nothing, so Session 7 of the launch plan built it. `INVITATION_ADMISSIONS_PER_INVITER_PER_DAY` (3 a UTC day) is now `INVITATION_ADMISSIONS_PER_INVITER` (3 in total): the inviter's count runs from the epoch, under the same advisory lock.
The existing project invitation is the named invitation, so the `inviterStanding` rule (an account an invitation let in cannot let others in) still makes the three belong to active founders the list or open sign-up let in.
The refusal now says the three are used and points to the waitlist. docs/NETWORK.md F6 and L7 say the credits are removed; no code paid one (the `attributions` row only records who brought whom). The `via` link and the waitlist's order by the referral tree (WP-03 T10) are unchanged. Not built: a counter of invitations left on a screen.

### The person page shows the app prompt (WP-12 T8)
WP-12 T3 (the private arrivals count) and T8 are on main. The only gap was the `/u/<handle>` page, which T8's log left for after #208 and #217; it now renders `<PublicAppPrompt />` like the other three public pages.
### No prices are defined here
The landing session reported an agreement with WP-09 that T15 would create `packages/config/src/price-test.ts`. This session's instructions give the prices to T14, so it was not created; the coordinating session was told.

### The migration is 0145
It was 0141, then 0136, and is 0145 at the rebase of Nov 20 onto main (0141 to 0144 landed there first), per the launch plan: a session takes the next free number when it rebases.

## Not done
- Indicative prices: `components/waitlist/IndicativePrices.tsx` is the slot and renders nothing. T14 (session "wp14-money") fills it from its pricing config.
- No link from the landing page to `/waitlist`: the landing folder belongs to the landing session.
- An operator screen for batches: after #208.
- The measures in the nightly report: after #208, #217 and T12 merge.
- The card by post: the founder's own action; it is recorded with the same `personal_note_at`.
- Production: no batch is set, so `/waitlist` says the next batch has no date. `WAITLIST_EMAILS` is unset, so the not-invited page keeps today's sentence.
