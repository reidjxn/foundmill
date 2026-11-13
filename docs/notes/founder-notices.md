# Founder notices and the former founder's cancel (security review P2-3)

Branch `claude/founder-notices`, on `claude/waitlist-invitations` (migrations 0089–0093 there). One migration here, **0094**, to be renumbered at the final rebase. Reworked in place after the second security review (same day): 0094 has not been merged anywhere.

## The problem

Someone with founder standing (an owner or a cofounder) could lower another founder's role, including the one who created the project, then remove them, then ask for the project's deletion, and nobody else was told. The deletion's warning went only to the Inbox of the people still in the project, so a removed founder never saw it and could not cancel.

## What changed

1. **Every founder is emailed about these changes**, and so is the person it happened to, even once they are out:
   - a founder's role goes below a founder's (owner or cofounder to anything lower);
   - a founder is removed (a founder is always stepped down first, so a removal counts as a founder's when someone else lowered their founder's role in the last 30 days; the audit entry names it as `formerRole`);
   - deletion is asked for: every founder, every **former founder for that request** (someone else demoted or removed them within 30 days before it, or after it), and a **receipt to the person who asked**;
   - deletion is canceled: the founders and the former founders for the request it canceled, never the one who canceled.

   The api sends ids only (`POST /v1/notify/email`, kind `founder_notice`, the audit entry's id); the gateway's one sender reads the entry, the people and the project again, and sends through `platform_notify`. The Inbox gets a Chief of Staff note for a lowered role or a removal (the deletion request and the cancel already had theirs; a cancel by a former founder now says who).
2. **A former founder can cancel the pending deletion until the request's scheduled day**: from the one-click link in their email (`/a/<token>`, a POST to confirm) or from a card on their home (Today, Home and /new). It cancels that request only, restores nothing else (they stay out; rejoining is a normal invitation), writes their own audit entry (`formerFounder: true`, `requestId`, `via`), and every founder is told.
3. **The purge**: no change. The cancel right lasts until the request's own scheduled day, the day the sweep purges on, so nothing has to wait for it.
4. **Events**: one new account-scoped event, `founder_notice.sent`, on the reader's own account events (the reader may no longer belong to the project). `fm_account_event_types()` lists it (0094), the catalog declares it, a fixture and a stream-wall test cover it.
5. **Limits** (second review, P1-1): founder notices have their own enforced daily ceiling (`pn:safety:day`, `PLATFORM_SAFETY_DAILY_CEILING`, default 5,000) and are no longer counted in `pn:all:day`; one person hears about one project at most 10 times an hour and 30 a day, past which one "More changes in {project}" email stands for the rest of the window and the rest are recorded as `folded`; in the api, one person may lower a founder's role, or ask for a deletion, 5 times a day in a project (a plain 429 refusal).

## Judgement calls

- **Classed as account-safety mail, apart from both existing classes.** There was no transactional or security class before: `EMAIL_NOTIFICATION_KINDS` are the person's own switchable kinds (with an off link, the pause, and three a day for most), `ADDRESS_EMAIL_KINDS` is the invitation (with "Don't send me invitations"). Following how security mail is classed elsewhere, a new `ACCOUNT_SAFETY_EMAIL_KINDS = ["founder_notice"]`: no switch in Settings, the pause does not hold it, none of the other kinds' counts, not the projects' room (`busy`), not "Don't send me invitations". Its own limits are below.
- **Its own ceiling, not the shared one** (P1-1). The first version counted toward `pn:all:day` without ever being refused, so two accounts could fill everyone's ceiling by flipping roles. Now `pn:safety:day` is separate and enforced (`safety_ceiling`), and `pn:all:day` is untouched by founder notices. A store that is not shared right now (Redis down) still counts on that replica rather than refusing: an outage should not silence an account-safety notice; the per-replica counts still hold the flood down.
- **Fold rather than drop** (P1-1). Past 10 an hour or 30 a day for one person and project, the first notice of the window becomes one "More changes" email (with the one-click cancel when the notice it stands for had one), and every later one in that window is recorded as skipped with `folded` on its `founder_notifications` row, so nothing is dropped silently. I chose the one-email-per-window form over a digest: a digest needs a scheduled pass to send it later, which is a larger change. The card on a former founder's home always shows a waiting deletion they may cancel, so a folded deletion email never takes the cancel away.
- **Limits on the actor in the api** (P1-1): lowering a founder's role and asking for a deletion, 5 a day per person and project, refused in plain words ("A deletion can be asked for 5 times a day by one person in a project, and that is used up for now. Try again in N hours."). A cancel is never limited: refusing it could let a deletion through, and each cancel needs a waiting request, which is limited.
- **Correction to the first version's notes**: they said each deletion request "needs a fresh sign-in". That was wrong: a request needs a sign-in within the last 10 minutes (`REAUTH_WINDOW_MS`), so one sign-in allows many requests. The 5-a-day limit above is what bounds them now.
- **Counted from the request, not the departure** (P2-1). A former founder for a deletion request is someone whose standing someone else took away within 30 days before the request, or at any time after it, and who does not have it back. They get the request's email and may cancel until that request's scheduled day, so a founder cannot wait out a window before asking. The 0094 check that capped a token at 7 days after the departure is gone with the columns it sat on. A removal is announced as a founder's removal when the demotion was in the last 30 days.
- **A receipt to whoever asks for a deletion** (P2-2), whatever the team's size: "You asked to delete {project} on {when}. It will be deleted on {day}. If this wasn't you, cancel in Settings › Danger zone and secure your account." It names nobody else and nothing about who else was told. No self-notice for a role change, a removal or a cancel.
- **Only a hard suppression stops it**: a bounce or a spam report (`HARD_SUPPRESSION_REASONS`, the words `suppressionReasonOf` writes, now shared constants), platform-wide or for that project. An unsubscribe from a project's mail or a "stop" reply does not. SendGrid's own bounce and spam lists still apply underneath. A member can no longer plant, change or delete a hard entry (P3-6): `suppression_list_write` now excludes those reasons for client roles (the service role, which writes them from delivery events, bypasses row security); a test checks the policy names the same reasons as the code. The flip side: a member can no longer remove a project's bounce entry from the app; only the service can.
- **SendGrid's global unsubscribe list** (P3-7): verified against SendGrid's v3 Mail Send reference ("bypass_unsubscribe_management: Allows you to bypass the global unsubscribe list … Bounce and spam report lists will still be checked … cannot be combined with the bypass_list_management filter"). Account-safety mail sets it (the SDK writes `mail_settings.bypass_unsubscribe_management`), and no longer sets `bypass_list_management`. Group unsubscribes are not bypassed; this email belongs to no group.
- **No unsubscribe link or List-Unsubscribe header.** `platform_notify` takes `accountSafety: true` instead of `unsubscribeUrl` (exactly one of the two; its own category `foundmill-account-safety`). The footer says why the email always arrives.
- **Demoted counts like removed.** The review names removal, but the same attack works with a demotion alone (a member cannot cancel a deletion either). A founder who left on their own does not get the cancel right.
- **`founder_departures`, written by a trigger.** A small business-scoped table filled by a security-definer trigger on `memberships`, so every path that lowers or deletes a founder's row is covered; its function now runs with `search_path = pg_catalog, public, pg_temp` and qualifies every table (P3-2). The person reads their own rows (they are no longer a member), a founder the project's; no client writes. Not exported (reason recorded).
- **One cancel link per email, in its own table** (P3-3, P3-4). `founder_cancel_links` holds one row per email that carries a cancel: the token's SHA-256 (256 random bits minted by the api, like the invitation link), the request it cancels and its end (that request's day). A newer email never replaces an older link, and the row is deleted when the gateway does not send the email, so only sent emails hold working links. The cancel names the request (from the link, or from the card) and is checked under the audit chain's lock: if another request has replaced it, the cancel is refused. Service role only, with its own RLS and cross-tenant test.
- **Names in Inbox notes** (P3-5): every person-written name in a note goes through `withoutLinks` and is markdown-escaped in the note's body, so a display name cannot become a link or markup there.
- **An admin's removal is announced** (P3-1): the recent demotion is read on the service connection before the removal's transaction (under the actor's RLS an admin could not read the project's departures). Read before, not inside, because on PGlite a second connection inside the transaction would wait for it; the tiny gap between the read and the removal does not matter, since the demotion row only grows older.
- **The removal's email carries the cancel too** when a deletion was already waiting (also a lowered role): the person is a former founder for that request whenever they left after it.
- **The Inbox has no per-person audience**, so the note is the project's: whoever reads the Inbox sees it, as they see roles in Settings › People.
- **"/home"** is not one route here: the signed-in front door is Today, the dashboards are Home, and someone with no project left lands on /new. The card is on all three (it renders nothing while there is no project to keep).
- **The base branch moves**: `team.ts` changes are kept to a few lines (the limit, the names and the demotion read before the transactions), for the coming rebase onto the role-grant rule.

