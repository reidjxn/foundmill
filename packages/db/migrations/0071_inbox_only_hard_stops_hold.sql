-- 0071 — only a hard stop holds Continue (founder, 2026-11-07, phase 1 of the first-time founder report: "When a user
-- clicks continue, all rounds of work should run automatically"). A decision waits for the founder without stopping
-- the team: the work that needs the answer is held on its own (an approval holds its task, a plan waits for its
-- confirmation, the Chief of Staff plans only groundwork before the sign-offs). A customer win is good news and never
-- holds anything. From here `inboxRepo.createItem` and `revise` keep `blocks_continue` only on a warning (credits used
-- up, a revoked key: the team cannot work until the founder acts); this clears it on every open note of another type.
update inbox_items set blocks_continue = false where blocks_continue and type <> 'warning';
--> statement-breakpoint
comment on column inbox_items.blocks_continue is 'Holds Continue: true only on a hard-stop warning (credits used up, a revoked key) since 0071. A decision or a win never holds it.';
