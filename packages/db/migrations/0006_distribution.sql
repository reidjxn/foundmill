-- 0006 — distribution: channels, campaigns, assets, channel metrics, suppression list.
create table channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel_key text not null check (channel_key in (
    'lead_generation','email_automation','seo','geo','content','social','paid_ads','influencer','affiliate',
    'direct_mail','print','broadcast','outdoor','pr','events'
  )),
  enabled boolean not null default false,
  line text not null check (line in ('attack','midfield','defence','wings')),
  fit int not null default 1 check (fit between 1 and 20),
  potential numeric(5,2) not null default 0,
  recommended boolean not null default false,
  why_md text not null default '',
  budget_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  kit_mode boolean not null default false,
  owner_agent_id uuid references agents(id) on delete set null,
  engine_workflow_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, channel_key)
);
--> statement-breakpoint
create index channels_business_id_idx on channels (business_id);
--> statement-breakpoint
create index channels_enabled_idx on channels (business_id, enabled);
--> statement-breakpoint
create index channels_owner_agent_id_idx on channels (owner_agent_id);
--> statement-breakpoint
select fm_tenant_table('channels');
--> statement-breakpoint
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  name text not null,
  goal text not null default '',
  status text not null default 'draft' check (status in ('draft','pending_approval','scheduled','live','paused','ended')),
  budget_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  starts_at timestamptz,
  ends_at timestamptz,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index campaigns_business_id_idx on campaigns (business_id);
--> statement-breakpoint
create index campaigns_channel_id_idx on campaigns (channel_id, status);
--> statement-breakpoint
create index campaigns_status_idx on campaigns (business_id, status);
--> statement-breakpoint
select fm_tenant_table('campaigns');
--> statement-breakpoint
create table assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  kind text not null check (kind in ('email','post','ad','video','article','mailer','print','script')),
  title text not null default '',
  content_ref text,
  approval_state text not null default 'draft' check (approval_state in ('draft','pending','approved','rejected')),
  authored_by_agent_id uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index assets_business_id_idx on assets (business_id);
--> statement-breakpoint
create index assets_campaign_id_idx on assets (campaign_id);
--> statement-breakpoint
create index assets_approval_state_idx on assets (business_id, approval_state);
--> statement-breakpoint
create index assets_authored_by_agent_id_idx on assets (authored_by_agent_id);
--> statement-breakpoint
select fm_tenant_table('assets');
--> statement-breakpoint
create table channel_metrics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  day date not null,
  spend_minor bigint not null default 0,
  currency char(3) not null default 'EUR',
  impressions bigint not null default 0,
  leads int not null default 0,
  signups int not null default 0,
  activations int not null default 0,
  customers int not null default 0,
  cpa_minor bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, campaign_id, day)
);
--> statement-breakpoint
create index channel_metrics_business_id_idx on channel_metrics (business_id, day);
--> statement-breakpoint
create index channel_metrics_campaign_id_idx on channel_metrics (campaign_id, day);
--> statement-breakpoint
select fm_tenant_table('channel_metrics', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
-- Hashed contact identifiers that must never be contacted. business_id null = platform-wide scope.
create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  email_hash text,
  address_hash text,
  phone_hash text,
  reason text not null,
  scope text not null default 'business' check (scope in ('business','platform')),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email_hash is not null or address_hash is not null or phone_hash is not null),
  check ((scope = 'platform') = (business_id is null))
);
--> statement-breakpoint
create index suppression_list_business_id_idx on suppression_list (business_id);
--> statement-breakpoint
create index suppression_list_email_hash_idx on suppression_list (email_hash);
--> statement-breakpoint
create index suppression_list_address_hash_idx on suppression_list (address_hash);
--> statement-breakpoint
create index suppression_list_phone_hash_idx on suppression_list (phone_hash);
--> statement-breakpoint
alter table suppression_list enable row level security;
--> statement-breakpoint
create policy suppression_list_select on suppression_list for select using (business_id is null or is_member(business_id));
--> statement-breakpoint
create policy suppression_list_write on suppression_list for all
  using (business_id is not null and has_role(business_id, array['owner','admin','member']))
  with check (business_id is not null and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
revoke all on suppression_list from anon;
--> statement-breakpoint
grant select, insert, update, delete on suppression_list to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('suppression_list');