## Tests (verbatim totals, this branch, after the second review)

- `pnpm -w turbo typecheck` (run alone): Tasks: 25 successful, 25 total
- eslint on the changed files: no errors, no warnings
- packages/db: Test Files 94 passed | 1 skipped (95); Tests 2394 passed | 13 skipped (2407)
- apps/api: Test Files 139 passed (139); Tests 1258 passed | 3 skipped (1261)
- apps/gateway: Test Files 33 passed (33); Tests 340 passed (340)
- packages/shared: Test Files 59 passed (59); Tests 820 passed (820)
- apps/web: Test Files 168 passed (168); Tests 1382 passed (1382)
- also packages/dugout 120 files, 1245 tests; packages/connectors 43 passed | 1 skipped (44) files, 828 passed | 121 skipped (949) tests; packages/events 13 files, 131 tests
- Playwright `founder-notices.spec.ts` on a fresh PGlite stack (api :4310, web :3310, gateway recorder :4311, `--trace off`): 3 passed. The stack's `.pglite` directory was deleted afterwards.
- `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs`: clean

## Left out

- No eval: no agent behavior changed.
- No digest sent later for folded notices: one "More changes" email per window stands for them (above).
- The founders' notices are not shown in-product beyond the Inbox notes and Settings › Preferences' latest emails ("Who runs a project, or its deletion"); a removed founder cannot read the stored copy of their email (the row is readable only by members).
- The Playwright spec needs the gateway recorder for `/a/<token>`; on the shared default stack (no `GATEWAY_URL`) that test skips and the card test still runs.
