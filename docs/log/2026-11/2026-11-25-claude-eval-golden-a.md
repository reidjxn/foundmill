---
date: 2026-11-25
branch: claude/eval-golden-a
title: Golden round A - the Head of Security builds the Sentry link from the key, the SEO agent says a page edit waits for approval, and the linker case gives the spans the code finds
areas: [agents, evals]
supersedes: []
---
## What changed
- Read live run 45641346718 (golden round A, on e89f119): golden 58/61, Source Watcher 3/3.
- security_engineer.error_reports 0.00. The agent built an organization-subdomain link and flagged it as unverified, so the link the founder needs was missing.
  - The link format is in the role's default skill (`library_error_reports_sentry`, step 7). The golden harness passes no skills to `buildSystemPrompt`, and in a session the body loads only when `selectSkills` picks it.
  - So the Head of Security template now states the format itself: https://sentry.io/issues/?project=<project number>&query=is%3Aunresolved, with the number taken from the end of the DSN. The founder gets the right link whether or not the skill body loaded.
- channel_seo.hosted_page 0.00, the second failure on the same wording. It said the page had not changed and that "the founders review the edit", but never that the edit waits for approval.
  - The coordinating session asked for the agent to be fixed, not the check (Nov 25, 2026).
  - A new channel_seo guardrail: a proposed page edit waits for the founders' approval. The agent says so in those words, and says nothing on the page changes until they approve.
- entity_linker.sweep 0.75 (0.8): two spans were off by one.
  - In the product the spans come from code (packages/entity-linker `sweep.ts`), and the model only resolves candidates.
  - The case asked the model to count characters, which the product never relies on. The prompt now gives the spans the code would find, as `sweep.ts` passes them.

- CI on this branch failed once in `apps/gateway` `follower-update.test.ts` (run 45678809236). The test saved a draft and its edit in the same millisecond, and `startSend` compares `updatedAt` to the millisecond (`repos/updates.ts`), so the edit looked unchanged.
  - The test now waits for the clock to pass the first save before it edits.
  - The product check stays as it is: a founder cannot preview and edit within one millisecond.

## Decisions
### Template rule over a harness change
- Loading skills in the golden harness the way a session does would test more faithfully. It would also change every case whose role has a default skill (55 skills have defaults) at the gate.
- The template rule fixes what the founder receives in every path, so it is the smaller root fix. Loading skills in the harness is left for after the gate.
### No threshold or check changed

## Not done
- No live run.
- The golden harness still does not load skill bodies as a session does (see above).
