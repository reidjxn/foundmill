---
date: 2026-11-25
branch: claude/inspiring-archimedes-le54qm
title: Head of Security with error reports, speed numbers, typed sign-up codes and the first hour of a launch
areas: [agents, evals, docs, gateway]
supersedes: []
---
## What changed
- A new agent template, `security_engineer`, named "Head of Security", is on every starting team that has engineering agents (`CODING_CORE` in `packages/agents/src/archetypes.ts`; every development member list now spreads it).
- A new library skill, `error_reports_sentry`, is its default from release 7 of the role defaults. It wires an app to the founder's own Sentry project, sends a test error, and sends the founder a note with a direct link to the reports.
- `ui_quality_checklist` (version 2) gives numbers: a response within 100 ms, no loading sign under 300 ms, skeletons instead of spinners, and optimistic updates.
- `signup_flow` (version 2) asks for a six-digit code typed on the same screen where an address must be confirmed before the person goes on, never a link that makes them leave.
- `launch_plan` (version 2) plans the first hour of each launch post; `social_strategy` (version 2) points to it.
- Tests: `archetypes.test.ts` (the role is on every engineering team), the pinned counts in `skill-library.test.ts` and `default-skills.test.ts`, a golden task and a session case for the role in `evals/src`.

- Second push (same day): two gateway tests no longer depend on the machine's clock or speed. `domains.test.ts` runs on a fixed clock; the 2 MB scan in `site-check.test.ts` allows 2,000 ms instead of 200 ms.

## Decisions
### The founder's answers (Nov 25, 2026)
- Error reports: "Use the skill only version and set it up so that all Foundmill projects with engineering agents always have at least one 'security agent' by default with the Sentry skill pre-installed."
- The role: "It should be an engineering agent with the Sentry skill, but their title is 'Head of Security'."
- The link: "we have to provide the user a direct link to the page in Sentry showing exactly the report results, we can't make them click around anywhere." The note also says the founder can later connect their own Sentry key so the team can read the reports.
- Speed: "answer within 100 ms, no loader under 300 ms, skeletons, optimistic updates".
- Sign-up: "It should be a code typed on the page instead of an emailed link."
- Launch: "There should be auto amplification in the first hour plan in a launch, even if they are not paid."
- Asked who amplifies, the founder chose both: the founder's real supporters (the team sends each the link with a suggested reply and each person chooses) and the project's own channels.
- Other founders or agent-run accounts engaging automatically: "Agreed, don't build this."

### The direct link is built from the project key
The link is `https://sentry.io/issues/?project=<project number>&query=is%3Aunresolved`, and the project number is the last part of the DSN.

Checked without an account: Sentry answers that address with a redirect to sign-in and stores the address as the place to return to. Not checked signed in, because no Sentry account was available. The organization's name is not in the DSN, so the address on the organization's own subdomain cannot be built from the key alone.

### The note does not promise a connection that is not built
There is no Sentry connector, so a founder has nowhere to enter a key today. The skill tells the agent to mention connecting a key only when Settings › Integrations offers a Sentry connection, and otherwise to point to "Request an integration".

### A new template, not a renamed one
The review agent gates merges and the infrastructure engineer owns pipelines; neither writes error reporting into an app. The new role carries the same rules as the other engineers and never changes a security setting: it prepares the change for the founder.

### The follow confirmation on public pages stays a link
A follower confirms that they want email, and the confirmation ends in the email itself: there is no screen they must come back to. The typed code is for flows where the person has to continue on the page.

### First-hour notes follow the Nov 23, 2026 first-contact rule
The team sends supporters' notes on its own in assisted and automated mode and asks in augmented mode. Supporters are people the founder listed or who follow the project. The skill forbids paid or traded engagement, extra accounts and scripted reviews, and drops the ask where a network forbids asking for responses.

### Two flaky gateway tests (founder, Nov 25, 2026: "Yes, fix the flaky gateway timing test")
The scan test failed on two unrelated pull requests at 203 and 216 ms against a 200 ms limit. It guards against a scan that goes quadratic, which would take minutes on these pages, so 2,000 ms still catches it.

The founder named one test; CI showed a second. The per-minute limit test in `domains.test.ts` failed once on a third pull request: the limit counts per clock minute, and the real clock crossed a minute between calls. It now passes a fixed clock through `deps.now`, which the route already reads.

## Not done
- Projects created before this change keep their teams. The founder decided no backfill is needed: "existing projects don't matter since we're pre launch and there are no real users".
- The Sentry connection was built afterwards in its own change (`docs/log/2026-11/2026-11-25-claude-sentry-connection.md`).
- Recurring playbooks, native visit counts and the first go-live checklist are in three other sessions' pull requests.
