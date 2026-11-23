-- Network safety before sign-up opens (#217's review, M3, M4 and L3).
--
-- M3, M4: Find people (`personProfiles.public.find`) matches words with ILIKE on a person's name, headline, about and
-- place, and the name search (`social.searchPublic`) uses `%` and a prefix LIKE on the founder's name. Trigram indexes
-- let both use an index instead of reading every profile (businesses.name has had one since 0002).
create index if not exists founder_profiles_display_name_trgm_idx on founder_profiles using gin (display_name gin_trgm_ops);
--> statement-breakpoint
create index if not exists founder_profiles_headline_trgm_idx on founder_profiles using gin (headline gin_trgm_ops);
--> statement-breakpoint
create index if not exists founder_profiles_about_trgm_idx on founder_profiles using gin (about gin_trgm_ops);
--> statement-breakpoint
create index if not exists founder_profiles_place_trgm_idx on founder_profiles using gin (place gin_trgm_ops);
--> statement-breakpoint

-- L3: the network is for adults, so the old founder card lists only a person who has confirmed that they are 18 or
-- older, as public_person_profiles already does (0100). Same columns as 0092; the grants on the view are kept.
create or replace view public_profiles with (security_barrier) as
  select b.id as business_id, 'business'::text as kind, b.name as display_name, b.slug, b.crest_url, b.archetype,
         b.kit_primary, b.kit_secondary, b.region, b.committed_at, null::uuid as user_id
    from businesses b
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
  union all
  select m.business_id, 'founder'::text, fp.display_name, null, null, null, null, null, null, null, fp.user_id
    from founder_profiles fp
    join memberships m on m.user_id = fp.user_id and m.role in ('owner','cofounder','admin')
    join businesses b on b.id = m.business_id
   where b.game_mode = 'live' and b.committed_at is not null and b.archived_at is null and not b.is_demo
     and fp.visibility = 'public' and fp.archived_at is null
     and exists (select 1 from adult_confirmations ac where ac.user_id = fp.user_id);
