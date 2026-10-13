-- 0031 — Door B sources the sign-up import stored as read (audit 2026-10-12, issue 39). Before this fix, commit copied
-- the sign-up job's simulated per-source rows into `sources` with `relevance.import.status = 'done'` and invented
-- summaries ("164 customers, 1 months of revenue"), although nothing had been read and no import was ever started for
-- them. A row still in that state (the simulation's provenance "Estimate", never fetched, and no read recorded by the
-- orchestrator's `importSource`) becomes "not read", with the reason, so Product › Sources says so and offers Read now.
-- So does an import row an earlier `import.start` stored without a status that no read ever recorded (3). Rows the
-- import actually read (`fetched_at` set, or `relevance.imported` recorded), rows waiting for a read now
-- (`import.status = 'pending'`) and every other source are untouched.
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
--> statement-breakpoint
-- 3. Rows an earlier `import.start` on a business stored without a status (before this fix) that no read ever recorded:
-- the worker was not reachable (the simulated job ran instead) or the gateway call threw before anything was written.
-- Nothing is reading them now, so they are not read, with the reason, instead of "not read yet" forever. A later read
-- (Read now) records its own outcome over this.
update sources
   set relevance = jsonb_set(
         jsonb_set(relevance, '{import,status}', '"failed"'::jsonb),
         '{import,note}', '"Not read: the earlier import never recorded a read."'::jsonb
       ) || '{"imported": false, "reason": "the earlier import never recorded a read"}'::jsonb,
       updated_at = now()
 where relevance ? 'import'
   and jsonb_typeof(relevance->'import') = 'object'
   and not (relevance->'import' ? 'status')
   and not (relevance ? 'imported')
   and fetched_at is null;
