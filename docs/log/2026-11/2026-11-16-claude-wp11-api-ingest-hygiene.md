---
date: 2026-11-16
branch: claude/wp11-api-ingest-hygiene
title: Bounded ingest bodies, the Data API watched, the service connection counted, and three P3 items
areas: [api, ingest, web, shared, supabase]
supersedes: []
---
## What changed
**WP-11 T14, T15, T17 and steps 2 to 4 of T18 (A8-11, A8-16, A8-21, A8-22, A8-23, A8-27, SEC-8, SEC-15).** T18's step 1 (the `public_profiles` migration) ships with the database changes.
- **T15, ingest.**
  - Webhook bodies are capped before the routes: 1 MiB at `/webhooks/<connector>` and 25 MB for GitHub (`WEBHOOK_MAX_BYTES`, `WEBHOOK_MAX_BYTES_BY_CONNECTOR`), and 1 MiB at `/billing/stripe` (`BILLING_WEBHOOK_MAX_BYTES`). A larger body gets 413 and the verifier never runs.
  - `/health` adds `platformMail: { domain, inbound, events }` as booleans. `events` uses the same secret resolver as `/mail/events`.
- **T14, api.**
  - `createDataApiProbe` (`services/data-api-probe.ts`) reads `GET <SUPABASE_URL>/rest/v1/` at boot and every 10 minutes. `/health` adds `dataApi`; it never fails readiness.
  - `supabase/config.toml` declares the Data API off, anonymous sign-ins off, Confirm email on and phone sign-up off, and `scripts/supabase-config.test.mjs` holds those four.
- **T17.** `service-connection.test.ts` counts each router's `ctx.db` lines against `SERVICE_CONNECTION_ROUTERS`. The counts matched the plan's 19 files exactly. apps/api/CLAUDE.md's first invariant and docs/ARCHITECTURE.md §13 now state the rule as the code has it.
- **T18, steps 2 to 4.**
  - `parsePublicEnv` treats a production build with no known `NEXT_PUBLIC_APP_ENV` as `production`.
  - `allowedOrigins` takes `APP_ENV`, and the localhost origins are allowed only in development and test.
  - The logger redacts `accessToken`, `refreshToken`, `sealed`, and secrets two levels down.
- docs/DEPLOY.md: §3 gets ingest's webhooks, the platform address's bounces (WP-00 S2) and GitHub's deliveries; §4 gets the declared settings and the Data API check.

## Decisions
### T17's `why` is honest about what was read
I classified the clear files: `person` for live, idea and founder-businesses; `signed_out` for the email links and people pages; `service_written` for billing. The rest are `mixed`, and the note says "not classified line by line" where I did not read each use. The count is what fails the test; the label is for review.
### WP-00 S2 should not set LIVE_CONNECTORS=sendgrid on ingest
The platform address's bounces arrive at `/mail/events`, which already runs on three variables. Adding `sendgrid` to ingest's list would mount the per-project SendGrid routes, which §5.7 step 6 forbids while N2 is open. The check is the four lines in DEPLOY §3.
### The Supabase keys are unchecked against a CLI
The session has no Supabase CLI. The four key names are the CLI's documented ones (`api.enabled`, `auth.enable_anonymous_sign_ins`, `auth.email.enable_confirmations`, `auth.sms.enable_signup`). The founder's `supabase config push` (WP-00 S10) shows the diff before it applies: it must list these four and nothing else.
### The billing case is in webhooks.test.ts
It sits beside the two webhook cases and shares their in-process request helper. Over a socket, an early answer closed the connection before 2 MB was uploaded.

## Not done
- WP-00 S2 and S10 are the founder's.
