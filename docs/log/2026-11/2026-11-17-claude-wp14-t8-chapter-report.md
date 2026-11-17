---
date: 2026-11-17
branch: claude/wp14-t8-chapter-report
title: WP-14 T8, the Chief of Staff's chapter report, from records only
areas: [composer, shared, evals, docs]
supersedes: []
---
## What changed
- **The report.** At the end of a chapter (a quarter) the Chief of Staff writes one `report` note to the Inbox, "Your chapter report: Q3 2026", in five sections: what we set out to do, what we did, the best moment, what we learned, what's next.
- **Real records only.** The page is a template (`packages/shared/src/chapter-report.ts`) over facts the composer reads through the repositories (`apps/composer/src/chapter-report.ts`). There is no model call, so nothing can be invented.
- **What it reads:** goals in force during the chapter; `task.completed` events by agent; first payments from a named customer; task reports agents saved; the work in hand and waiting; the goal in force now. A simulated task result, a simulated report and a payment the Simulate panel made are left out.
- **Every item is an entity link**, `[[ent:<uuid>|Name]]`, to the agent or the customer it is about. The note's `source_event_ids` hold the finished-work and payment events behind it, and `entity_ids` the customers named.
- **A thin chapter says so.** With fewer than three items on record the page opens "…was a quiet chapter. There is little on record, so this report is short, and nothing in it is filled in.", and a section with nothing says "Nothing on record for this chapter."
- **When it is written.** `ComposerService.chapterTitle` already runs when an ended chapter's title is asked for; it now also calls `chapterReport`. One report a chapter (idempotency key `chapter-report:<quarter>`); a second call returns the same note.
- **For whom.** Only the chapter that has just ended, only a project that existed during it, never a sample business.
- **Tests:** composer `chapter-report.test.ts` closes a chapter on a seeded project and checks one note, every item linked to an agent or customer of that project, the linker accepting every link, the claims against their records, nothing simulated, and no second note.
- **Eval:** `evals/src/chapter-report.ts` (`chapter_report.*`): an empty chapter, one piece of work, a goal only, and a full chapter, gated on links, numbers and result words.

## Decisions
### A template, not a model call
"Invents nothing" and "real records only" are certain with a template and only likely with a model. The day's digest (WP-04 T8) set the pattern: a Chief of Staff note written from records with no model call. It costs nothing and works the same in mock mode. If the founder wants the page in the Chief of Staff's own voice later, the facts and the gate in the eval are ready for a model to be held to.

### "Every item is an entity link" means an agent or a customer
Entity links exist for people, organizations and agents. A goal, a task or a report is not an entity, so each item links the agent that proposed, did or wrote it, or the customer it is about, and the note carries the event ids behind it. An outcome with nobody to link (the public page going live, emails sent) is therefore not an item in the report.

### The trigger is the ended chapter's title request
Nothing in the product marks a chapter as closed. The one moment the product acts on an ended chapter is when its title is asked for (the Ribbon read, the orchestrator), so the report is written there. If writing it fails, the failure is logged and the title is still returned.

### Only the chapter that just ended
A project opening its Ribbon for the first time asks for the title of every past quarter. Without this rule it would get a page for each of them at once.

### No amounts
A customer won is named with its day, never with what it paid: the note is read by everyone with the Inbox, including people walled from Finance.

### "What we learned" is the reports agents saved
The record of something learned is a task report. The line quotes its title and says the full report is on its task. The title is the agent's own words, shown as a quotation, never restated as fact.

## Not done
- In live mode the title is stored on its first model answer and is not asked for again, so a report that failed to write then is not retried. A sweep that retries it is not built.
- On the Playwright stack no composer runs, so no spec shows the report in the Inbox; it reads as any `report` note does.
- The public page going live and emails sent are not in the report (no entity to link).
