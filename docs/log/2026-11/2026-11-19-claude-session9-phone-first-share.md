# Session 9: the idea box shows the page, and the 390 px journey is tested (Nov 19, 2026)

Plan: docs/holistic-plan/LAUNCH_EVALUATION.md, Session 9.

## What changed

- **Audit (2).** Walked the first session at 390 px: landing, sign-in, keep the card, kept card, three questions, Commit, Today, Product › Public page and the public page. Every one already renders at 390 px. Two links on a phone's Today led to a desktop-only tab and so to `NeedsLargerWindow`: the "See the work" link of the Working now strip (Development › Live sessions) and the "post ready" note (Distribution › Creative). `TodayScreen.tsx` now draws the strip without its link on a phone and leaves the post-ready note out there. The note is not lost: it shows on a computer, and the post is still in Needs you where it asks for approval. Other links to desktop tabs (the health tiles) appear only after the first day, so they are outside the first session and were left alone.
- **Spec (3).** `apps/web/e2e/phone-journey.spec.ts`: one test at 390 px from a signed-out visitor to a published page's share panel and the link opened by a signed-out phone. It counts the screens by route and checks `needs-larger-window` on each.
- **Preview (1).** When the idea box's card lands, `IdeaBox` draws the project's public page under the card with the shared `ProjectPage` component, from the card's name and pitch, the Commit default colors (`DEFAULT_KIT`) and the initials logo. No sign-in, no AI call and no payment is needed to see it.

## Judgment calls

- **The journey is eight screens, not six.** Landing, sign-in, keep the card, kept card, three questions, Commit, Today, public page. Reaching six would mean dropping the kept card (the founder's Nov 13 decision in docs/IDEA_BOX.md: the visitor lands on their saved card) and Today as the first stop after Commit. The spec's budget is therefore 8 and says so; moving it to 6 needs the founder to change those two decisions. Not done here.
- **Logo (Session 4b).** No Session 4b pull request had merged when this was written, so the preview uses the existing initials logo on the default brand colors, which are what Commit gives the project, so the preview is truthful about the page that will be made. When Session 4b's CLI-Anything logo lands, the preview should show that file once the founder has approved it (it reaches the project only on approval), not before.
- Preview copy promises nothing about price or staying free.

## Checks

`vitest` for `components/landing` and `components/today` (195 pass), `tsc --noEmit` for the web app, `scripts/banned-terms.mjs` and `scripts/us-english.mjs`, and `e2e/phone-journey.spec.ts` against the local stack.
