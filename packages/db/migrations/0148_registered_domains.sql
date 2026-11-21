-- 0148 — a domain registered through Foundmill (docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, Path A, on
-- OpenSRS), on the same row as a project's own domain (0147). The founder registers it as its owner (registrant of
-- record); Foundmill sets its records (SendGrid's, the ownership TXT, the site, MX to Foundmill's inbound through SendGrid
-- Inbound Parse, DMARC p=none). What OpenSRS answered is kept: the order id, when it was registered and when it expires,
-- and the price the founder was shown (an Estimate: OpenSRS's cost plus about $3). A registered domain is never removed
-- from its project here (the founder owns it; moving it away is its own flow).
--
-- Forwarding: mail to any name at a registered domain arrives in the project; a copy goes to a founder's own inbox only
-- after that founder turned it on (`forwarding_user_id`, `forwarding_opted_in_at`). No mailboxes.
alter table project_domains add column source text not null default 'own'
  constraint project_domains_source_known check (source in ('own', 'registered'));
--> statement-breakpoint
-- A registered domain's row is written the moment OpenSRS registered it, before SendGrid's authentication exists.
alter table project_domains alter column sendgrid_domain_id drop not null;
--> statement-breakpoint
alter table project_domains add column registrar_order_id text;
--> statement-breakpoint
alter table project_domains add column registered_at timestamptz;
--> statement-breakpoint
alter table project_domains add column expires_at timestamptz;
--> statement-breakpoint
alter table project_domains add column price_minor bigint
  constraint project_domains_price_range check (price_minor is null or price_minor between 0 and 1000000);
--> statement-breakpoint
-- What the founder pays for a domain is in US dollars.
alter table project_domains add column currency char(3) not null default 'USD';
--> statement-breakpoint
alter table project_domains add column forwarding_user_id uuid references auth.users(id) on delete set null;
--> statement-breakpoint
alter table project_domains add column forwarding_opted_in_at timestamptz;
--> statement-breakpoint
alter table project_domains add constraint project_domains_registered_fields check (source = 'own' or (registrar_order_id is not null and registered_at is not null and expires_at is not null));
--> statement-breakpoint
create index project_domains_forwarding_user_id_idx on project_domains (forwarding_user_id);
--> statement-breakpoint
-- Members may see which founder gets the copy (Settings says whose inbox), never the registrar's order id.
grant select (source, registered_at, expires_at, price_minor, currency, forwarding_user_id, forwarding_opted_in_at) on project_domains to authenticated;
