---
date: 2026-11-16
branch: claude/network-reports
title: Report a person, a profile or a message, block in the same step, and a platform review queue
areas: [db, api, web, network, safety, docs]
supersedes: []
---
## What changed
The people layer is open in production (`LIVE_MODE=1` since Nov 15), so safety came first (docs/NETWORK.md F21; WP-12 T4).
- Migration 0129 `reports`: person-level, service role only (RLS on, no policy, clients revoked), one open report per reporter and target, never about oneself; `rls/reports.test.ts`.
- `report.create` (a `protectedProcedure`, not behind `liveGate`): a person, a public profile by handle, or a message from a thread the reporter is or was in; optional `block`; ten a day in the shared limit store. Every answer reads the same whatever was stored (`blocked` echoes the ask). A reported message's words are kept on the report.
- `operator.reports.list|resolve` behind `operatorProcedure` (`OPERATOR_USER_IDS` on the api; everyone else gets NOT_FOUND). `/operator/reports` (desktop): oldest first, due time (48 hours), overdue marked, the open reports about the same person, the reported message as it read when reported and the note, as plain text.
- `/operator/reports` checks the queue on the server first, so a non-operator gets the plain not-found page.
- Report controls: under `/u/<handle>` for a signed-in visitor who is not the person (`report.canReportProfile`), on a founder's `/profiles/founder/<id>`, and "Report someone here" in a conversation's menu (reports their latest message in view). One dialog (`components/safety/ReportPersonDialog.tsx`), with "Also block".
- The nightly numbers gain `safety.reports_open` and `safety.reports_overdue`; each filed report writes one `warn` log line (ids only).
- docs/DEPLOY.md: the stale `LIVE_MODE` row corrected (leaderboards are gone; it is on in production), `OPERATOR_USER_IDS`, and "Reports: who checks and how often".
Tests: db `rls/reports.test.ts`, `metrics.test.ts`; api `reports.test.ts`; web `PublicProfiles.test.tsx`, `NetworkScreen.test.tsx`; e2e `reports.spec.ts` (390 px report and block, owner and signed-out see no control, operator resolves, non-operator gets not found).

## Decisions
### One queue for the platform, apart from community moderation
A community post keeps `live.posts.report`, which goes to that community's moderators. People, profiles and messages are not any community's, so they go to the platform's operators. The `target_kind` check can grow (an ask, an answer, a project page) without a new table.

### Every report names the person it is about
A profile is resolved to its account and a message to its author before the row is written, so the queue can show a pattern across kinds ("3 open reports") and a report survives the profile being taken down. A message can be named only by someone in its thread: nobody can file a report about a message id they guessed.

### The answer never tells what was stored
An unknown handle, a private profile, oneself, a message never seen and a duplicate all answer `{ reported: true }`, as WP-12 T4 asks, so `report.create` cannot probe who exists. The handle is matched as typed, not validated, for the same reason.

### Reporting works with the layer closed, for admitted accounts
Not behind `liveGate`: stepping back never waits for anything (the rule already in `routers/live.ts`). WP-12 T4 asked for a `signedInProcedure` so a refused stranger could report; the security review showed that lets throwaway waitlisted accounts pile reports on one public profile and fake a pattern. A refused account can reach nobody but public pages, so `protectedProcedure` it is.

### The security review's other fixes
- `blocked` echoed the result of the block, which told a caller whether an id existed: it now echoes the ask.
- One unique index over `coalesce(message, person)` collided when a reported message was deleted, which could stop its author leaving a thread or deleting their account: two partial indexes instead, with a test of both deletes.
- The message's words are copied onto the report when it is filed (`message_body`), so leaving the last thread or deleting the account does not destroy the evidence before the review.

### Block rides on the report
"Also block" calls the existing `blockPerson`, which works without a connection. Block on its own already exists in a conversation's menu and the requests panel; on `/u/<handle>` it is offered only inside Report, because the public page carries no account id and a separate block-by-handle procedure would be a second way to probe handles.

### The operator alert is a log line for now
An email to operators needs a new safety kind on the one sender and a `founder_notifications` row with no business (`business_id` is not null), which is its own change.
Until then: a `warn` line per report for a Railway log alert, the nightly counts, and DEPLOY's "open the queue at least once a day". WP-12 T6 condition 1 asks for the email before the switch; the switch was already thrown, so this is the stopgap and the email is the next safety change.

### The operator list is an api variable, never a database role
As WP-12 T4 specifies. It is read on each call, tolerates spaces and case, and ignores anything that is not an account id.

### CI starts its own servers
The e2e stack in CI is started by `.github/workflows/ci.yml`, not by `playwright.config.ts`, so `OPERATOR_USER_IDS` is set in both (the dev founder): without it `reports.spec.ts` failed on shard 8, twice, at the operator's queue.

### The operator, named by the founder (Nov 17, 2026)
One account only: the founder's Foundmill account (UID `63d2dcc8-83a4-4ac7-bc72-b323a1f8b1e4`), set as `OPERATOR_USER_IDS` on the Railway api service by the holistic-plan session ("Only this account should have special operator privileges"). The response target is two days (`REPORT_RESPONSE_TARGET_HOURS` = 48).
Only the api reads `OPERATOR_USER_IDS` (`operatorProcedure`); the web page asks the api. The list is the only path: no role, owner standing, seed owner, `SEED_OWNER_EMAILS` or address makes an operator, and an unset, empty or malformed list means nobody (api `reports.test.ts`, shared `reports.test.ts`).

### Report on /u/<handle> is decided by the server's session
CI showed a signed-out visitor the Report control: in development and test the browser's api client falls back to the development account when there is no session, so `report.canReportProfile` answered as the dev founder.
The page now renders the control only when the request itself carries a session (`getServerAuth`), so a signed-out visitor never gets a control that needs an account; the spec waits for the network to settle before it counts.

## Not done
- The operator email alert (above). Removing access is still by hand in Supabase (DEPLOY lists the two statements).
- A second sign-in factor for operators (the review's hardening note): Supabase `aal2` in `operatorProcedure`, once the founder's account has one.
- Screening of messages for money requests, and new-account limits on requests (F21's rest); `takeLive` limits out of process memory (WP-12 T5).
- The two identity systems, Find people search, open roles, trials and join requests, feedback links, referral credit and pooled credits: next changes, in that order.
