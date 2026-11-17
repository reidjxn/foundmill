-- 0137 — one Stripe account, one project (WP-11, "Sign in with Stripe", founder, Nov 17, 2026). A founder who signs in
-- with Stripe connects their account to Foundmill's Connect platform, and payments for that account reach ingest's one
-- platform endpoint, which finds the project by the account id. So a signed-in account may be connected to one project
-- at a time, and a second project is refused ("This Stripe account is already connected to another project"). A pasted key
-- is not covered: its payments arrive at the project's own address with the project's own signing secret.
create unique index integrations_stripe_connect_account_key
  on integrations ((lower(settings->>'externalAccountId')))
  where connector_key = 'stripe' and status <> 'disconnected' and archived_at is null and settings->'config'->>'kind' = 'connect';
--> statement-breakpoint
comment on index integrations_stripe_connect_account_key is 'A Stripe account signed in with (Connect) is connected to one project at a time (0137).';
