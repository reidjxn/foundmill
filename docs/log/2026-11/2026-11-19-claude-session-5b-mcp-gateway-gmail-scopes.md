---
date: 2026-11-19
branch: claude/hopeful-keller-95yus5
title: The gateway is an MCP client for vendors' remote servers (Notion, HubSpot, Shopify, a custom one); Gmail's scopes split
areas: [gateway, connectors, api, web, docs]
supersedes: []
---
## What changed
Session 5b of docs/holistic-plan/LAUNCH_EVALUATION.md (section 2, "MCP" and "Gmail").

**Remote MCP.** `packages/connectors/src/remote-mcp/` builds a connector from a `RemoteServer` (a vendor's endpoint, Foundmill's
list of its tools with `policyHints`, a recorded mock). Four connectors are registered: `notion_mcp`, `hubspot_mcp`,
`shopify_mcp` (mock-only, see below) and `mcp_custom` (a server the founder connects by its address in Builder view).
Because it is an ordinary `Connector`, the existing pipeline already does scope, state re-check, Cedar, ask, metering,
audit, the credential, token-refresh persistence and the untrusted envelope. `apps/gateway/src/pipeline.ts` gained one
step (2c); `mcp.ts` needed no change (it already lists only the tools a session token names).
- **Sign-in.** OAuth 2.1 authorization code with PKCE S256 and the resource indicator, endpoints found from the server's
  own metadata over https only (`oauth.ts`). Foundmill holds one pre-registered client per vendor. The two connect steps
  stay stateless: the PKCE verifier is `HMAC(MCP_OAUTH_SECRET, connector | state)`, so nothing is stored between steps and
  only the gateway can finish a flow it started. The api now also passes `state` on the code step.
- **Tokens.** Sealed like every credential. Refreshed by the connector before they lapse, one refresh per credential in
  flight (Notion rotates refresh tokens and treats a replayed one as theft), the rotated token sealed back through
  `ctx.onCredentialRefreshed`. Disconnect now passes the stored credential to `connector.disconnect(integration,
  credential)` and the connector revokes both tokens when the server publishes a revocation endpoint.
- **Policy.** Listed tools carry Foundmill's hints, never the server's annotations. A tool on no list is reachable only
  through `call_unlisted_tool`, which is `contactsThirdParty` and `irreversible`, so it asks in every mode: policy `46-remote-unlisted.cedar` makes it ask even in automated mode (the first version
  relied on the hints alone and ran unasked in automated mode; the security review caught it). A name that would move money, sign, accept terms, delete permanently or change security
  settings (`hardGateName`: the name is split into words and matched by stem, so `deletePage`, `refunds` and `esign_document` count) is denied by the pipeline before anyone is asked, and refused again in the handler. A
  listed hard gate (Shopify `complete_checkout`) has no handler. Calling a listed tool through `call_unlisted_tool` is
  refused, so the list cannot be bypassed.
- **Schema size.** An agent gets a server's definitions only when its grants name them: `grants.ts` has the capabilities
  (`pages.read`, `crm.read`, ...) and the session token's allowed tools do the rest.
- **Mock.** Every server has recorded sample answers; the mock results are `simulated` like every other.
- **Settings.** The api sets `available: false` for a connector with no live build (`MOCK_ONLY_CONNECTORS`), and the web
  list hides every connector that is not available, unless it is already connected (so it can be disconnected).
  `mcp_custom` shows in Builder view only. The Gmail row has a "Turn on reading" button.

**Gmail.** `GMAIL_SCOPES` is now `gmail.send` and `gmail.compose`. `gmail.readonly` (`GMAIL_READ_SCOPE`) is asked for only
when the connect input carries `readMail: true` (the "Turn on reading" button, which signs in again; "Turn off reading"
signs in again without it). The live `list_messages` and `get_message` answer 403 `mail_read_off` while the token lacks it.
An existing connection with all three scopes keeps working.

