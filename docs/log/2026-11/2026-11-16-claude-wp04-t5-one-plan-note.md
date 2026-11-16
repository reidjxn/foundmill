---
date: 2026-11-16
branch: claude/wp04-t5-one-plan-note
title: One plan note, one approval (WP-04 T5)
areas: [shared, agents, db, api, orchestrator, web, modules, dugout, evals, e2e, docs]
supersedes: []
---
## What changed
- The drafted foundations post one decision note, "Your plan is ready", instead of "Sign off the product
  specification" and "Sign off the product roadmap" (founder, 2026-11-16 D3). Both `product_signoffs` rounds, the
  specification's and the roadmap's, point at it. No migration: the two rounds stay in the data.
- `packages/shared/src/first-week.ts`: `PLAN_READY_NOTE` (`key: "product.plan_ready"`, the subject and the labels
  "Approve the plan" / "Ask for changes") and `isPlanReadyDecision`. Day 1 on Today asks "publish your page and approve
  your plan" and, done, reads "You published your page and approved your plan." `FIRST_DAY_PROMISE` (Commit's steps and
  toast) says the plan arrives "as one note to approve". `FirstWeekFacts` keeps both dates.
- `packages/agents/src/foundations.ts`: `foundationsSignoffNotes(draft, { roadmapHref })` returns `{ plan }`, five
  lines at most (`PLAN_NOTE_MAX_LINES`), all from the draft: "First we build" (the first Now item), "It is for" (the
  vision's audience), "When it is done" (that item's first acceptance criterion, else the first sentence of its
  description), "What it costs: Nothing until you approve a spend.", and "[Read the full plan](…)" to the Roadmap tab.
  `planRoadmapHref(businessId)` links by the module key (`/b/<id>/d/product/roadmap`), which the web relocates to the
  department that carries the product module. `SPEC_SIGNOFF_SUBJECT` and `ROADMAP_SIGNOFF_SUBJECT` are gone.
- `packages/db`: `planDecisionBlock()` and `PLAN_OPTIONS` (option ids `approve` / `request_changes`, so Today's one tap,
  the one-click answer and the number keys decide it as any sign-off); `productSignoffsRepo.open` takes `inboxItemId`
  to attach a round to an existing note; `attach(db, businessId, signoffId, inboxItemId)`; `listForInboxItem`; and
  `forInboxItem` now prefers a round still open, then the newest, then the specification's. `foundations.apply` takes
  `signoffs: { plan: NoteDraft } | null` and opens the specification round with the note, then the roadmap round on it.
- `apps/api/src/services/signoff.ts`: the body of `decideProductSignoff`'s transaction is `decideRoundTx`;
  `decidePlanNote(ctx, item, input)` approves every round still open on the note in one transaction (the specification
  published as a version, the roadmap snapshotted), answers the note once and calls `startBuilding` once. Ask for
  changes sends the specification round back with the founder's words, makes one revision task and leaves the roadmap
  round pending. `decideSignoffItem` routes a note whose `decision.key` is the plan's there.
  `reopenSpecSignoffAfterPublish`: while the roadmap round still waits, the revised specification asks with the plan
  note again (same subject, key and options) and the roadmap round is attached to it.
- `inbox.get`'s `signoff` carries `plan`; `SignoffPanel` speaks of the plan for it ("Your decision", "Approve the plan
  and your team starts building the first item…").
- The welcome note: "Your plan follows as one note to approve. Building starts when you approve it." Home's ready line
  (`READY_SIGNOFF_LINE`, packages/modules): "One note in the Inbox asks you to approve your plan. Your approval is the
  yes that lets the team start building." The Board's waiting line: "Approve your plan first." The Dugout
  `FoundationsStatus` story and test quote the new ready line.
- The landing's day-one example lists the one note (`FIRST_DAY_SIGNOFFS = [PLAN_READY_NOTE.subject]`), and DESIGN.md's
  line about it says so.
