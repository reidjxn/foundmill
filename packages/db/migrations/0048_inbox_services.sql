-- 0048 — per-person Inbox read receipts (audit RUI-16, RUI-X1).
-- `inbox_items.state` is one column for the whole business, so one person opening a note marked it read for everyone
-- (a co-founder's "new" markers and the founder's Customer Update hold went with it) and a viewer or advisor, whose
-- update the Inbox policy refuses, could never clear their own. A read is now a row per person: `unread` means "this
-- person has not opened it", derived per viewer from these receipts; the state column keeps answered / archived (and a
-- `read` written for the whole business by the system, e.g. the Chief of Staff deciding a win on vacation).
-- Any member may keep their own receipts, whatever their role: reading is not writing the Inbox.
alter table inbox_items add constraint inbox_items_id_business_id_key unique (id, business_id);
--> statement-breakpoint
create table inbox_item_reads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  inbox_item_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A receipt can only point at an item of its own business.
  constraint inbox_item_reads_item_fkey foreign key (inbox_item_id, business_id) references inbox_items(id, business_id) on delete cascade,
  constraint inbox_item_reads_item_user_key unique (inbox_item_id, user_id)
);
--> statement-breakpoint
create index inbox_item_reads_business_id_idx on inbox_item_reads (business_id);
--> statement-breakpoint
create index inbox_item_reads_user_id_idx on inbox_item_reads (user_id, business_id);
--> statement-breakpoint
alter table inbox_item_reads enable row level security;
--> statement-breakpoint
create policy inbox_item_reads_own on inbox_item_reads for all
  using (user_id = auth.uid() and is_member(business_id))
  with check (user_id = auth.uid() and is_member(business_id));
--> statement-breakpoint
revoke all on inbox_item_reads from anon;
--> statement-breakpoint
grant select, insert, update, delete on inbox_item_reads to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('inbox_item_reads');
