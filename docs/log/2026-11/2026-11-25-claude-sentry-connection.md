---
date: 2026-11-25
branch: claude/sentry-connection
title: The team reads a project's error reports through Sentry's own MCP server
areas: [connectors, gateway, agents, evals, docs]
supersedes: []
---
## What changed
- A new remote MCP connector, `sentry_mcp`, for Sentry's own server at https://mcp.sentry.dev/mcp (`SENTRY_MCP` in `packages/connectors/src/remote-mcp/servers.ts`), wired like Notion and HubSpot: catalogue, grants, `PlatformSecrets.sentryMcpClientId`, `SENTRY_MCP_CLIENT_ID` in the env schema and `.env.example`, `FOUNDER_ACCOUNT_CONNECTORS`, the agents' connector keys.
- The founder connects in Settings › Integrations with Sentry's own sign-in, on their own Sentry account. Settings lists it from the catalogue, so the screen's code did not change. Not connected is 409 `integration_not_connected`; there is no platform key to fall back to.
- Foundmill's own list for the server: 18 reads run; `update_issue` and `link_issue` run unasked; `add_issue_note` is a send.
- Hard gates: keys (`create_dsn`, `update_dsn`, `create_project`), team access (`create_team`, `add_team_to_project`), uptime checks and Seer analysis. Alerts and metric monitors ask every time (`askAlways`).
- Every other tool goes through `call_unlisted_tool`, which asks first. A hard-gate name, any spelling of a listed hard gate, and on Sentry any name about keys, teams, members or access are refused before anyone is asked.
- A recorded mock answers the reads and issue changes, including one issue whose title carries an instruction (`SENTRY_DEMO_INJECTION_ISSUE`), so `INTEGRATIONS_MODE=mock` runs it and the gateway marks every answer simulated.
- Grants: `issues.read` for the Head of Security (`security_engineer`) and the infrastructure engineer.
- The library skill `error_reports_sentry` is version 2: it tells the founder they can connect Sentry in Settings › Integrations, and has a section on reading the open reports when connected, tying each to a release and proposing the fix as a task. Every note keeps the direct link, and the skill still works when Sentry is not connected.
- Tests: Sentry's connect flow against its recorded metadata, the policy list and the read capability (`remote-mcp.test.ts` in packages/connectors), the gateway path (`apps/gateway/src/__tests__/remote-mcp.test.ts`), and a new eval `evals/src/error-reports/` (connected, not connected, an instruction inside a report).
- FOUNDMILL.md: Sentry added to the vendors approved for an OAuth client that a vendor's MCP server requires.

## Decisions
### The founder's approval
Asked "do you approve an OAuth client for Sentry so the team can read reports?", the founder answered: "Yes, approved, build the Sentry connection". This is the per-vendor approval FOUNDMILL.md requires for an OAuth client that a vendor's MCP server needs. The answer reached this session through the session that assigned the work (Nov 25, 2026).

### Dynamic registration, so nothing is created by hand in Sentry
On Nov 25, 2026, mcp.sentry.dev's `/.well-known/oauth-authorization-server` listed a `registration_endpoint` with `token_endpoint_auth_method: none`, PKCE S256, refresh tokens and a revocation endpoint. sentry.io's `/.well-known/mcp.json` and MCP server card name the same server.
So, as with Notion, the operator registers Foundmill's public client once at https://mcp.sentry.dev/oauth/register with the redirect URI `<APP_URL>/integrations/oauth/callback` and sets `SENTRY_MCP_CLIENT_ID`. No client secret is needed.

### No scopes are asked
The server's metadata offers only coarse write scopes (`org:read`, `project:write`, `team:write`, `event:write`, `alerts:write`). Sentry's consent screen grants by skill (getsentry/sentry-mcp `skills.ts`): inspect, seer and docs are on by default, and triage and project-management are off.
Foundmill's own list governs what any agent can reach, whatever the token allows. So the connection asks for no scope, and a token that reports project-management access is refused.

### Which changes run and which stop
Changing an issue's status, assignee or priority is undone by changing it back, like a Notion page or a HubSpot record, so it runs (founder, Nov 23, 2026). A note is shown to the whole Sentry organization and notifies the people following the issue, so it is treated as a Notion comment.
A DSN is a key to the project, and creating a project makes one; team access is an access setting; Seer is paid on the founder's Sentry plan. Those six are hard gates with a step the founder takes in Sentry.

### What the security review changed
- `update_issue` posts its `reason` argument as a comment, so a call with one is refused; a note goes through `add_issue_note`.
- A sign-in whose token reports write access to projects, teams, members, alerts or the organization (`refusedScopes`) is not connected, and the scopes a token reports are stored.
- Uptime checks send requests the arguments choose, so they are hard gates. Alerts and monitors choose who receives error data, so they ask every time.
- A listed hard gate named through `call_unlisted_tool` in another spelling (`createDsn`) is refused on every server.

### Only the workers get the reads
The engineering lead's tool definitions were already near the ceiling in `tool-budget.test.ts`, and adding the reads pushed it over. The Head of Security and the infrastructure engineer read the reports and propose the fixes as tasks, so the lead keeps its tools. A founder can still add the grant to the lead.

## Not done
- Nobody signed in to Sentry with a real account: the tool list is Sentry's published `toolDefinitions.json`, and the live answers may differ from the recorded mock.
- Alerts, monitors and uptime checks are on no list, so each asks first through `call_unlisted_tool`.
