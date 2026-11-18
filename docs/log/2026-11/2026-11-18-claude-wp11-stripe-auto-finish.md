---
date: 2026-11-18
branch: claude/wp11-stripe-auto-finish
title: Back from a vendor's sign-in page, the connection finishes by itself
areas: [web]
supersedes: []
---
## What changed
The founder asked for this on Nov 18, 2026. They were asked whether the Stripe sign-in should finish connecting by itself, with no extra "Connect Stripe" press, and answered "Yes absolutely!". The founder's second Stripe test had failed for exactly this reason: Stripe sent them back, and nothing connected until they pressed the button.

`OAuthFinish` now sends the code and the signed state once, as soon as the page opens with them. The panel shows "Connecting Stripe" while it runs. The usual toast follows ("Connected Stripe to <project>" or "Could not connect"), and the address loses the code either way. A refusal from the vendor still shows its reason and a Dismiss button.

## Decisions
### Every sign-in vendor, not only Stripe
Gmail, Notion, Shopify and Stripe all come back through the same panel. Those three vendors get the same change, since the press added no protection for any of them. The api exchanges a code only with a state it signed for this founder, project and connector, within 15 minutes. A link carrying someone else's code and state therefore fails the same way with or without a press.

### One attempt per code
A ref keyed on the code keeps re-renders, and React running effects twice in development, from sending it again. A code works once at the vendor anyway.

### Only the project's admins
The panel stays inside `AdminOnly`, as before, so a collaborator who opens such a link sends nothing.

## Not done
- The GitHub installation panel ("Connect installation") still needs its press. GitHub's flow is separate, and the founder asked about the Stripe sign-in.
