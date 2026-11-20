---
date: 2026-11-19
branch: claude/youthful-maxwell-hxdk5w
title: The idea box shows the project's page before sign-in, and the 390 px journey from visitor to shared link is tested
areas: [web, landing, e2e]
supersedes: []
---
Plan: docs/holistic-plan/LAUNCH_EVALUATION.md, Session 9.

## What changed

- **Audit.** Walked the first session at 390 px: landing, sign-in, keep the card, kept card, three questions, Commit, Today, Product › Public page and the public page.
  Every one already renders at 390 px.
  Two links on a phone's Today led to a desktop-only tab and so to `NeedsLargerWindow`: the "See the work" link of the Working now strip (Development › Live sessions) and the "post ready" note (Distribution › Creative).
  `TodayScreen.tsx` now draws the strip without its link on a phone and leaves the post-ready note out there.
  The post is still in Needs you where it asks for approval.
  The health tiles also link to desktop tabs, but they appear only after the first day, so they are outside the first session and were left alone.
- **Spec.** `apps/web/e2e/phone-journey.spec.ts`: one test at 390 px from a signed-out visitor to a published page's share panel and the link opened by a signed-out phone. It counts the screens by route and checks `needs-larger-window` on each.
- **Preview.** When the idea box's card lands, `IdeaBox` draws the project's public page under the card with the shared `ProjectPage` component, from the card's name and pitch, the Commit default colors (`DEFAULT_KIT`) and the initials logo. No sign-in, no AI call and no payment is needed to see it.

## Decisions

- **The journey is eight screens, not six.** Landing, sign-in, keep the card, kept card, three questions, Commit, Today, public page.
  Six would mean dropping the kept card and Today as the first stop after Commit.
  The founder accepted the eight-screen path on Nov 19 (the Nov 13 decisions in docs/IDEA_BOX.md stand), so the spec's budget is 8 and a change that adds a ninth screen fails it.
- **Logo (Session 4b).** No Session 4b pull request had merged when this was written, so the preview uses the existing initials logo on the default brand colors, which are what Commit gives the project, so the preview is truthful about the page that will be made.
  When Session 4b's CLI-Anything logo lands, the preview should show that file once the founder has approved it (it reaches the project only on approval), not before.
- The preview copy promises nothing about price or staying free.

## Not done

- The Session 4b logo in the preview (above).
- Rebasing on Session 6's console-shell change, which had not merged.
