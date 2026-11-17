---
date: 2026-11-16
branch: claude/wp04-t14-answer-phone
title: The one-click answer page on a phone (WP-04 T14)
areas: [web, docs]
supersedes: []
---
## What changed
- `apps/web/components/email/EmailAnswer.tsx` (`/a/<token>`): the answer button and Open Needs you are `size="lg"`
  with `min-h-tap w-full @page-wide:w-auto` (they were `size="sm"`, 28 px); the cancel-deletion buttons share the
  same classes (they already had `lg` and `min-h-tap`). Each card's root is an `@container`, so `@page-wide:` reads
  the page's own width (DESIGN "Small screens").
- A press that fails (a dropped connection, a refusal) now shows an inline `role="alert"` line under the card's
  words, "That did not go through. Try again." (`ANSWER_FAILED`), and the button reads "Try again" and sends the
  same token again. Before, the button stopped spinning and nothing said why. The cancel-deletion card does the same.
- The bare "Loading…" is a three-line `SkeletonText` labeled "Opening your answer…" (`aria-busy`,
  `data-testid="email-answer-loading"`).
- New `apps/web/components/email/__tests__/EmailAnswer.test.tsx` (skeleton, tap classes on both buttons, the failed
  answer and its retry). `apps/web/e2e/return-loop.spec.ts`: a new 390 px test replays the link's read as ready
  (`page.route`), checks the answer button is at least 44 px tall and inside the screen, aborts the answer and reads
  the alert and a 44 px Try again; the existing phone test also checks Open Needs you is at least 44 px.
- WP-04's T14 is ticked.

## Decisions
- One button, relabeled "Try again", instead of a second button beside "Answer …": the card keeps one primary
  action, and the alert line says what happened. The spec asked for "a Try again button"; this is it.
- No separate `onError` callback: the mutation's own `isError` drives the line, which is the same thing with less
  code. The shared `MutationCache.onError` (`lib/query-client.ts`) still reports the error, which only ends a session
  on UNAUTHORIZED; nothing else toasts, so the inline line is the only thing the founder sees.
- The answer button takes `lines={2}`: its label carries the option's own words, and `whitespace-nowrap` could push a
  long option past 390 px. Two lines grow the button's height instead.
- Spec versus code: the page sits in `BrandFrame`, whose column is 480 px at most, so `@page-wide:` (640 px) never
  applies inside it, and `EmptyState` centers its actions in a row sized to its content, so `w-full` there is the
  button's own width rather than the panel's. The classes are as the spec asked and do the right thing if the frame
  ever widens; what matters on a phone, the 44 px height and staying inside the screen, is checked in Playwright.

## Not done
- `EmptyState` renders its children in a `<p>`, and this page passes a `<p>` (the subject, the consequence) inside
  it, so React logs "<p> cannot contain a nested <p>" in dev. It was there before this change; left alone.
- No story: no new component.
