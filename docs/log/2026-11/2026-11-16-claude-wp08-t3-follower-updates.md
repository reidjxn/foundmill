---
date: 2026-11-16
branch: claude/wp08-t3-follower-updates
title: Write to your followers (WP-08 T3), sent through the consent rule
areas: [db, gateway, api, modules, dugout, web, shared, events, connectors, agents, evals]
supersedes: []
---
## What changed
- Migration 0134 adds `project_updates` and `project_update_deliveries`, with RLS and `rls/project-updates.test.ts`.
  - Members read updates, and write only a draft's subject and body: the insert policy pins every other column, and update is a column grant with a draft-only policy.
  - Deliveries are service role only. They hold the contact's id, a state and a reason, never an address.
  - `fm_collaborator_event_types()` gains the two new events.
- `repos.updates`: drafts, the send's claim-before-send record, and the counts.
- Events `update.drafted` and `update.sent` (counts only). `mail.sent` gains `updateId`.
- Gateway `POST /v1/platform-mail/send-update` (api only): reads confirmed, unwithdrawn followers inside the gateway and sends one commercial message each through every `preparePlatformMail` guard, at most 50 a press, stopping at the first cap. Test: `apps/gateway/src/__tests__/follower-update.test.ts` (mock and live).
- tRPC `updates.list | get | preview | save | send | cancel`. `send` and `cancel` are for an owner or an admin with Distribution write; `send` is rate limited per member. Test: `apps/api/src/__tests__/updates.test.ts`.
- Agent tool `draft_follower_update` (capability `updates.draft`), granted to the email engine and the Chief of Staff. It writes a draft and never sends.
- `FollowerUpdatePanel` on Product › Public page, with a component test. Today shows one quiet line through the design system's `PublicPageNote` (new `line` prop and two stories).
- Golden task `channel_email_automation.follower_update`; Playwright `apps/web/e2e/follower-update.spec.ts`.

## Decisions
### The founder's D2, applied when the team drafted the update
"Written with help from AI and checked by ‹first name›." is added when an agent drafted the update, with the first name of the member who pressed Send, or "the founders" without one (founder, Nov 16, 2026; docs/log/2026-11/2026-11-16-claude-wp08-founder-decisions.md, pull request #244). A founder's own words get no AI line, because it would not be true.

### The consent rule decides every send
Each follower is checked with WP-08 T10's `recipientBasis` (#269), the same check every mail tool's call goes through, and only basis `consent` is sent to.

On top of it, a follower is read only while their contact still has the address that agreed: `contact_consents.email_hash` (0134) is set when they sign up and again when they confirm, and existing rows take their contact's address. Without it, a member who edited a follower's address would move the consent to someone who never agreed (T3 security review, High).

### Claimed before sent, so a person is never written to twice
Each follower's delivery row is claimed before their message goes out. A definite vendor refusal gives the claim back for "Send the rest"; after a timeout the message may have gone, so the person is marked skipped, not sent again.

### A simulated press records nothing
In development, test and a sample business the mock sends and the screen says "Simulated: email is not switched on here, so nothing was sent." No delivery, status change or event is written, so it can be pressed again. A person's project on staging or production in mock mode is refused.

### The send is the founder's press, through a service route
As with T2's answer, the founder pressing Send is the approval: no agent tool reaches the route, and the api sends ids only.

### The rest of the security review, fixed here
- A send starts only from the words the founder previewed (`seenUpdatedAt`), never from an update deleted since. Send is disabled while the boxes hold unsaved changes.
- Every follower is handled on their own. A vendor 5xx stops the press. Every press records its counts, `update.sent` and the audit row, whatever happened in it.
- One address is reached once per update, whichever contact record it is on (`recipient_hash`, unique per update).
- A simulated press gives the day's count back.
- The gateway checks again that the presser is an owner or an admin.
- The team keeps one open draft at a time.

### An answer to a reply goes out once
The coordinating session asked for this in T3 (WP-05 T14's rule: an outward message goes out once). The browser makes one id per answer. The gateway claims it on the shared counter for a day, and gives it back only when nothing can have gone out. A press repeated after a timeout answers "This answer already went out, or may have. Check the thread before you send it again."

### Why a postal address comes first, said before anyone writes
The panel says it as soon as the project has followers and no address, not only in the preview: "US law asks every email that tells people about a business to include a postal address, so readers know who is writing to them. A PO box or a mailbox service works." (US CAN-SPAM; founder, Nov 13, 2026.)

### The GitHub mock's merge sha carries the head (asked for by the coordinating session)
#278's CI failed in `apps/orchestrator/src/__tests__/merge.test.ts`, which this change does not touch. The mock numbers a pull request from a 900-wide hash of its head, and its merge sha came from the number alone.

When two tests' random task branches shared a number, their `pr.merged` events shared an idempotency key and the second deduped onto the first. The merge sha now includes the head branch, and `github.test.ts` pins that two heads with one number never share a merge sha.

### Smaller than the plan in three places
- The preview gives `perDay` (the project's day of email) instead of "cap left today", which only the gateway's shared counter knows.
- Today's invitation shows while the project has followers and never wrote to them, not "once per new follower day".
- The panel is covered by a component test like `PageQuizPanel`; module panels have no Storybook stories. The one design-system change, `PublicPageNote`'s `line`, has its stories.

## Not done
- On production: WP-00 S1 to S3, recorded in docs/DEPLOY.md.
- T10's `basisFacts` matches consent by the contact's current address. Checking `contact_consents.email_hash` there too would close the same gap for agents' mail. That is reported to the T10 session, not changed here.
- A follower claimed when the gateway stops mid-press stays claimed (state `sending`) and is not retried. It is rare, and visible in the counts.
- GTM-18 (agent messages through the project address) waits, as the plan says.
