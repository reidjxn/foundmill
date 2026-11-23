-- 0172 — a Customer Update shared as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; docs/DESIGN.md §9f).
-- A founder shares one Customer Update at a time, by their own press: the api writes one row here with exactly what
-- the public card shows, and deletes it when the founder stops sharing. Nothing is public by default: a journey with
-- no row here has no card.
--
-- The row is a copy made at the press, not a window onto the journey: the day (a date, no time), which of two
-- headlines, the lead channel's key, the standout agent's name and the founder's own optional line. It holds no
-- customer, no amount, no touch and no count, so the public read cannot reach one. The founder's line is the only
-- free text about the win, and it is the founder's to write.
--
-- customer_update_cards   read by members of the business who are not collaborators (a card is about a payment, and
--                         a collaborator reads no payment: 0094, 0107). Written by the api's service connection only, after its
--                         checks (an owner or an admin; a real payment; a published page; not a sample business): a
--                         client role holds no insert, update or delete, so a card that says "Verified" cannot be
--                         written by hand around the api.
create table customer_update_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- One card per Customer Update. Deleting the journey (or the conversion above it) deletes the card. Deleting the
  -- customer's record does not: the conversion stays with no customer, and so does the card.
  journey_id uuid not null unique references journeys (id) on delete cascade,
  headline text not null check (headline in ('new_customer', 'returning_customer')),
  occurred_on date not null,
  lead_channel_key text check (lead_channel_key is null or lead_channel_key ~ '^[a-z0-9_]{1,60}$'),
  standout_agent text check (standout_agent is null or char_length(standout_agent) between 1 and 80),
  note text check (note is null or char_length(note) between 1 and 140),
  -- True only for a payment delivered with Foundmill's own platform webhook secret (a "Sign in with Stripe" account): the
  -- card then says "Verified by Foundmill". A payment through a pasted key is real but not verified (founder, Nov 22, 2026).
  verified boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index customer_update_cards_business_id_idx on customer_update_cards (business_id, created_at desc);
--> statement-breakpoint
select fm_tenant_table('customer_update_cards', array['owner','admin'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on customer_update_cards from anon, authenticated;
--> statement-breakpoint
drop policy customer_update_cards_select on customer_update_cards;
--> statement-breakpoint
create policy customer_update_cards_select on customer_update_cards for select using (is_member_not_collaborator(business_id));
--> statement-breakpoint
-- The public read. Exactly these eight columns: the card's own id (its address, `/m/update/<id>`; never the journey's
-- id), the page's address and the six things the card prints. A row exists only while the business has a row in
-- `public_project_pages` (0077): taking the page down, archiving the business or it becoming a sample removes every
-- card at once.
create view public_customer_update_cards with (security_barrier) as
  select c.id,
         pp.slug,
         c.headline,
         c.occurred_on,
         c.lead_channel_key,
         c.standout_agent,
         c.note,
         c.verified
    from customer_update_cards c
    join project_pages p on p.business_id = c.business_id
    join public_project_pages pp on pp.slug = p.slug;
--> statement-breakpoint
-- The api's to read on the service connection, one id at a time and rate-limited, like the milestone cards (0089).
revoke all on public_customer_update_cards from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on public_customer_update_cards to service_role;
