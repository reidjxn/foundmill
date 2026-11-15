---
date: 2026-11-15
branch: claude/wp00-s3-live-connectors-health
title: Live connectors on /health, and the Nov 15 production record
areas: [api, gateway, deploy]
supersedes: []
---
## What changed
**WP-00 S3: live connectors on `/health`** (branch `claude/wp00-s3-live-connectors-health`, stacked on WP-01 T1). The gateway's `/health` lists
`liveConnectors`; the api's adds `modes.liveConnectors` and relays the gateway's under `gateway` (null when it does not answer within 2 s), so the values the
connector cannot read are read from `GET api.foundmill.com/health`. docs/DEPLOY.md §6 has the Nov 15 record of what was read and changed through the connectors.

## Decisions
### The founder's answers to the holistic plan's first questions

- **Railway watch paths:** applied now (WP-00 S4). **Wait for CI on api and gateway:** after WP-01 T1 merges.
- **The seven agent pull requests (WP-01 T8):** as recommended. Closed with a reason: #24, #30, #39, #45, #49. #52 and #38 get one run on the CI lanes once T1 is on main; merged if green (#38 closed if red).
- **Branches:** delete the merged ones and those of the closed agent pull requests. The session's git proxy refuses deletions, so the list is handed to the founder.
- **Railway project name:** rename `founder-manager` to `foundmill` (no connector can; a dashboard step).
- **Foundmill Sites domain:** the founder proposes `foundmill.app` (available, $9.99 the first year, $15 a year after, Vercel's price on Nov 15). A registrable domain apart from foundmill.com, as WP-07 D2 recommends.
- **Merging:** the cloud session may merge and turn on auto-merge for its own pull requests once their checks pass (founder, Nov 15, 2026; replaces "never merge" in the plan's prompt and the `ship-change` skill for this work).
- **CI cost:** accepted (about 170 runner minutes a run, Estimate, until WP-01 T3). **No previews for `agent/**`:** accepted. **Required checks:** the five names in §1 of docs/DEPLOY.md, confirmed.
- **Vercel plan:** Pro already (WP-00 S14 closed). **Stripe:** deliberately the last step before launch; WP-00 S8 and every task that waits on it stay behind their switches with the mock passing.
- **Spend limits at Anthropic and E2B (S13) and the front-door test (S1):** the founder does them.

## Not done
See the pull request's "Not verified" section.
