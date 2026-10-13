-- 0036 — agents and orchestration (audit W01).
--
-- One running vacation per business (audit O-35, DB-14, EX-1): startHoliday checked for a running vacation and then
-- inserted, so two requests at once (a double submit, two tabs) both inserted and two vacation workflows decided and
-- ran cycles in parallel; one "Come back" ended only one of them. Overlapping rows left by that race are closed first
-- (the newest stays running), then the partial unique index makes the second insert fail; the repository answers it
-- with "A vacation is already running".
update holiday_periods h
   set ended_at = now()
 where h.started_at is not null and h.ended_at is null and h.archived_at is null
   and exists (
     select 1 from holiday_periods n
      where n.business_id = h.business_id and n.started_at is not null and n.ended_at is null and n.archived_at is null
        and (n.started_at > h.started_at or (n.started_at = h.started_at and n.id > h.id))
   );
--> statement-breakpoint
create unique index holiday_periods_one_running_idx on holiday_periods (business_id) where started_at is not null and ended_at is null and archived_at is null;
--> statement-breakpoint
-- Usage bookings keyed by what they settle (audit O-33, BILL-20): a retried finishSession booked the session's sandbox
-- minutes and tokens again and charged the credits twice. A booking that carries a key is written once per business;
-- a repeat returns the first row and charges nothing.
alter table usage_ledger add column idempotency_key text;
--> statement-breakpoint
create unique index usage_ledger_idempotency_idx on usage_ledger (business_id, idempotency_key) where idempotency_key is not null;
--> statement-breakpoint
-- The founder's own id for a message sent at an agent's desk (audit RES-09): a reply lost in transit made Try again post
-- the question a second time and pay for a second answer. A repeat of the same client id in a thread returns the
-- exchange already recorded.
alter table agent_messages add column client_message_id text;
--> statement-breakpoint
create unique index agent_messages_client_message_idx on agent_messages (thread_id, client_message_id) where client_message_id is not null;
