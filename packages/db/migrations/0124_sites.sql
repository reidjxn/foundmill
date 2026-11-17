-- 0124 — Foundmill sites (WP-07 T2): a project's static site, served by apps/sites at `<slug>.<SITES_DOMAIN>`, and its
-- releases. A release is the whole site as one session left it: a manifest of `{ path, sha256, size }` whose bytes are
-- the business's `workspace_blobs` (0013), so a file is stored once however many releases carry it.
--
-- Who may do what:
--   read    members of the business (`fm_tenant_table` read_only), collaborators included: the site is what the project
--           shows publicly and a collaborator helps build it, so nothing here is closed to them as 0094 closes the
--           admin-written and Money tables
--   write   the services only (the orchestrator saves releases, the platform takes a site down), with two narrow
--           exceptions for an owner or an admin, the founder's own press as for the page:
--           `sites_publish` updates only `status` (draft or live), `live_release_id` (a `preview` release of the same
--           business, or null) and `slug`, never on a taken-down site; `site_releases_publish` stamps only
--           `published_by` (themselves) and `published_at` on a `preview` release. Column grants keep every other column
--           (taken_down_reason, business_id, starter_key, state, files, screening) the services' alone.
--
-- `sites_reader` is the database login of apps/sites (nologin here; docs/DEPLOY.md sets its password). It holds usage on
-- the schema and execute on `site_resolve`, `site_file` and `site_report`, and nothing on any table.
--
-- It also replaces `fm_collaborator_event_types()` with the three `site.*` events added (Product's, which a collaborator
-- reads).
create table sites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  slug text not null unique constraint sites_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and slug !~ '^p-' and slug not in ('www','api','app','mail','admin','preview','status','report','assets','static')),
  status text not null default 'draft' constraint sites_status_check check (status in ('draft', 'live', 'taken_down')),
  -- The release visitors see while live; its foreign key is added below, once site_releases exists.
  live_release_id uuid,
  starter_key text not null default 'static-site',
  -- Why the platform took the site down; null otherwise.
  taken_down_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create table site_releases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  number int not null constraint site_releases_number_check check (number > 0),
  -- The release this one was built on; null for the first.
  parent_release_id uuid,
  task_id uuid references tasks(id) on delete set null,
  -- The session that built it: one release per session (a retried finish writes none twice).
  session_id uuid,
  agent_id uuid,
  -- `WorkspaceManifestEntry[]`, the whole site.
  files jsonb not null constraint site_releases_files_shape check (jsonb_typeof(files) = 'array'),
  file_count int not null default 0 constraint site_releases_file_count_check check (file_count >= 0),
  total_bytes bigint not null default 0 constraint site_releases_total_bytes_check check (total_bytes >= 0),
  -- sha256 over the sorted `path:sha256` lines.
  content_hash char(64) not null constraint site_releases_content_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  state text not null constraint site_releases_state_check check (state in ('preview', 'held')),
  screening jsonb not null default '{"flags":[]}'::jsonb,
  -- 32 hex characters (randomBytes(16)); the preview host is `p-<token>`.
  preview_token text not null unique constraint site_releases_preview_token_format check (preview_token ~ '^[0-9a-f]{32}$'),
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_releases_number_unique unique (site_id, number)
);
--> statement-breakpoint
create index site_releases_business_idx on site_releases (business_id, created_at desc);
--> statement-breakpoint
create index site_releases_task_id_idx on site_releases (task_id);
--> statement-breakpoint
create unique index site_releases_session_idx on site_releases (session_id) where session_id is not null;
--> statement-breakpoint
alter table sites add constraint sites_live_release_id_fkey foreign key (live_release_id) references site_releases(id) on delete set null;
--> statement-breakpoint
create index sites_live_release_id_idx on sites (live_release_id);
--> statement-breakpoint
-- No release of one business sits on another business's site, whoever writes (the service connection included).
create function fm_site_release_same_business() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if not exists (select 1 from sites s where s.id = new.site_id and s.business_id = new.business_id) then
    raise exception 'a site release belongs to a site of its own business' using errcode = '23514', constraint = 'site_releases_same_business';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_site_release_same_business() from public, anon, authenticated;
