---
date: 2026-11-16
branch: claude/network-find-people
title: One identity for a person on the network, and Find people by what they are good at and here for
areas: [db, api, web, network]
supersedes: []
---
## What changed
Stacked on `claude/network-reports` (#208). a9 A9-P1-3 and NETWORK F16 (browse), with the layer already open.
- `repos.personProfiles.public.find`: public profiles (`public_person_profiles`) by words over name, headline, about, place and tags, a "good at" word over the strengths, and the answers to "What are you here for?"; never the viewer, never anyone blocked either way; newest published first, paged by cursor. `public.byUserId` reads one account's page.
- api: `live.people.find` (behind `liveGate` like every `live.*`). `live.people.search` now returns people who published /u/<handle> first, as their page, then the older cards, a person with both once. `live.people.profile` finds a person by their page too and returns `person` (what the page says).
- web: Find people on /network (words, good at, here for; work first, face second; rows open the network's person page, where Connect and Report are).
- The network's person page shows the page's words, projects and a link to /u/<handle>. "Profile visibility" is replaced by Your public page (Make or Edit, Open it), with a way to take back a name shown the old way. `/home` and the person frame link to /public-profile.
Tests: db `repos/find-people.test.ts`; api `find-people.test.ts`, `live.test.ts`; web `NetworkScreen.test.tsx`, `PublicProfiles.test.tsx`, `PersonHome.test.tsx`; e2e `find-people.spec.ts` (390 px), `live.spec.ts`, `person-home.spec.ts`.

## Decisions
### The published page is the person's identity
Two systems existed: `founder_profiles.visibility` feeding `public_profiles` (a name, and the Live businesses one runs), and `public` plus `handle` feeding `public_person_profiles` (the page).
The page wins: search, the person page and Find people read it first, and the Network panel now points to the page editor.
The old view stays for businesses and for people who never published a page, so nobody who made their name public before disappears; the old choice can be switched off from the new panel. No migration: both views already exist.

### The order is the publish date and nothing else
Find people orders by `published_at`, then handle. No relevance score and no use of "What are you here for?" in the order, so a person building on their own is never ranked lower (NETWORK §10, §15: no ranking of people). Filtering by an answer is the searcher's own choice.

### "Building on my own" is never written on a row
As on /u/<handle> (`lookingForLine` is null for it). The other answers show as one quiet line. No count of results or of people anywhere on the panel (NETWORK §14 answer 4 read widely).

### Rows open the network's person page, not /u/<handle>
The person page carries Connect and Report and the link to their page; /u/<handle> is the public page for anyone.

### Connecting still needs a Live business
`live.connections.request` is unchanged (`sectionWrite("live")`). A person with no project can find and read people, report and block, but not yet send a request: requests from people without a project are F17's, which needs its own security review (DECISIONS Nov 12, 2026). The /home card now says only what can be done ("Find people by what they are good at, and meet others who are building").

## Not done
- Projects in Find people (by kind, stage, what they need) wait for open roles (F15).
- Five today, Say hi and the matcher (F16's suggestions) are not built: suggestions need density and evals.
- Message requests for people without a project (F17).
