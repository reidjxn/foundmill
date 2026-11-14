-- 0105 — an optional "which one is for you" quiz on a project's public page. A visitor answers 2 to 4 short questions
-- and sees which of the project's offers probably fits them, with the page's own Follow form or the founder's own pay
-- link; every offer stays in view. Off until the founder turns it on. The team drafts it only from the project's real
-- customers (Customers rows, their replies and their purchases) and the founder approves every word before anything is
-- public (@foundmill/shared `page-quiz.ts`; apps/api services/page-quiz.ts).
--
-- Two tables, one view:
--   page_quizzes       one row per business: the definition (types, offers, questions, answer → type), its status
--                      (draft, approved, live), its version, and what the team's draft rested on (`evidence`: real
--                      counts, the founder's alone, never in the view)
--   page_quiz_counts   how many visitors finished the quiz with each result, per version: a number per type, nothing
--                      about who (no address, no answers, no time of day)
--   public_page_quizzes  what a visitor reads: the page's address, the version and the definition of a live quiz whose
--                      page is public. The service role's only, like the page view (0081).
--
-- Who may do what (signed-in clients; the service connection, which writes the team's draft and the counts, is not
-- limited):
--   read             members of the business
--   insert           nobody: the row is the team's draft, written on the service connection when a founder asks for it
--   edit the draft   owner, admin, member (the roles that edit the page's draft, 0077); any change to the definition
--                    puts the quiz back to draft, off the page, until it is approved again
--   approve, turn on or off   owner or admin only
--   evidence, version, who drafted it   never by hand
--   delete           owner or admin
--   counts           read only

-- True when a jsonb value has a quiz's outline: 2 to 4 types, 1 to 4 offers, 2 to 4 questions, at most 24 KB. The
-- shared `pageQuizProblems` judges every field; this keeps an approved or live row from being something else entirely.
create function fm_page_quiz_ok(q jsonb) returns boolean
language sql immutable as $$
  select coalesce(
    jsonb_typeof(q) = 'object'
    and octet_length(q::text) <= 24000
    and jsonb_typeof(q->'types') = 'array' and jsonb_array_length(q->'types') between 2 and 4
    and jsonb_typeof(q->'offers') = 'array' and jsonb_array_length(q->'offers') between 1 and 4
    and jsonb_typeof(q->'questions') = 'array' and jsonb_array_length(q->'questions') between 2 and 4,
    false);
$$;
--> statement-breakpoint
grant execute on function fm_page_quiz_ok(jsonb) to anon, authenticated, service_role;
--> statement-breakpoint
create table page_quizzes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  definition jsonb not null
    constraint page_quizzes_definition_shape check (jsonb_typeof(definition) = 'object' and octet_length(definition::text) <= 24000),
  status text not null default 'draft'
    constraint page_quizzes_status_known check (status in ('draft', 'approved', 'live')),
  -- Goes up by one whenever the definition changes, so counts are never read across two different quizzes.
  version integer not null default 1 constraint page_quizzes_version_positive check (version >= 1),
  -- What the team's draft rested on: { customers, replies, purchases, perType: { t1: n, ... } }. Real counts.
  evidence jsonb not null default '{}'::jsonb
    constraint page_quizzes_evidence_shape check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 2000),
  drafted_at timestamptz not null default now(),
  drafted_by_agent_id uuid references agents(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  -- When it was last turned on (kept after it is turned off).
  live_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint page_quizzes_business_id_key unique (business_id),
  constraint page_quizzes_approved_dated check (status = 'draft' or approved_at is not null),
  constraint page_quizzes_public_shape check (status = 'draft' or fm_page_quiz_ok(definition))
);
--> statement-breakpoint
create index page_quizzes_drafted_by_agent_id_idx on page_quizzes (drafted_by_agent_id);
--> statement-breakpoint
create index page_quizzes_approved_by_idx on page_quizzes (approved_by);
--> statement-breakpoint
create index page_quizzes_updated_by_idx on page_quizzes (updated_by);
--> statement-breakpoint
alter table page_quizzes enable row level security;
--> statement-breakpoint
create policy page_quizzes_select on page_quizzes for select using (is_member(business_id));
--> statement-breakpoint
create policy page_quizzes_update on page_quizzes for update
  using (has_role(business_id, array['owner','admin','member']))
  with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy page_quizzes_delete on page_quizzes for delete using (has_role(business_id, array['owner','admin']));
