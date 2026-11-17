---
date: 2026-11-17
branch: claude/landing-idea-examples
title: The idea field's examples stay inside it, the button stays whole, and the examples are worth wanting
areas: [web, landing]
supersedes: []
---
## What changed
The founder, Nov 17, 2026: "On the home page, the example text should never come out of the text box like it does
here. Also make the examples a bit cooler, they dont have to be too complex but we can be more inspiring than weekly
emails about cheap eats." Their screenshot at about 1080 px: "Coding lessons for kids, online, two evenings a week" ran
past the field and under "Shape my idea".
- Cause: the typing examples are an overlay over the empty field, pinned `absolute inset-y-0 left-0` with no right
  edge, so its `truncate` never clipped and a long example ran out of the field. It is now `inset-0` with the text
  `min-w-0 truncate`: an example longer than the field ends in an ellipsis inside it.
- The idea box is its own size container (`@container` on its root), so its `@page-wide:` switch (field and button
  side by side) reads the box's width, not the page's. At 1024 px the hero puts the box beside the example screen, about
  508 px wide; the field and button no longer squeeze into one row there (a 274 px text area), they stack as on a
  phone. Side by side only once the box is 640 px.
- New examples (`PLACEHOLDER_IDEAS`), each at most `PLACEHOLDER_IDEA_MAX` = 34 characters: "Hot sauce from my grandma's
  recipe", "Bike repairs that come to you", "Pet portraits in watercolor", "Guitar lessons over video call", "Plant care
  for offices near me", "Old chairs, restored and resold", "A board game about running a farm", "Ramen pop-ups in my
  backyard". The first is the one reduced motion shows.
- Tests: `IdeaBox.test.tsx` checks every example against the limit, for job words and for exclamation marks or dashes.
  Playwright `idea-box.spec.ts` gains "at <width> px the examples stay inside the field and the button is whole" at 390,
  768, 1024, 1080, 1280 and 1440 px: each example is set into the overlay and measured whole inside the text area, the
  button whole in the view and beside or under the field, never over it, and no sideways scroll. Before the fix it
  failed at 390, 768, 1024 and 1080 px. `first-timer.spec.ts`' reduced-motion case reads the first example from
  `PLACEHOLDER_IDEAS`.

## Decisions
### The limit comes from the narrowest text area
Measured on the local stack, the field's text area is narrowest at 390 px once the box stacks: 314 px. At 17 px the
34-character "Hot sauce from my grandma's recipe" is about 292 px. The Playwright check measures real widths at every
width; the unit test keeps the count. The ellipsis is a safety net, not the design.
### The examples
A point edit of the list, in its own register (first person, plain fragments). Each names a thing a person could
picture and start this month with little money: food, a service that comes to you, something drawn, teaching online,
selling to nearby businesses, hands-on resale, a game, an event. No hype words, nothing about jobs.
### Variants keep their own lists
The other landing variants (`words.ts`: "What are you into?", "What do you run?", "What do you want to build?") keep
their examples; some are longer than 34 characters and now end in an ellipsis inside the field at narrow widths instead
of running out of it. Rewriting them was not asked.

## Not done
- The variant pages' examples are not shortened (see Decisions).

