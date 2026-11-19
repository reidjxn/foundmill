---
date: 2026-11-19
branch: claude/upbeat-planck-rqacw0
title: Gmail and Google Calendar as context, per project, read through the quarantined reader; sends and invitations ask first
areas: [connectors, gateway, policy, orchestrator, api, web, evals]
supersedes: []
---
## What changed
Session 15 of docs/holistic-plan/LAUNCH_EVALUATION.md (the founder's answers of Nov 19, night), on the existing `gmail` and `google_calendar` API connectors, not MCP.

- Opt-in per project: `integrations.settings.contextReads` on the Gmail or Google Calendar row, off by default. `integrations.setContextReads` (founders of the project only, audited as `integrations.context_reads`) turns it on or off; Settings › Integrations shows "Your mail and calendar as context" (`GoogleContextPanel`) once either is connected. A reconnect to the same account keeps it.
- Enforcement: the orchestrator takes the reads out of a session's grants before its token is minted (`withContextReads` in `packages/connectors/src/google-context.ts`), so the gateway refuses them as out of scope.
- Off: no `gmail:list_drafts`, `get_draft`, `list_messages`, `get_message`, no `google_calendar:list_events`, `get_event`. On: drafts and calendar; the inbox only once the row's granted scopes include `gmail.readonly`.
- New tools: `gmail:list_drafts` and `gmail:get_draft` (untrusted email, readable with `gmail.compose`, so drafts are context before the inbox is), and `google_calendar:add_event` (the founder's own calendar, no attendees, `sendUpdates: none`; on `INTERNAL_WRITE_TOOLS`). Grants: `gmail` `drafts.read`; `add_event` joins `events.create`. The operations lead and the specialists get `drafts.read`.
- Reader: `READER_ALWAYS_CONNECTORS` in `apps/gateway/src/untrusted-reader.ts`: a session granted any gmail or google_calendar tool reads all untrusted content through the quarantined reader, even with no outbound tool.
- Policy `16-founder-google.cedar`: `gmail:send_message` and `google_calendar:create_event`, `update_event`, `delete_event` ask in every mode, automated and on vacation included. Hard gates still deny.
- Evals: two injection cases in the founder's own mailbox (an inbox message, a draft) and a new `calendar_event` kind with three cases (organizer description, refund demand, fake sign-in link). A gateway test reads mock message `18f1a0003` and a calendar week with a read-only token and gets the digest only.

## Decisions
### Enforced at token mint, not in pipeline.ts
`apps/gateway/src/pipeline.ts` belongs to Session 5b. The orchestrator is the only minter of agent session tokens and the gateway checks token scope on every call, so leaving the reads out of the token is a real gate. The api's one-tool tokens never name these reads.

### The reader rule is per session, not per source
The pipeline decides on the reader from the session's grants (`grantsOutboundTools`). Extending that rule to any gmail or google_calendar grant reaches the same place without touching the pipeline: a draft or an event the agent writes lands where the founder may send or keep it, so the agent never reads outside text raw.

### Events with nobody invited are a separate tool
"Agents write events" and "inviting asks first" conflict on one `create_event`, whose arguments the policy cannot see. `add_event` takes no attendees and runs; `create_event`, `update_event` and `delete_event` notify people and always ask.

### The founder answers, never a delegate
The security review found that an ask routed as `message_customers` is decided at once by an agent Team › Responsibilities names. `FOUNDER_ACCOUNT_SEND_TOOLS` in `packages/db/src/repos/approvals.ts` makes those approvals the founder's, whoever is named, agent or person.

### Other fixes from the security review
- `add_event` writes to `primary` only: a shared, delegated or room calendar shows the event to other people.
- `update_event` reports only id, times, status and link, never the organizer's description, location or attendees.
- Only the person who connected the account turns its reads on; anyone who may change Settings turns them off.
- A disconnect clears `contextReads`; a reconnect keeps it only for the same known account id.
- `list_calendars` is blocked with calendar reads off: shared calendars' names are written by other people.
- Turning reads off reaches sessions that start afterwards; the toast says so. A running session keeps its token (up to 4 hours) until the gateway re-checks it, which belongs with `state.ts` in a later change.

### Scopes untouched
`GMAIL_SCOPES` in `gmail/tools.ts` is not changed: Session 5b splits them. The inbox gate reads the row's granted scopes, so it follows 5b's split with no further change.

## Not done
- The live Google sign-in records the requested scopes when Google's answer omits `scope` (`_shared/google-auth.ts`); the inbox gate would then trust them. Google returns `scope` in practice; left for Session 5b's scope split.
- The panel's founder check is `isOwner` on the web; the server's `isProjectFounder` also excludes example memberships and is the one enforced.
- Reading context before a turn (a digest put into the prompt by the orchestrator): agents read through their tools when the task needs it.
- A Playwright run in this session; the spec is in `e2e/settings-plain.spec.ts`.
