---
date: 2026-11-22
branch: claude/network-safety-2
title: People and community safety before sign-up opens (M1 to L3 of #217's review)
areas: [api, db, web, agents, evals, config]
supersedes: []
---
## What changed
The medium and low findings of the security review in #217's description (Launch Session 18, part 2; part 1 is `claude/network-safety`). All still stood on main at be52161.
- **M1:** community reads (list, a community, its feed, its review queue, invitations) spend 120 a minute per person (`takeCommunityRead`); invitations list at most 100.
- **M2:** a person receives at most 50 requests to connect a day from everyone together (`takeRequestReceived`, spent only when a request is created). The note on a request is screened like a post (screen kind `connection_note`); a held note refuses the request with a sentence to act on.
- **M3, M4:** migration `0160_network_safety` adds trigram indexes on `founder_profiles` (name, headline, about, place), the columns Find people and the name search match.
- **M5:** the name search and the business profile page leave out a business whose owner, cofounder or admin is blocked either way with the viewer (`repos.social.runByBlocked`), and `lookupPeople` names nobody blocked either way.
- **L1:** `repos.social.stillSpeaksFor`: a member's business, and a community's owning business, show only while the person still has a writing membership in it.
- **L2:** community posts link only http(s) addresses (`webLinksOnly`); the community's name moved inside the untrusted block of the screen prompt.
- **L3:** `live.people.search`, `find` and `profile` (except one's own) need the 18+ confirmation, and `public_profiles` lists a founder only once they have confirmed. Every screen that reads people (Network's Find people and name search, a person's page, the CRM's "On Foundmill" group) waits for the confirmation through `useCanReadPeople` and shows `AdultNotice` instead: one tick and Confirm records it and lets the person straight in.
- Tests: api `live-social.test.ts` ("M1 to L3"), db `repos/social.test.ts`, evals `moderation.test.ts` (and three note cases in `MODERATION_CASES`), web `LiveScreens.test.tsx`.

## Decisions
### A cap per recipient, set high
A cap on requests one person receives lets a ring of accounts fill someone's day, so the cap is 50, far above what a person gets in a day, and it only stops new requests: existing ones, messages and communities are untouched. The ring is still slowed by each sender's own limits.
### The cap counts only requests that arrive
A request that is refused (a block, a held note, a repeat) spends nothing of what the person receives, so throwaway accounts cannot use up someone's day with requests that never reach them. The key is taken inside the insert's transaction, so a request past the cap rolls back.

### Notes are screened, not only checked
A note goes to a stranger, so it gets the same screen as a post (deterministic checks, then the moderation route, billed to the business that asks). A screen that cannot run refuses the request with "could not be checked just now"; sending without a note always works. A person's own phone number in a note is held on purpose: the note reaches a stranger.
### Old posts keep their business
L1 masks the business on a member row and on a community's owner. A post keeps the business it was written for, as a record of what was said then; a new post or edit already checks the person still speaks for it.
### The migration number is a placeholder
0160 is the next free number after every open branch's migrations today; the session takes the next free number on main when it rebases before merging.

### Accounts from before the confirmation
On production, 11 of 12 founder profiles have no confirmation on record (coordinating session, Nov 22). Nothing is backfilled: those founders leave the old founder cards and are asked once, kindly and in one step, the next time they open a screen that reads people. `/home` links to Network, which shows the same step at the top.

### Who still sees names without the 18+ confirmation
`people.lookup` and community member lists are not gated: they follow each person's visibility, and community steps already need the confirmation. The gate covers searching for people and reading another person's page.

## Not done
- Filtering before the `public_profiles` union (M4's second half) is left: the indexes and the people-search limit bound it.
- `public_profiles` founder rows still ignore a membership's `expires_at` and example memberships (from the review; a collaborator is not an owner, cofounder or admin, so the gap is small).