--> statement-breakpoint
create trigger site_releases_same_business before insert or update of site_id, business_id on site_releases for each row execute function fm_site_release_same_business();
--> statement-breakpoint
-- No site goes live on another business's release, whoever writes.
create function fm_site_live_release_same_business() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.live_release_id is not null
     and not exists (select 1 from site_releases r where r.id = new.live_release_id and r.business_id = new.business_id) then
    raise exception 'a site goes live on a release of its own business' using errcode = '23514', constraint = 'sites_live_release_same_business';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_site_live_release_same_business() from public, anon, authenticated;
--> statement-breakpoint
create trigger sites_live_release_same_business before insert or update of live_release_id, business_id on sites for each row execute function fm_site_live_release_same_business();
--> statement-breakpoint
select fm_tenant_table('sites', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
select fm_tenant_table('site_releases', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
-- Read only for app roles in the grants too, but for the two publishing columns sets below.
revoke insert, update, delete on sites from anon, authenticated;
--> statement-breakpoint
revoke insert, update, delete on site_releases from anon, authenticated;
--> statement-breakpoint
-- The founder's press: an owner or an admin turns the site live on a preview release of the business, or back to draft,
-- and may rename it. A founder can never undo a takedown or point the site at a held release.
create policy sites_publish on sites for update
  using (has_role(business_id, array['owner','admin']) and status <> 'taken_down')
  with check (status in ('draft', 'live') and (live_release_id is null or exists (select 1 from site_releases r where r.id = live_release_id and r.business_id = sites.business_id and r.state = 'preview')));
--> statement-breakpoint
grant update (status, live_release_id, slug, updated_at) on sites to authenticated;
--> statement-breakpoint
-- Who pressed publish and when, on the release they published: only their own name, only on a preview release.
create policy site_releases_publish on site_releases for update
  using (has_role(business_id, array['owner','admin']) and state = 'preview')
  with check (has_role(business_id, array['owner','admin']) and state = 'preview' and published_by = auth.uid());
--> statement-breakpoint
grant update (published_by, published_at, updated_at) on site_releases to authenticated;
--> statement-breakpoint
do $$
begin
  if not exists (select from pg_roles where rolname = 'sites_reader') then
    create role sites_reader nologin;
  end if;
end;
$$;
--> statement-breakpoint
grant usage on schema public to sites_reader;
--> statement-breakpoint
-- The host's first label to what it serves. `p-<32 hex>` is one of the newest 3 preview releases of a site that is not taken down
-- (kind 'preview'); any other label is a slug: a live site's live release (kind 'live'), or a taken-down site (one row,
-- release_id null, kind 'taken_down': the server answers 410). Nothing otherwise (a draft site, a held release, an
-- unknown label). `plan_tier` is the business's, for the "Built on Foundmill" mark.
create function site_resolve(label text) returns table (release_id uuid, business_id uuid, kind text, plan_tier text)
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select r.id, r.business_id, 'preview'::text, b.plan_tier
    from site_releases r join sites s on s.id = r.site_id join businesses b on b.id = r.business_id
   where lower(site_resolve.label) ~ '^p-[0-9a-f]{32}$'
     and r.preview_token = substr(lower(site_resolve.label), 3)
     and r.state = 'preview'
     and s.status <> 'taken_down'
     -- Only the newest 3 previews of a site are served (the founder, Nov 16, 2026: a preview link is unlisted but can
     -- be passed around; old ones stop answering). The live release is served by its slug whatever its age.
     and r.id in (select r2.id from site_releases r2 where r2.site_id = r.site_id and r2.state = 'preview' order by r2.number desc limit 3)
  union all
  select case when s.status = 'live' then s.live_release_id end, s.business_id, case when s.status = 'live' then 'live' else 'taken_down' end, b.plan_tier
    from sites s join businesses b on b.id = s.business_id left join site_releases lr on lr.id = s.live_release_id
   where lower(site_resolve.label) !~ '^p-[0-9a-f]{32}$'
     and s.slug = lower(site_resolve.label)
     and (s.status = 'taken_down' or (s.status = 'live' and lr.state = 'preview'))
$$;
--> statement-breakpoint
-- One file of a release: its manifest entry joined to the bytes of the release's own business.
create function site_file(release uuid, path text) returns table (content bytea, sha256 char(64), size int)
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select b.content, b.sha256, b.size_bytes
    from site_releases r
    cross join lateral jsonb_array_elements(r.files) as f(entry)
    join workspace_blobs b on b.business_id = r.business_id and b.sha256 = f.entry->>'sha256'
   where r.id = site_file.release and f.entry->>'path' = site_file.path
     -- Never a held release or a taken-down site's, even when asked by id.
     and r.state = 'preview' and exists (select 1 from sites s where s.id = r.site_id and s.status <> 'taken_down')
   limit 1
$$;
--> statement-breakpoint
-- A visitor's report of a live site (`/_fm/report`): one audit row `site.reported` for the site's business with the
-- reason and the visitor's note, never anything about the reporter. A preview link reports its site. Answers
-- 'recorded'; 'unknown' for a label that is neither a live site's slug nor a servable preview; 'invalid' for another reason; 'limited' at 5 a
-- minute or 30 a day per site. The audit chain's own lock serializes the count and the insert per business.
create function site_report(label text, reason text, detail text) returns text
language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  found_site record;
begin
  if lower(site_report.label) ~ '^p-[0-9a-f]{32}$' then
    -- A preview link can be passed around too, so it can be reported (against its site).
    select s.id, s.slug, s.business_id into found_site from site_releases r join sites s on s.id = r.site_id
     where r.preview_token = substr(lower(site_report.label), 3) and r.state = 'preview' and s.status <> 'taken_down'
       and r.id in (select r2.id from site_releases r2 where r2.site_id = r.site_id and r2.state = 'preview' order by r2.number desc limit 3);
  else
    select s.id, s.slug, s.business_id into found_site from sites s where s.slug = lower(site_report.label) and s.status = 'live';
  end if;
  if not found then
    return 'unknown';
  end if;
  if site_report.reason is null or site_report.reason not in ('scam', 'phishing', 'illegal', 'offensive', 'other') then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtext('audit_log'), hashtext(found_site.business_id::text));
  if (select count(*) from audit_log a where a.business_id = found_site.business_id and a.action = 'site.reported' and a.created_at > now() - interval '1 minute') >= 5
     or (select count(*) from audit_log a where a.business_id = found_site.business_id and a.action = 'site.reported' and a.created_at > now() - interval '1 day') >= 30 then
    return 'limited';
  end if;
  insert into audit_log (business_id, actor_kind, actor_id, action, target, details)
  values (found_site.business_id, 'system', null, 'site.reported', jsonb_build_object('siteId', found_site.id, 'slug', found_site.slug), jsonb_build_object('reason', site_report.reason, 'detail', left(site_report.detail, 1000)));
  return 'recorded';
