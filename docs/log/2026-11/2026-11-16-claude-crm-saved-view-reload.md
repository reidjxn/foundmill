---
date: 2026-11-16
branch: claude/crm-saved-view-reload
title: A view saved as new never takes the id of a view saved on an earlier visit (audit #204 flake)
areas: [dugout, web, e2e]
supersedes: []
---
## What changed
- `DataTable`'s "Save as new view" (`packages/dugout/src/components/data/DataTable.tsx`, `saveViewAs`) skips any id an
  existing view already holds. The ids come from `uniqueId("view")`, a counter that starts again at 1 on every page
  load, while saved views are stored per person (founder.tableViews) and outlive the page. A view saved on an earlier
  visit was `view-1`, and the first view saved after the next load was `view-1` again: the stored list then held two
  views with one id, `views.find` picked the older one, and after a reload the table opened on the old view, not the
  new one. Unit test: "gives a view saved as new an id no stored view holds".
- `apps/web/e2e/crm.spec.ts` "a saved view, and the view left open, come back after a reload" calls `settled(page)`
  after both reloads, as e2e/README.md "Streamed pages" asks for any reload followed by a look or a click. Without it,
  `getByTestId("crm-screen")` could match the streamed copy and the live screen at once (strict mode).

## Decisions
- Root cause, from the CI traces of run 43856823695 (shard 3). The first attempt failed on the streamed copy (strict
  mode at line 65); its save had reached the api (all three `founder.tableViews.save` posts answered 200 before the
  reload), and the failed attempt never reached its "Delete view" step, so `view-1` stayed stored. Both retries then
  saved their new view as `view-1` too (seen in the posted bodies) and reopened on the first attempt's view. So the
  flake was one timing failure in the test, made permanent for the retries by the product bug. The same bug hits a real
  founder who saves a second view on a later visit.
- Hypothesis (a), a reload before the save reaches the api, was ruled out by the traces. The two writes "Save as new"
  makes in one tick go out in one tRPC batch that the api runs concurrently, so their order is not guaranteed; 40
  batches against an idle api kept the open view each time. Left as is: no failure traced to it.
- Hypothesis (b): the second `crm-screen` is the hidden streamed copy (`div[hidden][id^="S:"]`), not a second shell or
  a portal. The test waits on that signal (`settled`); nothing in the screen changed for it.
- Reproduced locally (production build, own PGlite and ports) by leaving what a failed attempt leaves (one stored custom
  view `view-1`, open): 3 of 3 failed with "View: E2E view leftover" showing after the reload, the CI retries'
  failure. With the fix, from the exact state CI's first attempt stored, 26 of 30 repeats passed and every new view got
  a fresh id (`view-2`, `view-3`); none of the 4 failures was a wrong view after a reload: two renderer crashes and one
  stalled renderer on a machine at load 35 on 4 cores, and one `ECONNRESET` in Next's `/api/trpc` rewrite proxy.
- The id stays counter-based with a collision check rather than random, so stories and tests stay readable; the check
  is against the views the table holds, which include the stored ones.

## Not done
- People who already have two stored views with one id keep them; the table still shows the first. No migration: the
  bug was only reachable by saving a second custom view on a later visit, and deleting one fixes the list.
- The api does not reject a views list with repeated ids, and "Save as new" still writes twice in one batch that the
  api may run in either order. Neither caused this failure.
- The strict-mode half (the streamed copy) was not reproduced locally in the repeats; it is fixed by the documented wait.
- One local repeat failed on `Failed to proxy … ECONNRESET` from the web's `/api/trpc` rewrite to the api (the list
  query answered 500 and the table showed an error). Not seen in the CI run; not investigated here.
