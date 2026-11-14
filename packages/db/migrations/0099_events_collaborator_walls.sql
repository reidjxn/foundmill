-- 0099 — a collaborator reads only the business events a collaborator's sections cover (security fix, Nov 14, 2026).
-- It follows 0097.
--
-- `events` and `outbox` were made by `fm_tenant_table` (0011): `T_select` over `is_member` and `T_write`, FOR ALL, over
-- `has_role(business_id, array['owner','admin','member'])`. Since 0092 a collaborator holds 'member' in every `has_role`
-- check, so a collaborator's own RLS connection selected every event of the business, through either policy (a FOR ALL
-- policy answers SELECT too): `payment.received` with its amount, `bank.balance_updated`, `runway.threshold_crossed`,
-- `contract.signed`, `filing.due`, the Settings-only metrics. 0094 and 0095 closed the Money and Legal tables; the
-- events that describe them stayed open. The api and the business stream never served them to a collaborator
-- (@foundmill/shared `COLLABORATOR_SECTIONS`; apps/stream `EVENT_WALLS`); from 0099 the database says the same.
--
--   * `fm_collaborator_event_types()`: the business event types a collaborator may read. It is the list of the types
--     `EVENT_WALLS` files only under sections a collaborator can read (Product, Development, Distribution, Customers,
--     the Inbox and the Team; never Finance, Legal, Billing, Settings or `live`), including the types filed under no
--     section. A type filed under several sections is listed only when every one of them is readable, as the stream
--     delivers it (`viewEvent`: one walled section withholds the event). A type whose sections depend on its payload
--     (`conversation.message_posted`: the Inbox or the Team) is listed only when every outcome is readable. Immutable,
--     no table read; apps/stream walls.test.ts holds the latest definition among the migrations equal to `EVENT_WALLS`,
--     so a new event type, or a type moved to another section, fails a test until the list here follows.
--   * `events`: `events_select` lets a collaborator read a row only when its type is on that list; everyone else reads as
--     before (`is_member_not_collaborator` is `is_member` for every other role). An ended collaborator reads nothing,
--     as before (`is_member` leaves an ended row out). `events_write` (FOR ALL) is split into `events_insert`,
--     `events_update` and `events_delete`, the same writers as before (an owner, a cofounder, an admin, a member, a
--     collaborator), and a collaborator's insert, update or delete is held to the same list, so no row a collaborator
--     cannot read is written, changed or removed by them. The api writes events with RETURNING, which a row must
--     pass the select policy for, so the write side already followed the read side; it now says so itself.
--   * `outbox`: one row per event (its id, when it was relayed, the relay's last error). A collaborator reads, changes
--     or removes a row only when they can read its event (the `exists` runs under the caller's own row security, so it
--     follows `events_select`); the writers of a new row are the same as before (the event's own insert decides).
--
-- What a list of types cannot do: hide one field of an event a collaborator reads. The stream takes some payload fields
-- out for a reader walled off Finance (`hide`: a cycle's cost, a converted customer's amount, a task's cost, a goal's
-- revenue target); a row here is read whole. Those types stay readable, as their sections are, because the
-- collaborator's own screens read them under their RLS (Continue's state and the cycle history read the `cycle.*`
-- events, the Team its agents' `agent.health_changed`, the first week its first `cycle.completed`), and the api serves
-- the same figures to a collaborator elsewhere today (`cycle.status` `lastCost`, `journey.ribbon` revenue). Closing
-- those fields is a change to the api's reads, a follow-up of its own, not done here.
--
-- The migration refuses to run if `events` or `outbox` carries a policy other than the two it rewrites, so a policy
-- added later is a decision for whoever adds it, not an opening nobody saw.

do $$
declare
  stray text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into stray
    from pg_policies
   where schemaname = 'public'
     and tablename in ('events', 'outbox')
     and policyname <> tablename || '_select' and policyname <> tablename || '_write';
  if stray is not null then
    raise exception '0099: unexpected policies on events and outbox: %', stray;
  end if;
end;
$$;
--> statement-breakpoint
create function fm_collaborator_event_types() returns text[]
language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp as $$
  select array['idea.committed', 'spec.proposal_created', 'spec.version_published', 'source.added', 'source.scored', 'task.started', 'task.progressed', 'task.completed', 'task.blocked', 'pr.merged', 'deploy.succeeded', 'lead.created', 'lead.replied', 'campaign.launched', 'channel.threshold_breached', 'signup.created', 'activation.reached', 'customer.converted', 'agent.health_changed', 'training.completed', 'agent.promoted', 'approval.requested', 'approval.resolved', 'mode.changed', 'holiday.started', 'holiday.ended', 'cycle.started', 'cycle.completed', 'cycle.run_started', 'cycle.run_ended', 'autopilot.changed', 'autopilot.cycle_started', 'inbox.item_created', 'inbox.item_updated', 'decision.made', 'foundations.progressed', 'product.research_drafted', 'conversation.message_posted', 'membership.changed', 'business.updated', 'agent.message_sent', 'product.signoff_decided', 'distribution.started', 'goal.proposed', 'goal.approved', 'goal.change_requested', 'goal.achieved', 'page.published', 'team_call.started', 'team_call.ended', 'page.unpublished', 'page.followed', 'mail.sent', 'milestone.shown', 'milestone.hidden', 'post.drafted', 'invitation.sent', 'invitation.accepted', 'invitation.declined']::text[]
$$;
--> statement-breakpoint
comment on function fm_collaborator_event_types() is 'The business event types a collaborator may read: those apps/stream EVENT_WALLS files only under sections a collaborator can read (0099). The select, update and delete policies of events and outbox call it.';
--> statement-breakpoint
-- Not security definer: it reads nothing. The row policies call it as authenticated; anon never reaches `events` (no
-- grant) and on Supabase would otherwise hold EXECUTE directly (0087).
revoke execute on function fm_collaborator_event_types() from public, anon;
--> statement-breakpoint
grant execute on function fm_collaborator_event_types() to authenticated, service_role;
--> statement-breakpoint
drop policy events_select on events;
--> statement-breakpoint
create policy events_select on events for select using (
  is_member_not_collaborator(business_id)
  or (type = any (fm_collaborator_event_types()) and is_member(business_id))
);
--> statement-breakpoint
drop policy events_write on events;
--> statement-breakpoint
create policy events_insert on events for insert with check (
  has_role(business_id, array['owner','admin','member'])
  and (is_member_not_collaborator(business_id) or type = any (fm_collaborator_event_types()))
);
--> statement-breakpoint
create policy events_update on events for update
  using (has_role(business_id, array['owner','admin','member']) and (is_member_not_collaborator(business_id) or type = any (fm_collaborator_event_types())))
  with check (has_role(business_id, array['owner','admin','member']) and (is_member_not_collaborator(business_id) or type = any (fm_collaborator_event_types())));
--> statement-breakpoint
create policy events_delete on events for delete using (
  has_role(business_id, array['owner','admin','member'])
  and (is_member_not_collaborator(business_id) or type = any (fm_collaborator_event_types()))
);
--> statement-breakpoint
drop policy outbox_select on outbox;
--> statement-breakpoint
create policy outbox_select on outbox for select using (
  is_member_not_collaborator(business_id)
  or (is_member(business_id) and exists (select 1 from events e where e.id = outbox.event_id))
);
--> statement-breakpoint
drop policy outbox_write on outbox;
--> statement-breakpoint
create policy outbox_insert on outbox for insert with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
create policy outbox_update on outbox for update
  using (has_role(business_id, array['owner','admin','member']) and (is_member_not_collaborator(business_id) or exists (select 1 from events e where e.id = outbox.event_id)))
  with check (has_role(business_id, array['owner','admin','member']) and (is_member_not_collaborator(business_id) or exists (select 1 from events e where e.id = outbox.event_id)));
--> statement-breakpoint
create policy outbox_delete on outbox for delete using (
  has_role(business_id, array['owner','admin','member'])
  and (is_member_not_collaborator(business_id) or exists (select 1 from events e where e.id = outbox.event_id))
);
