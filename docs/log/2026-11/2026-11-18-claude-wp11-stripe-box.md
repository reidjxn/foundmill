---
date: 2026-11-18
branch: claude/wp11-stripe-box
title: Stripe in its own box on Settings › Integrations; the toast names the vendor and the project
areas: [web]
supersedes: []
---
## What changed
Two changes the founder asked for after the first working "Sign in with Stripe" (Nov 18, 2026):
- **The toast after connecting** read "Connected" over the vendor account's own name ("foundmill"). It now reads
  "Connected <vendor> to <project>", for example "Connected Stripe to Foundmill", for every connector.
  - The vendor account's name stays as the second line, unless it only repeats the project's name.
- **Stripe has its own box**, "Accept payments with Stripe", above the other connectors.
  - The box holds the same row, with the same states and actions as before: Sign in with Stripe, Use an API key,
    connected, renew, check and disconnect.
  - Stripe is no longer in the Connectors list, so it appears once.

## Decisions
- **One row.** The connector row is now a single `renderRow` used by both the box and the list, so the two never drift.
- **The count.** The list's count of connected connectors now covers the listed connectors only; its mode chip still covers all of them.
- **Finishing a sign-in.** The one-press finish after a vendor's page is unchanged; that question is still with the
  founder.

## Not done
Nothing.
