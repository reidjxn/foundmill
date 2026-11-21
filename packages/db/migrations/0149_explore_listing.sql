-- 0149 — an opt-in public gallery of published project pages (docs/holistic-plan/LAUNCH_EVALUATION.md Session 10: /explore).
-- A project is in the gallery only when its owner or an admin switched "Show in Explore" on, and only while its page is
-- published: taking the page down (or archiving the business, or it being a sample) removes it at once, whatever this
-- column says. Nothing is listed by default.
alter table project_pages add column explore_listed boolean not null default false;
--> statement-breakpoint
-- Its own guard, so the page guard of 0077/0090 stays as it is: a client role may switch it on only as an owner or an
-- admin (the same people who publish). The service connection is not limited.
create function fm_project_pages_explore_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.explore_listed) or (tg_op = 'UPDATE' and new.explore_listed is distinct from old.explore_listed))
     and not has_role(new.business_id, array['owner','admin']) then
    raise exception 'permission denied for project_pages: only an owner or an admin can put a page in the gallery' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger project_pages_explore_guard before insert or update on project_pages for each row execute function fm_project_pages_explore_guard();
--> statement-breakpoint
-- The gallery's read. Exactly these columns: what a card shows (the address, the name, the one-line pitch, the stage,
-- the brand colors, when the page went live). The view builds on `public_project_pages`, so the rule for what is public
-- is written once. The api's to read on the service connection, like the page view (0081).
create view public_explore_projects with (security_barrier) as
  select pp.slug,
         pp.name,
         pp.published ->> 'pitch' as pitch,
         pp.published ->> 'stage' as stage,
         pp.kit_primary,
         pp.kit_secondary,
         pp.published_at
    from public_project_pages pp
    join project_pages p on p.slug = pp.slug
   where p.explore_listed;
--> statement-breakpoint
revoke all on public_explore_projects from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on public_explore_projects to service_role;
