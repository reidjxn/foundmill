---
date: 2026-11-16
branch: claude/wp08-t2-replies
title: A reply to the project is kept and can be answered (WP-08 T2)
areas: [db, ingest, gateway, api, web, shared, connectors, evals]
supersedes: []
---
## What changed
- Migration 0124 adds `interactions.body_untrusted` (plain text, at most 20,000 characters; RLS unchanged, the table's tenant policy). The schema comment on `content_ref` no longer claims an encrypted body store exists.
- `repos.replies`: `storeInbound` (ingest), `list` and `isInbound` (api, under RLS), `forAnswer` (gateway only: the one place the address is read), `recordAnswer`. Test: `packages/db/src/__tests__/repos/replies.test.ts`, including business B reading nothing of A's text and the text going with `repos.entities.purge`.
- Ingest's `POST /mail/inbound` now keeps a verified reply's own words (`inboundReplyText`: quoted original and footer left out) on the row whose id the `lead.replied` event already names, on a person found by address or created as "Contact (sa***@example.com)" with source `reply` and no lawful basis.
- One Inbox note from the Chief of Staff names the record and none of the text. At most 200 replies are kept a project a UTC day.
- Gateway `POST /v1/platform-mail/answer-reply` (api only): reads the address from the record, sends only as a reply (the person wrote in the last 30 days), through every `preparePlatformMail` guard; a real send writes `mail.sent` (actor: the member) and the answer on the record. Test: `apps/gateway/src/__tests__/reply-answer.test.ts` (mock and live).
- tRPC `crm.replies.list` and `crm.replies.answer` (`sectionRead/Write("crm")`); test `apps/api/src/__tests__/replies.test.ts`. `ReplyThread` on the contact's Overview shows the email as plain text with one answer box; Playwright case in `apps/web/e2e/entity-profile.spec.ts`.
- Injection eval case `email.reply_body_instructions`.

## Decisions
### The founder's D3, applied as written
Reply text is stored as plain text, 20,000 characters at most, deleted with the person's record, and read by members with access to Customers (founder, Nov 16, 2026; recorded in docs/log/2026-11/2026-11-16-claude-wp08-founder-decisions.md, pull request #244). No encrypted store.

### The founder's answer goes through a service route, not an agent tool call
The plan said "a service call from the api with purpose reply". The api's generic tool path needs an agent and goes through Cedar, which in augmented mode would ask the founder to approve the message they just wrote.
The new route follows `confirm-follow`: the founder's press is the approval, the api sends ids and words only, and the gateway reads the address, so no address reaches the api or the browser. Every guard of the project's address still runs.

### An answer is a reply or nothing
If the person last wrote more than 30 days ago, the gateway refuses (`not_recent`, "This person has not written to the project in the last 30 days, so this would not be a reply. Nothing was sent.") instead of sending it as marketing, so a founder never sends commercial mail from this box by accident.

### The gateway records the answer, and only a real one
The plan had the api write the outbound row. The gateway is the one that knows the message left, so it writes `mail.sent` and the answer row together; a simulated send (development, test, a sample business) writes neither and the screen says "Simulated: email is not switched on here, so nothing was sent." A person's project on staging or production in mock mode is refused before anything is sent.

### Past the daily cap, nothing is kept, not even the person
The plan said "the event is still written and the body is not". The event is still written. Writing an empty row would still create a CRM record per message, which a flood to a public address would turn into thousands of records, so past 200 a day no record and no row are written.

### A sender is a "Contact", not a "Follower"
`followerDisplayName` gained a label, so a stranger who wrote is "Contact (sa***@example.com)". Writing to the project is not consent to marketing, so the record has no lawful basis.

### Agents do not read reply text
No agent tool returns interactions today, and this change adds none, so the text never enters a prompt. The injection case is there for the day an agent reads a reply through the quarantined reader (WP-08 T2 step 6).

### The Playwright case lives in entity-profile.spec.ts
The plan named `crm.spec.ts`; the reply thread is on the profile, and that spec already opens a record. The e2e stack runs no gateway or mail, so the case replays a kept reply into the api's answer and records the answer call.

### Security review, and what was fixed here
The security-reviewer agent found no hard-gate bypass, and these were fixed:
- The reply's `interactionId` seed now includes the project, so one message to two projects is two rows; a conflicting id rolls back the person it created.
- An address whose record was erased (its "Deletion requested" suppression) is never imported again when the person writes; an archived record is reused.
- A record merged away is not answered from.
- A per-project advisory lock keeps the day's count and the find-or-create sound under concurrent mail.
- `crm.replies.answer` carries `modelLimited("replyAnswer")` (10 a minute and 100 a day per member).
- The contact's data export includes the kept words.
- An answer shows as from "Your project", since any of the founders may have written it.

## Not done
- From the review, left open: one note per reply (a spammer with 200 verified addresses a day makes 200 notes; the cap bounds it), no idempotency key on Send (a timed-out answer pressed again may send twice), and `lead.replied.summary` still names the sender's address (as before this change).
- Switching it on in production: needs WP-00 S1 (a real follow and its email) and S2 (SendGrid's Event Webhook to `https://ingest.foundmill.com/mail/events`, signed, domain verified), recorded in docs/DEPLOY.md.
- Also for production: SendGrid Inbound Parse for `mail.foundmill.com` posting to `https://ingest.foundmill.com/mail/inbound?token=<PLATFORM_MAIL_INBOUND_TOKEN>`.
- No code switch: the routes are on once `PLATFORM_MAIL_*` is set, which it is.
- A reading pane in the Inbox for the reply (`apps/web/components/inbox/request.ts` in the plan): the note links to the contact, where the text is.
- The founders' answers are not threaded with an `In-Reply-To` header; the subject keeps "Re: ".
