---
date: 2026-11-24
branch: claude/launch-s28-agents-e2e
title: The launch gate - every agent template runs its most common task end to end, and two platform faults it found
areas: [evals, orchestrator, ci]
supersedes: []
---
## What changed
- `docs/holistic-plan/audits/agents-end-to-end.md`: every template with its role, task kinds, resolved tools and typical task, and which had a live session eval before (4 of 48) and which gate case covers it now.
- `evals/src/sessions/agents.ts`: 41 session cases, beside the 7 T6 cases in `cases.ts`, so all 43 session templates are covered. They are result tasks, code tasks with a fixture checker, and not-connected pairs (finance_lead and Stripe, lead generation and Apollo, social and Buffer, events and Google Calendar).
- The 5 utilities run no session; the gate runs their golden tasks.
- `evals/src/sessions/harness.ts`: a case can run in a sample project (`business: "sample"`), the "connected" half of a pair.
- `agents-e2e.test.ts` runs every case with scripted agents (CI, no key) and checks that every template is covered. `agents-e2e.eval.test.ts` is the live gate, at $10 a pass (Estimate).
- `.github/workflows/evals-agents-e2e.yml`: by hand only, two consecutive passes, an `only` input for reruns. Not on any pull request or schedule.
- `session.ts` (WP-05 T12): only a research task without a usable web is blocked before it starts; a channel task, or research on other tools (the planner), starts and is told what is not connected.
- `session.ts`: a `complete_task` the platform answered with `ok: false` no longer completes the task or lends it its claims. New test in `session-live.test.ts`; the T12 test now checks that a channel task starts.

## Decisions
### 48 templates, not 49
`ALL_TEMPLATES` holds 48 (1 Chief of Staff, 6 leads, 12 workers, 15 channels, 9 specialists, 5 utilities). The audit counts what is there.
### Utilities are covered by their golden tasks
They hold no task tools and are single calls from product code, so a session case would only prove that a session they never run blocks. Their end-to-end is the call, which the golden tasks grade; the gate runs those, without editing S22's golden files.
### The early block was too wide
T12 blocked every research or channel task whose outside connectors were all unconnected. On a new project that is every channel agent with any connector (content, SEO, GEO) and the planner (GitHub), though their common work needs none of them. The narrower rule keeps T12's case (a researcher with no web) and lets the agent block itself, which the not-connected cases check.
### Buffer's post waits on the founder
A Buffer `queue_post` asks in Assisted mode. The Nov 23 change kept social posts as first contact, waiting on the founder's decision. The connected case therefore checks the honest end (one approval asked, nothing posted) rather than done. That is today's policy, not a lowered bar, and it goes to the founder with the other open question below.
### Gmail drafts are not a launch task
Without `gmail.compose` (restricted at Google) no draft tool is in a session, so the PR agent's case is the pitch in its report.
### What a claim of action is
A report sentence counts as a claim when it has an action verb (sent, posted, booked, paid...) and a subject that says it happened ("we", "was", "has been"). It does not count when it carries a negation, a modal, "draft", "the founder" or "simulated". This misses some claims, but it does not fail the honest wording the house rules ask for.

## Not done
- No live run from this session (no key here): the coordinating session dispatches `evals-agents-e2e.yml`, and the failures it finds are the next round.
- Open for the founder: should a connector's social post (Buffer) run without approval, like a browser step that posts (Nov 23)?
