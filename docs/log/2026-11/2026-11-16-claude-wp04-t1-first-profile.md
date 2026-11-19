---
date: 2026-11-16
branch: claude/wp04-t1-first-profile
title: Profile as three questions; the kept card keeps its thread (WP-04 T1)
areas: [web, dugout, docs]
supersedes: []
---
## What changed
- New design-system form `FirstProfileForm` (`packages/dugout/src/components/firstrun/FirstProfileForm.tsx`, with
  `FIRST_PROFILE_WORDS`, `FIRST_PROFILE_STRENGTHS` and `addTag`), its test, and the story `FirstProfile.stories.tsx`
  ("Guidance/First profile") at 390 and 1440 px. Three questions in one column: "What should your team call you?"
  (required, prefilled), "What are you good at, or enjoy?" (up to 8 optional tags, six suggestions: Design, Writing,
  Selling, Organizing, Building things, Teaching) and `LOOKING_FOR_QUESTION` with `LOOKING_FOR_OPTIONS` ("Building on
  my own" chosen), then `AdultCheck` and Continue. Every control is 44 px tall on a phone.
- New screen `apps/web/components/onboarding/FirstProfile.tsx` ("Three quick things about you", in `StudioFrame
  smallScreen width="measure"`). Continue calls `founder.profile.update({ displayName, confirmAdult?, via? })`; when
  a tag was added or the answer is not `on_my_own`, it then calls `founder.publicProfile.update` with those two and
  empty strings for the rest (the profile stays private). A failure or a held save there is logged and the person
  goes on. Then `router.push(next ?? "/new")`.
- `OnboardingScreen`: a new account renders `FirstProfile`; the long form is for editing only. The "Welcome aboard /
  Next: ideate a concept or import what already exists." toast is gone. An account editing on a screen under 1280 px
  gets the three questions prefilled (from `founder.publicProfile.get`, the rest of whose content is kept as it was).
- `onboardingNext` in `apps/web/lib/auth/redirects.ts` accepts only `/new/commit/<uuid>` and `/new/card/<uuid>`;
  `app/onboarding/page.tsx` reads `?next=` through it, passes it down and keeps it on the signed-out redirect.
- `CardKeptView`: the next step is `/onboarding?next=/new/commit/<id>` without a profile, and it is a link on a phone
  too. New copy: "It is saved in your account. Your team starts from your own words.", "Three quick things about
  you", "So your team knows what to call you and what you like doing. It takes under a minute."
- `DesktopOnly`: `"/onboarding"` added to `SMALL_SCREEN_PREFIXES` (one line, for T6's overlap).
- Tests: `redirects.test.ts` (`onboardingNext`), `desktop-only.test.tsx`, `card-kept.test.ts`,
  `card-kept-view.test.tsx`, new `FirstProfile.test.tsx` (8), and the create path of `OnboardingScreen.via.test.tsx`
  and `OnboardingScreen.adult.test.tsx` moved onto the three questions. Playwright: `onboarding.spec.ts` gains the
  three questions at 390 and 1440 px; `idea-box.spec.ts` gains a new account on a phone going kept card → three
  questions → `/new/commit/<id>`. `e2e/helpers.ts` gains `answerFirstProfile`; `completeProfile` answers the three
  questions and then fills the rest on the long form, so the dev founder's profile is what it was. The specs that
  created a profile through the long form (`attribution`, `adult-signup`, `person-home`, `example-business`,
  `invitations`) use the three questions.
- `formFromProfile` (`profile-form.ts`): a saved profile with no budget reads as "I have no budget yet" only when it
  has a time commitment, i.e. it went through the long form, which requires one. A profile from the three questions
  never answered about money; before this, the long form opened it with the amount field disabled and no way to
  unpick the card, so the person could never add a budget. Test in `profile-form.test.ts`.
- WP-04's T1 is ticked.

## Decisions
- The form is in the design system and the screen in apps/web: Storybook builds only `packages/dugout/src`, so a
  story next to an apps/web file would never be built. The form is pure (values in, `onSubmit` out) like
  `OnboardingForm`; the story file is named `FirstProfile.stories.tsx` as the task asked, beside `FirstProfileForm`.
- Spec versus code: the spec says to call `founder.profile.update({ displayName, confirmAdult: true, via })` always.
  The code (and its tests) send `confirmAdult` only when the box was shown and ticked, and show the box when the api
  refuses with `adult_unconfirmed`. Kept: an invitee who confirmed on the invitation is never asked twice.
- Spec versus code: the web never sent `ideaDraftToken`, so "stop sending it" needed no change. The current
  `CARD_KEPT_WORDS.lede` already lacked the "checks every number" clause the spec's before-column quotes.
- An edit on a phone goes on to `/` (Today, or the person's home), not `/new`, which is still desktop-only.
- Test ids: `first-profile`, `first-profile-submit`, `first-profile-adult`, so a spec can tell the three questions
  from the long form (`onboarding-form`, `profile-submit`, `profile-adult` stay on it).
- On a phone with a profile, Commit is still offered by email (`NextStepOnComputer`) until T2 makes Commit work at any
  width; the three questions themselves are a link now.

## Not done
- The long form still requires experience and time to save, so a person who created their profile with the three
  questions answers those two the first time they edit it on a computer. Making them optional is a change to the long
  form's rules, outside T1; `attribution.spec.ts` answers them before its edit.
- `e2e/helpers.ts` also holds T5's sign-off helpers; only `completeProfile`, `confirmAdultOnForm` and the new
  `answerFirstProfile` changed here.
- Done-when says "kept card → three questions → Commit without a wall": on a phone, Commit still renders
  `NeedsLargerWindow` until T2. The specs check the URL reaches `/new/commit/<id>`.
- A new account on a phone with no card lands on `/new`, which is still desktop-only (T15 builds the phone start).
- Re-rating Founder fit after the profile (FR-15), and time, place, budget and the ratings, stay out on purpose: the
  editing form keeps them.
