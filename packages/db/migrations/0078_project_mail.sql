-- 0078 — a Foundmill sending address for every project (docs/THESIS_REVIEW.md package 1.5; CLAUDE.md "Foundmill ...
-- gives a project an address to send email from, with a daily cap per project and the founder's approval for outside
-- contact"). One row per business: the local part it sends from (`<local_part>@<PLATFORM_MAIL_DOMAIN>`), chosen once
-- from the public page's address (else the business's slug) and then kept, so replies to old messages still reach the
-- project after the page's address changes; whether Foundmill paused it; and a cap an operator may raise.
--
-- Who may do what:
--   read                         members of the business (Settings › Integrations shows the address and the cap)
--   create the row               the services only (the gateway on the first send, the api when Settings shows it)
--   pause, raise the cap         an operator of Foundmill, on the service connection (docs/DEPLOY.md §5.7); never an
--                                agent (agents have no database access) and never the project's own founders (no
--                                write policy, and no write grant to the app roles)
--   change the local part        nobody: the guard trigger refuses it (a new address would orphan every reply)
create table project_mail (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- Same shape as a page address, and never a role address (`MAIL_RESERVED_LOCAL_PARTS` in @foundmill/shared; a test
  -- compares the two lists).
  local_part text not null
    constraint project_mail_local_part_format check (local_part ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
    constraint project_mail_local_part_reserved check (local_part not in (
      'abuse', 'admin', 'administrator', 'billing', 'bounce', 'bounces', 'dmarc', 'foundmill', 'help', 'hostmaster', 'info', 'mailer-daemon', 'marketing',
      'no-reply', 'noc', 'noreply', 'postmaster', 'privacy', 'root', 'sales', 'security', 'support', 'team', 'unsubscribe', 'webmaster', 'www')),
  -- `paused`: Foundmill stopped this project's sending (abuse, a complaint); the gateway refuses every send.
  status text not null default 'active'
    constraint project_mail_status_known check (status in ('active', 'paused')),
  -- Messages per UTC day for this project; null = the deployment's PLATFORM_MAIL_DAILY_CAP.
  daily_cap integer
    constraint project_mail_daily_cap_range check (daily_cap is null or daily_cap between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_mail_business_id_key unique (business_id),
  constraint project_mail_local_part_key unique (local_part)
);
--> statement-breakpoint
select fm_track_updated_at('project_mail');
--> statement-breakpoint
create function fm_project_mail_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'A sending address stays with its business' using errcode = '23514';
  end if;
  if new.local_part is distinct from old.local_part then
    raise exception 'A project''s sending address never changes: replies to earlier messages would be lost' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger project_mail_guard before update on project_mail for each row execute function fm_project_mail_guard();
--> statement-breakpoint
alter table project_mail enable row level security;
--> statement-breakpoint
create policy project_mail_select on project_mail for select using (is_member(business_id));
--> statement-breakpoint
revoke all on project_mail from anon, authenticated;
--> statement-breakpoint
grant select on project_mail to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on project_mail to service_role;
