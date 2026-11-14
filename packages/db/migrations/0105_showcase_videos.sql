-- 0105 — showcase videos of real projects (docs/THESIS_REVIEW.md §13 item 15; approved by the network session, Nov 13,
-- 2026). Foundmill's own business (the house, packages/config `HOUSE_BUSINESS_ID`) asks a project with a real, public
-- milestone whether it may post a short video made only from the project's public story; every founder of the project
-- approves the final video, and any one founder's No, Withdraw or departure overrides the others' yes. The number is a
-- placeholder (0105); the final number is set at rebase.
--
-- `showcase_requests` — business-scoped to the HOUSE: one row per ask, its overall state only, never who said what.
--   `subject_business_id` the project; `preview` the snapshot of exactly what would be posted (the shots, the post's
--   words, the link, the networks and, once final, the video's clips) and `preview_hash` its SHA-256; `asset_id` the
--   house's draft post, once every founder said yes; `asked_at` when the ask went out to the founders (null while the
--   house's media is not final: a request without its video never goes out for a yes); `media` the house's own
--   bookkeeping of the video's generation (the gateway's task and approval ids, never a key); `expires_at` when the ask
--   runs out (14 days after it went out), `approved_until` when an approval lapses (30 days after it).
--   House members read it (tenant RLS). No client role writes it: the api writes it on the service connection.
--
-- `showcase_consents` — business-scoped to the PROJECT: one row per founder asked, with a copy of the preview and its
--   hash, their own `answer` (yes or no), `answered_at`, `withdrawn_at` and `expires_at`. A founder reads their own row
--   only, while they hold an owner's standing (`has_role(..., array['owner'])`, which 0092 extends to a cofounder:
--   isOwnerRole). The house cannot read it, another founder cannot read it, a collaborator or any other member reads
--   nothing. No client role writes it.
--
-- `businesses.showcase_may_ask` — "Foundmill may ask to feature this project": null until the founders choose, which
--   reads as the one default in packages/config (`SHOWCASE_MAY_ASK_DEFAULT`), so flipping the default is a one-line
--   change. Written by the api only (an owner's standing).
--
-- `inbox_items.for_user_id` — a note for one person: the ask to each founder. Null (every note before this one) is a
--   note for everyone who reads the Inbox, as before. A restrictive policy keeps a note for someone else out of every
--   client read and write; the service's own readers (the email to a person) filter on it themselves.
--
-- Client grants follow 0087's rule: nothing is granted to anon; authenticated gets SELECT only.

create table showcase_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  subject_business_id uuid not null references businesses(id) on delete cascade,
  preview jsonb not null,
  preview_hash text not null
    constraint showcase_requests_preview_hash_format check (preview_hash ~ '^[0-9a-f]{64}$'),
  asset_id uuid references assets(id) on delete set null,
  state text not null default 'asking'
    constraint showcase_requests_state_value check (state in ('asking', 'approved', 'declined', 'withdrawn', 'expired')),
  withdraw_reason text
    constraint showcase_requests_withdraw_reason_value check (withdraw_reason is null or withdraw_reason in ('declined', 'founder_withdrew', 'founders_changed', 'expired', 'approval_lapsed', 'page_private', 'milestone_hidden', 'setting_off', 'house_withdrew')),
  media jsonb not null default '{}'::jsonb,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  asked_at timestamptz,
  expires_at timestamptz,
  approved_until timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint showcase_requests_not_self check (subject_business_id <> business_id),
  constraint showcase_requests_approved_until check ((state = 'approved') = (approved_until is not null) or state in ('withdrawn', 'expired')),
  constraint showcase_requests_final_reason check ((state in ('declined', 'withdrawn', 'expired')) = (withdraw_reason is not null))
);
--> statement-breakpoint
create index showcase_requests_business_id_idx on showcase_requests (business_id, created_at desc);
--> statement-breakpoint
create index showcase_requests_subject_idx on showcase_requests (subject_business_id, created_at desc);
--> statement-breakpoint
create unique index showcase_requests_one_open_idx on showcase_requests (subject_business_id) where state in ('asking', 'approved');
--> statement-breakpoint
create index showcase_requests_asset_id_idx on showcase_requests (asset_id);
--> statement-breakpoint
create index showcase_requests_requested_by_user_id_idx on showcase_requests (requested_by_user_id);
--> statement-breakpoint
alter table showcase_requests enable row level security;
--> statement-breakpoint
create policy showcase_requests_select on showcase_requests for select using (is_member(business_id));
--> statement-breakpoint
revoke all on showcase_requests from public, anon, authenticated;
--> statement-breakpoint
grant select on showcase_requests to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on showcase_requests to service_role;
--> statement-breakpoint
select fm_track_updated_at('showcase_requests');
--> statement-breakpoint
create table showcase_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid not null references showcase_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  inbox_item_id uuid,
  preview jsonb not null,
  preview_hash text not null
    constraint showcase_consents_preview_hash_format check (preview_hash ~ '^[0-9a-f]{64}$'),
  answer text
    constraint showcase_consents_answer_value check (answer is null or answer in ('yes', 'no')),
  answered_at timestamptz,
  withdrawn_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint showcase_consents_request_user_key unique (request_id, user_id),
  constraint showcase_consents_answered_when check ((answer is null) = (answered_at is null)),
  constraint showcase_consents_withdrawn_yes check (withdrawn_at is null or coalesce(answer = 'yes', false)),
  constraint showcase_consents_inbox_item_fkey foreign key (inbox_item_id, business_id) references inbox_items (id, business_id) on delete set null (inbox_item_id)
);
--> statement-breakpoint
create index showcase_consents_business_id_idx on showcase_consents (business_id, created_at desc);
--> statement-breakpoint
create index showcase_consents_user_id_idx on showcase_consents (user_id, business_id);
--> statement-breakpoint
create index showcase_consents_inbox_item_id_idx on showcase_consents (inbox_item_id);
--> statement-breakpoint
alter table showcase_consents enable row level security;
--> statement-breakpoint
create policy showcase_consents_select on showcase_consents for select using (user_id = auth.uid() and has_role(business_id, array['owner']));
--> statement-breakpoint
revoke all on showcase_consents from public, anon, authenticated;
--> statement-breakpoint
grant select on showcase_consents to authenticated;
--> statement-breakpoint
grant select, insert, update, delete on showcase_consents to service_role;
--> statement-breakpoint
select fm_track_updated_at('showcase_consents');
--> statement-breakpoint
alter table businesses add column showcase_may_ask boolean;
--> statement-breakpoint
alter table inbox_items add column for_user_id uuid references auth.users(id) on delete cascade;
--> statement-breakpoint
create index inbox_items_for_user_id_idx on inbox_items (for_user_id) where for_user_id is not null;
--> statement-breakpoint
-- Restrictive: ANDed with 0005's tenant policies, so a note for one person is nobody else's to read, change or delete.
create policy inbox_items_for_user on inbox_items as restrictive for all
  using (for_user_id is null or for_user_id = auth.uid())
  with check (for_user_id is null or for_user_id = auth.uid());
