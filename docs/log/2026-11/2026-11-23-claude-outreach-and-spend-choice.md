---
date: 2026-11-23
branch: claude/outreach-and-spend-choice
title: Outside contact runs from the first message, and the spend choice reads in the founder's words (Launch Session 24, follow-up)
areas: [policy, connectors, gateway, web, shared, docs]
supersedes: []
---
## The founder's rule
Founder, Nov 23, 2026, as relayed by the coordinating session, on the two areas held back from #382:

> Spending: "This should be a choice for users: Let small spends run on their own as long as they are always under the budget, or keep asking every time?"

> First contact: "If the someone new is IN the platform, keep the ask for first contact only, then the team can reach out on their own. However, if the someone new is external (for example a supplier or a factory or a logistics company or whatever externally), then the agents should be able to reach out on their own from the start."

## What changed
- `packages/policy`: `15-mail-basis.cedar` (`mail-needs-basis`, `mail-recorded-basis-asks`) and `16-founder-google.cedar` (`founder-google-send-asks`) are removed.
- `packages/connectors`: `platform_mail`, `sendgrid` and `resend` `send_mail`, and `gmail` `send_message`, lose `irreversible`, so assisted mode lets them run. `sendgrid` `schedule_campaign` keeps it.
- Settings › What the team can do: the spend answers read "Small spends run on their own" and "Ask me every time" (the default, unchanged since #364).
- Copy: the assisted description, and the "can't be undone" stop, no longer say sending an email counts. FOUNDMILL.md (the project address line and the Nov 23 paragraph), the skills README rule 3 and three code comments change to match.
- Tests: the policy table and `founder-google.test.ts`.
- Gateway tests: platform mail (a person the founder added runs in assisted, someone new runs in automated, augmented asks), the founder's calendar (an invitation runs in automated and asks in augmented, answered by the founder only), follow confirmation and the BYO-key ask list.
- The Settings unit tests and the commit and team-can-do Playwright specs follow the new labels.
- Copy that said sends and invitations always ask first now says they run on their own unless the project asks before anything outside the business: the Gmail drafts refusal (#384), the `create_draft` and `add_event` descriptions, the Google context panel in Settings (with its unit test and `settings-plain.spec.ts`), and comments in `grants.ts` and `booking-calendar.ts`.

## Decisions
- Spending: the founder asked in this session, "Don't we already have a budget cap set by users?" Yes: the spend cap per action is that budget. So no new budget was added; the two answers that already existed are reworded. Paying and moving money stay hard gates.
- Outside contact: the founder chose to lift the basis rule and the first-message asks. Asked once more about `untrusted-recipient`, they chose to keep it. So an address first seen in a web page, an email or a document is still refused until it is verified, which enforces the Never line on instructions in untrusted content.
- Suppression, the daily send cap, unsubscribe and pausing, and the untrusted-recipient register are unchanged.
- Augmented mode still asks for every outside contact (`augmented-ask-external`): that is what the founder picks it for.
- A calendar cancellation (`delete_event`) stays `irreversible`, so it still asks in assisted mode.
- Inside Foundmill: agents have no tool that messages a person on the platform, so nothing changed there. The rule is in FOUNDMILL.md for when they do.
- `MAIL_NEEDS_BASIS_POLICY_ID` and the basis lookup in `pipeline.ts` are kept, unused by any policy, to keep the shared file's diff small.

## Not done
- The orchestrator's Temporal workflow suites could not start in this session (the test server download was blocked); CI runs them.
