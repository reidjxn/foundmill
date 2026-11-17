---
date: 2026-11-11
branch: claude/zealous-rubin-8q52gr
title: The mobile prompt pack follows main (retention, batching, round of work, plans, 18 or older, hard gates)
areas: [docs, mobile, shared]
supersedes:
  - "The mobile tRPC batch link carries up to 10 procedures (docs/mobile backend skill)"
---
## What changed
- Retention procedures in the backend skill, live since #84: email switches in `founder.preferences.notifications().email`, `founder.email.get|update|recent`, `founder.presence.ping|get`, `today.sinceLastVisit`, `today.streak` with its real shape and the web's streak words, `email.action.get|answer`, `email.pause`, and the `/a/<token>` and `/email/pause?t=` links.
- Prompts 13 and 15 and BACKEND_CHANGES follow the retention names.
- The backend skill also documents the start flow's shapes, the Money opener as the server's area sentence, the `finance.overview` monthly rows and the average-revenue rule. Hired agents are `team.agents.list` rows.
- `RUN_UNTIL_DONE` in packages/shared reads "New rounds of work start on their own until nothing is left to do, or until you pause." The api `cycle.test.ts`, web `business-shell.test.ts` and `e2e/home.spec.ts` follow. Found from the Newly preview.
- Google sign-in (#82) is web only; the phone keeps the email code, and the api refuses Apple today (BACKEND_CHANGES item 12).
- The app's tRPC batch link carries at most 4 procedures, each procedure is read once per screen through a shared hook, and only the current screen is prefetched. The server's batch cap answers in full, four at a time; `CLIENT_CLOSED_REQUEST` (499) is ignored.
- Plans in the mobile pack are Try, Founder, Studio and Partner. The keys map `free` to Try, `pro` to Founder and `scale` to Studio. "Free" is never a name, and the `tier_limit` row shows the api's own message.
- The phone Inbox is a Founder-plan feature once sign-up opens. The app reads the server's check (WP-14 T14) and never builds its own.
- A decision that touches a hard gate keeps its full confirmation on the phone. Today's one-tap answer opens the note when the api says `requiresConfirmation`.
- 18 or older (#127) is in the backend and product skills: `founder.adult.get|confirm`, `confirmAdult: true` on `idea.commit`, and the `adult_unconfirmed` refusal.

## Decisions
### At most 4 procedures per tRPC batch
Each procedure opens its own database transaction. Production's pool is 10, and the app's 8–10-wide batches filled it and restarted the api. Six `journey.ribbon` reads were seen in one batch. Raise the limit only together with the pool size and the server's cap.

### The phone asks "I am 18 or older" at Commit, before the refusal
`idea.commit` refuses an unconfirmed account. A new phone account that skips the web would meet the refusal at Take charge. The app reads `founder.adult.get` and shows one unticked checkbox above Take charge, so the refusal is only the fallback.

### Plan names on the phone come from the server, with a key map as fallback
`billing.plan().tiers[tier].name` wins. The key map (free → Try, pro → Founder, scale → Studio) only covers a missing name. Partner has no key a founder can be on yet.

## Not done
- These entries were in docs/PROGRESS.md and docs/DECISIONS.md on this branch before those files froze. They now live here, and both files match main.
- The phone Inbox's "comes with Founder" state waits for T14's table of what each plan includes.
- `today.visit` (retention branch claude/brave-allen-52yii5) joins prompt 15 once it merges.
- Prompt 13B (Google and Apple on the phone, the waitlist) waits for the founder's Apple decision.
