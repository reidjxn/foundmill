---
date: 2026-11-17
branch: claude/wp04-t2-commit-name-go
title: One first-day story; guidance on Today (WP-04 T7)
areas: [shared, config, api, dugout, web, evals, e2e, docs]
supersedes: []
---
## What changed
- `FIRST_DAY_PROMISE` (packages/shared `first-week.ts`) is now a frozen `readonly string[]` with the spec's four lines. Commit's "What happens next" is that array (`WHAT_HAPPENS_NEXT === FIRST_DAY_PROMISE`), and the welcome note's last line is `FIRST_DAY_PROMISE[3]`. `FIRST_DAY_TOAST` is Commit's toast.
  `OLD_FIRST_DAY_WORDS` is the regex the tests use to keep "specification", "roadmap", "two notes" and "sign off" out.
- The welcome note: subject "{Project} has started"; body "Hi {name}. {Project} is yours, and it has started." / "{Product lead} is drafting its public page from your own words. In about a minute you can check it and publish it." / "After that your plan arrives as one note. Nothing costs money or goes out in your name unless you say so."
  `welcomeNote` takes `displayName` and `businessName`; `idea.commit` passes the profile's `displayName` (new optional `CommitIdeaInput.displayName`).
- Today's empty Needs you in the first days: "Nothing needs you yet. Your page is being drafted and will show here in about a minute." Day 1 of "Your first week" reads "Your team drafts your page first, then your plan." (done: "Drafted your page and your plan.").
- Today's order is one pure function, `todaySections` (`today-view.ts`), drawn in that order; `data-order` on the grid names it. On a phone, and on a computer while the page waits (`pageReady`, or the page-ready note open in Needs you), Needs you leads at 12 columns, then the page line, the post line, the first week and the goal (12).
  Otherwise the first week, then the goal beside Needs you (6 + 6). The week, Since you were last here, the streak and Health always come last, in that order.
