-- 0011 — integrations, credentials, webhooks, policies, approvals, audit log, events, outbox.
create table integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  connector_key text not null,
  status text not null default 'disconnected' check (status in ('connected','degraded','expired','disconnected','mock')),
  auth_kind text check (auth_kind in ('oauth','api_key','app','none')),
  scopes text[] not null default '{}',
  account_label text,
  settings jsonb not null default '{}',
  last_health_at timestamptz,
  last_error text,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, connector_key)
);
--> statement-breakpoint
create index integrations_business_id_idx on integrations (business_id);
--> statement-breakpoint
create index integrations_status_idx on integrations (business_id, status);
--> statement-breakpoint
select fm_tenant_table('integrations', array['owner','admin']);
--> statement-breakpoint
alter table accounts add constraint accounts_integration_id_fkey foreign key (integration_id) references integrations(id) on delete set null;
--> statement-breakpoint
-- Envelope-encrypted vendor secrets. Only the gateway (service_role) may touch this table.
create table credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_id uuid not null references integrations(id) on delete cascade,
  kind text not null default 'secret',
  ciphertext bytea not null,
  data_key_ciphertext bytea not null,
  kms_key_id text not null,
  nonce bytea,
  expires_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index credentials_business_id_idx on credentials (business_id);
--> statement-breakpoint
create index credentials_integration_id_idx on credentials (integration_id);
--> statement-breakpoint
create index credentials_expires_at_idx on credentials (expires_at) where expires_at is not null;
--> statement-breakpoint
alter table credentials enable row level security;
--> statement-breakpoint
-- No policies: even a grant could not open this table to app roles. Belt and braces.
revoke all on credentials from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on credentials to service_role;
--> statement-breakpoint
select fm_track_updated_at('credentials');
--> statement-breakpoint
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_id uuid references integrations(id) on delete cascade,
  connector_key text not null,
  external_id text,
  secret_ref uuid references credentials(id) on delete set null,
  endpoint_path text not null,
  events text[] not null default '{}',
  status text not null default 'active' check (status in ('active','paused','failed')),
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index webhooks_business_id_idx on webhooks (business_id);
--> statement-breakpoint
create index webhooks_integration_id_idx on webhooks (integration_id);
--> statement-breakpoint
create index webhooks_connector_external_idx on webhooks (connector_key, external_id);
--> statement-breakpoint
create index webhooks_secret_ref_idx on webhooks (secret_ref);
--> statement-breakpoint
select fm_tenant_table('webhooks', array['owner','admin']);
--> statement-breakpoint
create table policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  scope text not null check (scope in ('business','department','agent')),
  scope_id uuid,
  name text not null default '',
  cedar_text text not null,
  version int not null default 1,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
--> statement-breakpoint
create index policies_business_id_idx on policies (business_id);
--> statement-breakpoint
create index policies_scope_idx on policies (business_id, scope, scope_id) where enabled;
--> statement-breakpoint
select fm_tenant_table('policies', array['owner','admin']);
--> statement-breakpoint
create table approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan_action_id uuid references plan_actions(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  session_id uuid references agent_sessions(id) on delete set null,
  inbox_item_id uuid references inbox_items(id) on delete set null,
  connector_key text,
  tool text,
  args jsonb not null default '{}',
  reasons text[] not null default '{}',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  outcome text check (outcome in ('approved','rejected','expired')),
  by_kind text check (by_kind in ('user','chief_of_staff','system')),
  by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index approvals_business_id_idx on approvals (business_id, requested_at desc);
--> statement-breakpoint
create index approvals_pending_idx on approvals (business_id) where resolved_at is null;
--> statement-breakpoint
create index approvals_plan_action_id_idx on approvals (plan_action_id);
--> statement-breakpoint
create index approvals_agent_id_idx on approvals (agent_id);
--> statement-breakpoint
create index approvals_session_id_idx on approvals (session_id);
--> statement-breakpoint
create index approvals_inbox_item_id_idx on approvals (inbox_item_id);
--> statement-breakpoint
select fm_tenant_table('approvals');
--> statement-breakpoint
-- Append-only, hash-chained per business. The chain is computed in the database by a
-- trigger so every writer (api, gateway, orchestrator) produces the same chain and no
-- client can supply a forged hash. prev_hash/hash passed by the client are overwritten.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  seq bigint not null,
  actor_kind text not null check (actor_kind in ('user','agent','system','webhook')),
  actor_id uuid,
  action text not null,
  target jsonb not null default '{}',
  details jsonb not null default '{}',
  prev_hash text,
  hash text not null,
  created_at timestamptz not null default now(),
  unique (business_id, seq)
);
--> statement-breakpoint
create index audit_log_business_id_idx on audit_log (business_id, created_at desc);
--> statement-breakpoint
create index audit_log_actor_idx on audit_log (actor_kind, actor_id);
--> statement-breakpoint
create index audit_log_action_idx on audit_log (business_id, action);
--> statement-breakpoint
create function audit_log_chain() returns trigger language plpgsql as $$
declare
  last_hash text;
  last_seq bigint;
