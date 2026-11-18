---
date: 2026-11-17
branch: claude/wp14-t11-commit-defaults
title: Commit opens on the careful option; the credits line has no dollar figure (WP-14 T11)
areas: [web, api, shared, e2e, docs]
supersedes: [2026-11-16-claude-wp04-t3-commit-start]
---
## What changed
- `naming.ts`: `COMMIT_SPEND_CAP_MINOR` is 500 (5.00 in the project's currency). `defaultSpendCapMinor(mode)` answers
  5.00, or the mode's own line when that is lower (Augmented keeps 0), for every founder; it no longer takes the
  profile's budget. `initialCommitForm` starts with `autopilot: false`.
- `CommitScreen.tsx`: the lede above the form is "Name your project. We've set everything else to the careful option,
  and you can change any of it later." The overnight shift's hint starts "Off unless you turn it on."
  `includedCreditsLine()` reads "Your team starts with this month's included credits." when the entry plan's config
  includes credits, and is left out when it includes none. The `hasBudget` prop and the effect that followed the
  profile's budget are gone: nothing reads them now.
- `packages/shared/src/autopilot.ts` and docs/ARCHITECTURE.md: the comment and the paragraph that said the overnight
  shift is on by default, and that a founder with no budget starts on a spend line of 0, say what is true now.
- Tests: `naming.test.ts` and `CommitForm.test.tsx` read each default and change two of them (the cap and the
  overnight shift); `idea-commit.test.ts` gains a case for a founder with no budget who commits with the defaults;
  `commit.spec.ts` reads the lede, the credits line and each default, changes two, and checks the cap kept on the
  business in Settings.

## Decisions
### What "Autopilot off" switches
Commit has one schedule switch, labeled "Overnight shift". It is Autopilot itself with the nightly cadence: on, the
form sends `autopilot: true` with `overnight: { timeZone }`; off, it sends `autopilot: false` and nothing else. There
is no second switch. The default changed in the form only. `idea.commit` already defaulted to off, and nothing here
reads or writes a project that already runs, so a running project's overnight shift is untouched.
### The 5.00 cap and "commit with no budget starts no cycle" (D1): checked, with one thing flagged
D1 holds. A cycle starts at commit only when the profile names a budget; the cap plays no part (test: no budget, cap
500, `cycle` is null, Autopilot off). What the cap does change: in Assisted mode a spending action of 5.00 or less on
a connected account runs without asking, and one above 5.00 asks. Under D4 a founder with no budget started on 0, so
every cent asked. That is what a cap for each action means and it is the founder's answer A4, but it is spending such
a founder did not name, so it is flagged in the pull request. Money movement, signatures and identity still always
ask.
### 5.00 in every mode, never more than the mode's own line
The package names Assisted. If the founder picks Automated in More options before typing a cap, the cap stays 5.00
rather than jumping to the mode's 1,000: "the careful option" should not turn into the least careful one by a single
press. Augmented keeps its 0. What the founder types is never overwritten.
### No logo is generated when the page opens
Step 1 lists "the first generated logo and its colors" among the defaults. Today a logo is generated only when the
founder asks (a model call, four marks). Generating one on opening Commit would be an AI run before the first press of
Continue, which CLAUDE.md keeps free of charge. The default stays the initials mark with the brand colors from the
idea's seed.
### The credits line names no plan and no card
The package says the line reads the plan from config. Config has no plan display name yet (WP-14 T14 adds Try,
Founder, Studio). The line reads the entry tier's included credits and says only that there are some. "No card" is
dropped: it stops being true the day the entry plan is paid.
### The lede says "project"
A new project has made no sale, so the stage rule asks for "project". The field label stays "Business name" (WP-04
T2's decision: seven specs find the field by it).

## Not done
- The plan's name in the credits line waits for WP-14 T14.
- Settings › What the team can do still suggests the mode's own line (250 for Assisted); it is not Commit and is
  another task's screen.
- The full Playwright suite and the full api suite were not run here; `commit.spec.ts`, `quick-fit.spec.ts` and the
  api's commit tests were.
