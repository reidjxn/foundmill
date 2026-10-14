-- Copy rules (founder, 2026-10-08 no football vocabulary; 2026-10-10 US English). New businesses get the right words from
-- the code; this brings rows written before the fixes into line where they still hold the old default text, replacing
-- only the known phrase so nothing a founder wrote or edited is touched. Identifiers stay (tab slug 'formation',
-- agent types, channel keys).
--
-- 1. The demo channels' "Why" text said "for this club".
update channels set why_md = replace(why_md, 'for this club (Estimate)', 'for this business (Estimate)'), updated_at = now() where why_md like '%for this club (Estimate)%';
--> statement-breakpoint
-- 2. Every business's first Distribution task: "propose the starting formation" (the goal is also the agent's brief).
update tasks set goal_md = replace(goal_md, 'propose the starting formation', 'propose the starting channels for the Channel Board'), updated_at = now() where goal_md like '%propose the starting formation%';
--> statement-breakpoint
-- 3. The consumer app's first Board decision: "Distribution has a formation ready".
update inbox_items set body_md = replace(body_md, 'Distribution has a formation ready', 'Distribution has its Channel Board ready'), updated_at = now() where body_md like '%Distribution has a formation ready%';
--> statement-breakpoint
-- 4. The four offline channel agents still read "(wings line)" (0021 skipped them: their old text had no British spelling).
update agents set description_md = replace(description_md, '(wings line)', '(Offline line)'), updated_at = now() where agent_type in ('channel_direct_mail', 'channel_print', 'channel_broadcast', 'channel_outdoor') and description_md like '%(wings line)%';
--> statement-breakpoint
-- 5. The Chief of Staff's instructions of agents hired before the role line was fixed: "Chief of Staff and Chief of Staff: ...".
update agent_versions set instructions = jsonb_set(instructions, '{role}', to_jsonb(replace(instructions->>'role', 'Chief of Staff and Chief of Staff:', 'Chief of Staff:'))), updated_at = now() where instructions->>'role' like 'Chief of Staff and Chief of Staff:%';
--> statement-breakpoint
-- 6. Live prompts and profiles still carry the template text from before the switch: the British spellings,
--    "on holiday", the department names a renamed department would make stale, and day-first dates in the
--    instructions and the What-I-do text. Each known phrase is replaced word for word (the 0021 rule); nothing else moves.
do $$
declare p record;
begin
  for p in select * from (values
  ('I run the Development department:', 'I run engineering for this business:'),
  ('Engineering lead for this business''s Development department\.', 'Engineering lead for this business: the department that builds and ships the product.'),
  ('Planner for the Development department\.', 'Planner for the department that builds the product.'),
  ('Development team''s measured pace', 'engineering team''s measured pace'),
  ('brief Development and Distribution when the spec moves', 'brief the engineering and distribution leads when the spec moves'),
  ('notify Development \(re-plan\) and Distribution \(messaging\)', 'notify the engineering lead (re-plan) and the distribution lead (messaging)'),
  ('Finance and Distribution notified', 'the finance and distribution leads notified'),
  ('notify Finance and Distribution', 'notify the finance and distribution leads'),
  ('Development re-plan', 'engineering re-plan'),
  ('Development merge flow', 'engineering merge flow'),
  ('Development flow', 'engineering flow'),
  ('\mon holiday\M', 'on vacation'),
  ('\mbehaviours\M', 'behaviors'),
  ('\mbehaviour\M', 'behavior'),
  ('\mcolours\M', 'colors'),
  ('\mcolour\M', 'color'),
  ('\mlabelling\M', 'labeling'),
  ('\munlabelled\M', 'unlabeled'),
  ('\mlabelled\M', 'labeled'),
  ('\mrecategorisations\M', 'recategorizations'),
  ('\mrecategorisation\M', 'recategorization'),
  ('\muncategorised\M', 'uncategorized'),
  ('\mcategorisation\M', 'categorization'),
  ('\mcategorised\M', 'categorized'),
  ('\mcategorise\M', 'categorize'),
  ('\mCategorise\M', 'Categorize'),
  ('\mCategoriser\M', 'Categorizer'),
  ('\mprogrammes\M', 'programs'),
  ('\mprogramme\M', 'program'),
  ('\mlicences\M', 'licenses'),
  ('\mlicence\M', 'license'),
  ('\mauthorised\M', 'authorized'),
  ('\morganiser\M', 'organizer'),
  ('\msummarised\M', 'summarized'),
  ('\msummarise\M', 'summarize'),
  ('\mSummarise\M', 'Summarize'),
  ('\mprioritised\M', 'prioritized'),
  ('\mprioritise\M', 'prioritize'),
  ('\mprioritising\M', 'prioritizing'),
  ('\mpersonalised\M', 'personalized'),
  ('\mpersonalisation\M', 'personalization'),
  ('\moptimisation\M', 'optimization'),
  ('\mmoisturiser\M', 'moisturizer'),
  ('\mmaterialised\M', 'materialized'),
  ('\mfulfilment\M', 'fulfillment'),
  ('\mcatalogue\M', 'catalog'),
  ('\mapologise\M', 'apologize'),
  ('\manalysed\M', 'analyzed'),
  ('\manalyse\M', 'analyze'),
  ('\mNormalise\M', 'Normalize'),
  ('\mnormalise\M', 'normalize'),
  ('\mincentivise\M', 'incentivize'),
  ('\mrecognise\M', 'recognize'),
  ('\mrealise\M', 'realize'),
  ('\mfinalise\M', 'finalize'),
  ('\mminimise\M', 'minimize'),
  ('\mmaximise\M', 'maximize'),
  ('\memphasise\M', 'emphasize'),
  ('\mutilise\M', 'utilize'),
  ('\mstandardise\M', 'standardize'),
  ('\mjudgement\M', 'judgment'),
  ('\mcentre\M', 'center'),
  ('\mfavour\M', 'favor'),
  ('\mhonour\M', 'honor'),
  ('\m(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\M (\d{4})', '\2 \1, \3'),
  ('\m(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\M', '\2 \1')
  ) as v(pat, rep) loop
    update agent_versions set instructions = regexp_replace(instructions::text, p.pat, p.rep, 'g')::jsonb, updated_at = now() where instructions::text ~ p.pat;
    update agents set description_md = regexp_replace(description_md, p.pat, p.rep, 'g'), updated_at = now() where description_md ~ p.pat;
  end loop;
end $$;
