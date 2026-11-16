---
date: 2026-11-16
branch: claude/wp03-t3-wall-exits
title: The wall has exits (WP-03 T3)
areas: [dugout, web, api, gateway, shared, docs]
supersedes: []
---
## What changed
- `NeedsLargerWindow` takes `title`, `body`, `actions` (a slot; still server-safe) and `showWidth` (default false).
  Default words: "This part is built for a bigger screen" and "It has tables and boards that do not fit a phone yet.
  Open it on a computer, or go back to what works here." The pixel line shows only with `showWidth`. New test and
  stories at 390 px with and without actions; `AppShell.test.tsx` reads the new title (the only line changed there).
- `packages/shared/src/continue-path.ts`: `CONTINUE_PATH_RE`, `CONTINUE_PATH_MAX` (200) and `isContinuePath`: a
  project's pages, the studio, onboarding and home; no query, hash or other host.
- Gateway: `AccountEmailRequest` gains `continue_link` (`{ userId, data: { path } }`, the path checked in the schema,
  so a bad one is a 400 before any count). Only the api may ask for it, only the orchestrator for `waitlist_admitted`
  (`ACCOUNT_EMAIL_SERVICE`). No once-marker; three a day per person (`pn:acct-link:<userId>:day`, `per_person`) before
  T2's per-address count and Foundmill's ceiling; the same suppression, mock refusal off development and test, and no
  address in a log line. Words in `continueLinkEmail` (`people-email.ts`, beside `waitlistAdmittedEmail`).
- api: `founder.email.sendLink({ path })` (protected, strict input, `modelLimited("continueLink")`: 5 a minute, 20 a
  day) asks `gateway.accountEmail` with the caller's own id. Answers `{ sent, reason, email }`.
- web: `components/providers/ContinueLater.tsx`: `ContinueLater` (Get the app while the store links are set, then
  Email me a link or Copy link, then one way back), `EmailMeALink` and `NextStepOnComputer`. `DesktopOnly` passes
  `ContinueLater` as the note's actions. This is T9's first reader of `publicEnv().storeLinks`.
- The reroute, a stopgap WP-04 deletes: on a small screen `CardKeptView` and `PersonHome` link nowhere desktop-only.
  The kept card's next step and Start something show "The next step needs a computer for now." with the email control
  for the path they would have opened; each concept's Continue becomes the email control; "See more directions" and
  "See every concept in the studio" are hidden there. Both files say so in a comment.
- `CARD_KEPT_WORDS.lede` already read "It is saved in your deck. Your team starts from your words." (WP-02 T6), so
  nothing changed there.
- docs/DESIGN.md §2, §6 "Small screens" and §8 NeedsLargerWindow: the bare note carries its exits.
  docs/ARCHITECTURE.md §9: the `continue_link` request and its order of checks.

## Decisions
- Built on `claude/wp03-t2-waitlist-admits` (#198), which had not merged when this branch was cut.
- Never "Sent" unless it went: the api turns a simulated send into `{ sent: false, reason: "simulated" }`, which reads
  "Email is only simulated here, so nothing was sent. Copy the link instead."; mail off, a refusal or a gateway that
  did not answer read "We could not send it. Copy the link instead." Until WP-00 S1 and S2 the gateway answers `off`
  or `simulated`, so on production the control falls back to Copy link, honestly.
- `sendLink` also returns the signed-in address (`ctx.email`) when sent, for "Sent. Check {email}." The spec's answer
  had no address, and the note has no other way to know it. Without one it reads "Sent. Check your email."
- `signedIn` is `!isPublicPath(pathname)`: the proxy sends a signed-out visitor to sign in on every other route. A
  walled page no link can carry (`/businesses`, `/tour`, `/examples/<id>`) offers Copy link from the start; a
  signed-out one goes back to the landing page ("Go to the home page"), which the spec did not cover.
- `sendLink` carries `modelLimited` because the api's rule asks for it on every vendor-per-press procedure; the
  gateway's three a day is the real limit.
- The footer link of the link email is T2's platform-wide stop with its label "Don't email this address about joining
  Foundmill". It is the only stop the sender has for an account email, and the person asked for this one.
- The "a walled route at 390 px shows two controls" test lives in `continue-later.test.tsx` with the providers the
  controls need; `desktop-only.test.tsx` stubs `ContinueLater` and checks it gets the path.
- Where the spec named `notify-email.ts` for the email words, the code keeps account emails in `people-email.ts`.

## Not done
- No Playwright run of the kept card at 390 px (reaching it needs the idea box's keep flow on a phone); the component
  test covers it. `phone-today.spec.ts` and `person-home.spec.ts` cover the note and `/home`.
- The email arriving needs WP-00 S1 and S2. Redirecting a signed-in phone to the store at launch stays one branch in
  `DesktopOnly` (its comment names `publicEnv().storeLinks`).
