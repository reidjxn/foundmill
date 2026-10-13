-- 0040 — department shortcuts (audit AC-13: renaming one department moved other departments' G chords).
-- Until now the shell derived every letter from the current names, first come first served, so renaming Development
-- moved Distribution from G S to G D. Each department now stores its letter: the API settles a letter for every live
-- department on each change (the stored ones stay; a new or renamed department takes the first free letter of its
-- name), and the founder can choose one in Settings › Departments (`shortcut_chosen`, kept across renames).
-- H, I, C (Home, Inbox, CRM) and G (the chord key) are never a department's. Existing rows stay null until their
-- business's first department change, and the shell derives the same letters as before for them meanwhile.
alter table departments add column shortcut text check (shortcut ~ '^[A-Z]$' and shortcut not in ('G', 'H', 'I', 'C'));
--> statement-breakpoint
alter table departments add column shortcut_chosen boolean not null default false;
--> statement-breakpoint
create unique index departments_business_id_shortcut_key on departments (business_id, shortcut) where shortcut is not null and archived_at is null;
