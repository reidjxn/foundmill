---
date: 2026-11-17
branch: claude/wp04-t2-commit-name-go
title: A phone start without a card (WP-04 T15)
areas: [web, dugout, e2e]
supersedes: []
---
## What changed
- `/new/write` (`app/new/write/page.tsx`, `components/new/WriteIdea.tsx`): "What do you want to build?" / "One sentence is enough.", the fields "A working name" (up to 60) and "Your idea, in your words" (up to 4000), and "Shape it". One `idea.write({ title, pitch, archetype: null })`, guarded by `useSingleFlight` so a double press sends once, then `/new/commit/<id>`.
  Signed out goes to sign-in and back; no profile goes to `/onboarding`.
- The form is a new dugout component, `WriteIdeaForm` (firstrun group, `WRITE_IDEA_WORDS`), with a test and the story "Guidance/Write an idea" (390 px, 1440 px, written, shaping, failed). It says what is missing under each field instead of sending.
- `/home`'s "Start something" links to `/new/write` on a narrow screen and to `/new` on a wide one; the `NextStepOnComputer` stopgap of WP-03 T3 is gone from that card. The button is full width until `page-wide`.
- `/home` leaves the "Find a project or people" card out while `features.liveMode` is false (no "Opening soon"); Start something is then the only card, in one column. With `liveMode` true (production) the card and its link are as before.
- `DesktopOnly.tsx`: `"/new/write"` is in `SMALL_SCREEN_PREFIXES` (exactly that path).
- Tests: `WriteIdea.test.tsx` (the words at 390, one `idea.write` on a double press, then Commit; nothing sent with an empty idea).
  `PersonHome.test.tsx` (the start link by width, with `liveMode` on and off; the find card without "Opening soon" in both states); `desktop-only.test.tsx`.
  `person-home.spec.ts` at 390 x 844 goes Start something → `/new/write` → Shape it → Commit with one `idea.write` request and no larger-window ask, and at 1280 finds no "Opening soon".

## Decisions
### The form lives in dugout, the screen in apps/web
apps/web has no Storybook; the stories are dugout's (as T1 did with `FirstProfileForm`). The pure form is dugout's and the screen that writes and navigates is `WriteIdea.tsx`, as the spec names it.
### No "kind of business" field
WriteDialog offers one with "Any" as its default. One sentence is the point of this page, so the archetype is sent as null and the Ideation agent picks it, as WriteDialog's default does. It can be changed under More options on Commit.
### Hiding "Opening soon" hides the whole find card
The card's only action while the people layer is closed was the "Opening soon" chip, and its words promised a date nobody set. Without it the card is a dead end, so it is left out. Production runs with `liveMode` true, so there it is unchanged; both states are tested.
### "Start something" picks by measured width
It uses the same `isViewportTooSmall(useViewportWidth())` the screen already used, so the server render (unmeasured) links to `/new` and a phone switches to `/new/write` on hydration.

## Not done
- On a phone, a concept's Continue on `/home` still offers the link by email, though Commit now works on a phone (T2). The spec does not name it; it is one line in `PersonHome.tsx`.
- Commit's Back goes to the studio (`/new/ideate`), which is desktop-only; from `/new/write` on a phone it shows the "continue later" note.
- A signed-in "no idea at all" path on a phone is not built, as the spec says.
