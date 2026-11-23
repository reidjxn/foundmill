---
date: 2026-11-22
branch: claude/launch-loose-ends
title: Launch loose ends - search snippets (WP-05 T1), public_profiles for the service only (WP-11 T18 step 1), and what main already did
areas: [models, connectors, db, docs]
supersedes: []
---
## What changed
- WP-05 T1 step 3: a web search result carries `snippet` (at most 300 characters), the page sentence the answer cited for that address (`cited_text` of a `web_search_result_location` citation), or null without one. The request asks for one quoted sentence per result, and `max_uses` goes from 1 to 2 (`packages/models/src/client.ts`).
- The answer's own text never reaches a result: only `cited_text`, which is page text, so the result stays untrusted and the typed facts still carry only the address and host. Both mocks return a snippet marked "(mock)". Tests: a recorded citation response fills the snippet; a result with no citation keeps null.
- WP-11 T18 step 1: migration 0168 revokes every right on `public_profiles` from public, anon, authenticated and the service role, then grants the service role SELECT. Every reader is `repos/social.ts` on the service connection.
- `client-grants.test.ts` checks that no client role can SELECT it and that the service holds SELECT and nothing else; the `user-scoped` suite reads it as the service and checks that anon is refused.

## Decisions
### WP-05 T0 could not run here
- The three queries read production (e0's 215 / 81 / 23 sessions). This cloud session has no production database: the Supabase connector failed to connect (proxy refused the tunnel). T0 stays open for a Desktop session; nothing in this change depends on its answer.
### WP-05 T1 without the live call the step asks for
- The step wanted one live call to confirm the citation shape. No key is available here.
- The shape is the one the installed Anthropic SDK types (`CitationsWebSearchResultLocation`: `url`, `title`, `cited_text`, `encrypted_index`), and the mapping falls back to null when no citation comes, so a different live shape costs the snippet, never the titles and addresses. The nightly outcome evals run live searches and will show it.
- `max_uses` 2 can double the search fee of one call (an Estimate: one more search at the per-search price). The step asks for it.
### public_profiles supersedes the 2026-10-05 line
- The Oct 5 decision left this view readable by anyone. The Nov 11 person-profile review made the public views the service's, and this follows it. docs/DECISIONS.md is frozen, so the supersession is recorded here.
### Already on main, recorded only
- Steps 1 and 2 of WP-05 T1 (`SELF_REFUSING_MOCK_CONNECTORS`, the refusal for account-free connectors, `mock-refusal.test.ts`) merged in #171; this change adds step 3 and ticks T1.
- The operator-list test that the Nov 17 "one operator" entry asked of #208 is on main: `apps/api/src/__tests__/reports.test.ts` "operator access comes from OPERATOR_USER_IDS alone" (no owner, seed owner, admin or address is an operator; an empty or malformed list is nobody).
- Pull request #38 (WP-01 T8) was closed on Nov 15, 2026 by the rule in its T8 row ("update once and run; merge if green, close if red"): its one run failed only the test it adds. Nothing left to decide.

## Not done
- WP-11 T18 steps 2 to 4 (the web env default, the api's localhost origins, the logger redaction).
- WP-05 T0 (above).
- The orchestrator's Temporal workflow suites could not start here (the test server download is blocked); every other suite passed.
