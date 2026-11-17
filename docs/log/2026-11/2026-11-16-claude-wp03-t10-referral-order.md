---
date: 2026-11-16
branch: claude/wp03-t10-referral-order
title: The waitlist is ordered by who brought whom (WP-03 T10)
areas: [db, shared, api, web, orchestrator, docs]
supersedes: []
---
## What changed
Migration 0113 gives each `waitlist_entries` row a share code (`code`, ten characters `a-z2-7`, unique, format
checked) and `referred_by_entry_id` (whose link the person joined through; `on delete set null`; never itself). RLS is
unchanged: the table stays the services' alone, and `rls/idea-drafts.test.ts` checks the new columns are closed too.

`WAITLIST_ORDER` (packages/db `repos/idea-drafts.ts`), the one fragment `admitNext` and the sweep use, is now:
1. entries that brought someone who joined (at least one entry with an account names them), then
2. every other entry;
3. within each group, `created_at` oldest first, then `id`.

`@foundmill/shared/via` gains the kind `waitlist` (`w.<code>`) in `VIA_KINDS` only, not `ATTRIBUTION_VIA_KINDS`.
`waitlist.join` takes `via` (the web's `fm_via` cookie, handed over by `joinWaitlist`) and records the referrer once,
when the entry is made. `waitlist.join` and `waitlist.status` return `shareUrl` (`<APP_URL>/?via=w.<code>`). The
place-saved line on the not-invited and on-waitlist pages gains the link and a Copy link button.

docs/DEPLOY.md §4's list query now shows the waitlist in the sweep's order (a db test runs it against `admitNext`);
docs/ARCHITECTURE.md §4 and the schedules row describe the order. T10 is ticked in WP-03.

## Decisions
- How many someone brought never orders anyone: bringing one person or ten puts you in the same first group, and the
  group is in sign-up order. A count-ranked queue would invite gaming and is a count by another name ("No public
  counts", Nov 12 answer 4). The page shows no place number and no count.
- Coming alone costs nothing beyond the plain order the decision implies ("ordered by referral"): you wait in sign-up
  order, behind only people who brought someone. Being brought gives the person brought no head start and no penalty.
  Nobody is told to bring anyone; the share line is an offer.
- The referrer is fixed when the entry is first made. A later join with another link changes nothing, and an existing
  entry never takes one, so two people cannot point at each other to both move up. An unknown code, the person's own
  code (same account, or the same mailbox by T8's `addressKey`, so `maya+1@gmail.com` cannot bring `maya@gmail.com`)
  and any other reference kind are ignored without an error. Someone already let in (an `account_admissions` row)
  brings no one, so an admitted account calling `waitlist.join` cannot credit a friend (security review).
- A referral counts only when the person brought has an account (`user_id` set), as the sweep admits only those.
- Codes are minted on join, not backfilled in SQL: an entry from before 0113 gets one the next time its person opens
  the page, which is the only place the link shows. `newPostCode` from `post-attributions.ts` is reused (same shape).
- A `w.` reference that is still in `fm_via` at onboarding is handed to `founder.profile.update` as before;
  `attributions.resolve` names nothing for it, so no attribution and no account event is written. `fm_via` stays first
  touch: someone who arrived through a project page earlier keeps that reference, and their friend's waitlist link
  is not recorded. Accepted: changing first touch belongs to the people layer.
- The link points at the home page, where the idea box and sign-in start, not at a new page.
- Trusting the code over the spec: the spec has `waitlist.status` return the link; the web never calls `status`, so
  `waitlist.join` (which the page already runs on arrival) returns it as well.
- User-facing words (US English, plain): "Know someone who wants a place too? When they join through your link, your
  place opens sooner.", "Copy link", "Link copied", "The link could not be copied. Select it and copy it instead."
- The network session ("People layer end to end"): no open branch on origin touches the waitlist, `via.ts`, the
  attribution code or migrations past 0111 at the time of writing. `claude/ci-fewer-minutes` edits DEPLOY.md and
  ARCHITECTURE.md in other sections.

## Not done
- 0112 is WP-03 T8's (`0112_admission_address_key`, journal idx 100, branch claude/wp03-t8-signup-guards), so this
  is 0113 (idx 101) and merges after T8. The journal and `migrations.test.ts` list then take T8's 0112 line.
- No event for "someone joined through your link" and no email to the referrer: nothing tells a person they moved.
- A person could make a second confirmed address at another mailbox to bring themselves; the order is plain and the
  gain small, so no guard is added. WP-09's per-account ceiling and the sign-up guards (T8) are where that would go.
- The e2e check of the share link runs only on the invite-only stack (`E2E_SIGNUP_ALLOWLIST=1`), as T1's spec does.