--> statement-breakpoint
revoke all on page_quizzes from public, anon;
--> statement-breakpoint
grant select, insert, update, delete on page_quizzes to authenticated, service_role;
--> statement-breakpoint
select fm_track_updated_at('page_quizzes');
--> statement-breakpoint
-- The rules RLS cannot say, for a signed-in client whichever path it wrote by. A changed definition is a new version
-- and back to draft (off the page) for everyone, the service connection included. Not security definer:
-- `current_user` must be the caller's role.
create function fm_page_quizzes_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  app_role boolean := current_user in ('authenticated', 'anon');
  admin boolean;
  changed boolean := new.definition is distinct from old.definition;
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'A quiz stays with its business' using errcode = '23514';
  end if;
  if app_role then
    admin := has_role(new.business_id, array['owner','admin']);
    if new.evidence is distinct from old.evidence or new.drafted_at is distinct from old.drafted_at
       or new.drafted_by_agent_id is distinct from old.drafted_by_agent_id
       or new.version is distinct from old.version then
      raise exception 'permission denied for page_quizzes: what the team drafted from is not changed by hand' using errcode = '42501';
    end if;
    -- Editing an approved or live quiz takes it off the page until it is approved again: an owner's or an admin's call.
    if changed and old.status <> 'draft' and not admin then
      raise exception 'permission denied for page_quizzes: only an owner or an admin can change an approved quiz' using errcode = '42501';
    end if;
    if not changed and (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at
        or new.approved_by is distinct from old.approved_by or new.live_at is distinct from old.live_at) and not admin then
      raise exception 'permission denied for page_quizzes: only an owner or an admin can approve the quiz or turn it on or off' using errcode = '42501';
    end if;
  end if;
  -- A changed definition is a new version, back to draft and off the page, for every role.
  if changed then
    new.version := old.version + 1;
    new.status := 'draft';
  end if;
  if new.status = 'live' and old.status = 'draft' then
    raise exception 'A quiz is approved before it is turned on' using errcode = '23514';
  end if;
  if app_role then
    -- Who approved it and when, and when it went on: the database's to record, whatever the client sent.
    if new.status = 'draft' then
      new.approved_at := null;
      new.approved_by := null;
    elsif old.status = 'draft' then
      new.approved_at := now();
      new.approved_by := auth.uid();
    else
      new.approved_at := old.approved_at;
      new.approved_by := old.approved_by;
    end if;
    if new.status = 'live' and old.status is distinct from 'live' then new.live_at := now(); else new.live_at := old.live_at; end if;
  elsif new.status = 'draft' then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger page_quizzes_guard before update on page_quizzes for each row execute function fm_page_quizzes_guard();
--> statement-breakpoint
create table page_quiz_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  quiz_id uuid not null references page_quizzes(id) on delete cascade,
  version integer not null constraint page_quiz_counts_version_positive check (version >= 1),
  type_key text not null constraint page_quiz_counts_type_key_shape check (type_key in ('t1', 't2', 't3', 't4')),
  finished bigint not null default 0 constraint page_quiz_counts_finished_nonnegative check (finished >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_quiz_counts_once_key unique (quiz_id, version, type_key)
);
--> statement-breakpoint
create index page_quiz_counts_business_id_idx on page_quiz_counts (business_id);
--> statement-breakpoint
select fm_tenant_table('page_quiz_counts', array['owner'], 'read_only');
--> statement-breakpoint
-- The public read. Exactly these four columns: the page's address, the quiz's version, the definition (never the
-- evidence or who approved it) and whether the page carries its Follow form (an offer that points to it shows its
-- button only then). A row exists only while the quiz is live and its page has a row in `public_project_pages` (0077):
-- taking the page down, archiving the business or it becoming a sample removes the quiz at once.
create view public_page_quizzes with (security_barrier) as
  select pp.slug,
         q.version,
         q.definition,
         coalesce(pp.published->'followForm' = 'true'::jsonb, false) as follow_form
    from page_quizzes q
    join project_pages p on p.business_id = q.business_id
    join public_project_pages pp on pp.slug = p.slug
   where q.status = 'live' and fm_page_quiz_ok(q.definition);
--> statement-breakpoint
-- The api's to read on the service connection, one address at a time and rate-limited, like the page view (0081, 0087).
revoke all on public_page_quizzes from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on public_page_quizzes to service_role;
