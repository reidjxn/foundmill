---
date: 2026-11-16
branch: claude/wp08-t10-mail-basis
title: No email without a basis, decided in policy (WP-08 T10)
areas: [shared, policy, db, gateway, connectors, evals]
supersedes: []
---
## What changed
- `packages/shared/src/recipient-basis.ts`: `RECIPIENT_BASES` (`consent`, `relationship`, `recorded`, `none`),
  `MAIL_SEND_TOOLS` (`platform_mail:send_mail`, `sendgrid:send_mail`, `sendgrid:schedule_campaign`, `resend:send_mail`,
  `gmail:send_message`), `isMailSendTool`.
- Policy `15-mail-basis.cedar`: `mail-needs-basis` refuses a send whose basis is `none` in every mode;
  `mail-recorded-basis-asks` asks the founder for one whose basis is `recorded` in every mode (D4). `CallContext` and the
  Cedar schema gain the optional `recipientBasis`. An ask already outranks an automated allow in `evaluate.ts`.
- `apps/gateway/src/recipient-basis.ts`: `recipientBasis(db, businessId, email, now)`. The first that holds wins: a
  confirmed page consent that was not withdrawn (`consent`); a verified reply or a payment within
  `PROJECT_MAIL_RELATIONSHIP_MS` (`relationship`); a contact with a lawful basis from a source the founder made
  (`FOUNDER_SOURCES`; `recorded`); otherwise `none`. `mailRecipientEmails` reads only the recipient fields, never the
  sender. `weakestBasis` takes the least-allowed basis when a mail has several recipients. The db read is
  `repos.followers.basisFacts`.
- Pipeline: for `MAIL_SEND_TOOLS` the weakest basis among the recipients goes into the policy context. A campaign to
  one of the founder's own lists names no address, so its basis is `recorded` and the founder approves it.
- `check_contact` returns `{ email, contactable, basis }` with the new description; `contactable` is false when there is
  no basis. The gateway host and the mock follow.
- Gateway tests: `recipient-basis.test.ts` is new. The platform-mail, Resend and follow-confirmation tests now give the
  addresses they mail a basis (`fixture.mailable`, `setupGateway({ mailable })`). "Someone new" is now refused in every
  mode with no approval row, and a person the founder added is asked for in every mode.
- Golden task `channel_email_automation.refuses_cold_consumer`.

## Decisions
- A contact counts as `recorded` only from an allow-list of founder-made sources, so an unknown or agent-written source
  fails closed. The plan's rule ("source is not a channel key") let any other source through.
- A lawful basis of "consent" on a contact never stands alone: only a live consent row is consent. A follower who
  withdrew keeps that label on the contact and must not be mailed on it.
- Recipients are read as whole values from `to`, `cc`, `bcc`, `recipients` and `personalizations`, not with the text
  scanner, so the address checked is the one the mail goes to (the security review found `o'brien@…` read as `brien@…`).
- The 12-hour lapse of the untrusted-recipient register (a5 §7 item 16) is closed in effect for these tools: after the
  lapse, an address first seen in a web page still has basis `none` (test in `recipient-basis.test.ts`). It is recorded
  here because docs/DECISIONS.md is frozen.

## Not done
- From the security review, left for the founder's call: other `contactsThirdParty` tools also make a vendor email a
  person with words the agent wrote (`stripe:send_invoice`, `google_drive:share_file`, `google_calendar:create_event`
  and `update_event`, `dropbox_sign:send_signature_request`). They ask in augmented and assisted mode and are allowed in
  automated mode, as before. A checkout payment counts as `relationship`, but the payer's email is not verified. A
  channel's `upsertLead` can fill in the lawful basis of a founder-made contact that had none.
- The golden task runs only with the live evals, which this change does not dispatch.
- The tests were written alongside the code; the policy table rows were not run failing first.
