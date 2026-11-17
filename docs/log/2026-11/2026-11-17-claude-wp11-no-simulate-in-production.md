---
date: 2026-11-17
branch: claude/wp11-no-simulate-in-production
title: The Simulate panel exists in development only, never on staging or production
areas: [config, web, api, ingest, docs]
supersedes: []
---
## What changed
`SIMULATE_ENVS` is now `["development"]`. These all follow it:
- the web panel (`simulatePanelAvailable`);
- the api procedure (`dev.simulate`, 404 elsewhere);
- ingest's Simulate routes (`simulateRoutesMounted` now refuses staging as well as production, even when forced on).

Staging, test and production never show the panel, whatever `INTEGRATIONS_MODE` is. Tests cover the config flags, web
env, api simulate, ingest simulate and staging webhooks. `shell.spec.ts` already asserts the panel is absent on the
test stack.

Production runs `APP_ENV=staging` with `INTEGRATIONS_MODE=mock`, so allowing staging put the panel in front of real
founders. An owner or admin could write simulated conversions, customers and journey rows into a real project.

The same page lost its developer wording: the panel's hint named "the API" and "apps/ingest", the simulation
descriptions said "mock SendGrid parse", and a test connection's health check showed the connector's own words
("stripe mock healthy"). A healthy test connection now says "Test data: nothing was checked with the vendor."
`simulate-gate.test.tsx` renders the whole tab on staging and production (no panel) and development (panel, no
developer words).

DEPLOY §6 gains a Nov 17 table: F5 done, DMARC `p=quarantine`, Supabase backups, SendGrid S2, `web` in
`LIVE_CONNECTORS`, `LIVE_MODE`, `OPERATOR_USER_IDS`, Turnstile and Foundmill Sites.

## Decisions
- Test stays excluded, because `shell.spec.ts` expects no panel under `APP_ENV=test`. A unit test covers development.
  Only the ingest test harness forces the routes on, under `APP_ENV=test`.
- The north star and the funnel never counted simulated events: `REAL_OUTCOME_PREDICATE` drops the `system:simulate`
  actor and simulated payloads. Conversions, customer records and journeys did include them.
- DEPLOY no longer says staging fabricates events through Simulate. Its `INGEST_URL` check now reads the api boot log.

## Not done
- The connector list's "Not available yet" labels are unchanged.
- A connection's stored error (`lastError`) and its permission names in the tooltip are shown as the vendor gave them.
- Nothing to clean up. The coordinator ran the read-only count query against production on Nov 17, 2026: 0 rows.
  No real project carries simulated events, conversions, journeys, customer records or inbox items.
