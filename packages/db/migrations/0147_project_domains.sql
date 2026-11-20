-- 0147 — a project's own domain (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path B: a domain the founder
-- already owns). One row per project: the domain, the name its mail is sent as there (`<sender_local_part>@<domain>`),
-- the id of its domain authentication at Foundmill's SendGrid, the DNS records the founder adds and what the last check
-- found, and whether sending from it is verified. Replies still come back through the project's Foundmill address
-- (Reply-To), and the founder's own MX is never touched.
--
-- Who may do what:
--   read                     members of the business (Settings › Integrations shows the domain and its records)
--   add, check, remove       the founders (owner or admin), through the api, which asks the gateway (the only service that
--                            reaches SendGrid and DNS) and writes the row on the service connection: no app role writes
--                            here, so nobody can mark a domain verified without the check
--
-- Verification needs the project's own ownership TXT (`_foundmill.<domain>`, a value derived from the project and the
-- domain) besides SendGrid's records, which are the same for every project on Foundmill's one SendGrid account: so only
-- whoever controls the domain's DNS can verify it for a project. A domain is verified by one real (not simulated) project
-- at most (the partial unique index), and a pending row never blocks the real owner.
create table project_domains (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  domain text not null
    constraint project_domains_domain_format check (domain ~ '^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'),
  sender_local_part text not null default 'hello'
    constraint project_domains_sender_format check (sender_local_part ~ '^(?=.{1,40}$)[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'),
  -- SendGrid's id for the domain authentication (its whitelabel domain), kept as text.
  sendgrid_domain_id text not null,
  -- The records to show: [{ purpose, type, host, value, priority?, found, reason? }] (packages/shared `OwnDomainRecord`).
  records jsonb not null default '[]'::jsonb
    constraint project_domains_records_array check (jsonb_typeof(records) = 'array'),
  status text not null default 'pending'
    constraint project_domains_status_known check (status in ('pending', 'verified')),
  -- Written from the connector's mock (development, test, a sample business): never the From of a live send.
  simulated boolean not null default false,
  checked_at timestamptz,
  verified_at timestamptz,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_domains_business_id_key unique (business_id)
);
--> statement-breakpoint
create unique index project_domains_verified_domain_key on project_domains (domain) where status = 'verified' and not simulated;
--> statement-breakpoint
create index project_domains_added_by_idx on project_domains (added_by);
--> statement-breakpoint
select fm_track_updated_at('project_domains');
--> statement-breakpoint
alter table project_domains enable row level security;
--> statement-breakpoint
create policy project_domains_select on project_domains for select using (is_member(business_id));
--> statement-breakpoint
revoke all on project_domains from anon, authenticated;
--> statement-breakpoint
-- Members read what Settings shows, never SendGrid's id or who added it.
grant select (id, business_id, domain, sender_local_part, records, status, simulated, checked_at, verified_at, created_at, updated_at) on project_domains to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on project_domains to service_role;
