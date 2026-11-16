-- 0118 — the project's positioning notes (WP-08 T1; audit a5 GTM-08). One record of who the project is for, their
-- problem, what they use today and what is different, which every marketing call reads (@foundmill/shared
-- `positioning.ts`). `positioning` is the copy the founders approved; `positioning_draft` waits for them (the team's
-- first draft, a member's edit, or an agent's proposed change). Nothing an agent writes is used until a founder approves.
--
-- RLS unchanged: business_foundations keeps its tenant policy (0018), so the new columns are the business's alone.
alter table business_foundations add column positioning jsonb;
--> statement-breakpoint
alter table business_foundations add column positioning_draft jsonb;
--> statement-breakpoint
alter table business_foundations add column positioning_approved_at timestamptz;
--> statement-breakpoint
alter table business_foundations add column positioning_approved_by uuid;
--> statement-breakpoint
-- The positioning event is Product's, which a collaborator reads. `fm_collaborator_event_types()` (0099, 0105) follows
-- `EVENT_WALLS`: the same list, plus `positioning.approved`. `create or replace` keeps its owner, grants and policies.
create or replace function fm_collaborator_event_types() returns text[]
language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp as $$
  select array['idea.committed', 'spec.proposal_created', 'spec.version_published', 'source.added', 'source.scored', 'task.started', 'task.progressed', 'task.completed', 'task.blocked', 'task.design_checked', 'pr.merged', 'deploy.succeeded', 'lead.created', 'lead.replied', 'campaign.launched', 'channel.threshold_breached', 'signup.created', 'activation.reached', 'customer.converted', 'agent.health_changed', 'training.completed', 'agent.promoted', 'approval.requested', 'approval.resolved', 'mode.changed', 'holiday.started', 'holiday.ended', 'cycle.started', 'cycle.completed', 'cycle.run_started', 'cycle.run_ended', 'autopilot.changed', 'autopilot.cycle_started', 'inbox.item_created', 'inbox.item_updated', 'decision.made', 'foundations.progressed', 'product.research_drafted', 'conversation.message_posted', 'membership.changed', 'business.updated', 'agent.message_sent', 'product.signoff_decided', 'distribution.started', 'goal.proposed', 'goal.approved', 'goal.change_requested', 'goal.achieved', 'page.published', 'team_call.started', 'team_call.ended', 'page.unpublished', 'page.followed', 'mail.sent', 'milestone.shown', 'milestone.hidden', 'post.drafted', 'invitation.sent', 'invitation.accepted', 'invitation.declined', 'showcase.requested', 'showcase.approved', 'showcase.withdrawn', 'quiz.approved', 'quiz.published', 'quiz.unpublished', 'positioning.approved']::text[]
$$;
