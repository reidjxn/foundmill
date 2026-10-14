-- 0034 — first payments and the attribution a Customer Update actually used.
-- A renewal or a repeat order is revenue, not a new customer: ingest records it as a payment conversion with
-- first_payment = false and writes no journey and no customer.converted for it. journey_daily counts customers
-- (`payments`) from first payments only and revenue from every payment.
alter table conversions add column first_payment boolean not null default true;
--> statement-breakpoint
-- Payments recorded before 0034 were all counted as customers. Those the connector reported as renewals or repeat
-- orders (the source event's firstPayment), and those whose CRM record had already paid, are revenue only from here on.
update conversions c set first_payment = false
  from events e
 where c.kind = 'payment' and e.id = c.source_event_id and e.business_id = c.business_id and e.payload ->> 'firstPayment' = 'false';
--> statement-breakpoint
update conversions c set first_payment = false
 where c.kind = 'payment' and c.first_payment and c.entity_id is not null
   and exists (select 1 from conversions p where p.business_id = c.business_id and p.entity_id = c.entity_id and p.kind = 'payment' and p.occurred_at < c.occurred_at);
--> statement-breakpoint
create index conversions_first_payment_idx on conversions (business_id, kind, occurred_at) where first_payment;
--> statement-breakpoint
-- The models the journey builder used for the weights and the xC curve (null on records written before 0034, for
-- which the API derives the label as before).
alter table journeys add column attribution_model text check (attribution_model in ('position_based_40_20_40','data_driven_markov'));
--> statement-breakpoint
alter table journeys add column xc_model_source text check (xc_model_source in ('archetype_prior','trained'));
--> statement-breakpoint
drop view journey_daily;
--> statement-breakpoint
drop materialized view journey_daily_mv;
--> statement-breakpoint
create materialized view journey_daily_mv as
with rows as (
  select s.business_id, (s.started_at at time zone 'UTC')::date as day, a.department_ids[1] as department_id,
         extract(epoch from coalesce(s.ended_at, s.started_at) - s.started_at) / 3600.0 as agent_hours,
         0 as tasks_done, s.cost_minor as spend_minor, 0::bigint as revenue_minor, 0 as signups, 0 as activations, 0 as payments, 0 as decisions
    from agent_sessions s join agents a on a.id = s.agent_id
  union all
  select t.business_id, (t.ended_at at time zone 'UTC')::date, t.department_id, 0, 1, 0, 0, 0, 0, 0, 0
    from tasks t where t.status = 'done' and t.ended_at is not null
  union all
  select m.business_id, m.day, null, 0, 0, m.spend_minor, 0, 0, 0, 0, 0
    from channel_metrics m
  union all
  select c.business_id, (c.occurred_at at time zone 'UTC')::date, null, 0, 0, 0,
         case when c.kind = 'payment' then c.amount_minor else 0 end,
         case when c.kind = 'signup' then 1 else 0 end,
         case when c.kind = 'activation' then 1 else 0 end,
         case when c.kind = 'payment' and c.first_payment then 1 else 0 end, 0
    from conversions c
  union all
  select d.business_id, (d.decided_at at time zone 'UTC')::date, null, 0, 0, 0, 0, 0, 0, 0, 1
    from decisions d
)
select business_id, day,
       -- nil uuid = "no department" so the key is non-null and the matview can refresh concurrently
       coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) as department_id,
       sum(agent_hours)::numeric(12,3) as agent_hours,
       sum(tasks_done)::int as tasks_done,
       sum(spend_minor)::bigint as spend_minor,
       sum(revenue_minor)::bigint as revenue_minor,
       sum(signups)::int as signups,
       sum(activations)::int as activations,
       sum(payments)::int as payments,
       sum(decisions)::int as decisions
  from rows
 group by business_id, day, department_id
with data;
--> statement-breakpoint
create unique index journey_daily_mv_key_idx on journey_daily_mv (business_id, day, department_id);
--> statement-breakpoint
revoke all on journey_daily_mv from anon, authenticated;
--> statement-breakpoint
grant select on journey_daily_mv to service_role;
--> statement-breakpoint
create view journey_daily with (security_barrier) as
  select * from journey_daily_mv where is_member(business_id);
--> statement-breakpoint
revoke all on journey_daily from anon;
--> statement-breakpoint
grant select on journey_daily to authenticated, service_role;