- The streak (founder's D5): hidden on the project's first day, with Health. `today.get` gains `projectDay` (1 on the day the business was created, in its own time zone) and `firstDay`. `StreakStrip` is one quiet line (small flame, headline, line, a dot per day opened). Its props are `opened` only: no missed or "today" dots, no `atRisk`, no "Open your business today" line.
- Today's tour, `TODAY_TOUR` (id `today`): What needs you, Your first week, Continue: one round of work. Mounted through `LazyTour` from `TodayScreen`, never on a phone; ending it marks `home` done too (`TourDefinition.alsoDone`). `useCoachmarkStamps` now answers when its first pass ran, and `Tour` mounts the Coachmark only then.
- `Explainer` on Today (`TODAY_EXPLAINER`: what Today is, what Needs you is, what Continue does). `AppShell` gains `phoneExplain`, which draws `ExplainPageButton` in the phone title row; `BusinessShell` sets it on Today only (`isTodayPath`). `today.visit` gains `returning` (a previous session on record).
- The founder dashboard preset no longer places `first_week_checklist` (the widget stays in the catalog). The seed test counts four widgets plus the department cards.
- Tests: shared (`first-week`, `empty-why`), api (`idea-commit` with a new "one first-day story" block, `foundations`, `today` `projectDay`, `since-last-visit` `returning`), dugout (`StreakStrip`, `AppShell` phone explain), web (`todaySections`, `streakStripProps`, the Today tour in `tours.test.tsx`, definitions, `isTodayPath`, `CommitForm`), and evals (`FIRST_DAY_STRINGS`, jargon-free).
- e2e: `today.spec.ts` asserts DOM order at 1440 and 390 on Northwind and on a fresh project's day one (no streak, no Health, Needs you first). It also checks Explain this page in both places. `phone-today.spec.ts`, `return-loop.spec.ts`, `tours.spec.ts` (a Today tour test) and `first-days.spec.ts` (no checklist) are updated.
  `commit.spec.ts` reads the four new lines in order. `first-days.spec.ts` waits for the api's foundations status and the plan note (`foundationsStatus` moved from commit.spec.ts to helpers.ts) instead of Today's drafting panel, the AC-11.1.6 race T2 fixed in commit.spec.ts, which this spec hit locally.
  `helpers.ts` has `FIRST_NOTE`, used by `commit.spec.ts` and `foundations.spec.ts`. The root `golden-path.spec.ts` matches "has started" but not "Distribution has started". `global-setup.ts` marks `today` done.
- docs/DESIGN.md: the Today screen note (order, the quiet streak, the explainer, the tour) and the checklist's line. T7 is ticked in the plan.

## Decisions
### FIRST_DAY_PROMISE changed shape (code over spec)
On main it was `{ steps, sentence }` with T5's four lines. The spec's interface is a plain array, so it is one now, and the toast that read `sentence` reads `FIRST_DAY_TOAST`. T4's starting-team line on Commit stays as its own line under the list; "Your team is hired" left the list.
### The note and Commit share one line word for word
The copy table words the note's plan line ("After that your plan arrives as one note.") differently from the promise ("Your plan arrives as one note to approve."). Both keep the table's words, and the note's last sentence is the promise's fourth line itself, so the step-1 test checks a shared line, not a paraphrase.
### The welcome note loses the house-rules line and the distribution line
The copy table drops both. The house-rules line stays in the Chief of Staff's template description; "nothing costs money or goes out in your name" replaces the distribution line. With no name on the profile the note opens "Hi."; with no Product lead, "The Product lead". An imported project reads "from what you imported" instead of "from your own words", which would not be true for it.
### Needs you's first-days line only while the page is on its way
The spec's line ("Your page is being drafted…") would be wrong on day 5. Today passes `firstDays` only while the first week shows and `pageReady` is true. After that the calm line ("Nothing needs you right now…") shows.
### The page leads while it waits, on a computer too
"A page-ready note is open or `pageReady` is true and nothing is published" is read as: `pageReady` (no page live, no note open), or a Needs you row whose one tap is the page note's "Check it and publish". Both already mean "not published". In that state the goal goes to 12 columns too, so no half row is left. The post line keeps its place beside the page line.
### The streak per D5, read narrowly
Only days opened are drawn: vacation days are not dots either, though they still freeze the count in the words. The at-risk words become the ordinary ones on Today (the founder is here), and `streakWords` itself is unchanged for the brief. "Day 2" is the project's calendar day from `created_at`, as the first week counts. Until `today.get` answers, the streak and Health wait.
### A sample business or one already selling is never on its first day
The seed creates Northwind "today" (the first-week test says so), so on a fresh stack `projectDay` is 1 for a business that reads two years in, and the first Playwright run hid its Health. `firstDay` is day 1 and not a sample and not selling; Today reads `firstDay`, not the number.
### "From the second visit" is a previous session or a project past its first day
A visit as a presence session needs a 30-minute gap, which no e2e stack can make without a database write. The tour starts when `today.visit.returning` is true, or once `firstDay` is false. Either way it is never in the sitting that started the project. Northwind therefore gets it on its first Today visit with guidance on, which `tours.spec.ts` uses.
### Ending Today's tour marks Home's either way
Done and Skip both mark `home` with `today`: a founder who skipped the front door's tour does not want the Details one next. The definitions test now allows two tours to point at a shell anchor (`continue`); stamped ids stay one tour's.
### Coachmark waits for the stamps
Today's first step is a stamped target. The Coachmark mounted before the stamp pass and started on Continue (seen in the new unit test), so `Tour` mounts it after the first pass. The Home, Inbox and department tours start the same.
### Explain this page on the phone, Today only
A prop on `AppShell` (`phoneExplain`), not a phone-wide change. The Inbox's reading pane and the public page also register explainers, and the spec names Today only.

## Not done
- `features.liveMode` is not read by T7. The api tests run with `LIVE_MODE=1`, as production does.
- The founder's existing dashboards keep a `first_week_checklist` they already hold; only new dashboards and the preset lose it. Removing it from stored layouts is a migration the spec does not ask for.
- `evals/src/founder-strings.ts` checks the shared first-day lines. The tour and explainer words live in apps/web, which evals does not import; `definitions.test.ts` checks their form.
- No new component, so no new story file; `StreakStrip`'s stories are rewritten (Going, Second day, Milestone, Vacation, 390 px).
- `public-page.spec.ts`'s first test failed locally twice: the Next.js dev overlay's "1 Insight" badge covered the "Built on Foundmill" link at 390 px, so the click timed out. T7 does not touch that page. The test was not changed; CI will show whether it fails there too.
- No test reads files outside its package, so `scripts/ci-affected.mjs` `TEST_READS` is unchanged.
