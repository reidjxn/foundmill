-- An App connector's installation (the GitHub App), as the gateway verified it when the business connected it: which
-- installation, and which GitHub user proved they own or administer its account. The gateway writes it with the
-- service role after checking with GitHub; members of the business read it (as they read `integrations`, which already
-- shows the installation id). No app role writes it, so a business cannot
-- point its integration at another account's installation by writing `integrations` directly: the gateway mints
-- installation tokens only when the integration names the installation recorded here.
create table app_installations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  connector_key text not null,
  installation_id text not null,
  account_label text,
  verified_by text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index app_installations_business_connector_idx on app_installations (business_id, connector_key);
--> statement-breakpoint
select fm_tenant_table('app_installations', array['owner','admin'], 'read_only');
