-- What a business's first-open drafting has stored so far (audit P3): the vision as soon as it has streamed, the plan
-- (one thesis per specification section and the roadmap's titles), each specification section as it is written and
-- the roadmap items as they arrive, all already plain text with figures labelled. Members read it through
-- `product.foundations.get` while the drafting runs (the vision shows within seconds, the rest fills in); a retry
-- resumes from it; the apply that turns the drafting ready clears it (the specification and the roadmap then live in
-- spec_blocks and roadmap_items, the vision in `vision`). A column on the row, not a table: it inherits the row's
-- policies from 0018 (members read, only services write; `fm_tenant_table(..., 'read_only')`).
alter table business_foundations add column progress jsonb;
--> statement-breakpoint
alter table business_foundations add constraint business_foundations_progress_object check (progress is null or jsonb_typeof(progress) = 'object');
--> statement-breakpoint
-- Bounded: ten to thirty sections of a few kilobytes each; a runaway value is refused rather than stored.
alter table business_foundations add constraint business_foundations_progress_size check (progress is null or octet_length(progress::text) <= 1048576);
