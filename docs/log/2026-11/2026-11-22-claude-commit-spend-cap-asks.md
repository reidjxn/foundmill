---
date: 2026-11-22
branch: claude/commit-spend-cap-asks
title: Commit's spend cap starts at 0 again, so every spending action asks first
areas: [web, api, e2e, docs]
supersedes: [2026-11-17-claude-wp14-t11-commit-defaults]
---
## What changed
- `naming.ts`: `COMMIT_SPEND_CAP_MINOR` is 0 (it was 500 from WP-14 T11, #301). `defaultSpendCapMinor(mode)` is now 0 in every mode, so a project committed with the defaults asks the founder before any spending action, whatever the amount, in Assisted, Augmented and Automated.
- `CommitScreen.tsx`: `spendCapSummary` reads "Asks you before any spend" for a cap of 0, instead of "Asks you above $0.00".
- Tests: `naming.test.ts`, `CommitForm.test.tsx` and `commit.spec.ts` read 0 as the default. The api case for Commit's defaults in `idea-commit.test.ts` now commits with a cap of 0 and checks that a $1 (and a 1-cent) spending action asks first in Assisted and Augmented.
- docs/ARCHITECTURE.md: the paragraph on what commit starts says the cap opens on 0.

## Decisions
### The founder's decision
Founder, Nov 22, 2026, given to the coordinating session: "go with your recommendation on the spend caps", the recommendation being to set the cap back to asking every time. FOUNDMILL.md already says "Anything outward or costly asks first (Needs you) in augmented and assisted mode"; a 5.00 cap let an Assisted spend of 5.00 or less run without asking.
### Everything else from #301 stays
The overnight shift is still off when Commit opens, and the credits line still names no dollar figure. Only the cap's default changed. What a founder types on Commit or in Settings › What the team can do is still kept, so a founder who wants a cap can set one.
### No migration or backfill
Projects committed since Nov 17 with a cap of 500 keep it. A stored 500 cannot be told apart from a founder who typed 5 on purpose, and overwriting a limit the founder may have chosen is a change to their settings without asking. Sign-up is invite-only, so the affected projects are few; the founder can lower any of them in Settings › What the team can do. Flagged to the coordinating session.
### "Asks you before any spend"
"Asks you above $0.00" is true but reads like a mistake. The summary says what 0 means instead.

## Not done
- Settings › What the team can do still suggests the mode's own line as a recommendation (`recommendedSpendLineMinor`); it is a suggestion the founder picks, not a default, and was left alone.
- `idea.commit` called without `spendCapMinor` still stores null (no cap). The Commit screen always sends a value; changing the api default is a separate question.
- The full Playwright suite was not run here.
