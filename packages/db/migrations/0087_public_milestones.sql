-- 0087 — milestones a founder chooses to show (docs/NETWORK.md F2 "the story", F3 "cards"; docs/THESIS_REVIEW.md
-- package 5.3). A project's real outcomes are milestones the platform recorded itself (`ref.trophyKey`: the page went
-- live, the first follower confirmed, the first customer, ...). An owner or an admin may show a reached one: its
-- `visibility` becomes 'public' (the column exists since 0007 and defaults to 'private'). Shown milestones make up the
-- project's story (`/p/<slug>/story`) and each has a card (`/m/<id>`), read through the view below and nothing else.
--
-- Two things make "Verified by Foundmill" true of every row the view lists:
--   1. `milestones` is an ordinary tenant table (0007: owner, admin and member write it through RLS). Until now nothing
--      public read it. The guard below keeps a signed-in client from writing a platform-recorded milestone by hand,
--      changing one, or showing and hiding one without being an owner or an admin, whichever client wrote.
--   2. The view lists only rows that carry a known key, and builds the public words from the key.

-- Who may do what to a milestone, for the client roles (the service connection, which records them, is not limited):
--   insert   a row with `ref.trophyKey` only as "Page live", and only when the business's page is published with that id
--            and that date (the api awards it in the transaction that publishes the page, as the signed-in founder);
--            every other platform-recorded milestone is written on the service connection (ingest, the nightly sweep)
--   update   a row with `ref.trophyKey` keeps its kind, label, date, ref and business; showing, hiding, archiving or
--            restoring a shown milestone is an owner's or an admin's; only "Page live" and "First follower" can be
--            shown at all (each is recorded from one real outside event; a customer or revenue milestone is counted
--            or estimated and is not shown as "Verified" yet)
--   delete   a shown milestone is an owner's or an admin's to delete (deleting it takes it off the page)
-- Rows without `ref.trophyKey` (a release, a decision, a launch someone noted) stay as writable as before; the view never
-- lists them. Not security definer: `current_user` must be the caller's role.
create function fm_milestones_guard() returns trigger
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
create trigger milestones_guard before insert or update or delete on milestones for each row execute function fm_milestones_guard();
--> statement-breakpoint
-- The public read. Exactly these five columns: the milestone's id (the card's address, `/m/<id>`), the page's address,
-- the key, the public words and the date it was reached. A row exists only for a milestone that is shown, not archived
-- and carries a known key, and only while its business has a row in `public_project_pages` (0077): taking the page
-- down, archiving the business or it becoming a sample removes the story and every card at once.
--
-- The words are built from the key, never read from what a row holds: a milestone about a customer says "First
-- customer" and nothing of who (`ref` and the customer's record never leave). A revenue milestone keeps its stored
-- words only when they are the threshold in the business's money ("First $1K MRR", "First £10K monthly revenue").
-- A test compares this list with `TROPHIES` in @foundmill/journey.
create view public_project_milestones with (security_barrier) as
  select m.id,
         pp.slug,
         m.ref ->> 'trophyKey' as key,
         case m.ref ->> 'trophyKey'
           when 'page_live' then 'Page live'
           when 'first_follower' then 'First follower'
           when 'customer_1' then 'First customer'
           when 'customer_10' then '10th customer'
           when 'customer_100' then '100th customer'
           when 'customer_1000' then '1,000th customer'
           when 'first_enterprise_contract' then 'First enterprise contract'
           when 'mrr_1k' then case when m.label ~ '^First .{1,8}1K (MRR|monthly revenue)$' then m.label else 'First 1K of monthly revenue' end
           when 'mrr_10k' then case when m.label ~ '^First .{1,8}10K (MRR|monthly revenue)$' then m.label else 'First 10K of monthly revenue' end
           when 'mrr_100k' then case when m.label ~ '^First .{1,8}100K (MRR|monthly revenue)$' then m.label else 'First 100K of monthly revenue' end
         end as label,
         m.achieved_at
    from milestones m
    join project_pages p on p.business_id = m.business_id
    join public_project_pages pp on pp.slug = p.slug
   where m.visibility = 'public' and m.archived_at is null
     and m.ref ->> 'trophyKey' in ('page_live', 'first_follower', 'customer_1', 'customer_10', 'customer_100', 'customer_1000',
                                   'mrr_1k', 'mrr_10k', 'mrr_100k', 'first_enterprise_contract');
--> statement-breakpoint
-- The api's to read on the service connection, one address at a time and rate-limited, like the page view (0081).
revoke all on public_project_milestones from public, anon, authenticated;
--> statement-breakpoint
grant select on public_project_milestones to service_role;
