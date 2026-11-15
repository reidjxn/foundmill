-- 0073 — Builder view (founder, 2026-11-08). One account-wide switch, beside guidance (0064) and anthropomorphic agents
-- (0067): off (the default) hides how the platform runs the team (cycle numbers, tokens, ETAs, test counts, the Code,
-- Health and Hierarchy tabs, ratings out of 20, the technical columns of the change and preview lists); on shows them
-- exactly as before. Hidden, never rewritten: the data is the same either way. Operator and Exited profiles have it
-- turned on at their first profile save (founder.profile.update), where guidance is turned off for them.
-- The existing policy (`user_id = auth.uid()`) and grants cover the column; a person with no row reads the default (off).
alter table account_preferences add column builder_view boolean not null default false;
--> statement-breakpoint
comment on column account_preferences.builder_view is 'Builder view: show how the platform runs the team (cycle numbers, tokens, technical tabs and columns). Default off.';