end;
$$;
--> statement-breakpoint
revoke execute on function site_resolve(text), site_file(uuid, text), site_report(text, text, text) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function site_resolve(text), site_file(uuid, text), site_report(text, text, text) to service_role, sites_reader;

--> statement-breakpoint
-- The site's events are Product's, which a collaborator reads.
-- `fm_collaborator_event_types()` (0099) follows apps/stream `EVENT_WALLS`: the same list (0118 included), plus `site.release_created`, `site.published`, `site.unpublished`.
-- `create or replace` keeps its owner, its grants and the policies that call it.
create or replace function fm_collaborator_event_types() returns text[]
language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp as $$
  select array['idea.committed', 'spec.proposal_created', 'spec.version_published', 'source.added', 'source.scored', 'task.started', 'task.progressed', 'task.completed', 'task.blocked', 'task.design_checked', 'pr.merged', 'deploy.succeeded', 'lead.created', 'lead.replied', 'campaign.launched', 'channel.threshold_breached', 'signup.created', 'activation.reached', 'customer.converted', 'agent.health_changed', 'training.completed', 'agent.promoted', 'approval.requested', 'approval.resolved', 'mode.changed', 'holiday.started', 'holiday.ended', 'cycle.started', 'cycle.completed', 'cycle.run_started', 'cycle.run_ended', 'autopilot.changed', 'autopilot.cycle_started', 'inbox.item_created', 'inbox.item_updated', 'decision.made', 'foundations.progressed', 'product.research_drafted', 'conversation.message_posted', 'membership.changed', 'business.updated', 'agent.message_sent', 'product.signoff_decided', 'distribution.started', 'goal.proposed', 'goal.approved', 'goal.change_requested', 'goal.achieved', 'page.published', 'team_call.started', 'team_call.ended', 'page.unpublished', 'page.followed', 'mail.sent', 'milestone.shown', 'milestone.hidden', 'post.drafted', 'invitation.sent', 'invitation.accepted', 'invitation.declined', 'showcase.requested', 'showcase.approved', 'showcase.withdrawn', 'quiz.approved', 'quiz.published', 'quiz.unpublished', 'positioning.approved', 'site.release_created', 'site.published', 'site.unpublished']::text[]
$$;
