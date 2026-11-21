---
date: 2026-11-19
branch: claude/sharp-bell-ost3ip
title: Twenty landing pages, one per ideal founder profile, at /1 to /20
areas: [web]
supersedes: []
---
## What changed
The founder asked for twenty versions of the landing page's words, one per ideal founder profile, at foundmill.com/1 to
foundmill.com/20, with the structure and design unchanged. `/1` is the current first-timer's page; `/2` to `/20` are 19
new variants (lib/landing-variant.ts `PROFILE_VARIANTS`, words in components/landing/words.ts `VARIANT_WORDS`, each
with a comment naming its profile). A variant now also sets the order of the four hero examples (the first one is
chosen) and the Ideation Studio's example set (components/landing/first-timer-examples.ts `STUDIO_SETS`: ten new sets
of three ideas besides the sneakers one). The profiles cover younger and older founders: student, graduate, stalled at
the blank chat box, overwhelmed by tools, evenings and weekends, parent, experienced professional, tradesperson,
retiree, maker, home cook, creator, freelancer, developer, game maker, teacher, beauty and wellness, shop owner, and
someone with too many ideas.

## Decisions
### Built on the existing variant system
Each profile is an ordinary landing variant, prerendered at `/lp/<id>` and reachable with `?lp=<id>` like the others.
The proxy rewrites `/1` to `/20` to those routes for anyone, signed in or out (`numberedLandingVariant`), and keeps the
variant in `fm_lp` so going home from `/7` shows the same words.

### What a variant changes
The hero headline, lede, field label and typed ideas; the hero examples' order; the order of the three ways in; and the
Studio set. Everything else (what comes back, cost, control, questions, the first week) stays shared, because those
lines state facts that are the same for every reader, and the page's rule is that a variant chooses which true things
to say first.

### Studio sets
Three sets start from a hero example (Northwind, Tutorlane, Glitchwick) with two new ideas each; the other seven are
three new ideas. All are labeled examples and none is real. Each new card uses the one-reason `rated` helper, the same
as Lace Lab and Kick Swap.

### Each profile has its own example founder (founder, later the same day)
The founder asked for the first week, the example person page and the example project page to follow the profile too,
especially for older founders, with cost and the questions shared. components/landing/stories.ts holds one story per
profile page: a person, their project's page and a first week. The student's page keeps Sole Revival, which was
written for that reader. Every week uses only what Sole Revival's does (shape and rate, draft and publish the page,
share the link, a drafted post, the first milestone, one decision, $0 spent); the profiles that bring something use
the Markdown import or the read-only website report, which work inside today. "See another example" stays shared.

## Not done
No analytics yet tie a visit to its number; `fm_lp` carries the variant name.
