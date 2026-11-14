-- 0101 — the founders' postal address for a project's marketing email (US CAN-SPAM; founder, Nov 13, 2026). CAN-SPAM
-- asks every commercial email to carry a valid physical postal address of the sender (a PO box is allowed). A project's
-- marketing email from its Foundmill sending address shows the founders' own address in the footer, which they enter
-- in Settings › Integrations; until they do, the gateway refuses a commercial send (a reply to a person who wrote first,
-- a receipt and the follow confirmation are transactional and still go out).
--
-- One row per business. Private: never on the public page or in any public view; only in the footers of the project's
-- commercial email.
--
-- Who may do what:
--   read, enter, change, remove   the founders (owner or admin); collaborators (member, viewer, advisor) and an example
--                                 visitor (always a viewer) neither read nor write it
--   read                          the gateway, on the service connection, for the footer
create table project_postal_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- One line, as packages/shared `normalizePostalAddress` writes it (`postalAddressProblem` checks the rest).
  address text not null
    constraint project_postal_addresses_address_length check (char_length(address) between 10 and 300)
    constraint project_postal_addresses_address_one_line check (address !~ '[\r\n<>]'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_postal_addresses_business_id_key unique (business_id)
);
--> statement-breakpoint
create index project_postal_addresses_updated_by_idx on project_postal_addresses (updated_by);
--> statement-breakpoint
select fm_track_updated_at('project_postal_addresses');
--> statement-breakpoint
alter table project_postal_addresses enable row level security;
--> statement-breakpoint
create policy project_postal_addresses_select on project_postal_addresses for select using (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
create policy project_postal_addresses_insert on project_postal_addresses for insert with check (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
create policy project_postal_addresses_update on project_postal_addresses for update
  using (has_role(business_id, array['owner','admin'])) with check (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
create policy project_postal_addresses_delete on project_postal_addresses for delete using (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
revoke all on project_postal_addresses from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on project_postal_addresses to authenticated, service_role;
