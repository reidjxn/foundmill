-- 0090 — when a page went live is a fact the platform records (docs/NETWORK.md "only real outcomes", "none was typed
-- in"; CLAUDE.md north star). The public page says "Published Oct 7, 2026" from `project_pages.published_at`, and the
-- milestone "Page live" (0089) takes its date from the same column and is shown as "Verified by Foundmill".
--
-- What was wrong: the guard of 0077 checked who may change a page's publish columns (an owner or an admin) and never the
-- value of its dates. An owner or an admin with an ordinary session could write `published_at = '2020-01-01'` straight
-- through PostgREST, on a live page or on a row that was never published, and the page, the nightly milestone catch-up
-- and the story would repeat it. A member could also delete a private "Page live" so that it was recorded again from
-- the typed-in date.
--
-- Now, for the client roles (the service connection is not limited: seeds, backfills and repairs keep their dates):
--   insert        `published_at` is the database's clock when the row is written published, null otherwise;
--                 `unpublished_at` is null
--   goes live     `published_at` is the database's clock, whatever the client sent; `unpublished_at` is cleared
--   stays live    `published_at` keeps its value ("publish changes" does not move the date)
--   taken down    `published_at` keeps its value (the page did go live that day); `unpublished_at` is the database's clock
--   stays down    both dates keep their values
-- A date a client sends is replaced, not refused: the api's own write carries one (its clock on a first publish, the
-- value it read back on "publish changes", which a client holds to the millisecond only), so refusing a difference
-- would refuse an honest publish. Who may publish, take down or move a live page's address is checked first, on what
-- the client sent, exactly as before: a member who sends a date is still refused.
--
-- The clock is `now()` (the transaction's start) kept to the millisecond, the precision the api's clients carry, so the
-- date a client reads back is exactly the date stored: 0089 accepts a signed-in client's "Page live" only when its
-- date equals the page's.
create or replace function fm_project_pages_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  app_role boolean := current_user in ('authenticated', 'anon');
  goes_public boolean;
  stamp timestamptz := date_trunc('milliseconds', now());
begin
  if tg_op = 'INSERT' then
    goes_public := new.published is not null or new.published_at is not null or new.published_by is not null or new.unpublished_at is not null;
  else
    if new.business_id is distinct from old.business_id then
      raise exception 'A page stays with its business' using errcode = '23514';
    end if;
    goes_public := new.published is distinct from old.published
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by
      or new.unpublished_at is distinct from old.unpublished_at
      or (old.published is not null and new.slug is distinct from old.slug);
  end if;
  if goes_public and app_role and not has_role(new.business_id, array['owner','admin']) then
    raise exception 'permission denied for project_pages: only an owner or an admin can publish a page, take it down or change a live page''s address' using errcode = '42501';
  end if;
  -- The two dates are the database's to write for a client role (the table above).
  if app_role then
    if tg_op = 'INSERT' then
      new.published_at := case when new.published is not null then stamp end;
      new.unpublished_at := null;
    elsif old.published is null and new.published is not null then
      new.published_at := stamp;
      new.unpublished_at := null;
    elsif old.published is not null and new.published is null then
      new.published_at := old.published_at;
      new.unpublished_at := stamp;
    else
      new.published_at := old.published_at;
      new.unpublished_at := old.unpublished_at;
    end if;
  end if;
  if new.published is not null and exists (select 1 from businesses b where b.id = new.business_id and b.is_demo) then
    raise exception 'A sample business has no public page' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
-- The milestone guard of 0089, with one more rule for the client roles: a milestone the platform recorded
-- (`ref.trophyKey`) is not deleted by hand, shown or not, whoever asks. Until now only a shown one was protected (an
-- owner's or an admin's to delete). A deleted row is recorded again, and not always as it was: "Page live" would come
-- back with the date the page last went live, so deleting it, taking the page down and putting it back up moved a real
-- first date to a later one; a revenue milestone recorded under the earlier rule (docs/DECISIONS.md 2026-11-11, "never
-- rewritten") would be worked out again under the new one. Nothing in the product deletes a milestone: a founder who
-- does not want one on the page hides it, and archiving keeps the row (its key stays taken). A note without a key is
-- deleted as before.
--
-- Deleting a business still removes its milestones. No client role deletes a business (0002 gives `businesses` no
-- delete policy); the scheduled deletion runs `fm_purge_business` (0028), which is security definer, so the cascade
-- reaches this trigger as the function's owner, not as a client role. The service connection is not limited.
--
-- Everything else is 0089's, unchanged.
create or replace function fm_milestones_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  app_role boolean := current_user in ('authenticated', 'anon');
  recorded boolean;
begin
  if not app_role then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.visibility = 'public' and not has_role(old.business_id, array['owner','admin']) then
      raise exception 'permission denied for milestones: only an owner or an admin can take a shown milestone off the page' using errcode = '42501';
    end if;
    if old.ref ->> 'trophyKey' is not null then
      raise exception 'permission denied for milestones: a milestone the platform records is not deleted by hand' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.ref ->> 'trophyKey' is not null then
      if new.ref ->> 'trophyKey' <> 'page_live' or new.kind <> 'trophy' or new.label <> 'Page live'
         or new.visibility <> 'private' or new.archived_at is not null
         or not exists (
           select 1 from project_pages p
            where p.business_id = new.business_id and p.id::text = new.ref ->> 'pageId' and p.published is not null
              and date_trunc('milliseconds', p.published_at) = date_trunc('milliseconds', new.achieved_at))
      then
        raise exception 'permission denied for milestones: a milestone the platform records is not written by hand' using errcode = '42501';
      end if;
    elsif new.visibility = 'public' and not has_role(new.business_id, array['owner','admin']) then
      raise exception 'permission denied for milestones: only an owner or an admin can show a milestone' using errcode = '42501';
    end if;
    return new;
  end if;
  recorded := old.ref ->> 'trophyKey' is not null or new.ref ->> 'trophyKey' is not null;
  if recorded and (new.business_id is distinct from old.business_id or new.kind is distinct from old.kind or new.label is distinct from old.label
                   or new.achieved_at is distinct from old.achieved_at or new.ref is distinct from old.ref) then
    raise exception 'permission denied for milestones: a milestone the platform records is not changed by hand' using errcode = '42501';
  end if;
  -- Only a milestone recorded from one real outside event is shown as "Verified" (@foundmill/journey `isShowableTrophyKey`):
  -- a customer or revenue milestone is counted or estimated, so a client cannot make one public, whoever they are.
  if new.visibility = 'public' and old.visibility is distinct from 'public'
     and coalesce(new.ref ->> 'trophyKey', '') not in ('page_live', 'first_follower') then
    raise exception 'permission denied for milestones: this milestone cannot be shown yet' using errcode = '42501';
  end if;
  if ((new.visibility is distinct from old.visibility and 'public' in (old.visibility, new.visibility))
      or (old.visibility = 'public' and new.archived_at is distinct from old.archived_at))
     and not has_role(new.business_id, array['owner','admin']) then
    raise exception 'permission denied for milestones: only an owner or an admin can show a milestone or take it off the page' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
-- Rows written before this migration. A backdated date cannot be told from a real one and stays. Two kinds of date
-- cannot be real, and the nightly catch-up would still record "Page live" from them, so they are put right here (the
-- migration is not a client role, so the guard above leaves these writes alone):
--   a page that never went live but holds a date (not published, never taken down: the product never wrote such a
--   row; publishing sets the date and a take-down keeps it with `unpublished_at`): the date is cleared;
update project_pages set published_at = null where published is null and unpublished_at is null and published_at is not null;
--> statement-breakpoint
--   a date in the future: it becomes the latest moment the page can have gone live, which is now, or the day it was
--   taken down when that is earlier (`least` passes over a null).
update project_pages set published_at = least(date_trunc('milliseconds', now()), unpublished_at) where published_at > now();
