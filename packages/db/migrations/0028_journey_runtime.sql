-- 0028 — the background runtime (audit fixes, 2026-10-12): milestones awarded from real conversions, the drafted
-- creative a founder reads before approving it, CRM deletion requests that suppress at once and are purged by the
-- scheduled job, and the purge of a business whose scheduled deletion came due.
--
-- Milestones: each trophy (`ref.trophyKey`) is awarded once per business, however many writers race for it (ingest on
-- a payment, the journey build, the nightly catch-up). A later duplicate, if one exists, keeps its row and loses the key.
update milestones m set ref = (m.ref - 'trophyKey') || jsonb_build_object('supersededTrophyKey', m.ref ->> 'trophyKey')
where m.ref ->> 'trophyKey' is not null
  and exists (
    select 1 from milestones o
    where o.business_id = m.business_id and o.ref ->> 'trophyKey' = m.ref ->> 'trophyKey' and (o.achieved_at, o.id) < (m.achieved_at, m.id)
  );
--> statement-breakpoint
create unique index milestones_trophy_key_idx on milestones (business_id, (ref ->> 'trophyKey')) where ref ->> 'trophyKey' is not null;
--> statement-breakpoint
-- Creative: the text the channel agent drafted (an email, a post, an ad's copy, a print brief). `content_ref` stays the
-- pointer to rendered artwork or a hosted page.
alter table assets add column body text;
--> statement-breakpoint
alter table assets add constraint assets_body_length_check check (body is null or char_length(body) <= 8000);
--> statement-breakpoint
-- CRM deletion requests (GDPR erasure): the contact is suppressed at once (suppression_list hashes) and purged by the
-- scheduled job once `deletion_due_at` passes. Columns of `entities`, so its policies apply unchanged.
alter table entities add column deletion_requested_at timestamptz;
--> statement-breakpoint
alter table entities add column deletion_due_at timestamptz;
--> statement-breakpoint
alter table entities add constraint entities_deletion_check check ((deletion_requested_at is null) = (deletion_due_at is null));
--> statement-breakpoint
create index entities_deletion_due_idx on entities (deletion_due_at) where deletion_due_at is not null;
--> statement-breakpoint
-- The audit chain stays append-only for everyone, except while `fm_purge_business` removes the chain of the one business
-- it is purging (the transaction-local setting names it; nothing else can set it for another business's rows).
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('fm.purge_business', true) = old.business_id::text then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = 'P0001';
end;
$$;
--> statement-breakpoint
-- The nightly business-deletion sweep reads each business's latest deletion entry across every audit chain
-- (`repos.businesses.deletionsDue`); this keeps it off a scan of the whole log.
create index audit_log_deletion_idx on audit_log (business_id, seq desc) where action in ('business.request_deletion', 'business.cancel_deletion');
--> statement-breakpoint
-- Permanently deletes a business and everything it owns (every business-scoped table cascades from `businesses`).
-- Service role only: the orchestrator's business-deletion job calls it for a deletion the owner scheduled, that was not
-- canceled, once its date has passed. Cap-table entries go first (their holder FK is RESTRICT).
create function fm_purge_business(target uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  removed int;
begin
  perform set_config('fm.purge_business', target::text, true);
  delete from cap_table_entries where business_id = target;
  delete from businesses where id = target;
  get diagnostics removed = row_count;
  perform set_config('fm.purge_business', '', true);
  return removed > 0;
end;
$$;
--> statement-breakpoint
revoke all on function fm_purge_business(uuid) from public;
--> statement-breakpoint
grant execute on function fm_purge_business(uuid) to service_role;
