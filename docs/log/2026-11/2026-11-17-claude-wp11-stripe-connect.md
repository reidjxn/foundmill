---
date: 2026-11-17
branch: claude/wp11-stripe-connect
title: Sign in with Stripe (Connect OAuth) beside a pasted key; the platform key never acts alone
areas: [connectors, gateway, api, ingest, db, web, shared, sandbox, docs]
supersedes: []
---
## What changed
The founder asked for this on Nov 17, 2026: "I think we should ship with a sign in with stripe option". Stripe is the
one exception to "no Foundmill developer apps": Foundmill is a Stripe Connect platform. A founder connects their own
Stripe account one of two ways on Settings › Integrations › Stripe:
- **Sign in with Stripe** opens Stripe's page with a state the api signed for the founder, project and connector. The
  code Stripe sends back is exchanged in the gateway and names the account. Stripe's access token is dropped. Calls
  run on the platform's Connect key (`STRIPE_CONNECT_SECRET_KEY`, else `STRIPE_SECRET_KEY`) with `Stripe-Account`.
- **Use an API key**: the restricted key, sealed as before (with T20's optional signing secret).

The rest of the change:
- **Account id alone.** It is no longer accepted. It only starts the sign-in, where Stripe names the account.
- **Health check.** It no longer uses the platform key alone. A pasted key is checked with that key, a sign-in with
  the Connect key and the account header. A key-paste row without its key reads as disconnected.
- **One account, one project.** Migration 0137 adds a partial unique index on signed-in accounts. The gateway refuses
  first with "This Stripe account is already connected to another project.", and the api maps the index's race the
  same way.
- **Replacing and disconnecting.** Signing in to another account, or pasting a key over a sign-in, withdraws the
  previous sign-in at Stripe (`oauth.deauthorize`) once the new connection is saved (new `POST
  /v1/integrations/release`, refused for any account a project is still signed in with). A sign-in over a pasted key
  revokes the key in the same save. The audit names the old and new account. Disconnecting withdraws access first
  (new `POST /v1/integrations/disconnect`; `Connector.disconnect` in the contract).
- **Webhooks.** Ingest's platform endpoint `/webhooks/stripe` routes a delivery by the account Stripe signed for
  (`repos.integrations.businessForStripeAccount`, the one cross-business lookup). `account.application.deauthorized`
  marks that connection expired with "Stripe access was removed in your Stripe dashboard. Sign in with Stripe again
  to reconnect." (`ConnectorWebhook.revokedAccount`).
- **Money only comes in.** A permanent guard in `stripe.test.ts` fails if a tool that refunds, pays out, transfers
  or cancels gains a handler or loses its hard gate, or if the set of running tools changes. The rule is now in
  `packages/connectors/CLAUDE.md`.
- **Screen.** The Stripe row says "Sign in with Stripe, or an API key" and offers both buttons when Stripe runs
  live. Renewing follows how the project connected.

## Decisions
- No sealed copy of the account id (coordinator, Nov 17): it is not a secret, and webhook routing needs it in the clear.
- The webhook endpoint is the existing `/webhooks/stripe` with `STRIPE_WEBHOOK_SECRET`, not a new
  `/webhooks/stripe/connect` and a new variable as first planned. The webhook code already treated a URL-less delivery
  as the platform's, and SEC-10's account check already covered the Connect kind. Only the lookup was missing.
- A delivery for an account no project signed in with is acknowledged and written nowhere, so Stripe stops retrying.
- Only a live sign-in (connected or degraded) holds its account, in the index and in the lookup. A test connection
  (`mock`, whose fixture account every demo shares) and an expired one (access removed in Stripe) leave it free.
- Withdrawing access at Stripe is best effort. A founder who already removed it in Stripe can still disconnect here,
  and the audit records whether it was withdrawn.
- A refused sign-in (account already in another project) withdraws nothing, because that would cut the other
  project's connection.
- `authKind` stays `oauth` for both ways in, since sign-in is the first way. `config.kind` (`connect` or `own`) tells
  them apart.

## Security review (Nov 17, 2026)
The security-reviewer agent found these, and all are fixed here:
- **High.** A blank `apiKey` beside a code skipped the state check. The api now takes the key path only for a
  non-blank key, and strips `code`, `state`, `redirectUri` and `shop` from it.
- **Medium.** Mock rows fell under the index.
- **Low.** The previous sign-in was withdrawn before the new one was saved.
- **Low.** An expired sign-in kept its account locked.
- **Gap.** The money-out guard did not look at the running tools' input fields (it does now, with `cancelUrl` named
  as the one allowed field).

## Also in this change
`apps/gateway/src/__tests__/service-routes.test.ts`, the key-validation limit test, flaked on #237's CI (expected 429,
got 200). The cause is the clock: the limiter counts per wall-clock minute, so the eleven calls could straddle a
minute boundary and the over-limit one land in a fresh window. The test now pins the gateway's injected clock
(`deps.now`) inside one minute. This is test-only, so the limiter is unchanged.

## Not done
- Archiving a project does not withdraw its Stripe sign-in at Stripe. The connection stays on Foundmill's platform until
  the founder removes it in Stripe, and the account is held until then. Left for the archive flow (WP-11 T16's closing
  plan names connections).
- `stripe` stays out of `LIVE_CONNECTORS` everywhere until payment powers is on main and the founder's test-mode
  sign-in works end to end (DEPLOY §5.5 steps 1 to 7).
- The migration number 0137 is the coordinator's (Nov 17, 2026), after #208's 0136.
