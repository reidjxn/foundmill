-- 0079 — following a project from its public page (docs/THESIS_REVIEW.md package 1.6, first part). A visitor leaves an
-- email address and ticks a box agreeing to hear from the project; the api records here what they agreed to, word for
-- word, and when, and the person's contact in the CRM (a new one is a lead, source `page`, with no lawful basis yet).
-- It is double opt-in: the record is pending until the person confirms from the one email the platform sends them
-- (`confirmed_at`); only then is the contact's lawful basis `consent` (when it had none) and does the person count as a
-- follower. Unsubscribing from the project's mail sets `withdrawn_at`.
--
-- Who may do what:
--   read             members of the business (Customers shows "Agreed to email on Oct 7, 2026"; the Public page tab counts them)
--   write            the services only (the api's signed-out `publicPage.follow`, on the service connection): nobody in
--                    the project can write, rewrite or backdate what a person agreed to
-- A record goes with its contact when the contact is purged (a deletion request; the suppression entry stays).
create table contact_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  -- What they agreed to receive. Only email for now.
  purpose text not null constraint contact_consents_purpose_known check (purpose in ('email')),
  -- Where they agreed: the project's public page.
  source text not null constraint contact_consents_source_known check (source in ('page')),
  -- The page's address when they agreed (it may move later).
  source_ref text not null constraint contact_consents_source_ref_length check (char_length(source_ref) between 1 and 200),
  page_id uuid references project_pages(id) on delete set null,
  -- The sentence beside the box they ticked, exactly as they read it.
  consent_text text not null constraint contact_consents_text_length check (char_length(consent_text) between 1 and 600),
  -- When they ticked the box on the page.
  agreed_at timestamptz not null default now(),
  -- When they confirmed from the email (null while pending). Only a confirmed record is consent.
  confirmed_at timestamptz,
  -- When the confirmation email was last asked for (one per address per project per 30 days), and the sha256 hex of the
  -- random nonce its link carries (the link is also signed; a link from an earlier email stops working once a new one
  -- is sent, and every link stops once confirmed).
  confirmation_sent_at timestamptz,
  confirmation_token_hash text constraint contact_consents_token_hash_shape check (confirmation_token_hash is null or confirmation_token_hash ~ '^[0-9a-f]{64}$'),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One record per contact, purpose and source: a second signup with the same address writes nothing.
  constraint contact_consents_once_key unique (business_id, entity_id, purpose, source)
);
--> statement-breakpoint
create index contact_consents_entity_id_idx on contact_consents (entity_id);
--> statement-breakpoint
create index contact_consents_page_id_idx on contact_consents (page_id);
--> statement-breakpoint
select fm_tenant_table('contact_consents', array['owner'], 'read_only');
--> statement-breakpoint
-- A page's published copy may now say whether it carries the follow form (`followForm`, a boolean). A copy written
-- before this migration has no such field and stays valid; it reads as no form until the founder publishes again.
create or replace function fm_page_content_ok(c jsonb) returns boolean
language sql immutable as $$
  select coalesce(
    jsonb_typeof(c) = 'object'
    and jsonb_typeof(c->'pitch') = 'string' and char_length(c->>'pitch') between 1 and 140 and position(E'\n' in c->>'pitch') = 0 and position(E'\r' in c->>'pitch') = 0
    and jsonb_typeof(c->'about') = 'string' and char_length(c->>'about') between 1 and 1500
    and jsonb_typeof(c->'forWhom') = 'string' and char_length(c->>'forWhom') <= 300
    and jsonb_typeof(c->'stage') = 'string' and c->>'stage' in ('idea', 'building', 'live')
    and jsonb_typeof(c->'showFounders') = 'boolean'
    and (c->'followForm' is null or jsonb_typeof(c->'followForm') = 'boolean'),
    false);
$$;
