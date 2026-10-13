-- 0039 — money and billing (audit BILL-09, CML-11).
-- Every model call was booked at its cost rounded to a whole cent, so a call under half a cent (every Haiku utility
-- call, many short Sonnet answers) cost 0 in credits, Payroll and the Billing tab. A ledger row now keeps its exact cost
-- in millionths of a cent (the meter's costMicroMinor) next to the rounded cost_minor; every sum adds these and rounds
-- once. Rows written before 0039 hold null and count as cost_minor × 1,000,000.
alter table usage_ledger add column cost_micro_minor bigint check (cost_micro_minor is null or cost_micro_minor >= 0);
--> statement-breakpoint
-- What a period's charges add up to below a whole cent: the balance is charged each time the carry completes a cent,
-- so thousands of tiny calls are charged what they cost instead of nothing.
alter table credit_balances add column carry_micro_minor bigint not null default 0 check (carry_micro_minor >= 0 and carry_micro_minor < 1000000);
--> statement-breakpoint
-- Training was booked twice (audit O-19, BILL-10): every answer and grader call is a `tokens` row, and the run then wrote
-- a 'training' row with the same cost, in the column default's currency. The 'training' row is now a count of tests at no
-- cost; an old one that sits next to its per-call rows (a grader call of the same agent just before it) is zeroed so
-- totals, Payroll and the vacation spend ceiling count the run once.
update usage_ledger u
set cost_minor = 0, cost_micro_minor = 0, currency = 'USD'
where u.kind = 'training'
  and u.cost_minor > 0
  and exists (
    select 1 from usage_ledger t
    where t.business_id = u.business_id
      and t.agent_id is not distinct from u.agent_id
      and t.kind = 'tokens'
      and t.details ->> 'kind' = 'skill_grader'
      and t.occurred_at between u.occurred_at - interval '2 hours' and u.occurred_at
  );
