---
date: 2026-11-22
branch: claude/dreamy-archimedes-6wts6h
title: Founder-only approvals for made files, listed remote changes and hosted-browser steps; destructive remote arguments denied
areas: [db, api, orchestrator, gateway, connectors, policy]
supersedes: []
---
## What changed
- `packages/db` `repos/approvals.ts`: `FOUNDER_ONLY_TOOLS` and `founderOnlyCall` list the calls only an owner or admin approves: CLI-Anything `release_output`, the listed Notion and HubSpot change tools, every `browser_<site>` step, and the founder-account sends (`FOUNDER_ACCOUNT_SEND_TOOLS`). `routeApproval` never hands one to an agent or a member.
- The same file: `resolve()` refuses a yes on a founder-only call unless it comes from a person who is an owner, cofounder or admin now. A stored null decision type is the founder's too. `useGranted` and `useDecided` run a call only under such a yes, so a grant a delegate, the Chief of Staff or the system gave before this change never runs a release.
- `apps/api` `approver.ts`: a stored null decision type is no longer recomputed from the connector's hints, and a founder-only call is the founder's whatever type it carries.
- `apps/orchestrator` `plan.ts`: `approve_spend` with `approval_id` refuses a founder-only approval, and grants an ordinary one as the plan's (system), never as the user a `by` param names. `session.ts` closes a founder-only hold that moved on by itself as expired, not approved.
- `packages/policy` `48-remote-change.cedar`: the listed Notion and HubSpot change tools ask in every mode, automated and vacation included.
- `packages/connectors` `remote-mcp/index.ts`: `remoteHardGateCall` also names a listed change call whose arguments delete, trash, archive, merge or change access, and the gateway denies it at step 2c, before any approval is looked at. The `notion-update-page` schema now declares `command`.
- Tests: `approvals-founder-only.test.ts` (db), `staff-authority.test.ts` (api), `plan.test.ts` (orchestrator), `remote-mcp.test.ts` (gateway and connectors), `evaluate.test.ts` (policy).

## Decisions
### One shared list, checked where approvals are routed, resolved and used
The gateway, plans, Inbox answers, Chief of Staff decisions and the session replay all go through `repos.approvals`. So the rule is enforced there and in `approver.ts`, not in each caller, and `pipeline.ts` is unchanged.
### Null means the founder's, and fails closed for rows from before 0054
A null `decision_type` is answered and used only by an owner or admin. Only the system's own bookkeeping of a recorded hold may still close one as approved, and that never runs a call.
### Destructive arguments: what the vendors document (read Nov 22, 2026)
- Notion's tool reference lists only `update_properties` and `update_content` for `notion-update-page`, so any other command, or none, is denied.
- `notion-move-pages` moves items that inherit access from their new parent. It is denied, because the arguments cannot show whether access changes.
- `notion-update-data-source` removes the options a call leaves out, so any `options`, or a property set to null, is denied.
- HubSpot documents no arguments for `manage_*`. The scanner fails closed on removing words in operation-like arguments or argument names, at any depth and inside JSON strings.
### No migration
Every rule reads columns that already exist (`decision_type`, `by_kind`, `by_id`, memberships).

## Not done
- The role check in `resolve()` and the update are two statements. A role removed between them is let through once.
- `call_unlisted_tool` on a remote server is still routed as messaging customers (from `UNLISTED_HINTS`), so it can be delegated.
- Our list still calls the Notion tool `notion-update-database`; Notion now names it `notion-update-data-source`.
