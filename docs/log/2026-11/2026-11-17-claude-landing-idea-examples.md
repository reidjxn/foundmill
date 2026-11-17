---
date: 2026-11-17
branch: claude/landing-idea-examples
title: The idea field's examples stay inside it, better examples, and the hero's example label and order
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
- The hero's example picker (founder, Nov 17, 2026: "switch around tutorlane and sole revival in the order there. also
  instead of 'example' it should say 'Example companies you can create'"): `EXAMPLE_IDEAS` now runs Northwind,
  Tutorlane, Sole Revival, Glitchwick (Northwind still first on load; the arrow keys follow the new order), and the
  hero's `ScreenFrame` takes `LANDING_WORDS.hero.exampleLabel`, "Example companies you can create". Only that frame
  changed: the design system's default "Example", the Studio section's "Example ideas", "Example project" and the
  "Example" chips in other sections are other strings and stay.
- CLAUDE.md's "the words for people" gains one sentence recording the exception.
- Tests: `ExampleIdeas.test.tsx` and `LandingPage.test.tsx` read the new order and label, and the page says
  "companies" exactly once. The Playwright width check also measures the label (whole, one line, inside its frame) and
  the examples' order and row (one line from 768 px) at all six widths.

## Decisions
### "companies" on the landing page only
The founder, Nov 17, 2026, asked whether "companies" should be "businesses" under the vocabulary rule: the rule "is
still true. The only exception is here on the landing page". The word is kept in that one label, recorded in CLAUDE.md,
and pinned by a test that counts it once on the page. No linter flagged it, so nothing needed allowing. The FAQ's "Do I
need a company, a bank account or a website?" (the legal sense) was already there and is unchanged.
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

