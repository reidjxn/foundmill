---
date: 2026-11-16
branch: claude/wp03-t8-signup-guards
title: The guards open sign-up needs before it opens (WP-03 T8)
areas: [api, db, shared, web]
supersedes: []
---
## What changed
Open sign-up now stops one person taking many of the day's places, and the web can send a bot-check token with the
sign-in email. Nothing changes until the switches are set: `SIGNUP_OPEN` stays off, and so does the bot check.
- `addressKey` (packages/shared/src/address-key.ts): one key per mailbox (lower case, `+tag` cut, Gmail's dots removed,
  googlemail.com read as gmail.com), `domainOfKey`, and `COMMON_MAIL_DOMAINS` (15 large providers).
- Migration 0112: `account_admissions.address_key`, indexed, written only for an `open` admission. RLS unchanged
  (service role only); the closed-table test now covers the column. Repo: `keyTaken`, `openSinceForDomain`.
- `decideAdmission` gains `sameAddressAdmitted`, `domainAdmittedToday`, `domainCeiling`: a mailbox already admitted by
  open sign-up, or a private domain at `SIGNUP_PER_DOMAIN_PER_DAY` (default 5, an Estimate), waits with `on_waitlist`.
  The two reads run under the existing advisory lock, in open mode only, for a confirmed person not yet admitted.
- Web: `turnstile.ts` moved to apps/web/lib (the old path re-exports). With `NEXT_PUBLIC_SIGNIN_BOT_CHECK=on` and a
  site key, `LoginForm` passes `captchaToken` (action `sign_in`) to `signInWithOtp`; a token it cannot get shows the
  idea box's line, "We could not check this browser. Reload the page and try again.", and sends nothing.
- docs/DEPLOY.md §4: the guards, the bot check and its order, and the order to open: T8, WP-09's ceiling, then S5.

## Decisions
- Built on `claude/wp03-t2-waitlist-admits` (#198 was not yet merged when this started). The migration is 0112.
- The bot check has its own switch, `NEXT_PUBLIC_SIGNIN_BOT_CHECK`, off by default, instead of following the site key
  as the spec says. The site key may already be set for the idea box, and D6 keeps Supabase's check off until the
  native app sends a token, so following the key would load Turnstile on every sign-in for nothing.
- `SignInCode` (`verifyOtp`) sends no token, against the spec. Supabase's auth source (`internal/api/api.go`, read
  Nov 16, 2026) checks captcha on `/otp`, `/magiclink`, `/signup`, `/recover`, `/resend` and `/token`, not on `/verify`
  or `/authorize`, and `verifyCaptcha` returns early while protection is off. So the code step and Google need nothing,
  and sending the token while Supabase's check is off is safe: turn on the web first, then Supabase.
- The per-domain count matches the domain exactly (`split_part(address_key, '@', 2) = domain`), not the spec's
  `like '%@' || domain`, whose `_` would match any character and which a subdomain could not get past.
- An invitation that falls back to open sign-up's own admission (an inviter with no standing, or past their number)
  now meets the guards too; otherwise collaborator links would get around them. An invitation's own admission still
  passes neutral values, as the spec says.
- An address that does not parse into a key meets only the day's ceiling. Supabase gives a confirmed account a real
  address, so this is not expected in practice.
- `SIGNUP_DAILY_CEILING` keeps its default of 200 in code. D7's 25 goes in at S5, written in DEPLOY.md.

## Not done
- Opening sign-up: WP-09's per-account ceiling, then WP-00 S5 (the founder and the Desktop session).
- Supabase's bot protection and `NEXT_PUBLIC_SIGNIN_BOT_CHECK`: wait for the native app's token (D6, WP-00 S10).
- The waitlist's daily sweep does not apply the per-domain number: its count is the founder's own.
- No pull request opened (the coordinating session opens it).
