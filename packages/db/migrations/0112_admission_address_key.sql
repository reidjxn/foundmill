-- 0112 — open sign-up's guards (WP-03 T8). `address_key` is the mailbox an open admission came from
-- (@foundmill/shared `addressKey`: lower case, the `+tag` cut, Gmail's dots removed and googlemail.com read as
-- gmail.com). apps/api services/access.ts reads it under open sign-up's advisory lock: an address whose key was already
-- admitted waits, and so does a private domain past SIGNUP_PER_DOMAIN_PER_DAY in a UTC day. Null for every other kind of
-- admission and for the rows from before.
--
-- RLS unchanged: the table stays the service role's alone (RLS on, no policy, no grant to a client role).
alter table account_admissions add column address_key text;
--> statement-breakpoint
create index account_admissions_address_key_idx on account_admissions (address_key);
