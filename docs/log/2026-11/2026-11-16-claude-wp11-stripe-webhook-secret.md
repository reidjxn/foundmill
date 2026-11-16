---
date: 2026-11-16
branch: claude/wp11-stripe-webhook-secret
title: A founder's own Stripe stores its webhook signing secret
areas: [gateway, connectors, ingest]
supersedes: []
---
## What changed
**WP-11 T20 (the Stripe half of N2).** Built behind its switch: it reaches production when `stripe` is in ingest's `LIVE_CONNECTORS` (WP-00 S8). WP-07's pay link and WP-08's first payment wait for it.
- `STRIPE_CONNECT_FIELDS` gains an optional secret field `webhookSecret` ("Webhook signing secret", `whsec_…`). Its hint says where to find it.
- The gateway's `WEBHOOK_SECRET_FIELDS` (`apps/gateway/src/integrations.ts`) holds one entry, `stripe`. The field is taken out of the input before `connector.connect` sees it, and a value that does not start with `whsec_` is a 400 (`invalid_webhook_secret`) before Stripe is called.
- After the main key is stored, the secret is sealed as a second `credentials` row of kind `stripe_webhook_secret` on the same integration, in the same transaction, under the row-bound AAD. It is never echoed, and the audit row names only its kind.
- Tests: `service-routes.test.ts` (two rows, with the secret sealed and absent from the answer, the audit and the logs; one row without it; `abc` refused) and `staging-webhooks.test.ts` (staging with `stripe` live: a delivery signed with the stored secret writes `payment.received`, another secret is 401, and the same delivery at another project's address writes nothing there).
  `connect-fields.test.ts` lists the new field.
- docs/DEPLOY.md §5 item 5 (the founder's steps in Stripe) and docs/SECURITY_REVIEW.md N2.

## Decisions
### Only in live mode with a key
A mock connect seals nothing, as before, so a signing secret given to a mock connect is dropped with the rest of the input.
### The secret is checked by shape only
Stripe has no API that confirms an endpoint secret. A wrong `whsec_` value is caught when the first delivery fails to verify (401 in ingest's log).

## Not done
- The Settings › Integrations Playwright spec was not run in this session: the dialog renders `connectFields` as given, and CI runs the spec because this changes `packages/connectors`.
- Showing the project's webhook address in the product is WP-07's.
