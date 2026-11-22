---
date: 2026-11-22
branch: claude/network-safety
title: Community safety before sign-up opens (H1 to H4 of #217's review)
areas: [api, db, web, config]
supersedes: []
---
## What changed
The four high findings of the security review in #217's description, fixed in the community layer (Launch Session 18). All four still stood on main at be52161.
- **H1:** a post is held by reports only when three members who still read the community and joined before the post was written have open reports on it (`repos.social.holdingReportCount`, in `reportPost`). Joining (or accepting an invitation) is limited to 30 a day per person (`takeCommunityJoin`, `LIMITS.liveJoinsPerUserPerDay`).
- **H2:** `moderatePost` refuses `restore` on the moderator's own post (`SELF_RESTORE`). The web hides Approve on one's own post in the feed menu and the review queue, and says how it can still show.
- **H3:** `live.communities.update` spends one of 20 changes a day (`takeCommunityEdit`) before the screening model call.
- **H4:** a block holds inside communities: `listPosts` and `replyCounts` leave out authors blocked either way with the viewer; replying under, reading the replies of, or reporting the post of someone blocked either way reads as not found; and `communities.get` leaves them out of the member list.
- Tests: api `live-social.test.ts` ("network safety before sign-up opens"), `live-limits.test.ts`; web `LiveScreens.test.tsx`; e2e `live.spec.ts` (the own held post has no Approve).

## Decisions
### Reports count from members who were there first
Scaling the threshold with the community's size still lets a few fresh accounts hide a post in a small community. Counting only reporters who joined before the post means accounts made to attack a post cannot hold it, and an approved post stays approved (each member reports a post once). Every report still reaches the moderators' queue.

Known limit: accounts that join early and wait can still hold a later post; it then waits for a moderator, who approves it once and for all. An edit keeps a report-held post held while any open report stands (banning the reporters is no way out). Joining again as a member spends no join.
### A moderator never approves their own post, even alone
A community with one moderator keeps a way on: editing a screen-held post screens it again, and deleting always works. A post held by members' reports waits for another moderator; that is the point of the reports. Nothing here counts or nudges a person for moderating alone.
### Blocks filter feeds for everyone, moderators included
A moderator who blocked someone no longer reads their posts in the feed, but the review queue and the restricted list still show everything a moderator must act on.

## Not done
The medium and low findings (M1 to M5, L1 to L3) follow in a second pull request on `claude/network-safety-2`.
