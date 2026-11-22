---
date: 2026-11-21
branch: claude/dreamy-fermi-92d232
title: The demo seed never ends overdrawn, and Home's runway says "Cash is below zero" like the top bar
areas: [db, widgets, e2e, evals]
supersedes: []
---
## What changed
Main's nightly of Nov 21, 2026 (`92d14fa5`) failed three Playwright specs on every retry: `home.spec.ts:52` (the strip's runway agrees with the bar), `money-legal-distribution.spec.ts:95` (the Money line starts "You have") and `shell-chrome.spec.ts:40` (the search keeps its placeholder at 1440). No merge caused them.
The same code seeded with `SEED_TODAY=2026-11-20` gives Northwind +£44,784 and with `2026-11-21` gives −£7,717: the seed's history re-rolls with the day it runs, and nothing kept the balance above zero. No seed, journey or finance file changed between the last green nightly (`bd3b7b8a`) and `92d14fa5`.

- `packages/db/src/seed/finance.ts`: the first financing row (Northwind's director loan) grows until the balance after it never drops below three average months of spending. Ledgerly already cleared that cushion and is unchanged. Northwind seeded on seven dates from Nov 19, 2026 to Mar 2, 2027 now ends between £47K and £105K.
- `packages/db/src/seed/__tests__/seed.test.ts`: a seed on Nov 21, 2026 keeps both demo balances above zero. It failed before the fix (−771,674 at volume 0.1).
- The overdrawn seed also showed a real product bug: Home's runway tile read "−4mo" while the top bar read "Cash is below zero". `runwayTile` (`packages/widgets/src/shared/today-tiles.ts`) read `finance.runway.months` raw instead of `runwayFigure`, the shared helper that the bar, the Inbox and Finance already use.
  The same raw read is fixed in the department card's runway metric, the Cash and runway widget's tile and the Journey ribbon's horizon. `today-tiles.test.ts` covers it and fails without the fix.
- With the fix, the three spec files pass locally on a fresh seed (49 passed), and `@foundmill/widgets` (241) and the seed suite (21) pass.

## Decisions
### The seed is fixed, not the specs
The specs assert what the founder chose: a demo business with money in the bank. "You have …" is the Money line for a positive balance (Nov 9, 2026), and the search keeps its whole placeholder at 1440 when the bar holds a runway figure. A seed that can end overdrawn on some days is the defect.
The cushion is three average months of spending, not zero, so a seeded runway never sits next to the Continue block (`LIMITS.runwayBlockMonths`, 3).

### The api keeps returning negative months
`finance.overview` still divides a negative balance by the burn. That figure drives `warnings` and `blocksContinue`, which are right for an overdrawn business. The words come from `runwayFigure` / `runwayWords` on the client, as the bar already did. The Cash and runway widget's tone still reads the raw months, so an overdrawn balance stays "bad".

### The outcome eval: nothing changed what "not connected" means
`channel_email_automation.not_connected_is_not_sent` failed on Nov 21 only ("blocked for no_result"): the live agent ended the session without calling `block_task`. It passed on Nov 18, 19 and 20. A scripted run of the case returns the same tool results on `bd3b7b8a` and `92d14fa5`: both sends are denied by `mail-needs-basis`, then `block_task` succeeds.
Between those commits the channel agent's template, the eval harness and the mail tools' not-connected path did not change. #341 and #351 only add service-only connectors and a From address for a verified own domain. The failure is one live sample's behavior. The eval's acceptance line is unchanged.

## Not done
- The eval agent hears "Nobody at this address has agreed to hear from the project" (`mail-needs-basis`, a Cedar deny that runs before the connection check), never "not connected", so the case tests something slightly different from its title.
  Changing the gateway's order of checks is a policy change for its own reviewed pull request; the mock test in `evals/src/__tests__/sessions.test.ts` already notes it.
- The unit failure on the push of #352 (`apps/gateway` `follower-update.test.ts`, "a draft edited after the founder's preview is not sent") did not recur in the Nov 21 nightly and was not investigated.
