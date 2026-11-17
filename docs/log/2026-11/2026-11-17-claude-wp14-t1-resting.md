---
date: 2026-11-17
branch: claude/wp14-t1-resting
title: Resting: a team out of budget finishes the task it is on, and a session starts only if a reserve covers it (WP-14 T1)
areas: [config, db, orchestrator, api, web, shared, agents, docs]
supersedes: ["The charge that empties a balance pauses the team (2026-10-12)"]
---
## What changed
WP-14 T1, which amends WP-09 T13. Stacked on WP-14 T14 (`claude/zen-bardeen-zq7g2y`, #300): the note names the plan
with `planName`. A later session can rely on:

- **The word.** A team that has used the month's budget is **Resting** until the date its budget resets. "Paused is a
  choice. Resting is a team out of budget until the date shown." is in `packages/shared/src/terms.ts` (`resting`), in
  the Inbox Composer's rules and on Billing. Internally it is still the stop flag with reason `credits_exhausted`.
- **The reserve.** `SESSION_RESERVE` in `packages/config/src/pricing.ts`. Before a session on Foundmill's key starts,
  `SessionCredits.open` compares what is spendable with `sessionReserveMinor`: the larger of 10 cents and the recent
  average cost of that agent type's sessions in the project (`repos.agents.recentSessionCost`, the latest 20) times
  1.5. Under it the session does not start, nothing is booked, the balance keeps what is left, and
  `restBeforeSession` rests the team.
- **The last task finishes.** A session running when the balance empties is no longer interrupted: the stop watch in
  `session.ts` ignores a `credits_exhausted` stop, and `SessionCredits.settle` returns `exhausted` only once the
  session has spent `backstopCeilingMinor` (50 cents) after the balance was first seen empty. The SDK's budget is what
  was spendable plus that ceiling. Entering the backstop is logged once per session ("session outgrew its reserve")
  with the reserve and the spend. Everything is booked to the usage ledger, overrun included.
- **The note.** One note from the Chief of Staff (`RESTING_SUBJECT`), built by `restingNoteBody`: the brief's
  sentence, up to five tasks finished this month and three that come next (from the task records), the plan by name,
  what is left, and `waysToContinue`. A team already resting this month gets no second note.
- **Ways on are only the real ones.** `waysToContinue` names a top-up only where one can be bought
  (the `topUps` option of #251, from `topUpsOnSale(env)`)
  and a change of plan only once plans are on sale. The founder's own Anthropic key is always offered.
- **Billing** shows "Resting until Dec 1, 2026" (`billing.plan.resting.until`) in place of "Used up: team paused".
- **The platform cap stays apart.** A session held at the free plan's monthly cap sets no stop, writes no resting
  note and never says Resting (asserted in `session-live.test.ts`).

Tests: `packages/db` `billing.test.ts`; `apps/orchestrator` `session-live.test.ts`, `session.test.ts`,
`session-budget.test.ts`; `packages/config` `pricing.test.ts`; `apps/web/e2e/billing.spec.ts`.

## Decisions
### The two numbers proposed (for the founder)
- **Safety factor 1.5**, as the brief suggests.
- **Backstop ceiling 50 cents** past an empty balance, per session. It is about three and a half average Sonnet
  sessions ($0.14, an Estimate from WP-09 D7), so a normal task never reaches it. Worst case on Try: four sessions at
  once each overrun by 50 cents, $2.00 in a month, which Foundmill pays. A first round runs one session at a time, so
  there it is 50 cents.
- Also chosen here: **minimum reserve 10 cents** (the existing floor under which a capped round starts nothing) and
  **the average over the latest 20 sessions** of the type.

### The note's top-up and plan offers follow what can really be had
The brief's sentence is "You can top up, change plan, or let us rest until <date>". In production today no top-up can
be bought (Stripe is not set up) and no plan is on sale, so that sentence would be untrue. The note is built from what
is available: today it reads "You can bring your own Anthropic key in Settings → Keys (Anthropic bills your key, not
us), or let us rest until Dec 1, 2026, when your budget resets." With top-ups on sale and the stage open it reads as
the brief has it, with the key added.

### Finished and next items are task titles, not entity links
Tasks are not entities, so the lists carry the titles the founder reads (`founder_title`, else `title`). Every item
is a real task record; with none, the note claims no list.

### Whether top-ups are on sale is passed by the caller (changed at the rebase, Nov 19, 2026)
This branch first set it once at boot (`configureCreditsCopy`). WP-09 T13 (#251) merged with an explicit `topUps` option
instead, passed by every caller of `bookUsage` and `assertPlatformCredits`, so the boot hook is gone and the new
code follows #251: `creditsUsedUp`, `restBeforeSession`, the resting note and the low-credits note take `topUps`, and
none names a top-up unless the caller says one can be bought. The two session summaries (`RESTING_SUMMARY`,
`CREDITS_USED_UP_SUMMARY`) name no top-up at all, so #251's `creditsUsedUpSummary(topUps)` is deleted with its test.

### While resting, platform-key calls rest too
A team that rested before a session has a small balance left. Conversations, Refresh and planning are still refused
while the stop stands, as they were at zero: the leftover stays in the balance until a top-up, a key or the new month.

### A run that resumes while the team rests does not start
"The last task finishes" covers a session that is running. A task parked for an approval, or handed off, starts a new
run, and a new run does not start while the team rests (`prepareSession`).

### "The voice skill" is the Inbox Composer's rules
`packages/agents/skills/marketing/voice_guide.md` is the project's brand voice, not the product's. The product's own
voice for notes is the Composer prompt, so the sentence went there and into `terms.ts`.

### Rebase onto main, Nov 19, 2026
Session 3 of the launch plan rebased this onto #300's rebased branch. Kept from main: the 30% markup (the reserve and
a session's limit are at cost, so `costCoveredMinor(spendable)` is what is compared with the reserve and what
`maxBudgetUsd` starts from) and #251's `waysToContinue` wording ("To keep going, ..."), which takes two optional
fields here: `plans` (name "change plan" once plans are on sale) and `voice: "rest"` (the note's "You can ... or let us
rest until <date>, when your budget resets."). Changed from main: the zero-credits note is the Chief of Staff's
resting note, so #251's "You've used all your included AI!" head and its "What stopped / What still works" lines no
longer open the note (`includedAiUsedUp` is still exported, unused; Billing's zero-credits hint still shows those two
lines). The brief is the later and more specific word for that note.

## Not done
- WP-09 T13 step 3 (the note lists what still works with no model call, each proven by a test) and step 6 (a
  test-mode Stripe run, setup S8) are not done.
- `apps/web/components/conversation/logic.ts`'s fallback line, `packages/shared/src/autopilot.ts` and
  `chief-answers.ts` still word the reason as credits that ran out; the server's own sentence, which they show first,
  says Resting.
- WP-14 T12's measure "share of projects that reach Resting and what they do next" can read the audit action
  `billing.credits_exhausted`, whose details now carry `resting`, `leftMinor` and `reserveMinor`.
