-- 0062 — The first days are about the product (founder request 2026-10-18). When a new business's foundations are
-- drafted, the Product lead asks the founder to sign off the specification and the roadmap, each as a decision note;
-- both approvals start the first build. Distribution (the channel engines, the channel-scoring task, the Board's
-- "Where should the first customer come from?") waits for an explicit start.
--
-- product_signoffs: one row per sign-off round (kind spec | roadmap | ready_to_sell, round n), tied to the Inbox
-- decision item that asks for it. Standard tenancy: members read, owner/admin/member write (the api decides as the
-- user through RLS; the foundations apply and the orchestrator write pending rows with the service role).
create table product_signoffs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('spec', 'roadmap', 'ready_to_sell')),
  round int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested', 'declined')),
  inbox_item_id uuid references inbox_items(id) on delete set null,
  spec_version_id uuid references spec_versions(id) on delete set null,
  -- roadmap: {items: [{id, title, horizon, position}]}; ready_to_sell: {roadmapItemId, title}.
  snapshot jsonb,
  -- The founder's words with the decision (request changes, approve with notes).
  notes text check (notes is null or char_length(notes) <= 2000),
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_kind text check (decided_by_kind is null or decided_by_kind in ('user', 'system')),
  decided_at timestamptz,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kind, round)
);
--> statement-breakpoint
create index product_signoffs_business_idx on product_signoffs (business_id, kind, round desc);
--> statement-breakpoint
create index product_signoffs_item_idx on product_signoffs (inbox_item_id);
--> statement-breakpoint
create index product_signoffs_spec_version_idx on product_signoffs (spec_version_id);
--> statement-breakpoint
create index product_signoffs_decided_by_idx on product_signoffs (decided_by);
--> statement-breakpoint
select fm_tenant_table('product_signoffs');
--> statement-breakpoint
-- When the founder started distribution (Distribution › Board › Start distribution, or the "Ready to start selling?"
-- note). Null until then: no channel engine starts, the cycle planner defers channel tasks, the Board waits.
alter table businesses add column distribution_started_at timestamptz;
--> statement-breakpoint
-- Backfill: every business committed before sign-offs existed keeps selling and reads as signed off.
update businesses set distribution_started_at = committed_at where committed_at is not null and distribution_started_at is null;
--> statement-breakpoint
insert into product_signoffs (business_id, kind, round, status, decided_by_kind, decided_at, notes)
select b.id, k.kind, 1, 'approved', 'system', b.committed_at, 'Recorded at migration 0062: this business was committed before sign-offs existed.'
  from businesses b cross join (values ('spec'), ('roadmap')) as k(kind)
 where b.committed_at is not null;
