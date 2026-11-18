---
date: 2026-11-17
branch: claude/wp14-t10-tour-landing-copy
title: WP-14 T10, the tour and landing copy from the behavior brief of Nov 17
areas: [web, docs]
supersedes: []
---
## What changed
- `/tour`: the deck's first Continue press ends in a customer win on all three examples (the win is first in each `CYCLE_OUTCOMES`); the caption reads "<Name> is an example business. Press Continue and see what your team would do this week." (`deckCaption`).
- `/tour`: "You do not manage prompts. You run a business…" sits directly under the hero (`RunABusiness`) and leaves How it works; the thesis ends on "…without asking you to become a manager of software."; pillar 1 is "A whole company, working while you work"; the "You stay in charge" pillar has the brief's body.
- `/tour`: the house rules lead with "Never signs anything in your name", with a line under them (`HOUSE_RULES_WHY`); the footer's "Desktop only" line and the unrendered `INCLUDED_CREDITS_ASSURANCE` are gone.
- `/`: a `vacation` section ("Take a vacation."), one line by the control rules about estimates, and two more headline variants on the `fm_lp` seam, `calls` and `team` (`?lp=calls`, `?lp=team`).
- `/` hero, after the founder's answers of the afternoon (WP-14 A1, A6): the lines under the idea box are "Free to start · no card" while sign-up is by invitation, the privacy line, "Nothing spends, signs or files without you" and "Built for a big screen and your full attention". `IdeaBox` takes `assurances`; the tour keeps its own three.
- The small-screen wall's title is "Foundmill is built for a big screen." (`NEEDS_LARGER_WINDOW_WORDS`); its body and the page's actions ("Email me a link", the way back) are unchanged, so no page lost its way on.
- `/` no longer says "the free plan does not expire" (`cost.free`): the entry plan becomes paid when sign-up opens.
- Tests: `TourPage.test.tsx`, `cycle.test.ts`, `examples.test.ts`, `LandingPage.test.tsx` and the three Playwright specs updated; the web landing suites, eslint and the three copy linters pass locally. Playwright runs in CI.

## Decisions
### "Not because it can't. Because you hired it not to." was reworded
The house rules are enforced outside the agent (packages/policy hard gates), so an agent cannot do these things. The line under the list says so: "No agent can change these, and no instruction it reads can talk it out of them."

### "Every number we didn't measure says so." was reworded
WP-14 T7 (one style for estimates) has not merged. The line is the rule the product keeps today: "Every number that is an estimate or a forecast is labeled as one."

### "Your first day" keeps the product's own sentence
The brief's line ("a product plan to sign off … your team starts building") is the old first-day story. `FIRST_DAY_PROMISE` puts the page first and the plan as one note (WP-04 T7), so `FIRST_DAY_SENTENCE` is unchanged.

### The Team section already has its named, rated example agent
Each department tab shows its lead by name with stars and attribute ratings under an "Example business" chip. Nothing was added.

### The signature and the terms are two rules now
The list had "Never signs anything or accepts terms". To lead with the brief's exact words, accepting terms became its own line, "Never accepts terms for you".

### Northwind's deck order
Its win is the chain's opening order, so the decision on that chain's terms moved to the end of the loop: on the next time round the terms come before the order.

### The two new variants share the default page's lede shape
Only the headline differs in substance, so a later comparison reads the headline.

### The free line reads sign-up's stage from the page's switches
"Free to start · no card" shows while `SIGNUP_OPEN` is off, the same switch the api reads (flags.ts `signupOpen`). Once it is on, the line is "Shaping your first idea is free and needs no sign-up", which is true of the idea box at any price. No config value names the entry plan's price yet (WP-14 T14), so the stage is the switch.

### The privacy line stays
The brief lists three hero lines. "Your idea stays private until you choose to share it" was not asked to go and answers a first-timer's fear, so the hero has four.

### "card" in one line
`/` calls the rated result an idea (Nov 16). "Free to start · no card" is the founder's line and means a payment card; the test that bans the word on `/` allows that one string.

### removed-claims.test.tsx is unchanged
Neither new line matches a removed claim ("Desktop only", "1280 px wide or more" stay removed).

### The deck's callout waits until the deck is back in view
With the first press ending in a win, the deck is idle and unpressed once the visitor opens the Customer Update.
The Continue callout then mounted and its card took focus from the Journey heading (CI: `#journey-title` never focused).
The callout now waits (`away` in `CycleDeck.tsx`) until the deck has left and returned to the window.
`landing.spec.ts` and `TourPage.test.tsx` assert both: the heading keeps focus, then the callout opens on return.

## Not done
- The not-invited page (WP-14 T15 owns its wording) and the pill "First company? The team comes with it." (a removed claim).
- Plan names and prices on `/`: "What it costs" still says "The free plan includes …"; the names Try, Founder, Studio and Partner arrive with WP-14 T14.
- Measuring the two headlines waits for analytics on the site.
