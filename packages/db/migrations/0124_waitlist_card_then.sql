-- 0124 — where a waitlisted person's kept card goes once they are let in (founder, 2026-11-16): a visitor who chose
-- "Shape it in the Ideation Studio" on the landing page and met the waitlist is taken to the Studio, opened on that card,
-- on their first sign-in after admission. Null: the card's own page, as before. Set with the held card at
-- `waitlist.join` and read by `ideaBox.preview`; only `studio` is a value today.
--
-- RLS unchanged: waitlist_entries has RLS on and no policy for `authenticated` (only the api's own connection reads it);
-- a column needs no new policy.
alter table waitlist_entries add column card_then text;
--> statement-breakpoint
alter table waitlist_entries add constraint waitlist_entries_card_then_check check (card_then in ('studio'));
