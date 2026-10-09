-- The business's logo: an image the founder uploaded or picked from generated marks. One row per business.
-- The api checks every logo before it writes this table with the service role: rasters by magic bytes, header
-- dimensions and size (the browser normalises uploads to a square of about 512 px), SVG through the strict sanitiser
-- (no script, foreignObject, event handlers, external references or style URLs). Members read it; no app role writes
-- it, so a logo cannot bypass those checks by being written straight through PostgREST (which `businesses.crest_url`,
-- writable by owners and admins, could not prevent). Kept out of `businesses` so the row every procedure loads and
-- `business.get` returns stay small: the image travels once per version through `business.logo.get`.
create table business_logos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source text not null check (source in ('upload', 'generated')),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  content bytea not null check (octet_length(content) between 1 and 98304),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 1 and 1024),
  height integer not null check (height between 1 and 1024),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index business_logos_business_idx on business_logos (business_id);
--> statement-breakpoint
select fm_tenant_table('business_logos', array['owner','admin'], 'read_only');
