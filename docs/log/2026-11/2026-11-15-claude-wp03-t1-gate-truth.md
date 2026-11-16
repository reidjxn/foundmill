---
date: 2026-11-15
branch: claude/wp03-t1-gate-truth
title: The gate tells the truth at any width (WP-03 T1)
areas: [web, api, shared]
supersedes: []
---
## What changed
- The not-invited page (`NotInvitedPage.tsx`) works from 390 px on any route (`BrandFrame smallScreen` and
  `<WorksOnSmallScreens />`), reads "A few people at a time" and "{email} has a place in line", and saves the person's
  place once on arrival (`WaitlistJoin`: `useEffect` with a ref guard, `startTransition` around the Server Action).
  "Save my place" shows only to try again after the join failed. Sign out is 44 px tall (`min-h-tap`).
- `OnWaitlistPage` renders the same `WaitlistJoin` under the card, so a person refused by the day's ceiling is
  stored too. `ON_WAITLIST_WORDS` is unchanged (T2 changes it).
- `UnreachablePage` works from 390 px the same way. `/start` joins `SMALL_SCREEN_PREFIXES`.
- Copy: `NOT_INVITED_MESSAGE`, `WAITLIST_WORDS`, the not-invited footer, `IDEA_BOX_ERRORS.limit` and `.resting`,
  and one line under the sign-in form's reassurance ("New here? Foundmill lets new people in a few at a time.
  Signing in saves your place."), as in the T1 copy table. No string promises an email.
- Tests: `api-error-page.test.tsx` (390 px on a desktop route, joins once, the card line, retry, no join when
  unconfirmed, the unreachable page at 390 px, the ceiling page stores the person), `desktop-only.test.tsx` (`/start`),
  `login-form.test.tsx` (the new line), `signup-allowlist.test.ts` (the message), `idea-box.test.ts` (the two
  refusal lines). New Playwright spec `e2e/not-invited.spec.ts` for the 390 px case on an invite-only stack.
- `invitations.spec.ts`'s ceiling case looks for `/email you when/i`, not `/email you/i`: the saved line under the
  card ("we cannot email you yet") says the opposite of a promise.
- docs/DESIGN.md (the waitlist note) and docs/IDEA_BOX.md (the not-listed step) now describe the save on arrival.

## Decisions
- The 390 px Playwright case lives in a new `not-invited.spec.ts`, not in `idea-box.spec.ts` as the spec says: the
  landing session's open PRs (#172, #182) edit `idea-box.spec.ts`. It skips unless `E2E_SIGNUP_ALLOWLIST=1`, the
  `invitations.spec.ts` pattern.
- A dev account (`/auth/dev?as=`) reaches the api with no address in its context, so `waitlist.join` refuses it and
  the page shows the retry. The spec therefore accepts either the saved line or "Save my place" after the arrival
  join; the stored row is proven by the unit tests and `idea-box.test.ts`, not by Playwright. Changing the dev path
  to carry its stub address was left alone (out of scope).
- `/start` works from 390 px for everything it renders in place: the landing page (already a small-screen page at
  `/`) and the gate's three pages. The existing "kept at 390 px only while marked" test moved from `/start` to `/new`.
- `NOT_INVITED_MESSAGE` builds on `APP_NAME` rather than spelling the name.
- While the join runs, the page shows `WAITLIST_WORDS.offer` ("We are saving your place.") as a polite status.

## Not done
- Left for the landing session (PRs #172, #182): `IDEA_BOX_WORDS.keepLead` and `freeLine` in
  `components/landing/idea-box/IdeaBox.tsx` (the copy table's two rows), and their words test. Both still carry the
  old lines ("real sources" stays in `keepLead`).
- The Privacy Policy's retention line still says "90 days if you join the waitlist with it"; joining is now automatic
  on arrival. The waitlist row is the account's own address, already covered by "your account". Not edited here.
- Funnel writes: WP-02's writers are not called (none exists for the join yet).
