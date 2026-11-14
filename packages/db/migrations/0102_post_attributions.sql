-- 0102 — what a shared team post led to (item 8, approved by the network session Nov 13, 2026). A post the team drafted
-- for the founder to share by tap gets its own public codes, minted in the transaction that stores the draft: one per
-- network and one for a copied link, a message and the device's own share sheet (network null). Each link of the post
-- then carries `?via=s.<code>` (@foundmill/shared/via) in place of the page's `p.<slug>`. A real outcome that came back
-- through one is credited to the post: a person who arrived through it and confirmed that they follow the project
-- (double opt-in), then a real reply or a payment from that follower within 30 days, or a payment that carried the
-- code. Last touch, at most one post per outcome. Visits are never counted or shown; the first one only stamps the link.
--
-- Who may do what:
--   read    members of the business (the Creative tab says what a post led to, behind the CRM and Finance walls); a
--           collaborator reads no payment credit, as they read nothing of Money (0094, 0095)
--   write   the services only (the api's signed-out page reads, ingest's confirmation and webhooks, the drafting step)
--
-- Nothing here names a person: no entity id, no address, no IP, no device, no amount. A business never reaches another's
-- rows: each table's trigger checks that what a row points to is of the row's own business, whoever writes.
--
-- `attributions` (0088) and its kind check are unchanged: a first touch through `s.<code>` is recorded there as the
-- `p.<slug>` of the post's project, so no post code reaches an account event.
create table post_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- The team post (an `assets` row, kind `post`); its links go with it.
  asset_id uuid not null references assets(id) on delete cascade,
  -- The network the link was made for (`POST_NETWORKS`); null for a copied or sent link.
  network text constraint post_links_network_known check (network is null or network in ('x','linkedin','facebook','threads','reddit','bluesky','instagram','tiktok')),
  -- Ten characters from the RFC 4648 base32 alphabet, lowercase. Public (it is in a shared link), never an internal id.
  code text not null constraint post_links_code_shape check (code ~ '^[a-z2-7]{10}$'),
  -- Minted for a publish through a mock connector: never resolves, credits nothing.
  simulated boolean not null default false,
  -- When a browser that is not a member's first opened the link; a later visit changes nothing.
  first_visited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_links_code_key unique (code),
  constraint post_links_asset_network_key unique nulls not distinct (asset_id, network)
);
--> statement-breakpoint
create index post_links_business_id_idx on post_links (business_id);
--> statement-breakpoint
create table post_attributions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  link_id uuid not null references post_links(id) on delete cascade,
  -- The link's post and network, copied from the link (the trigger checks they match).
  asset_id uuid not null,
  network text constraint post_attributions_network_known check (network is null or network in ('x','linkedin','facebook','threads','reddit','bluesky','instagram','tiktok')),
  outcome_kind text not null constraint post_attributions_outcome_kind_known check (outcome_kind in ('follow','reply','payment')),
  -- The outcome's own event (`page.followed`, `lead.replied`, `payment.received`): one post at most per outcome.
  outcome_event_id uuid not null,
  -- What the outcome came from: the consent record for a follow; the follow's row for a reply or a payment through a
  -- follower; the payment's own event for a payment that carried the code. One reply and one payment per follower.
  origin_id uuid not null,
  outcome_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_attributions_outcome_event_key unique (outcome_event_id),
  constraint post_attributions_origin_kind_key unique (origin_id, outcome_kind)
);
--> statement-breakpoint
create index post_attributions_business_id_idx on post_attributions (business_id, outcome_at);
--> statement-breakpoint
create index post_attributions_link_id_idx on post_attributions (link_id);
--> statement-breakpoint
create index post_attributions_asset_id_idx on post_attributions (asset_id);
--> statement-breakpoint
-- The signup a follow came through: the post link the visitor last arrived with, kept only when the link is the
-- project's own, not simulated and was visited. Written by the api's public follow on the service connection, like the
-- rest of the row (contact_consents has no write policy for app roles).
alter table contact_consents add column post_link_id uuid references post_links(id) on delete set null;
--> statement-breakpoint
create index contact_consents_post_link_id_idx on contact_consents (post_link_id);
--> statement-breakpoint
-- No cross-business row, whoever writes (the service connection included). Security definer so the check sees the row
-- it points to whatever the writer may read; it reads nothing else and returns nothing.
create function fm_post_link_same_business() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  link post_links%rowtype;
begin
  if tg_table_name = 'post_links' then
    if not exists (select 1 from assets a where a.id = new.asset_id and a.business_id = new.business_id) then
      raise exception 'a post link points to a post of its own business' using errcode = '23514', constraint = 'post_links_same_business';
    end if;
    return new;
  end if;
  if tg_table_name = 'contact_consents' then
    if new.post_link_id is not null and not exists (select 1 from post_links l where l.id = new.post_link_id and l.business_id = new.business_id) then
      raise exception 'a follow points to a post link of its own business' using errcode = '23514', constraint = 'contact_consents_post_link_same_business';
    end if;
    return new;
  end if;
  select * into link from post_links where id = new.link_id;
  if not found or link.business_id <> new.business_id or link.asset_id <> new.asset_id or link.network is distinct from new.network then
    raise exception 'an outcome is credited to a post link of its own business' using errcode = '23514', constraint = 'post_attributions_same_business';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
revoke execute on function fm_post_link_same_business() from public, anon, authenticated;
--> statement-breakpoint
create trigger post_links_same_business before insert or update on post_links for each row execute function fm_post_link_same_business();
--> statement-breakpoint
create trigger post_attributions_same_business before insert or update on post_attributions for each row execute function fm_post_link_same_business();
--> statement-breakpoint
create trigger contact_consents_post_link_same_business before insert or update of post_link_id, business_id on contact_consents for each row execute function fm_post_link_same_business();
--> statement-breakpoint
select fm_tenant_table('post_links', array['owner'], 'read_only');
--> statement-breakpoint
select fm_tenant_table('post_attributions', array['owner'], 'read_only');
--> statement-breakpoint
-- A collaborator reads nothing of Money (0094, 0095; @foundmill/shared `COLLABORATOR_SECTIONS`), so in the database too
-- they read the follows and replies a post led to and never a payment credit (security review, Nov 14, 2026). Every
-- other member reads all of them, as the api's walls already decide per section.
drop policy post_attributions_select on post_attributions;
--> statement-breakpoint
create policy post_attributions_select on post_attributions for select
  using (is_member_not_collaborator(business_id) or (outcome_kind <> 'payment' and is_member(business_id)));
--> statement-breakpoint
-- Read only for app roles in the grants too, not only in the policies: nobody in a project writes what a post led to.
revoke insert, update, delete on post_links, post_attributions from anon, authenticated;
