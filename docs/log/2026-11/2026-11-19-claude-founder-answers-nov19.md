---
date: 2026-11-19
branch: claude/founder-answers-nov19
title: The founder's answers of Nov 19 (evening), auto-merge for session pull requests, and two more launch sessions
areas: [docs, ci, skills]
supersedes: []
---
## What changed
The founder's answers of Nov 19, 2026 are recorded in docs/holistic-plan/LAUNCH_EVALUATION.md section 4: the streak
shows only the days opened; the first-session journey is eight screens; `PAID_ENTRY` stays its own switch and is
turned on on opening day; the MCP sign-in apps for Notion, Shopify and HubSpot are approved; WP-11 T3, T8 and T10 have
the go-ahead. A ready pull request now merges itself once the required checks pass: FOUNDMILL.md, `ship-change`, the
holistic-plan README, and `.github/workflows/auto-merge.yml`, which turns on auto-merge for `claude/*` pull requests.
Sessions 12 (streak) and 13 (WP-11 T3, T8, T10) are added.

## Decisions
### Auto-merge through a workflow
Cloud sessions cannot be messaged from the coordinating session, so a workflow turns auto-merge on when a `claude/*`
pull request opens or leaves draft. The ruleset's six required checks still gate every merge.

### A merge made with GITHUB_TOKEN starts no workflow on main
That is GitHub's rule. Main's push checks and the E2B template build would then skip after an auto-merge. The workflow
uses an `AUTOMERGE_TOKEN` secret when the founder adds one (a fine-grained token with pull request and contents write);
until then the nightly full run still checks main.

### Production steps stay with Session 11
WP-11 T8 drops a backup table on production. Session 13 prepares and checks read-only; the drop runs in Session 11
with the founder watching.

### foundmill.app
The founder says the Sites domain is done. DEPLOY.md still lists the `sites_reader` password, `DATABASE_URL` on
`sites` and `SITES_DOMAIN` as open, so Session 11 checks production and sets what is missing.

### The night answers
WP-06 T11 is kept. Gmail stays in Google's testing mode while sign-up is invite-only; the founder submits
verification for the sensitive scopes and starts the assessment for `gmail.readonly`. Sending stays on SendGrid,
receiving stays in Foundmill, and a founder's name@ only forwards (no mailboxes). Domains (OpenSRS) and Gmail and
Calendar as context are Sessions 14 and 15. Vercel is on Pro. The WP-14 T15 measures win in the plan's stop rules.

## Not done
- Sessions 12 to 15 are not started.
- The spending limits (S13) have no amounts yet; Z.ai's DPA and SCCs are with the founder.
