---
date: 2026-11-16
branch: claude/signin-email-delay
title: The sign-in email's link opens a page with a button, so a mailbox's link scanner cannot use it up
areas: [web, supabase, docs]
supersedes: []
---
## What changed
- A new founder (a Microsoft 365 mailbox) saw "Link expired" on the sign-in link two minutes after asking for it.
  Supabase's auth log shows why: the one-time link was opened 22 seconds after the email was sent, from an address that
  was not the founder's, and the founder's own tap two minutes later found the token used. The email was not slow and
  the 900 s expiry was never reached; a link scanner at the mailbox used the link up (Supabase's email-template guide
  calls this "email prefetching" and names Microsoft 365's Safe Links).
- `supabase/templates/magic_link.html` and `confirm_signup.html`: the link is now
  `{{ .SiteURL }}/auth/confirm?confirmation_url={{ .ConfirmationURL }}`, the shape Supabase's guide recommends.
- `apps/web/app/auth/confirm`: the page reads `confirmation_url` on the server (`lib/auth/confirm-link.ts`: it must be
  this deployment's own Supabase `/auth/v1/verify` address, else `/login?error=missing_code`; no Supabase on the server,
  `not_configured`) and shows one button, `ConfirmSignIn`, whose press opens the link from script. No redirect, no
  anchor, no script-free fallback. `/auth/` is already a public prefix in the proxy; the page is not indexed.
- Tests: `app/__tests__/auth-confirm.test.tsx` (the helper on the encoded and the raw link shape, a foreign origin, the
  page's redirects, the press); `scripts/supabase-config.test.mjs` (both templates link through `/auth/confirm` and never
  straight to the verify endpoint); `e2e/login.spec.ts` (the page at 1280 and 390 px; the stub case presses the button).
- docs/DEPLOY.md §4 step 4 and the status table: the founder pushes both templates with `supabase config push` and
  signs up once with a fresh address on a Microsoft 365 mailbox.

## Decisions
### The button opens the link from script, not a form or an anchor
The CSP's `form-action 'self'` blocks a form whose action is Supabase, and Chromium applies it to the redirect after a
POST too, so a POST to a route of ours that 303s to Supabase would be blocked as well. An anchor is what scanners
follow. A `window.location.assign` on press is what the Google button already does; the scanners that open links ahead
of the reader run no script, so there is deliberately no `<noscript>` link.
### Both link shapes are read
Supabase's guide inserts `{{ .ConfirmationURL }}` straight into a query parameter without saying whether its engine
percent-encodes it there. Encoded, the link arrives whole; raw, its own `type` and `redirect_to` arrive as parameters
of our page, and the helper puts them back. The founder's real sign-up after the push shows which shape production sends.
### The 900 s expiry stays
It looked like the cause and was not: the founder tapped at 2 min 20 s. One hour would not have helped a link already
used, and the login page already offers a new link on "Link expired".
### The error copy stays
"This sign-in link has expired or was already used" is true for a scanned link; the new page removes the cause rather
than explaining it.

## Not done
- The templates are not pushed from here: `supabase config push` is the founder's (DEPLOY §4, WP-00 S10). Until then
  production still sends the bare link, and the six-digit code in the same email is the way in.
- The sender's DMARC is still `p=none` (DEPLOY's status table said to tighten it after a week of mail, Oct 20);
  unrelated to this failure, noticed while reading the DNS records.
- Who runs the scanner (134.199.84.58, a RIPE-allocated address with no reverse name) is not known; Resend's log for
  the message would show the delivery time.
