---
date: 2026-11-16
branch: claude/wp10-t11-t12-settings-states
title: Settings opens on five basics; states that lose or hide information; the console scrolls sideways from 640 px
areas: [web, api, dugout, shared, docs]
supersedes: []
---
## What changed
WP-10 T11, T12 and the sideways-scroll task from founder decision 3 (Nov 16, 2026, relayed by the plan-execution
session), folded into one pull request to keep CI to one run.

T11, Settings › Basics (`apps/web/components/settings/BasicsTab.tsx`): five rows, each a link to the tab that holds the
setting and its value now: Name and logo (the project's name), How much your team asks before acting
(`teamCanDoWords`), Text size and explanations, Credits and spending ("$3.20 of $5.00 left this month", Estimate), People
("Just you" or the count, never a prompt to add someone). `basics` is first in `SETTINGS_TABS`; the other tabs follow
under "Everything else". The sidebar's Settings and the breadcrumb open on Basics with Builder view off and on Business
with it on. No setting moved and no tab was renamed. Tests: `basics-tab.test.tsx`, a `sidebar.test.ts` case,
`e2e/settings-basics.spec.ts`.

T12:
- Customer Update keeps a loaded replay when a background refetch fails (`loadFailed`) and shows
  `RefreshFailedNotice` above it (`journey-states.test.ts`).
- Milestones asks for the project's own day (`useToday`), not UTC's (`time-zone.test.ts`: 11:30 PM in Los Angeles).
- `toastDuration`: a warning, an error or a toast with an action stays until dismissed; others keep 5000 ms
  (`Toast.test.ts`).
- The reading pane marks a note read and archives it at once in the cached Inbox list and puts it back on failure
  (`inbox-cache.ts` and its test). Decisions stay pessimistic.
- `dev.tasks.count({ status })` (the existing `countByStatus`, same `read` guard and RLS) replaces the 500-task list
  the reading pane fetched to count running tasks (`dev-tasks-count.test.ts`, with the cross-tenant refusal).

Decision 3: `MIN_SCROLL_WIDTH = 640` and `isViewportTooNarrowToScroll`. From 640 to 1279 px `AppShell` renders the
console at its 1280 px floor inside `scroll-shell` (`overflow-x: auto`) with `NarrowWindowNote` (new, with story and
test), dismissed for the tab's session. `DesktopOnly` shows the larger-window note only below 640 px. Below 640 px and on
phones nothing changes; Today and Needs you keep their phone layout under 1280 px. `shell.spec.ts` checks it at 1152 ×
800. CLAUDE.md's "Never show the dense console below 1280 px" becomes "never lay it out narrower than 1280 px" with the
640 px rule, as the work package said the decision needs; DESIGN.md §1 and §2 and packages/dugout/CLAUDE.md say the same.

## Decisions
- `dev.tasks.count` takes a status only: the reading pane needs no more, and the existing `countByStatus` answers it.
- Basics opens with Builder view off (the sidebar's existing `builder` input) rather than with guidance on: Builder view
  is the switch that already decides which tab an area link lands on.
- The narrow-window note is dismissed per tab session (sessionStorage), so it comes back in a new session where the
  window is still narrow.
- T12's Milestones and Journey checks are unit tests of the helpers the screens now call; the screens have no render
  harness of their own.

## Not done
- T8 (the skills picker's look): `packages/modules/src/team/skills.tsx` is in open pull request #255 and
  `apps/web/components/agents/OverviewTab.tsx` in #252, so it waits for them.
- Playwright for these screens ran only partly locally (see the pull request); CI runs the rest.