## Vendors, as checked on Nov 19, 2026 (also in the header of `servers.ts`)
- **Notion** (`https://mcp.notion.com/mcp`): OAuth + PKCE with `resource`; metadata at `/.well-known/oauth-protected-resource/mcp`
  and `/.well-known/oauth-authorization-server`; one client registered per issuer (dynamic registration, public client), re-registering orphans grants;
  access tokens about 8 hours, rotating refresh tokens up to 180 days, `invalid_grant` is terminal; no revocation
  endpoint documented; a connected client reaches whatever the signing-in member can.
- **HubSpot** (`https://mcp.hubspot.com`): OAuth 2.0 with PKCE required, from a developer-platform app (client id and secret);
  read and write on CRM objects and engagements; no sensitive data properties; an account admin connects first; HubSpot
  plans OAuth 2.1 with single-use refresh tokens.
- **Shopify**: the Storefront MCP's catalog and cart tools were removed from `/api/mcp`; UCP at `/api/ucp/mcp` wants an agent
  profile per request; Checkout and Customer Accounts MCP list no tools or sign-in. Nothing a founder can sign into yet.

## Decisions
- **Shopify is `live: false`.** Its list is from the documentation and connecting it throws "not confirmed"; Settings hides it. The
  existing Shopify API connector stays. Flip `live` once Shopify's sign-in and the per-store address are confirmed.
- **Tool lists are recorded from documentation, not from a live `tools/list`.** Notion's names are from memory of its
  published tools; HubSpot's are from its docs page. `call_unlisted_tool` covers drift (it asks). Someone with a test
  account at each vendor should diff `tools/list` against `servers.ts` before launch.
- **Foundmill's own OAuth clients are needed** (`NOTION_MCP_CLIENT_ID`, `HUBSPOT_MCP_CLIENT_ID` and secret, `MCP_OAUTH_SECRET`): the
  exception the rule of Nov 19 names; Session 11 registers them.
- **`hardGateName` is deliberately broad** (`token`, `role`, `permission`, `payment`, ...): an unlisted read with such a
  word is refused and the fix is to add it to the list. Refusing is the safe error.
- **Custom server uses a pasted bearer token**, not OAuth (a custom server has no client Foundmill registered). Every call asks.
- **"Request an integration" does not exist on main** (the plan says keep it). Nothing here invents a contact channel; it needs one.

## Security review (agent, before the push) and what was done
Blocked the first commit on two findings, both fixed: an unlisted tool ran unasked in automated mode (policy 46 added, with
a policy row and a gateway test), and the hard-gate name check missed camelCase and inflected names (now tokenized, with a
test of 26 names). Also fixed: Gmail asks Google for exactly the requested scopes (`include_granted_scopes` off), so
reading cannot ride in on another project's grant or survive "Turn off reading"; a remote server's own words never reach an
agent in an error (fixed messages only); a rotated refresh token is not replayed by a call that loaded the old credential
(result kept 60 seconds); OAuth endpoints must be https with no localhost exception; vendor OAuth error text is cut to an
RFC 6749 code.

Left open, and why:
- Refresh across several gateway replicas, and a failed re-seal of a rotated token, still cost a reconnect (needs a row lock; `persistRefreshedCredential` has no compare-and-swap).
- Custom server addresses are checked before the request, not on the socket (L1: the transport takes `fetch`, so an undici agent with `publicOnlyLookup` can close it).
- OAuth discovery does not pin the issuer and endpoint hosts per vendor (L2).
- `manage_crm_objects` and `notion-update-page` may delete through their arguments: confirm against the live tools; they ask in augmented and assisted mode and run in automated mode.
- The custom server is hidden outside Builder view in the web only; the api accepts it from any admin (the token is the founder's own).
- Vendor health checks use the stored token without refreshing, so Notion may read "degraded" after about 8 hours until the next call.
- Existing Gmail connections that hold `gmail.readonly` keep it until the founder signs in again.

## Not done
- Custom server addresses are checked against private ranges right before the request, not on the socket (DNS rebinding is
  not stopped); the MCP SDK transport takes no custom dispatcher yet (`shortcut:` note in `custom.ts`).
- The refresh queue is per process: two gateway replicas refreshing one Notion credential at the same moment can replay a rotated token
  and cost the founder a reconnect. A database lock would close it.
- Not run: Playwright for the Settings list, and nothing was run against a live vendor.
