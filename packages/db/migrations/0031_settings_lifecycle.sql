-- 0031 — Door B sources the sign-up import stored as read (audit 2026-10-12, issue 39). Before this fix, commit copied
-- the sign-up job's simulated per-source rows into `sources` with `relevance.import.status = 'done'` and invented
-- summaries ("164 customers, 1 months of revenue"), although nothing had been read and no import was ever started for
-- them. A row still in that state (the simulation's provenance "Estimate", never fetched, and no read recorded by the
-- orchestrator's `importSource`) becomes "not read", with the reason, so Product › Sources says so and offers Read now.
-- Rows the import actually read (`fetched_at` set, or `relevance.imported` recorded) and every other source are
-- untouched.
--
-- 1. The invented summary shown in Product › Sources ("What it says").
update sources
   set relevance = relevance - 'summary', updated_at = now()
 where relevance ? 'import'
   and relevance->'import'->>'status' = 'done'
   and relevance->'import'->>'provenance' = 'Estimate'
   and fetched_at is null
   and not (relevance ? 'imported');
--> statement-breakpoint
-- 2. The import record itself: not read, with the reason, and without the simulated summary.
update sources
   set relevance = jsonb_set(
         jsonb_set(relevance #- '{import,summary}', '{import,status}', '"failed"'::jsonb),
         '{import,note}', '"Not read: the sign-up import never read it."'::jsonb
       ) || '{"imported": false, "reason": "the sign-up import never read it"}'::jsonb,
       updated_at = now()
 where relevance ? 'import'
   and relevance->'import'->>'status' = 'done'
   and relevance->'import'->>'provenance' = 'Estimate'
   and fetched_at is null
   and not (relevance ? 'imported');
