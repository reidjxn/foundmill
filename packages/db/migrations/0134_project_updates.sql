-- 0134 — write to your followers (WP-08 T3; audit a5 GTM-01). One update from the founders to the people who confirmed
-- they want to hear from the project, sent from its Foundmill address by a founder's press (an agent may draft one,
-- never send it).
--
-- project_updates   read by members of the business; members write a draft's subject and body (column grants), and
--                   only a draft (insert policy and update column grants); every other column (status, who approved, the counts, the agent that drafted
--                   it) is the services' (the api's service connection after `sectionAdmin("distribution")`, the
--                   gateway, the agent tool through the gateway).
-- project_update_deliveries
--                   one row per follower an update reached or skipped, claimed (`sending`) before its message goes out
--                   so two presses never send twice: the idempotency record of a send. Service role
--                   only (RLS on, no policy, no client grant), like account_outbox. It holds no address: the contact's id,
--                   the state, a reason word and the message's own id.
-- contact_consents.email_hash: the address that agreed and confirmed, as its suppression hash. Consent is recorded on
--                   the contact, and a member can edit a contact's address, so a send checks the address it would use
--                   against this hash (WP-08 T3 security review). Existing rows take their contact's address now.
alter table contact_consents add column email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
update contact_consents c set email_hash = encode(sha256(convert_to(lower(trim(e.identifiers ->> 'email')), 'UTF8')), 'hex')
  from entities e where e.id = c.entity_id and e.business_id = c.business_id and e.identifiers ? 'email' and c.email_hash is null;
--> statement-breakpoint
create table project_updates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'canceled')),
  drafted_by_agent_id uuid references agents (id) on delete set null,
  approved_by uuid,
  approved_at timestamptz,
  sent_count integer not null default 0 check (sent_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  remaining_count integer not null default 0 check (remaining_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint
create index project_updates_business_id_idx on project_updates (business_id, created_at desc);
--> statement-breakpoint
create index project_updates_drafted_by_agent_id_idx on project_updates (drafted_by_agent_id);
--> statement-breakpoint
select fm_tenant_table('project_updates', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
revoke update, delete on project_updates from anon, authenticated;
--> statement-breakpoint
-- A member's insert is a fresh draft of their own (the policy pins every column but the words; inserts name every
-- column, so this is a table grant with the policy as the guard).
create policy project_updates_insert on project_updates for insert
  with check (has_role(business_id, array['owner','admin','member']) and status = 'draft' and drafted_by_agent_id is null and approved_by is null and approved_at is null and sent_count = 0 and skipped_count = 0 and remaining_count = 0);
--> statement-breakpoint
create policy project_updates_edit on project_updates for update
  using (has_role(business_id, array['owner','admin','member']) and status = 'draft')
  with check (has_role(business_id, array['owner','admin','member']) and status = 'draft');
--> statement-breakpoint
grant update (subject, body, updated_at) on project_updates to authenticated;
--> statement-breakpoint
create table project_update_deliveries (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references project_updates (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  entity_id uuid not null references entities (id) on delete cascade,
  -- The address's suppression hash, never the address: one person reached once per update, whichever record they are on.
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('sending', 'sent', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 40),
  message_ref uuid,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_update_deliveries_one unique (update_id, entity_id),
  constraint project_update_deliveries_one_address unique (update_id, recipient_hash)
);
--> statement-breakpoint
create index project_update_deliveries_business_id_idx on project_update_deliveries (business_id);
--> statement-breakpoint
create index project_update_deliveries_entity_id_idx on project_update_deliveries (entity_id);
--> statement-breakpoint
alter table project_update_deliveries enable row level security;
--> statement-breakpoint
revoke all on project_update_deliveries from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, update, delete on project_update_deliveries to service_role;
--> statement-breakpoint
select fm_track_updated_at('project_update_deliveries');
--> statement-breakpoint
-- The two update events are Distribution's, which a collaborator reads (as `mail.sent`): `fm_collaborator_event_types()`
-- follows the stream's walls, the whole list again plus the two. `create or replace` keeps its owner, grants and policies.
create or replace function fm_collaborator_event_types() returns text[]
language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp as $$
  select array['idea.committed', 'spec.proposal_created', 'spec.version_published', 'source.added', 'source.scored', 'task.started', 'task.progressed', 'task.completed', 'task.blocked', 'task.design_checked', 'pr.merged', 'deploy.succeeded', 'lead.created', 'lead.replied', 'campaign.launched', 'channel.threshold_breached', 'signup.created', 'activation.reached', 'customer.converted', 'agent.health_changed', 'training.completed', 'agent.promoted', 'approval.requested', 'approval.resolved', 'mode.changed', 'holiday.started', 'holiday.ended', 'cycle.started', 'cycle.completed', 'cycle.run_started', 'cycle.run_ended', 'autopilot.changed', 'autopilot.cycle_started', 'inbox.item_created', 'inbox.item_updated', 'decision.made', 'foundations.progressed', 'product.research_drafted', 'conversation.message_posted', 'membership.changed', 'business.updated', 'agent.message_sent', 'product.signoff_decided', 'distribution.started', 'goal.proposed', 'goal.approved', 'goal.change_requested', 'goal.achieved', 'page.published', 'team_call.started', 'team_call.ended', 'page.unpublished', 'page.followed', 'mail.sent', 'milestone.shown', 'milestone.hidden', 'post.drafted', 'invitation.sent', 'invitation.accepted', 'invitation.declined', 'showcase.requested', 'showcase.approved', 'showcase.withdrawn', 'quiz.approved', 'quiz.published', 'quiz.unpublished', 'positioning.approved', 'site.release_created', 'site.published', 'site.unpublished', 'update.drafted', 'update.sent']::text[]
$$;
