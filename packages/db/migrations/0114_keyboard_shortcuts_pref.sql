-- 0114 — single-key shortcuts off by default (WP-04 T13; audit A2-03, WCAG 2.1.4). One stray key (R, J, K, E, 1–4, a
-- G chord) must not refresh, move or answer a note for a person who never asked for keys: the shell binds the single
-- keys only while `keyboard_shortcuts` is true (Settings › Preferences › Keyboard shortcuts). /, Cmd-K, ? and Esc always
-- work, and Space is never a page shortcut. A person who had turned guidance off already sees the key caps (docs/DESIGN.md
-- "Key caps go the other way"), so their keys stay on; a new account whose first profile save turns guidance off gets them
-- on in the same save (apps/api founder.profile.update).
--
-- RLS unchanged: account_preferences keeps its own-row policy (`user_id = auth.uid()`); a column needs no new policy.
alter table account_preferences add column keyboard_shortcuts boolean not null default false;
--> statement-breakpoint
update account_preferences set keyboard_shortcuts = true where guidance = 'off';
