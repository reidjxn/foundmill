---
date: 2026-11-17
branch: claude/vibrant-dirac-xkj04i
title: Quick fit before the ideas, sharpen after; time and where you live before take charge (WP-14 T2)
areas: [web, api, db, dugout, config, agents, evals, e2e, docs]
supersedes: [2026-11-16-claude-wp04-t1-first-profile]
---
## What changed
- `packages/config/src/quick-profile.ts` (new): the two quick ratings and the neutral one (`QUICK_PROFILE_RATINGS`:
  picked 14, unpicked 7, neutral 10), the five tags with the skill each sets (`QUICK_PROFILE_TAGS`),
  `quickSkillRatings(tags)`, `skillsFit(skills, archetype)` (the mean of the two skills a kind of business leans on),
  `reratedFounderFit`, `fitBasisOf(profile)` and `fitLine` ("Fit: 15 (quick profile)"), and the take-charge rule
  (`TAKE_CHARGE_NEEDS`, `takeChargeMissing`, its message).
- The first profile (`FirstProfileForm` in the design system, `FirstProfile.tsx`): the title is "Tell your team about
  you". The five suggested tags are the brief's, one for each skill. Two new questions, "How much time can you give?"
  and "Where do you live?", both optional here. The save carries `skills` (the quick ratings), `timeCommitment`,
  `residence` and, on the save that creates the profile, the currency of the place. The story and both tests follow.
- Founder fit follows the ratings without a model call. `repos.ideas.rerateFounderFit` writes the `founder_fit` entry
  of the current version of every idea the person still holds (not committed, not discarded), in place.
  `services/founder-fit.ts` moves each rating by how much the two skills of its kind of business moved, and
  `founder.profile.update` calls it on the save that creates the profile and on every save that changes a rating. A
  failure is logged and never fails the save.
- What a fit number rests on: `IdeaCard` and `ConceptCard` take `fitBasis` and print "Fit: N (quick profile)" under
  the bar until the long profile is saved. The kept card (`/new/card/<id>`) shows Founder fit once the profile exists;
  the Studio passes the basis to every card.
- "Help your team help you" (`SharpenOffer.tsx`): once the Studio's deck has ideas and fit rests on the quick profile,
  one panel offers the long profile ("Fit is based on your quick answers. Two minutes to sharpen it?"). "Not now" is
  kept in the browser for the account. Saving the long profile over a quick one returns to `/new/ideate?sharpened=1`,
  where the same slot says fit was re-rated and offers a fresh set (the Studio's own Draft).
- The long form: its lede is "Your team will suggest ideas that fit your skills, your time and your budget. Change it
  any time."; "Be honest: the team hires to cover what you don't have." stays. Its save goes on to `next` when there
  is one.
- Take charge (A5): `idea.commit` refuses, after the 18+ check and before anything is created, unless the profile or
  the press itself says how much time and where the person lives; answers given on the press fill only what the
  profile lacks. Commit shows a panel, "Two things your team needs first" (`AboutYou.tsx`), with exactly the questions
  the profile lacks, and Start waits for them.
- The Ideation agent: `founderBrief` adds `skills_basis` ("quick_answers" or "rated_by_founder"), and one rule tells
  the agent how to read quick ratings and what to do with no profile.
- Eval: `evals/src/ideation.ts` gains the brief `quick_profile` and a fifth check, Founder fit (`checkFounderFit`):
  with no profile every card's fit stays between 7 and 13; on the quick profile the kinds of business that lean on a
  picked skill are not rated a worse fit, on average, than those that lean on none.
- Tests: `quick-profile.test.ts` (config), `founder-quick-fit.test.ts` (api: the re-rating in place, another person's
  ideas untouched, the three take-charge cases), `SharpenOffer.test.tsx`, new cases in `FirstProfile.test.tsx`,
  `FirstProfileForm.test.tsx`, `CommitForm.test.tsx`, `card-kept-view.test.tsx`, `IdeaCard.test.tsx`,
  `concept.test.tsx`, `ideation.test.ts`. Playwright: new `quick-fit.spec.ts` (idea box to Today with an empty
  profile), `onboarding.spec.ts` and `idea-box.spec.ts` updated; `answerFirstProfile` answers time and place unless
  told not to.
- Seventeen api test files that take charge gained `timeCommitment` and `residence` on their profile fixtures, and
  nothing else.

## Decisions
### The two ratings are 14 and 7, neutral 10 (flagged for the founder)
The brief's suggestion, kept. 14 is the top of "Good" on the ramp; 7 is under the neutral 10, so an unpicked skill
reads as "the team covers this". A person who picks none of the five gets 10 for all, and the form's hint says so.
### The brief's five tags replace Design, Writing, Selling, Organizing, Building things, Teaching
Three of the old six map to no skill and none maps to Finance or Domain. The brief's five map one to one. A person can
still type their own tags; those say nothing about the five ratings. Profiles that hold old tags keep them.
### Both new questions are optional on the first profile and required at take charge
A5 says a person who reached ideas without answering is asked at take charge, and the spec for step 6 starts from an
empty profile, so the first profile cannot require them. The server enforces it, not only the screen.
### "Sharpened" is read from the experience answer, with no new column
The long form requires experience and the first profile never asks it. `formFromProfile`'s "no budget yet" rule used
the time answer for the same purpose; time is now on the first profile, so it reads experience too.
### Re-rating moves the number, it does not replace it
A card's fit came from the Ideation agent (or, for an idea-box card, from a read with no profile). The re-rate adds
the change in the two skills its kind of business leans on, so the agent's judgment of the idea stays and only the
person's side moves. A fresh draft is the way to a full re-read, and the Studio offers it.
### In place, with no new version
Nothing the person or the agent wrote changes, so a new version would fill the history with rows nobody made. Only the
`founder_fit` entry is written.
### Nothing reorders
Step 3 says saving reorders the ideas. The Studio orders shortlisted first, then newest; no order uses ratings.
Nothing was added: a sort by fit is a change to the deck's rule, outside this task.
### The quick ratings are stored in `skills`
They are the person's own stated answers at two levels of precision, in the field the long form edits, so sharpening
starts from them. Nothing is stored as measured or inferred.

## Not done
- The live eval was not run (no model key in the session); the offline checker and the mock run pass.
- The mock model keeps its own copy of the archetype-to-skills table (`packages/models/src/mock/ideation.ts`).
- "Add detail" on the long form counts as answered for a quick profile, because its ratings are no longer all 10.
- The native app's take-charge path is not built here; an app that calls `idea.commit` must send or collect the two
  answers.
- `apps/api/src/services/ideation.ts` is also changed by #251 (four attribution lines); the two changes are in
  different functions.
