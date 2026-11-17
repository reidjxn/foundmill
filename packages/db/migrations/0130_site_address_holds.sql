-- 0130 — A site address a project gives up is held before another project can claim it (WP-07; founder, Nov 16, 2026).
-- When a site's slug changes, or its site is deleted (its business deleted), the old slug is recorded here; for
-- `fm_site_address_hold_days()` days (30, confirmed by the founder on Nov 16, 2026: the one value to change) no other
-- project's site may take it, so a link someone saved never lands on a stranger's site the next day. The project that
-- gave it up may take it back inside the hold.
--
-- A platform table like `retired_mail_local_parts` (0078): never read or written by an app role (RLS on with no policy,
-- and no grant), written only by the triggers below. `released_by_business` is who gave the address up, kept as a bare
-- uuid with no foreign key so the hold outlives a deleted business.
create table site_address_holds (
  id uuid primary key default gen_random_uuid(),
  slug text not null constraint site_address_holds_slug_key unique,
  released_by_business uuid not null,
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
select fm_track_updated_at('site_address_holds');
--> statement-breakpoint
alter table site_address_holds enable row level security;
--> statement-breakpoint
revoke all on site_address_holds from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on site_address_holds to service_role;
--> statement-breakpoint
-- The length of the hold, in days. An Estimate (30); replace this function to change it.
create function fm_site_address_hold_days() returns int
language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp as $$
  select 30
$$;
--> statement-breakpoint
-- Records the address a site gives up: its old slug on a rename, its slug when the site is deleted. Only an address
-- the public could have saved is held (the site is live, was ever published, or was taken down); a business keeps at
-- most `fm_site_address_holds_per_business()` holds (its newest), so renaming in a loop reserves nothing more. A
-- taken-down site's address is held for good (`released_at = 'infinity'`), so a phishing address never comes free.
-- Both triggers take the same per-address lock, so a rename and a claim of one address never pass each other.
create function fm_site_address_holds_per_business() returns int
language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp as $$
  select 2
$$;
--> statement-breakpoint
create function fm_site_address_release() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.slug = new.slug then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('site_slug'), hashtext(old.slug));
  if old.status = 'draft' and not exists (select 1 from site_releases r where r.site_id = old.id and r.published_at is not null) then
    return null;
  end if;
  insert into site_address_holds (slug, released_by_business, released_at)
  values (old.slug, old.business_id, case when old.status = 'taken_down' then 'infinity'::timestamptz else now() end)
  on conflict (slug) do update set released_by_business = excluded.released_by_business, released_at = excluded.released_at;
  delete from site_address_holds h
   where h.released_by_business = old.business_id and h.released_at <> 'infinity'::timestamptz
     and h.id not in (
       select h2.id from site_address_holds h2
        where h2.released_by_business = old.business_id and h2.released_at <> 'infinity'::timestamptz
        order by h2.released_at desc, h2.id desc limit fm_site_address_holds_per_business());
  return null;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_site_address_release() from public, anon, authenticated;
--> statement-breakpoint
create trigger sites_address_release after update of slug or delete on sites for each row execute function fm_site_address_release();
--> statement-breakpoint
-- Refuses an address another project gave up inside the hold, as a unique violation (the same answer as an address in
-- use: "That address is taken"). Taking an address clears its hold: its own project's, or one that has run out.
create function fm_site_address_not_held() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.slug = new.slug then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('site_slug'), hashtext(new.slug));
  if exists (
    select 1 from site_address_holds h
     where h.slug = new.slug and h.released_by_business <> new.business_id
       and h.released_at > now() - make_interval(days => fm_site_address_hold_days())
  ) then
    raise exception 'duplicate key: this site address was given up by another project and is held for now' using errcode = '23505', constraint = 'sites_slug_key';
  end if;
  delete from site_address_holds h where h.slug = new.slug;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_site_address_not_held() from public, anon, authenticated;
--> statement-breakpoint
create trigger sites_address_not_held before insert or update of slug on sites for each row execute function fm_site_address_not_held();
