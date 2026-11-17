---
date: 2026-11-17
branch: claude/wp04-t11-t12-t16-lifecycle-email
title: Lifecycle email for started projects and kept cards; T16 closed and its old notes cleared (WP-04 T11, T12, T16)
areas: [shared, db, connectors, gateway, orchestrator, api, web]
supersedes: []
---
## What changed
WP-04 T11 and T12, parked on mail setup until WP-00 S1 and S2 were done (Nov 17, 2026), and T16 as the founder
decided it the same day.

- Two email kinds, `getting_started` ("Help while you set up") and `checkin` ("When your project has been quiet"):
  switches in Settings › Preferences › Email, on until turned off, counted in the three a day
  (`LIMITED_EMAIL_KINDS`), and only ever one of a person's first two emails of a day
  (`LIFECYCLE_PER_PERSON_PER_DAY`), so a decision that holds up work keeps room. Owners and admins only.
- `packages/shared/src/lifecycle-email.ts`: when each stage is due (`dueLifecycle`, `dueCardEmail`), pure, asked by
  the orchestrator's notifier and asked again by the gateway from its own reads. Stages: `page_ready` (page drafted,
  not live, 30 minutes after the person left, first week), `ask_five` (live two days, nothing real since, first two
  weeks), `day_14`, `day_30`, `day_60` (counted from the latest visit by anyone in the project; never past day 90;
  restarts after a visit; only from a visit or start on or after Nov 18, 2026), and for a card `card_saved` (an hour)
  and `card_week` (a week).
- Rules across them: never while the person is here; nothing at all on vacation (`planNotifications` returns nothing,
  the project's other news included, as T11 step 4 says); one lifecycle email per project at a time; one
  `getting_started` a day and four in all; three lifecycle emails since the last visit with no return through their
  links end the sequence.
- First editions: a project's day-1 morning brief ("{project}, day 2: one thing to do today") and its day-7 review
  ("{project}: your first week", whatever the weekday) go out with no news, with the one thing to do.
- Words in `notify-words.ts` (`retentionEmail` cases, `cardEmail`). The day-3 note and every check-in are letters
  (D6): signed "The Foundmill team", sent from hello@mail.foundmill.com with Reply-To `hey@foundmill.com` (`replyTo`
  on `platform_notify:send_notification`), no "replies don't reach the team" line.
- T12: kept cards of an admitted person with a profile and no project (`repos.notifyFacts.cardHolders`); the
  orchestrator's `cardEmailsSweep` runs after the project sweep (`patched("card-emails")`); the gateway's
  `notify-card-email.ts` (orchestrator only) reads that one card and records the email with `business_id` null.
- Migration 0132 (number assigned by the coordinating session): the two kinds in `founder_notifications_kind_check`;
  `business_id` nullable only for a card's row (`founder_notifications_business_or_card`: `getting_started` with a
  `getting_started:card_` key); the own-read policy becomes `user_id = auth.uid() and (business_id is null or
  is_member(business_id))`; an index for the per-person lifecycle read.
- Every kind of Foundmill's email to a person, the older ones included (decision, win, brief, invitation accepted),
  now skips an address suppressed platform-wide (founder, Nov 17, 2026).
- T16 step 2: `pnpm --filter @foundmill/db notes:clear-day-one` lists, per quiet project (nobody here for 14 days),
  its unanswered day-one notes older than 14 days, a dry run by default; `--apply` archives them (never deletes) with
  one audit row per project (`repos.dayOneNotes`). Not run against production.
- The notifier asks again after a `simulated` answer (never recorded, never skipped for good) and logs one warning per
  sweep (A9-P0-4 item 2).
- `apps/api/src/routers/email.ts`: a row with no business never resolves as a one-click answer.

## Decisions
### T16 closed by the founder
"Forget about win back altogether, I know all these people" (Nov 17, 2026, relayed by the plan-execution session).
The read-only list of the 13 projects started before Oct 26 and quiet since showed 9 are the founder's own test
projects and the rest belong to people the founder knows. The win-back letters, their switch and their planning were
built in this branch and taken out again before any push; nothing of them is left. Check-ins never count from a
visit before Nov 18, 2026, so those 13 projects get no automatic check-in either. Step 2, clearing the old day-one
notes, stays (founder: "clear them") as the script above.

### Which consent and suppression rules apply to Foundmill's own letters
WP-08 T10's basis check (`recipientBasis`, policy `15-mail-basis.cedar`) covers `MAIL_SEND_TOOLS`, the projects'
outside mail. These emails go through `platform_notify:send_notification`, service only, to the account's own
address, so the basis check does not run. What applies: the person's switch per kind, the pause, the one-click off
link and List-Unsubscribe header, SendGrid's own bounce, spam and unsubscribe lists, and now for every kind the
platform-wide suppression list (`isSuppressed` with the nil business: a bounce, a spam report or "Don't send me
invitations").

### Letters are sent from hello@, with Reply-To hey@foundmill.com
The founder confirmed (Nov 17, 2026). SendGrid's authenticated domain is `mail.foundmill.com`; a From on
`foundmill.com` would need that domain authenticated in SendGrid first. Moving the From is one line once it is.

### "Check my page" opens Today
Department slugs are labels and may differ by project (never hard-code a department), so there is no stable link to
the Public page tab. Today leads with the page while it waits (T6, T7) and works from 390 px.

### No founder task from T9
T11's plan types name T9's `FounderTask`, which the plan-execution session owns and has not built. The day-1 brief's
one thing is a two-way template here (publish the page, else send it to five people). T9 should replace it with
`founderTaskOf` when it lands.

### The weekly first edition's empty line
s2's "Nothing reached the outside world this week" became "Nothing has reached anyone outside yet. That is common in
a first week, and the next step takes two minutes: {step}." It replaces the brief's own empty line for What worked
only in the first week.

### Security review (security-reviewer agent, Nov 17, 2026)
No P1. The policy holds: another user never reads a row (user_id = auth.uid() stays required); a member of A never
reads B's rows and a removed member still reads none (rows with a business still need is_member); no view, function or
other policy reads the table; column grants unchanged. Fixed from its findings:
- P2: check-ins counted from the recipient's own last visit, so a cofounder away while another works daily would be
  asked "keep or archive". Now counted from the project's latest visit by anyone (`projectLastSeenAt`), and the
  gateway sends lifecycle kinds to owners and admins only.
- P2: the gateway searched the whole card-holder list (500, by user id), so later people could starve. It now reads
  one person's newest card (`cardHolders(..., { only })`); the sweep's cap is 5,000.
- P3: the constraint allowed any `getting_started` row with no business; now only a card's key.
- P3: the card link carried `n=` that nothing records with no business; dropped (it keeps `via=email`).
- P3: the day-14 count of outcomes (payments among them) is left out for someone walled from Customers or Money.
Left, with the reason: the Reply-To is a constant (the founder named hey@foundmill.com, D6; a staging send with live
SendGrid would reach it too); rows with no business are outside the business export and go with the account.

## Not done
- `/new/commit/<id>` at 390 px, which the card email opens, is T2's (the plan-execution session's) and is not covered
  here.
- The solo-guard phrases are copied into `notify-words-lifecycle.test.ts` until WP-12 T0 (`solo-guard.ts`) merges.
- No visit count in the day-1 brief (needs `page.visited`, WP-02).
- The Real Postgres lane did not run locally (no Docker daemon or pgvector here); CI's postgres-suites job runs it.
- The day-one note script archives notes only; an approval request behind an archived note stays pending.
