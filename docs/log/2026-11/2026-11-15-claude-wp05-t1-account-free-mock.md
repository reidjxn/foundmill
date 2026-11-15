---
date: 2026-11-15
branch: claude/wp05-t1-account-free-mock
title: An account-free mock connector is refused for a real project
areas: [gateway, connectors]
supersedes: []
---
## What changed
`connectionRefusal` (apps/gateway pipeline.ts, from WP-02 T3) used to return early for every connector with
`auth.kind === "none"`, so a person's project on staging or production received simulated web searches, exchange
rates and domain checks as if they were read. Such a connector in mock mode is now refused there with
`integration_not_connected` and "<Connector> is not switched on here yet, so nothing was read or done". A sample
project and development or test keep the simulated answer. The two connectors that refuse a simulated send by
themselves (`platform_mail`, `platform_notify`) are listed in `SELF_REFUSING_MOCK_CONNECTORS` (packages/connectors
catalogue.ts) and left to it. The refusal runs before `allow` and before `ask` (T3), so nobody is asked to approve it.

## Decisions
- The plan placed the condition in `allow`. Since T3 it lives in `connectionRefusal`, which both paths call, so the
  change is there.
- A test lists every account-free built-in and asserts each one is always live, refuses itself, or is refused, so a
  new account-free connector cannot slip through.

## Not done
- Step 3 (a `snippet` on `search_web` results, from the answer's citations, `max_uses` 2) needs one live call to
  confirm the citation shape, and this session has no model key. Per the plan, steps 1 and 2 ship on their own; the
  snippet waits for a session that can make that call. T1 stays unticked until then.
