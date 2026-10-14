-- 0044 — Home and navigation data.
--
-- Dashboards (BUILD §11.2 "per user per business; share with co-founders"): every member of the business reads a
-- co-founder's live dashboard (the link "Share with co-founders" hands out opens read-only), while a person still
-- writes only their own rows, and only with a role that writes ("Viewers never write, anywhere": viewers and advisors
-- read the Founder's view the api builds for them instead of saving one). One active dashboard per person per
-- business: a first Home opened on two devices at once used to insert two active rows.
drop policy dashboard_layouts_own on dashboard_layouts;
--> statement-breakpoint
-- Your own rows (archived ones too: archiving is an update whose new row must stay readable to you), and every
-- member's live dashboards.
create policy dashboard_layouts_select on dashboard_layouts for select
  using (is_member(business_id) and (user_id = auth.uid() or archived_at is null));
--> statement-breakpoint
create policy dashboard_layouts_insert on dashboard_layouts for insert
  with check (user_id = auth.uid() and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy dashboard_layouts_update on dashboard_layouts for update
  using (user_id = auth.uid() and has_role(business_id, array['owner','admin','member']))
  with check (user_id = auth.uid() and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy dashboard_layouts_delete on dashboard_layouts for delete
  using (user_id = auth.uid() and has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
-- Keep the oldest active dashboard per person and business (the one `dashboards.active` already returned).
update dashboard_layouts d set is_active = false
 where d.is_active and d.archived_at is null
   and exists (
     select 1 from dashboard_layouts o
      where o.business_id = d.business_id and o.user_id = d.user_id and o.is_active and o.archived_at is null
        and (o.created_at, o.id) < (d.created_at, d.id)
   );
--> statement-breakpoint
create unique index dashboard_layouts_one_active_key on dashboard_layouts (business_id, user_id) where is_active and archived_at is null;
--> statement-breakpoint
-- Demo businesses (the seeded Northwind and Ledgerly, BUILD §17.2) share the database with real founders when the
-- seed runs on boot. Their numbers are synthetic, so they are never listed on the network for anyone outside them:
-- not in public views, not on leaderboards, not as a community's owner. Their own members still see them.
alter table businesses add column is_demo boolean not null default false;
--> statement-breakpoint
update businesses set is_demo = true where id in ('b1e5e5e5-0000-4000-8000-000000000001', 'b1e5e5e5-0000-4000-8000-000000000002');
--> statement-breakpoint
create or replace function is_public(bid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return exists (
    select 1 from businesses b
    where b.id = bid and b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
  );
end;
$$;
--> statement-breakpoint
create or replace view public_profiles with (security_barrier) as
  select b.id as business_id, 'business'::text as kind, b.name as display_name, b.slug, b.crest_url, b.archetype,
         b.kit_primary, b.kit_secondary, b.region, b.committed_at, null::uuid as user_id
    from businesses b
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
  union all
  select m.business_id, 'founder'::text, fp.display_name, null, null, null, null, null, null, null, fp.user_id
    from founder_profiles fp
    join memberships m on m.user_id = fp.user_id and m.role in ('owner','admin')
    join businesses b on b.id = m.business_id
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
     and fp.visibility = 'public' and fp.archived_at is null;
--> statement-breakpoint
-- Chapter titles (BUILD §11.2 "Chapters: one per quarter, titled by Opus"): the composer's title for a quarter that
-- has ended, stored once so the Ribbon names it from then on. Written by the composer (service role) only.
create table chapter_titles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  chapter_id text not null check (chapter_id ~ '^[0-9]{4}-Q[1-4]$'),
  title text not null,
  subtitle text not null default '',
  mood text not null default 'steady' check (mood in ('rising','steady','turbulent','breakthrough')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index chapter_titles_business_chapter_key on chapter_titles (business_id, chapter_id);
--> statement-breakpoint
select fm_tenant_table('chapter_titles', array['owner','admin','member'], 'read_only');
