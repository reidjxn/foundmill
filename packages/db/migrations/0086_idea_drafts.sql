-- 0086 — the landing page's idea box (founder, Nov 13, 2026; docs/IDEA_BOX.md): a signed-out visitor's one card, kept
-- until they sign in and claim it, and the waitlist that keeps it for someone not yet admitted.
--
-- `idea_drafts`: one card drafted for a browser before any sign-up. The browser holds an opaque token in a cookie and
-- the sign-in email holds a second one (the claim token, for another device); only their SHA-256 (lowercase hex) is
-- stored. A draft nobody claims is deleted after `expires_at` (7 days), or after `held_until` when the waitlist holds it
-- (90 days). Claiming it puts the card in the person's deck as an idea (`idea_id`) and records who claimed it.
--
-- `waitlist_entries`: a signed-in person who is not on the invite list yet, with the draft they want to keep.
--
-- Both are the api's alone: RLS on, no policy, no grant to a client role. Nothing a browser holds can read them except
-- through the api, which answers only the holder of the token.
create table idea_drafts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  claim_hash text check (claim_hash ~ '^[0-9a-f]{64}$'),
  prompt text not null default '' check (char_length(prompt) <= 500),
  interest text check (char_length(interest) <= 60),
  card jsonb not null,
  weak_line text check (char_length(weak_line) <= 300),
  model_mode text not null check (model_mode in ('live', 'mock')),
  cost_micro bigint not null default 0 check (cost_micro >= 0),
  expires_at timestamptz not null,
  held_until timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  idea_id uuid references ideas(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint idea_drafts_token_hash_key unique (token_hash),
  constraint idea_drafts_claim_hash_key unique (claim_hash),
  constraint idea_drafts_claimed_check check ((claimed_by is null) = (claimed_at is null))
);
--> statement-breakpoint
create index idea_drafts_sweep_idx on idea_drafts (expires_at) where claimed_at is null;
--> statement-breakpoint
alter table idea_drafts enable row level security;
--> statement-breakpoint
revoke all on idea_drafts from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on idea_drafts to service_role;
--> statement-breakpoint
select fm_track_updated_at('idea_drafts');
--> statement-breakpoint
create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  idea_draft_id uuid references idea_drafts(id) on delete set null,
  admitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_entries_user_id_key unique (user_id)
);
--> statement-breakpoint
alter table waitlist_entries enable row level security;
--> statement-breakpoint
revoke all on waitlist_entries from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on waitlist_entries to service_role;
--> statement-breakpoint
select fm_track_updated_at('waitlist_entries');
--> statement-breakpoint
create index idea_drafts_claimed_by_idx on idea_drafts (claimed_by);
--> statement-breakpoint
create index idea_drafts_idea_id_idx on idea_drafts (idea_id);
--> statement-breakpoint
create index waitlist_entries_idea_draft_id_idx on waitlist_entries (idea_draft_id);
