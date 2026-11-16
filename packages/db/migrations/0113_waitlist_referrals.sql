-- 0113 — the waitlist is ordered by who brought whom (WP-03 T10; DECISIONS 2026-11-12, NETWORK.md §14 answer 7: "The
-- waitlist stays plain and ordered by referral"). Each entry gets its own share code, and an entry made through someone's
-- link (`?via=w.<code>`) records whose entry it came from. `repos.waitlist.admitNext` lets in first the people who
-- brought someone who joined (at least one entry with an account names them), then everyone by sign-up time. The number
-- brought never orders anyone, and nobody is shown a place or a count ("No public counts", answer 4).
--
-- RLS unchanged: the table stays the services' alone (RLS on, no policy, no grant to a client role).
alter table waitlist_entries add column code text;
--> statement-breakpoint
-- Ten characters from `a-z2-7`, the shape of a shared post's code (`POST_CODE_ALPHABET` in @foundmill/shared/via). Minted
-- on the next join (an entry made before 0113 gets one the next time its person opens the page).
alter table waitlist_entries add constraint waitlist_entries_code_format check (code is null or code ~ '^[a-z2-7]{10}$');
--> statement-breakpoint
alter table waitlist_entries add constraint waitlist_entries_code_key unique (code);
--> statement-breakpoint
-- Set once, when the entry is made; a referrer who leaves the waitlist leaves the friend's entry as it is.
alter table waitlist_entries add column referred_by_entry_id uuid references waitlist_entries(id) on delete set null;
--> statement-breakpoint
-- Nobody brings themselves.
alter table waitlist_entries add constraint waitlist_entries_not_self check (referred_by_entry_id is null or referred_by_entry_id <> id);
--> statement-breakpoint
-- The order's lookup: does anyone with an account name this entry.
create index waitlist_entries_referred_by_idx on waitlist_entries (referred_by_entry_id) where user_id is not null;
