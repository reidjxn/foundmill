---
date: 2026-11-16
branch: claude/wp04-t3-commit-start
title: What commit starts for a founder with no budget
areas: [agents, api, web, orchestrator]
supersedes: []
---
## What changed
WP-04 T3, built to the founder's answers D1 and D4 of Nov 16, 2026
(`2026-11-16-claude-stage3-founder-decisions.md`).

- `packages/agents` exports `firstCycleTasksFor(seed, { hasBudget })`. Without a budget it drops the tasks of kind
  `finance` and `legal`. With one it returns the seed's list.
- `idea.commit` reads `hasBudget` from the founder profile it already loads (`budgetMinor` above 0) and passes it to
  `commitIdea`. Without a budget, commit seeds the tasks `firstCycleTasksFor` returns and starts no `businessCycle`.
  `CommitIdeaResult.cycle` is `TemporalResult | null`. The overnight shift (Autopilot) still starts as before, and the
  page and the plan still draft on the first open. The commit audit row records `hasBudget`.
- On the Commit screen, `initialCommitForm` takes `{ hasBudget }`. Without a budget the spend line starts at "0" in
  every mode, through the new `defaultSpendCapMinor(mode, { hasBudget })`. `CommitForm` takes a `hasBudget` prop, which
  `CommitScreen` sets from `founder.profile.get`. The line follows the profile until the founder types one.
- The "Setting up your business" line reads "the first tasks", not "the first cycle". A founder with no budget gets no
  cycle at commit.
- docs/ARCHITECTURE.md §19 says what commit starts in each case.
- Tests: `archetypes.test.ts` (three cases), `idea-commit.test.ts` (the no-budget commit, and a spend line of 0 asks
  before a one-cent spend in Assisted and Automated while null lets it run), `autopilot.test.ts` (a project with no cycle
  and one ready task starts cycle 1 at the overnight shift's first look and does not count as idle), `naming.test.ts`
  and `CommitForm.test.tsx` (the spend line starts at 0). The existing commit tests that check cycle 1 starts now give
  their founder a budget.

## Decisions
- **0 means "ask before any spend", checked before changing the default.** The business's spend line lowers the
  approval threshold (`effectiveApprovalThresholdMinor`). It does not set the hard spend cap, which comes from an agent's
  own autonomy. The Assisted and Automated policies ask when `amountMinor > approvalThresholdMinor`, so with 0 any spend
  of a cent or more asks and work that costs nothing still runs. Null stays "no limit". This needed no change to
  docs/DECISIONS.md.
- **`hasBudget` defaults to true in `commitIdea`.** A caller that does not pass it gets today's behavior. To roll back,
  pass `hasBudget: true` from the router.
- **`decideAutopilot` needed no fix.** An empty cycle history has no idle streak, and with no cycle the daily cadence is
  due at its first hour after the shift was turned on. The new orchestrator test passes on main too: it guards the
  start, as step 3 of the task allows.
- **Only finance and legal are dropped.** For DTC and hardware the seed's specialist tasks (supplier RFQ, certification
  map) stay, so those projects start with two ready tasks, not one. The task names finance and legal only.
- **No e2e for the no-budget path.** The e2e stack's dev founder has a budget (the seed gives £60,000), so
  `first-days.spec.ts` and `commit.spec.ts` keep checking the with-budget path. A no-budget e2e would need a second
  seeded founder. The api test covers the no-budget path.
- **Code over spec.** The spec cites `commit.ts:436` and `cycle.ts:197`. Both match by function. The spec says to record
  the decision in docs/DECISIONS.md. That file is frozen, so this entry records it, which also covers step 5.

## Not done
- The first-Continue callout (`wantsFirstContinueCallout`, `BusinessShell.tsx`) still assumes commit ran cycle 1 and
  shows until two cycles have completed. For a no-budget project it shows for one round longer than needed. T13 owns
  `BusinessShell.tsx`, so it is left alone here.
- Two items wait for WP-02's reports: the Done-when figure (less than $1.00 spent in the first hour, an Estimate) and
  the claim that no agent session runs before the page note.
