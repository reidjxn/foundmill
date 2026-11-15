---
date: 2026-11-15
branch: claude/wp05-t6-outcome-evals
title: Outcome evals - a session with tools reaches a result, checked nightly (WP-05 T6)
areas: [evals, ci]
supersedes: []
---
## What changed
- `evals/src/sessions/harness.ts`: `createSessionEvalEnv()` and `runSessionCase(c)`. One PGlite database (the
  orchestrator's `setupOrchestratorHarness`), one in-process gateway (`buildGateway`, the real pipeline and `platform`),
  and the orchestrator's own `prepareSession` / `runAgentSession` / `finishSession` on the live runner. Per case it hires
  an agent from a template, opens a task and a session, runs it and reads back the task, its `task_reports` row, the
  session's tool calls, the pages read and the mail sent.
- The world around the session: `web` runs live over a fixture (three supplier pages; `search_web`'s Anthropic call
  is answered by the fixture); `sendgrid` runs live into a capture inbox (`platform_mail` follows it); the project's own
  address is off. Gateway and orchestrator run with `APP_ENV=staging`, so simulated results never count.
- `evals/src/sessions/cases.ts`: `researcher.report_saved`, `researcher.real_citations`,
  `channel_email_automation.not_connected_is_not_sent`, `isolation.refused_tools`.
- `evals/src/__tests__/sessions.test.ts` (unit suite, mock): every case passes with a scripted agent that calls the same
  gateway over HTTP with the session's token, and each check fails on a wrong result. `sessions.eval.test.ts`: the
  live run, skipped without a key.
- `.github/workflows/evals-outcomes.yml`: nightly (04:41 UTC) and by hand, never on a pull request, not required. It
  uses `secrets.ANTHROPIC_API_KEY` like evals-typed-reads.yml, and a red scheduled run opens or updates an issue.
- `OUTCOME_EVAL_BUDGET_USD = 2` (Estimate) is the whole run's budget. Each session's cap (`spendCapMinor`, so the
  SDK's `maxBudgetUsd`) is what is left. A case does not start with less than 10 cents left, and the run fails then.
  Cost is the session's SDK metering (`costMicroMinor`) plus the gateway's model calls (`onUsage`).
- evals now depends on the orchestrator, the gateway, db, events, sandbox and the Agent SDK (for `vi.mock`).

## Decisions
- The code over the spec: a session cannot have no grants (`parseGrants` falls back to the template on an empty list),
  so `isolation.refused_tools` runs the researcher with only its platform grant. It checks the SDK options and the
  session's own PreToolUse hook, which every case asks about Bash, WebFetch and Skill.
- The code over the spec: with mail off, the session ends `not_connected` only when every outside call was simulated or
  not connected. The project address's refusal is a deny, so a blocked task may carry `dependency` (the agent's own
  `block_task`). The case accepts either and fails on `done`, on a send that went through, or on any captured mail.
- Smaller than the spec: no fresh database per case (one per run, an agent and a task per case), and no
  `backend_engineer.fixes_failing_test` (T9 adds it). `golden/tasks.ts` gets only a pointer to the new cases: golden
  tasks grade one completion with no tools.
- The nightly lane (nightly.yml) holds no secret, so the outcome evals have their own workflow; nightly.yml says so.

## Not done
- Steps 1 to 3's live verification: this session had no model key, so the live suite has not run, and no manual run
  of the workflow has been made. Done when three nights are green.
- Found in passing: an email task whose every send was refused (SendGrid not connected, the project address off) still
  ends `done` when the agent calls `complete_task`. The runner counts the address's deny as neither simulated nor not
  connected. The mock test shows it and the case's check catches it; the fix belongs in the orchestrator.
