---
date: 2026-11-16
branch: claude/wp04-t2-commit-name-go
title: Commit as name and go, at any width (WP-04 T2)
areas: [web, e2e, docs]
supersedes: []
---
## What changed
- `CommitScreen.tsx`: the form is one column at the reading measure (`StudioFrame smallScreen width="measure"`), the same
  from 390 to 1440 px. The default view is the Name panel (the name prefilled, the suggestions and "You can change the
  name, the logo and how your team works any time."), then What happens next with the included credits line and one
  button, "Start my project" (`size="lg"`, `min-h-tap w-full @page-wide:w-auto`; "Starting…" while it runs). Under it a
  ghost "More options" (`data-testid="commit-more"`, `aria-expanded`) opens, for everyone and closed by default: the name
  checks, the logo and brand colors with the concept card and the words note, How it runs (its labeled summary over its
  five controls, no more "Change"), the team preview and a second "Start my project" (`take-charge-bottom`).
  `moreOpen` replaces `runsChosen`; a refused answer inside (archetype, spend line, 18+, brand colors) opens it.
- `idea.domainCheck` is asked only while More options is open. Before, it ran on every name change.
- The wage line (`squad-preview-wages`) shows only in Builder view (`BuilderOnly`), inside More options.
- The 18+ record comes from `founder.profile.get.adultConfirmed` (already loaded there), not `live.summary`. That query
  is gone from the screen.
- Copy: the title is "Start {name}" ("Start your project" with no name, also the page's browser title), the lede is "Check the
  name and start. Your team drafts your public page first, from your own words.", and the error toast is "That did not
  start". The words live in `COMMIT_WORDS`. The loading, not-found and "Already started" frames are `smallScreen` too.
- `StudioFrame.tsx`: the trail's Commit step reads "Start" and the doors step "New project" (it was "Start"). With
  `smallScreen`, the trail is hidden by CSS under `page-wide` and left out below 1280 px, so the 56 px bar never wraps.
- `DesktopOnly.tsx`: `/^\/new\/commit\/[0-9a-f-]{36}\/?$/i` is added to `SMALL_SCREEN_PATTERNS`.
- `CardKeptView.tsx`: with a profile, a phone gets the link to Commit, the same as a computer. Before, it got
  `NextStepOnComputer` by email. "See more directions" (the studio) stays off small screens.
- docs/DESIGN.md: a Commit bullet in the screen notes (two lines), and the logo's "Saving" line names the new button.
- Tests: `CommitForm.test.tsx` gains "name and go" with guidance on and off (one input, the next-step lines, the
  credits line, one "Start my project", More options closed and every panel behind it, no domain, trademark,
  spend-line, mode or wage words, no `domainCheck` until it opens), a refused archetype opening it, a one-press start
  with the defaults, the copy, and the wage line in Builder view only. The How it runs tests run inside More options.
  `StudioFrame.test.tsx` (the labels; no trail at 390 with `smallScreen`), `desktop-only.test.tsx` (the Commit
  pattern) and `card-kept-view.test.tsx` (Commit linked on a phone) are updated too. In Playwright, `commit.spec.ts`
  gains "name and go" at 390 x 844 and 1440 x 900: no wall, one field, one button, More options closed, no
  `idea.domainCheck` request, no horizontal scroll, and one press reaches Today. Its other tests open More options
  first. `import.spec.ts`, `ideation.spec.ts` and the root `golden-path.spec.ts` press "More options" where they
  pressed "Change" or read the card.
- **AC-11.1.6 fix** (`commit.spec.ts`). The test waited for Today's `foundations-status` panel. That panel shows only
  when Today's first read catches the mock drafting in progress, so the test also failed on a clean main (WP-04 T5's
  log). It now polls the api's own status (`product.foundations.get` as the dev founder) until it reads `ready`. A
  drafting that fails reads `failed` and still fails the test. It then checks that whatever Today shows of the
  foundations is the ready state, never failed: the panel is either absent, or present and reading `ready`. It is not
  skipped and not loosened. A panel seen drafting and a panel never shown are both accepted, because both prove the
  same thing once the api reads ready.
- WP-04's T2 is ticked.

## Decisions
- **One button on the default view, both test ids kept.** The spec asks for one button and also keeps `take-charge` and
  `take-charge-bottom`. `take-charge` is the button under What happens next, which every spec presses.
  `take-charge-bottom` closes the open More options, where the column is long. The header carries only Back.
- **Inside More options, How it runs is open.** "With all its controls" read as no second disclosure, so the "Change"
  toggle and `how-it-runs-change` are gone. Guidance no longer opens anything: More options starts closed for everyone.
- **Trail labels.** Commit's step becomes "Start", as the spec says. The doors step was already "Start", so it now
  reads "New project". Without that change the trail would show "Start" twice.
- **Code over spec.**
  - The "before" lede the spec quotes had already changed on main ("…drafting your public page, then your plan").
    The new lede replaces main's.
  - `WHAT_HAPPENS_NEXT` should become T7's `FIRST_DAY_PROMISE` with three lines. T7 is not built, and
    `FIRST_DAY_PROMISE.steps` on main has four lines (T5's wording). The screen keeps `FIRST_DAY_PROMISE.steps`, and
    the test counts `WHAT_HAPPENS_NEXT.length` lines, not three. T7 changes the shared constant.
  - The team panel "from T4" does not exist yet. Today's team preview (`squad-preview`) moved under More options.
- **What else moved under More options:** the concept card and the words note ("The pitch is in your words…"), which
  sat in the rail. They preview the logo and the pitch, and neither is a field or a step.
- **The field label stays "Business name".** The project/business rule would make it "Project name", but seven spec
  and helper files find the field by that label. That rename is worth a change of its own.
- **Trail on small screens:** CSS (`hidden @page-wide:flex`) hides it on a phone from the first paint, and the
  measured width removes it up to 1280 px, so a tablet never wraps the bar. Arbitrary container sizes are not allowed
  in the design system, so CSS alone could not cover the tablet range.
- `CardKeptView` is in `components/new/card/`, not `app/new/card/keep/*` (PR #249's files), so it is not part of
  that overlap. The change completes T1's "Done when": card → three questions → Commit, with no wall.
- New tests that failed on main: every new `CommitForm` test and the reworked ones (no `commit-more` or
  `COMMIT_WORDS`), the trail labels and the 390 trail test, the Commit pattern in `desktop-only`, the kept card's
  phone link, and in Playwright both "name and go" tests (at 390 the wall, with no form; at 1440 six inputs where the
  test expects one), the More options test and AC-11.1.6 (no `commit-more` on main).

## Not done
- Back on a phone still goes to `/new/ideate` (or the import), which asks for a larger window. That page has its own
  exits (Email me a link) and is the studio's to open up (T15).
- "take charge" stays as a verb in the studio and import copy (Doors, Compare "Nothing is committed until you take
  charge.", ImportScreen). It is outside T2's files, and the trail and the button now say "Start". One pass over those
  lines would make them match.
- No Storybook story: no new component. `CommitForm` lives in apps/web, and Storybook builds only the design system.
- The founder's first page note and the Agents tab count (T4, T7) are their tasks.
