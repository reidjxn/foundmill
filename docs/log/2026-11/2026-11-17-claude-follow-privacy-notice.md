---
date: 2026-11-17
branch: claude/follow-privacy-notice
title: The follower privacy notice and the Follow form's "How your email is used" link
areas: [web, shared, dugout, legal]
supersedes: []
---
## What changed
The founder approved the six terms on Nov 17, 2026, relayed by the plan-execution session: "yes, have it built as one
small pull request, treated as launch-critical". Follower email must not go live without this notice. This is the
privacy half of `claude/blissful-fermat-q03yq1` (38ae2616), which the axe half (#265) left out, rebased on main.

- `apps/web/content/legal/privacy.ts`: a "Following a project" section (`#following`) with what is kept, confirming
  (one email, the link works for `FOLLOW_CONFIRM_TTL_MS` = 7 days), who sees it, who writes to you, if you reply,
  stopping and deleting. `facts.ts`: Privacy Policy updated Nov 17, 2026.
- `packages/shared/src/project-page.ts`: `FOLLOW_PRIVACY_HREF = "/privacy#following"` and the link's words.
- `ProjectFollowForm`: "How your email is used" under the consent box, before the button, a 44 px target opening the
  policy in a new tab. The consent sentence is unchanged.
- Tests: `legal-content.test.ts` (the link, the section, the 7 days, and the facts checked below), `ProjectFollowForm.test.tsx`,
  `public-page.spec.ts` (the link at 390 and 1280 px; the link counts).

## Decisions
Each term was checked against the code on Nov 17, 2026, and two were corrected from the Nov 15 wording:
- **Who sees it.** It said "the project's founders and collaborators can see". Contacts are read behind the Customers
  section's access (`sectionRead("crm")`), so it now says "the project's founders and collaborators who have access to
  its Customers".
- **If you reply** (new term). Since #267 a reply to a project's email is stored on the sender's contact as plain text,
  cut at `REPLY_BODY_MAX` (20,000 characters), read behind the same access, and deleted with the person's record. The
  section now says so in one sentence, and "Deleting" names the replies too.
- Unchanged, and true: the confirmation link's 7 days (`FOLLOW_CONFIRM_TTL_MS`); an unsubscribe, a bounce or a spam
  report ends the consent (`followers.withdrawByEmailHash`), and the withdrawn record and the suppression list keep the
  address from being emailed again.
- The follower-email session (WP-08 T3) was told which files this edits before the edit.

## Not done
- "Who writes to you" describes follower email as WP-08 T3 builds it (from the project's Foundmill address, with an
  unsubscribe link). If that changes, this term changes with it.
