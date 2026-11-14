-- 0107 — a collaborator reads no Finance figure of the tables a collaborator's own screens read (the follow-ups of the
-- events walls, Nov 14, 2026). The number is a placeholder: it follows the events walls (0099) and the migrations
-- numbered 0100–0106 on other branches, and takes the next free number, with a `when` above the last one, when merged.
--
-- 0094 and 0095 closed the Money and Legal tables to a collaborator, and the events walls the Money, Legal and Settings
-- event types. Two tables a collaborator's own screens read still carried money in a column of their own:
--   * `conversions` (0007, `fm_tenant_table(..., 'read_only')`: one select policy over `is_member`, written only by the
--     services): the Customers screens, Home's customer counts, the Customer Updates and a count goal's progress read
--     its rows under the reader's RLS, and `amount_minor` came with each payment;
--   * `journey_daily` (0041, a security-barrier view over the matview, `is_member`): the Ribbon and the chapters read
--     each day's `spend_minor` (agent sessions and channel spend) and `revenue_minor` (payments).
-- The api already zeroed or nulled these for a reader walled off Finance (`journey.ribbon`, `crm.entity.get`); from 0107
-- the database says the same to a collaborator, whatever the query.
--
-- `conversions`: a collaborator reads no row of the table (`conversions_select` is `is_member_not_collaborator`, 0094's
-- helper) and reads every row through `member_conversions` instead, a security-barrier view over the same columns with
-- `amount_minor` null unless the reader is a member who is not a collaborator. The view reads the table as its owner
-- (so the table's own policy does not apply inside it) and keeps `is_member` itself; packages/db reads it for every
-- client role's connection, and the table for the service's (`repos.journeys`, as `journey_daily` against its
-- matview). Owners, cofounders, admins, members, viewers, advisors and example viewers read the same rows and amounts
-- as before; an ended collaborator reads nothing either way. A row filter (a collaborator reads only signups and
-- activations) was the smaller change but not a faithful one: the customer counts on Home, the Customer Updates of
-- payments and a paying-customers goal would have read nothing for a collaborator, who may read the Customers area.
-- A column grant cannot tell a collaborator from a member: every person's connection is the same `authenticated` role.
--
-- `journey_daily`: the same view, with `spend_minor` and `revenue_minor` null unless the reader is a member who is not
-- a collaborator (`create or replace`, so the grants stay as 0041 and 0087 left them). The counts (tasks, signups,
-- activations, first payments, decisions) and the agent hours stay: they are the Ribbon's for everyone.
--
-- `inbox_items` is not changed. Its money is free text (the subject, the body, the decision options, the status strip:
-- "Cash is €2,000", "runway 4 months"), which only the api's Inbox redaction can mask (`@foundmill/db`
-- inbox-redaction.ts: currency symbols and codes, money words, runway figures, Finance strip entries and exhibits).
-- Doing it in the database would mean a second implementation of that masking in SQL, applied to every read of every
-- note, kept in step with the api's by hand; and `cost_minor`, the one money column, is now null behind the api's
-- Finance wall (`redactInboxItem`). The api's redaction stays the wall for the Inbox.
--
-- Supabase gives a new view every privilege for anon, authenticated and service_role by default (0087), and
-- `member_conversions` is a single-table view, so it is auto-updatable: a write through it would run as its owner. Every
-- privilege is revoked from public, anon and authenticated by name, and authenticated and service_role get SELECT only.
-- No function is added.
--
-- Like 0095, the migration refuses to run if `conversions` carries a policy other than the one it rewrites.

do $$
declare
  stray text;
begin
  select string_agg(policyname, ', ') into stray from pg_policies where schemaname = 'public' and tablename = 'conversions' and policyname <> 'conversions_select';
  if stray is not null then
    raise exception '0107: unexpected policies on conversions: %', stray;
  end if;
end;
$$;
--> statement-breakpoint
drop policy conversions_select on conversions;
--> statement-breakpoint
create policy conversions_select on conversions for select using (is_member_not_collaborator(business_id));
--> statement-breakpoint
create view member_conversions with (security_barrier) as
  select c.id, c.business_id, c.entity_id, c.kind,
         case when is_member_not_collaborator(c.business_id) then c.amount_minor end as amount_minor,
         c.currency, c.occurred_at, c.source_event_id, c.first_payment, c.created_at, c.updated_at
    from conversions c
   where is_member(c.business_id);
--> statement-breakpoint
revoke all on member_conversions from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on member_conversions to authenticated, service_role;
--> statement-breakpoint
comment on view member_conversions is 'Every conversion of the businesses the caller is a member of, with amount_minor null for a collaborator (0107). Client roles read conversions through it; the table itself is closed to a collaborator.';
--> statement-breakpoint
create or replace view journey_daily with (security_barrier) as
  select business_id, day, department_id, agent_hours, tasks_done,
         case when is_member_not_collaborator(business_id) then spend_minor end as spend_minor,
         case when is_member_not_collaborator(business_id) then revenue_minor end as revenue_minor,
         signups, activations, payments, decisions
    from journey_daily_mv
   where is_member(business_id);
--> statement-breakpoint
revoke all on journey_daily from anon;
--> statement-breakpoint
comment on view journey_daily is 'The daily rows of the businesses the caller is a member of, with spend_minor and revenue_minor null for a collaborator (0107).';
