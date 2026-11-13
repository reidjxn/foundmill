-- 0103 — a post draft's media, the "ready-to-post kit" (packages/shared `post-media.ts`; founder, 2026-11-13): a short
-- vertical video made on the founder's own Runway account and, if they like, a voiceover made on their own ElevenLabs
-- account, for a post the social agent drafted (an `assets` row, kind `post`). Media is added to the existing draft:
-- the draft, its caps and its check are unchanged, and posting stays the founder's own press.
--
-- Why a table of its own. Foundmill has no object storage. Runway's address for a finished clip expires within a day or
-- two, and a voiceover arrives inline, so the file is copied here once it is made: it stays reachable for tap-to-post and
-- for a publishing connector later. The workspace store (0013 `workspace_blobs`) is for saved code: its sweep removes
-- anything no code snapshot references, and its quota is the code's. Here every row belongs to one draft and goes with
-- it (`on delete cascade`), and the project's total is held to `POST_MEDIA_LIMITS.perProjectBytes` by the repository,
-- under a lock per business, before a file is written.
--
-- A simulated row (a mock connector answered) never has a file: nothing was made, so there is nothing to keep or post.
--
-- Who may do what: members read (the Creative tab and the share panel show the draft's media, as they show the draft);
-- the orchestrator writes on the service connection. No client role writes.
create table post_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  kind text not null
    constraint post_media_kind_value check (kind in ('video', 'voiceover')),
  state text not null
    constraint post_media_state_value check (state in ('asking', 'making', 'ready', 'simulated', 'declined', 'failed')),
  connector_key text not null
    constraint post_media_connector_value check (connector_key in ('runway', 'elevenlabs_voice')),
  approval_id uuid,
  vendor_ref text
    constraint post_media_vendor_ref_length check (char_length(vendor_ref) <= 100),
  simulated boolean not null default false,
  mime text
    constraint post_media_mime_value check (mime in ('video/mp4', 'audio/mpeg', 'audio/wav')),
  sha256 char(64),
  size_bytes integer
    constraint post_media_size_value check (size_bytes >= 0 and size_bytes <= 33554432),
  duration_seconds real
    constraint post_media_duration_value check (duration_seconds >= 0 and duration_seconds <= 600),
  content bytea,
  error_code text
    constraint post_media_error_code_format check (error_code ~ '^[a-z][a-z0-9_]{0,59}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nothing simulated has a file; a ready row that is not simulated has one, with its size and digest.
  constraint post_media_simulated_has_no_file check (not (simulated and content is not null)),
  constraint post_media_simulated_is_never_ready check (not (simulated and state = 'ready')),
  constraint post_media_ready_has_file check (state <> 'ready' or (content is not null and sha256 is not null and size_bytes = octet_length(content)))
);
--> statement-breakpoint
create unique index post_media_asset_kind_idx on post_media (asset_id, kind);
--> statement-breakpoint
create index post_media_business_id_idx on post_media (business_id, created_at desc);
--> statement-breakpoint
select fm_tenant_table('post_media', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
-- The row's draft must be the same business's.
create function fm_post_media_same_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from assets a where a.id = new.asset_id and a.business_id = new.business_id) then
    raise exception 'post_media: the draft belongs to another business' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger post_media_same_business before insert or update of asset_id, business_id on post_media
  for each row execute function fm_post_media_same_business();
