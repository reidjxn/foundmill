# Founder notices and the former founder's cancel (security review P2-3)

Branch `claude/founder-notices`, on `claude/waitlist-invitations` (migrations 0089–0093 there). One migration here, **0094**, to be renumbered at the final rebase.

## The problem

Someone with founder standing (an owner or a cofounder) could lower another founder's role, including the one who created the project, then remove them, then ask for the project's deletion, and nobody else was told. The deletion's warning went only to the Inbox of the people still in the project, so a removed founder never saw it and could not cancel.

## What changed

1. **Every founder is emailed about these changes**, and so is the person it happened to, even once they are out:
   - a founder's role goes below a founder's (owner or cofounder to anything lower);
   - a founder is removed (a founder is always stepped down first, so a removal counts as a founder's when someone else lowered their founder's role in the last 7 days; the audit entry names it as `formerRole`);
   - deletion is asked for (also to every founder someone else demoted or removed in the last 7 days);
   - deletion is canceled (the same people).

   The api sends ids only (`POST /v1/notify/email`, kind `founder_notice`, the audit entry's id); the gateway's one sender reads the entry, the people and the project again, and sends through `platform_notify`. The Inbox gets a Chief of Staff note for a lowered role or a removal (the deletion request and the cancel already had theirs; a cancel by a former founder now says who).
2. **A recently removed (or demoted) founder can cancel a pending deletion** for 7 days: from the one-click link in the deletion's email (`/a/<token>`, a POST to confirm), or from a card on their home (Today, Home and /new). It cancels and restores nothing else: they stay out, and rejoining is a normal invitation. It writes their own audit entry (`formerFounder: true`, `via`), and every founder is told.
3. **The purge**: no change. The grace is already 7 days from the request (`BUSINESS_DELETION_DELAY_DAYS`), so a deletion asked for within 7 days of a founder's removal is never due before that founder's own 7 days end. A test pins it.
4. **Events**: one new account-scoped event, `founder_notice.sent`, on the reader's own account events (the reader may no longer belong to the project). `fm_account_event_types()` lists it (0094), the catalog declares it, a fixture and a stream-wall test cover it.

## Judgement calls

- **Classed as account-safety mail, apart from both existing classes.** There was no transactional or security class before: `EMAIL_NOTIFICATION_KINDS` are the person's own switchable kinds (with an off link, the pause, and three a day for most), `ADDRESS_EMAIL_KINDS` is the invitation (with "Don't send me invitations"). Following how security mail is classed elsewhere, a new `ACCOUNT_SAFETY_EMAIL_KINDS = ["founder_notice"]`: no switch in Settings, the pause does not hold it, no per-person or per-project count, not the projects' room (`busy`), not "Don't send me invitations". It still counts toward `pn:all:day` best effort, so the other kinds see the load, but is never refused by it.
- **Only a hard suppression stops it**: a bounce or a spam report (`HARD_SUPPRESSION_REASONS`, the words `suppressionReasonOf` writes, now shared constants), platform-wide or for that project. An unsubscribe from a project's mail or a "stop" reply does not. SendGrid's own bounce and spam lists still apply underneath.
- **No unsubscribe link or List-Unsubscribe header.** `platform_notify` takes `accountSafety: true` instead of `unsubscribeUrl` (exactly one of the two; its own category `foundmill-account-safety`). The footer says why the email always arrives.
- **Never to the person who did it.** Nobody is emailed about their own step, which is what keeps a founder on their own from getting anything from their own actions. The Inbox note for a role change or a removal is written only when another founder is there to read it. The trade: an account taken over and used by the attacker sends no email to its own owner; the other founders are told.
- **Demoted counts like removed.** The review names removal, but the same attack works with a demotion alone (a member cannot cancel a deletion either). So a founder whose standing someone else took away in the last 7 days, demoted or removed, may cancel; a founder who left on their own may not.
- **`founder_departures`, written by a trigger.** The record is a small business-scoped table (`business_id` plus the person's `user_id`), filled by a security-definer trigger on `memberships`, so every path that lowers or deletes a founder's row is covered. The person reads their own rows (they are no longer a member), a founder the project's; nobody reads the token's hash; no client writes. Own RLS suite with a cross-tenant check. It is not exported (reason recorded).
- **The cancel token is minted by the api**, as the invitation link is: 256 random bits, only its SHA-256 kept on the departure with the request it cancels and its end (never past the departure's 7 days, checked by the database), spent once. The gateway uses it only when its hash matches that person's departure for the request still waiting. It follows the existing `/a/<token>` pattern (random, hashed, single use, expiring); there is nothing to sign, because the row is the record. A newer request mints a new token and the old link stops working.
- **The removal's email carries the cancel too** when a deletion was already waiting at removal time (also a lowered role). If the deletion was asked for before the removal, the purge can come before the removed founder's 7 days end; they still had the full 7 days' notice from the request (as a founder, then from the link), so the purge is not moved for it.
- **Names are read on the service connection before the change's transaction** (a person reads only their own profile under RLS; on PGlite a second connection inside the transaction would wait for it).
- **The Inbox has no per-person audience**, so the note is the project's: whoever reads the Inbox sees it, as they see roles in Settings › People.
- **"/home"** is not one route here: the signed-in front door is Today, the dashboards are Home, and someone with no project left lands on /new. The card is on all three (it renders nothing while there is no project to keep).
- **Repeated request and cancel** can produce several emails; each needs a fresh sign-in for the request and is a real change the founders should hear about, so no count was added.

## Tests (verbatim totals, this branch)

- `pnpm -w turbo typecheck`: Tasks: 25 successful, 25 total
- eslint on the changed files: no problems
- packages/db: Test Files 94 passed, 1 skipped (95); Tests 2392 passed, 13 skipped (2405)
- apps/api: Test Files 139 passed (139); Tests 1257 passed, 3 skipped (1260)
- apps/gateway: Test Files 33 passed (33); Tests 338 passed (338)
- packages/shared: Test Files 59 passed (59); Tests 817 passed (817)
- apps/web: Test Files 168 passed (168); Tests 1382 passed (1382)
- packages/dugout: Test Files 120 passed (120); Tests 1245 passed (1245)
- also packages/connectors 43 passed, 1 skipped (44) files, 828 passed, 121 skipped (949) tests; packages/events 13 files, 131 tests; apps/stream 13 files, 98 tests
- Playwright, a fresh PGlite stack (api :4310, web :3310, gateway recorder :4311, `--trace off`): `founder-notices.spec.ts` 3 passed; `return-loop.spec.ts`, `home.spec.ts`, `today.spec.ts` 20 passed. The stack's `.pglite` directory was deleted afterwards.
- `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs`: clean

## Left out

- No eval: no agent behavior changed.
- The founders' notices are not shown in-product beyond the Inbox notes and Settings › Preferences' latest emails ("Who runs a project, or its deletion"); a removed founder cannot read the stored copy of their email (the row is readable only by members).
- The Playwright spec needs the gateway recorder for `/a/<token>`; on the shared default stack (no `GATEWAY_URL`) that test skips and the card test still runs.
