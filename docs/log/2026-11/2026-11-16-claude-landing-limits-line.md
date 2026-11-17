---
date: 2026-11-16
branch: claude/trusting-goldberg-28k3rx
title: The home page no longer lists payments, live web facts and project email as things the team cannot do
areas: [web, landing]
supersedes: []
---
## What changed
- `/`, "What can it not do yet?": the answer drops "Take a payment or check facts on the live web." and "Send email
  for your project." (`limitsBase` and `limitsMail` in apps/web/components/landing/words.ts). It keeps the line about
  building an app needing a GitHub account, reworded to stand alone.
- `LandingPage.tsx` `questions()` no longer builds the answer from the `platformMail` switch; the first-week section
  still uses that switch for the follow line.
- `LandingPage.test.tsx`: the two assertions on `limitsMail` are removed.

## Decisions
### The three limits come off the page now (founder, Nov 16, 2026)
The founder: "This is all wrong. We must launch with all of these features in place, thus they must be prioritised in
the plan and this must be removed from the homepage." Taking a payment (Foundmill Sites' pay button, the payment-link
tool, a founder's own Stripe), checking facts on the live web (WP-00 S6) and email for a project (WP-08 T2 and T3 on
the platform address) are launch requirements, and sign-up opens only when they work.
### The page says nothing in their place
The page does not claim any of the three while they are not switched on in production: the lines are removed, not
replaced by a promise. Sign-up is closed and the home page is not indexed until it opens.

## Not done
- The features themselves; each ships in its own change.
- The GitHub line stays until Foundmill Sites is switched on, when it stops being true as written.
