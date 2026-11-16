---
date: 2026-11-16
branch: claude/wp04-t8-note-budget
title: Note budget and the day's digest
areas: [db, api, shared, config, web]
supersedes: []
---
## What changed
WP-04 T8 (s2 §5.3, e0: 4 to 17 notes on day one). In a project's first 7 days (`LIMITS.firstWeekDays`), an agent's
plain update or report (no decision, not holding Continue, not from the Chief of Staff) is stored archived and listed
in one Chief of Staff update, "What your team did today", written afresh each time and replacing the earlier one (and
the welcome note) through `supersedeUpdates`. Decisions, warnings, wins, milestones, people's messages and every note of
a sample business are never folded. One choke point: `inboxRepo.createItem` (`foldOf`, `writeDigest`); callers pass
nothing new and still write `inbox.item_created` for their own note.

- `packages/shared/src/note-budget.ts`: `noteVerdict`, `digestBody` (a template, at most 8 lines, then "And {n} more in
  the Inbox."), `DIGEST_SUBJECT`. Tests in `note-budget.test.ts`.
- `packages/config/src/limits.ts`: `firstWeekDays = 7`, `firstWeekNotesPerDay = 3`.
- `apps/api/src/services/goals.ts`: `ensureGoal` proposes nothing while the project is under 24 hours old and its page
  is not live, whichever ends first (`goalWaitsForPage`).
- Tests: `packages/db/src/__tests__/inbox-note-budget.test.ts` (three updates on day one leave one unread Chief of Staff
  note listing three lines and three archived rows; a decision in between is untouched; day 9 and a sample deliver),
  two cases in `apps/api/src/__tests__/goals.test.ts`. Its helper now commits two days back so the older cases are
  unchanged.
- Playwright specs that read a first-week agent update from the Inbox list now find it in the digest or in Archive:
  `inbox.spec.ts` ("Building starts", and the page goes live through `page.publish` before the goal),
  `first-days.spec.ts`, `product-research.spec.ts`; `commit.spec.ts` and `foundations.spec.ts` accept the welcome or the
  digest.

The check for Done-when 3, to run on production:

```sql
select b.id, count(*) from inbox_items i join businesses b on b.id = i.business_id where not b.is_demo and i.type <> 'human_message' and i.state <> 'archived' and i.created_at < b.committed_at + interval '24 hours' group by 1;
```

## Decisions
### `noteVerdict` takes the number of days as an argument
The spec gives `noteVerdict(f)`. `@foundmill/shared` does not depend on `@foundmill/config`, so the repo passes
`LIMITS.firstWeekDays` as a second argument instead of adding a package edge. The rollback lever stays one constant.

### Which notes the digest lists
There is no column marking a folded note. The digest lists the archived plain updates and reports from agents other
than the Chief of Staff created on the business's day (its time zone) since commit. In the first week every such note
was folded: none is delivered, so none is archived by hand or superseded. No migration.

### "Holding Continue" uses the stored value
An update or report never holds Continue (`holdsContinue`: only a warning does), so the check is on the stored flag
and every plain update or report from another agent folds, including the follow-ups to the founder's own press
("Building starts", "Changes requested", "Distribution has started"). The spec names only decisions, approvals,
warnings, wins, milestones and messages as never folded. If founders miss those follow-ups, they can be exempted by
type of note later.

### No links in the digest
The Risk line says the digest links each line to its note. No note body links another note today, and the body
renderer has no such markup, so each line names the agent and the subject and the body says the full notes are in the
Inbox under Archive.

### The goal's wait applies to every proposal, not only the first
"One condition before `writeProposal`" sits at the top of the proposal step: only the first goal can come up in a
project's first day, and a business never committed (`committed_at` null) is not held.

### `firstWeekNotesPerDay` is a target, not a counter
Nothing counts against it when a note is written: the fold holds day one to the welcome or digest, the page note and
the sign-off notes. The repo test checks the day's open notes against it.

### Done-when, against the code
D3 (one plan note instead of the two sign-off notes) is WP-04 T5, not on main yet. Until it lands, a project left
alone on day one holds the welcome or digest, the page note and the two sign-off notes: four, where Done-when 3 says at
most three. T5 brings it to three.

## Not done
- The digest's lines do not link to their notes (above).
- T5's single plan note (D3); until it lands Done-when 3 reads four notes, not three.
- Today's goal panel still says "Your Chief of Staff proposes a goal after the first round of work."; on day one it also
  waits for the page. Left to T7, which owns Today's first-day words.
- The Playwright specs changed here were not run to the end locally: on the shared build machine the browser page
  crashed for lack of memory before the first assertion. They are type-checked and linted; CI runs them.
