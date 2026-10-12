-- 0052 — Product and Development fixes (W17).
-- The Operations department of a physical-product business (dtc_physical, hardware) sits over the development module's
-- Specialists and Plan tabs only (DECISIONS: "Formulation Lab over the development module's Specialists and Plan
-- screens"); Commit and the seeds gave it every Development tab, so it duplicated Live sessions, Pull requests, Code and
-- Environments with the same business-wide data (DB-11). Commit and the seeds now build the subset; this removes the
-- copies from existing businesses, only where a tab is still the untouched default (one full-screen module widget), and
-- puts Specialists first.
delete from screen_definitions s
 using departments d, businesses b
 where s.department_id = d.id
   and b.id = d.business_id
   and b.archetype in ('dtc_physical', 'hardware')
   and d.slug = 'operations'
   and d.module_keys = array['development']::text[]
   and s.tab_slug in ('training-ground', 'pull-requests', 'code', 'environments')
   and s.layout = ('{"widgets":[{"key":"module:development/' || s.tab_slug || '","x":0,"y":0,"w":12,"h":60,"settings":{}}]}')::jsonb;
--> statement-breakpoint
update screen_definitions s
   set position = case s.tab_slug when 'specialists' then 0 else 1 end, updated_at = now()
  from departments d, businesses b
 where s.department_id = d.id
   and b.id = d.business_id
   and b.archetype in ('dtc_physical', 'hardware')
   and d.slug = 'operations'
   and d.module_keys = array['development']::text[]
   and s.tab_slug in ('specialists', 'plan')
   and not exists (select 1 from screen_definitions o where o.department_id = d.id and o.tab_slug not in ('specialists', 'plan'));
