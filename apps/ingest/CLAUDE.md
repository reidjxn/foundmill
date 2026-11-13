# apps/ingest (`@foundmill/ingest`)

Webhook receivers (Stripe, SendGrid, GitHub, Shopify, ...): verify, normalize to platform events, write through the outbox. Also Foundmill's own billing webhook, the platform sending address's endpoints (`/mail/*`) and the dev-only Simulate panel backend. It calls no vendor API and serves no screens.

## Invariants
- **Verify before parsing:** the raw body is never parsed before the connector's `verify()` has read the bytes the vendor signed.
- Normalized events are declared in `packages/events` with Zod and written through the outbox, one transaction per event, idempotent on (connector, external id). Conversions, the customer's CRM link and milestones are written in the same transaction as the event.
- Mock webhooks verify against secrets committed in `fixtures/`, so they mount in development and test only (`registry.mountableWebhooks`); in staging and production a webhook mounts only for a connector running live, and a delivery is written only for a business whose integration for it is connected.
- Per-business webhook secrets are read from the vault and decrypted in memory (`src/secrets.ts`); never log them.
- The Simulate routes exist only in development or staging with the flag on, and require the service token the api mints for an owner or admin; elsewhere they are 404, so production cannot fabricate events.
- The `/mail/*` endpoints are 404 while `PLATFORM_MAIL_DOMAIN` is unset, and check their own tokens and signatures (`src/platform-mail.ts`).
- A live credit top-up is paid out only by `POST /billing/stripe`, signed with `STRIPE_BILLING_WEBHOOK_SECRET`.
- Simulated results never count as real outcomes. Database through `repos` only (`fm/no-raw-db`); env through `loadEnv()`.

## Read when needed
- docs/ARCHITECTURE.md §1 (line 13, the app's scope), §8 Connectors (lines 127–145: webhook mounts at 132, the platform mail endpoints at 133), §5 Events (83–106), §17 Staging (294–301). Lines are very long: read a range or grep.
- docs/BUILD.md §13.1 Connector contract (`webhooks`), §13.3 Mock mode, §8.1 Event catalog, §11.4 Customer Journey ("Triggers"), §14 Security and compliance checklist.
- Decisions: `node scripts/decisions-index.mjs webhook` (add a vendor name to narrow), then read only the printed range.

## Commands
- `pnpm --filter @foundmill/ingest typecheck` | `lint` | `test`
- A new event type: `pnpm --filter @foundmill/events test` too (`new-event` skill).

## Key files
- `src/app.ts`: `createIngestApp(deps)`, the HTTP surface
- `src/webhooks.ts`: `POST /webhooks/:connector[/:businessId]`, verification and routing
- `src/ingest.ts`: the write path into `events` + `outbox`
- `src/conversions.ts`, `src/customers.ts`: conversions and CRM links
- `src/platform-mail.ts`: `/mail/inbound`, `/mail/events`, `/mail/unsubscribe`, `/mail/confirm`, `/mail/notify/off`
- `src/billing.ts`: Foundmill's own Stripe billing webhook
- `src/simulate.ts`, `src/simulate-token.ts`: dev-only Simulate panel
- `src/secrets.ts`: per-business webhook secrets