begin
  -- Serialise appends per business so the chain has no forks.
  perform pg_advisory_xact_lock(hashtext('audit_log'), hashtext(new.business_id::text));
  select a.hash, a.seq into last_hash, last_seq
    from audit_log a where a.business_id = new.business_id order by a.seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := last_hash;
  new.created_at := coalesce(new.created_at, now());
  new.hash := encode(sha256(convert_to(
    coalesce(last_hash, '') || '|' || new.business_id::text || '|' || new.seq::text || '|' ||
    new.actor_kind || '|' || coalesce(new.actor_id::text, '') || '|' || new.action || '|' ||
    new.target::text || '|' || new.details::text || '|' || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'UTF8')), 'hex');
  return new;
end;
$$;
--> statement-breakpoint
create trigger audit_log_chain before insert on audit_log for each row execute function audit_log_chain();
--> statement-breakpoint
create function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'P0001';
end;
$$;
--> statement-breakpoint
create trigger audit_log_immutable before update or delete on audit_log for each row execute function audit_log_immutable();
--> statement-breakpoint
alter table audit_log enable row level security;
--> statement-breakpoint
create policy audit_log_select on audit_log for select using (is_member(business_id));
--> statement-breakpoint
-- Viewers never write; their (read-only) activity is audited by services if needed.
create policy audit_log_insert on audit_log for insert with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
revoke all on audit_log from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert on audit_log to authenticated, service_role;
--> statement-breakpoint
-- Verifies the chain for one business; returns the first broken seq or null when intact.
create function audit_log_verify(bid uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  expected text;
  prev text := null;
begin
  for r in select * from audit_log where business_id = bid order by seq loop
    expected := encode(sha256(convert_to(
      coalesce(prev, '') || '|' || r.business_id::text || '|' || r.seq::text || '|' ||
      r.actor_kind || '|' || coalesce(r.actor_id::text, '') || '|' || r.action || '|' ||
      r.target::text || '|' || r.details::text || '|' || to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'UTF8')), 'hex');
    if r.hash <> expected or coalesce(r.prev_hash, '') <> coalesce(prev, '') then
      return r.seq;
    end if;
    prev := r.hash;
  end loop;
  return null;
end;
$$;
--> statement-breakpoint
grant execute on function audit_log_verify(uuid) to authenticated, service_role;
--> statement-breakpoint
create table events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null default now(),
  actor jsonb not null default '{"kind":"system","id":"platform"}',
  entity_ids uuid[] not null default '{}',
  payload jsonb not null default '{}',
  narrated boolean not null default false,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index events_business_id_idx on events (business_id, occurred_at desc);
--> statement-breakpoint
create index events_type_idx on events (business_id, type, occurred_at desc);
--> statement-breakpoint
create index events_unnarrated_idx on events (business_id, occurred_at) where not narrated;
--> statement-breakpoint
create index events_entity_ids_idx on events using gin (entity_ids);
--> statement-breakpoint
create unique index events_idempotency_idx on events (business_id, idempotency_key) where idempotency_key is not null;
--> statement-breakpoint
select fm_tenant_table('events');
--> statement-breakpoint
alter table conversions add constraint conversions_source_event_id_fkey foreign key (source_event_id) references events(id) on delete set null;
--> statement-breakpoint
-- Transactional outbox: written in the same transaction as events; relayed to Redis by apps/api.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  event_id uuid not null unique references events(id) on delete cascade,
  published_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index outbox_business_id_idx on outbox (business_id);
--> statement-breakpoint
create index outbox_unpublished_idx on outbox (created_at) where published_at is null;
--> statement-breakpoint
select fm_tenant_table('outbox');