- `evals/src/foundations/run.ts`: `planNoteProblems(draft, note?)`, a structure check that the note has at most five
  lines and no figure the draft does not hold (a link's address aside), part of `checkFoundations`.
- Tests: `signoff.test.ts` gains "one plan note, one approval" (one note with both rounds on it; Approve settles both,
  publishes, snapshots and builds once, a second Approve is refused; Ask for changes; the re-ask after a publish; a
  round approved on its tab leaves the note open for the other) and its first describe now walks the plan note;
  `foundations.test.ts` (api, db), `today.test.ts`, `idea-commit.test.ts`, the agents and shared tests, `TourPage`
  and `CommitForm` follow. Playwright: `helpers.ts` (`PLAN_NOTE`, `approvePlan` replaces `approveBothSignoffs`),
  `inbox`, `foundations`, `first-days`, `today`, `commit`, `landing`, and the root `golden-path`.
- The root golden path waited for the Chief of Staff's welcome note alone in two places (the Commit step and the First
  days step). Since WP-04 T8 the day's note, "What your team did today", replaces it once a first-week agent update is
  folded, so another session's full run failed there. Both now accept either (`FIRST_NOTE`, from `WELCOME_NOTE` and a
  new `DIGEST_NOTE`), as the apps/web specs already do; both are updates with no decision bar.
- WP-04's T5 is ticked.

## Decisions
- Spec and code differ in three places, and the code won:
  - Step 5 asked the plan note not to hold Continue before the page is published and to hold it after. Since Nov 7,
    2026 no decision holds Continue (`holdsContinue` in packages/db keeps `blocks_continue` only for warnings), so the
    note is written with `blocks_continue: false` and nothing switches it. The page is still the first thing asked:
    the page note comes first and the plan follows when the drafting ends.
  - The spec kept "the `spec` and `roadmap` drafts for the re-ask". Its own step 1(d) makes the re-ask the plan note
    again, and the re-ask's body comes from the published version's changelog (there is no draft then), so nothing
    would read them. They were removed rather than kept unused.
  - `already_decided` on a second Approve: `decideInboxItem` refuses an answered note before any sign-off code runs
    ("Inbox item is already answered", BAD_REQUEST), as it did for the two notes. The test asserts that refusal and
    that no second build started; `decidePlanNote` also refuses with `already_decided` if it is reached with no open round.
- The Product tabs still decide one round at a time. A round approved there leaves the plan note open while the other
  round waits on it, so the note's Approve finishes the plan (first-days.spec walks this). A request for changes from a
  tab answers the note, as before, since the founder has answered it.
- "Ask for changes" on the plan note sends the specification back (step 1c), so the revision task is "Revise the
  specification from your notes", whatever the words are about. With the specification already approved on its tab, the
  words go to the roadmap instead.
- The approve option's consequence is "Your team starts building the first item on the plan." With no budget (WP-04 T3,
  #226, not merged yet), commit starts no cycle and this approval is what starts the first round: `startBuilding`
  plans the Now items and calls `startCycle`. Nothing in T3 had to change for that; T3 relied on `startBuilding` already.
- `forInboxItem` returns the open round first, so the reading pane, Today's one tap and the archive guard see the round
  that still asks. Its order is a SQL `case` on the status, then the round, then the kind (`spec` sorts after `roadmap`).
- "When it is done" replaced the spec's "what you will be able to open": the first acceptance criterion reads as an
  outcome ("A new account reaches the first result without help."), not as something to open.

## Not done
- `apps/web/e2e/commit.spec.ts` "AC-11.1.6" failed twice here at `foundations-status` on Today (the line this change did
  not touch): the panel shows a ready state only when the visit saw the drafting, and on this machine the mock drafting
  finished before Today's first read. Not checked against main. `landing.spec.ts` "prerendered pages" fails under
  `next dev` (every page is `no-store`); it needs the production server CI runs.
- WP-04 T8 (#220) changes the same e2e expectations (the first week's "Building starts" update folded into the day's
  note). This branch builds on main, where the update is its own row; whichever merges second rebases the e2e helpers
  (`approvePlan` here, `approveBothSignoffs` there).
- The seeded demo businesses keep their two approved rounds and no plan note, as they did (they never had open notes).
- `chief_of_staff` prompts still say "signed off the specification and the roadmap": that is what the rounds record,
  and it is not shown to the founder.
