-- 0069 — character styles for anthropomorphic agents (founder, 2026-10-24). A founder who turns anthropomorphic agents
-- on chooses how the team looks: photographic humans (today's faces), 3D cartoon humans, 2D cartoon humans and animals,
-- or fantasy folk. One key, four looks: the agent's `persona_key` (0067) stays what it is, and the style catalogs in
-- @foundmill/shared (`characterFor(key, style)`) are index-aligned with the human catalog, so the character of a key in
-- a style is fixed, unique per business like the key, and changes nothing when the style changes.
-- The style is the account's, beside the switch (0067): off shows agents exactly as before whatever the style says. The
-- existing policy (`user_id = auth.uid()`) and grants cover the column; a person with no row reads the default (humans).
alter table account_preferences add column agent_style text not null default 'humans' check (agent_style in ('humans', 'cartoon_3d', 'cartoon_2d', 'fantasy'));
--> statement-breakpoint
-- A portrait is now per (style, key): at most 4 × 240 = 960 images ever. Every row made before this migration is a
-- photographic human, which is what the default says. The api serves them on GET /personas/:style/:key (and
-- GET /personas/:key still means humans). RLS, the absence of policies and the service-role-only grants (0067) are unchanged.
alter table persona_portraits add column style text not null default 'humans' check (style in ('humans', 'cartoon_3d', 'cartoon_2d', 'fantasy'));
--> statement-breakpoint
alter table persona_portraits drop constraint persona_portraits_persona_key_key;
--> statement-breakpoint
alter table persona_portraits add constraint persona_portraits_style_persona_key_key unique (style, persona_key);
