---
date: 2026-11-15
branch: claude/landing-direction
pr: 153
title: The landing page's critique and direction, and the founder's answers
areas: [docs, design, landing]
supersedes: ["The landing page's idea box (founder)", "The landing page, less dense (founder) (#105)"]
---
## What changed
- `docs/holistic-plan/landing/DIRECTION.md`: the reader (a first-timer on a phone), the one job, nine sections the same at every width, the copy, the people section, a claims table mapping every sentence to code, a switch table, the design in design-system terms, measures and three experiment hypotheses.
- Today's `/` rendered at 390 and 1440 px (`docs/holistic-plan/landing/shots/today-*.png`); impeccable's critique (Nielsen 21/32) and, at the founder's request, its detector (55 findings at 1440, 6 at 390 on today's page; 0 in the mock's source).
- Storybook `Landing/Direction`: the hero and two sections with the recorded and the filled button (`shots/direction-*.png`).
- `docs/DESIGN.md` §9a rewritten for the new page; the earlier page's spec kept under "/tour".

## Decisions
### The founder's answers (Nov 15)
- `/` is for the first-timer alone; today's page moves to `/tour`.
- The idea box's button is the flat filled primary (`IDEA_BUTTON = "filled"`); the 2026-11-13 dark outlined look stays as "recorded".
- The home page is indexed once sign-up opens: indexing follows `SIGNUP_OPEN`.
- Open the people layer and build what it needs end to end, reporting included: a separate session; turning `LIVE_MODE` on is a deployment step.
- Keep `/tour`, with broad A/B testing at launch.
### Two lines from the brief held back
Pooled cofounder credits are not built (a9 §1.3), and Share exists only in the desktop console, so "share in one tap" is not true on a phone (a9 A9-P1-5). Each returns when its code ships.
### Follow lines wait for platform mail
A page's Follow form confirms by email, and platform mail is not confirmed on in production (e0), so "Four people follow the page" renders only with `PLATFORM_MAIL_DOMAIN` set.
### Switches are read at build time from the web's own environment
The page is `force-static`; unset means off, which matches production today. The api's variables of the same names do not reach the web build.
### No top-bar start button
It competed with the idea box and led to the invite wall; the top bar is the wordmark, Sign in and, with the people layer on, Find people.
### impeccable's detector
Allowed by the founder over the session brief; its engine was fetched into the session's scratch directory, checked against the skill's pinned checksum, and pointed at a copy of the files.

## Not done
No product code here: #157, #172 and #182 build it.
