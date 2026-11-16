---
date: 2026-11-15
branch: claude/wp03-t4-signin-code
title: The sign-in email carries a code for a new address (WP-03 T4)
areas: [web, supabase, docs]
supersedes: []
---
## What changed
- `supabase/templates/confirm_signup.html`: the magic-link body with the first line "Welcome to Foundmill"; it
  carries `{{ .ConfirmationURL }}` and `{{ .Token }}`. `supabase/config.toml` declares
  `[auth.email.template.confirmation]` (subject "Your Foundmill sign-in code"). A new address gets Supabase's
  Confirm signup email, so until now it had no code to type.
- `scripts/supabase-config.test.mjs`: a new check that both template sections exist, point to their files, and that
  both files carry the link and the code (it did not look at templates before).
- `LoginForm` sent state: the pill reads "Check your email". Below 1280 px (`isViewportTooSmall`) the code comes
  first under "Type the 6-digit code we sent to {email}.", then "Or open the link in that email on this device.",
  then "Use a different address". A desktop keeps today's order and sentence.
- `SignInCode` takes `first`: its label reads "The code from the email" when it comes first, since "Or type the code
  from the email" has nothing above it to say "or" to.
- Tests: `login-form.test.tsx` (order at 390 and 1440 px, the pill); `login.spec.ts` gains the sent-state case at
  1280 and 390 px.
- docs/DEPLOY.md §4: step 4 names the new template and the founder's one sign-up with a fresh address; the status
  table has its row, "waiting for S10". e2e/README.md describes the new case.

## Decisions
- The e2e stack has no Supabase, so the form cannot reach its sent state there. The new `login.spec.ts` case runs
  only against a web built with a stand-in Supabase address and `E2E_SUPABASE_STUB=1`, answering the browser's
  `/auth/v1/otp` itself; CI skips it. Ordering is also checked in the unit test, which CI runs.
- Small means below 1280 px, the product's one width rule, as the spec says (`isViewportTooSmall`).
- The template file is not pushed anywhere from here; the hosted Supabase settings are the founder's (WP-00 S10).

## Not done
- Pushing the templates to the Supabase project and the real sign-up check (WP-00 S10, the founder).
