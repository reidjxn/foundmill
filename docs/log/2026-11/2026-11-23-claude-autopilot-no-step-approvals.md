---
date: 2026-11-23
branch: claude/autopilot-no-step-approvals
title: Steps run without per-step approval: hosted-browser steps, changes in connected tools, a made file's release (Launch Session 24)
areas: [policy, connectors, gateway, agents, docs]
supersedes: []
---
## The founder's rule
Founder, Nov 23, 2026, as relayed by the coordinating session: "we should not over burden users with approvals ... If the user has to approve every time the browser does something new, that is a terrible experience ... They expect it to run completely on autopilot, regardless of the setting they choose in Foundmill, and just get the job done. They should never have to approve individual steps. The same is true with changes in Notion or Hubspot, or a CLI-Anything release ... If they are burdened with having to approve each individual step, they will feel that Foundmill isn't automated at all ... They need to feel that Foundmill is magic."

## What changed
- `packages/policy`: `47-unclassified-step.cedar` is removed; `45-release.cedar` loses `cli-release-asks-founder` (the merge to main keeps `release-asks-founder`); `48-remote-change.cedar` keeps only HubSpot's marketing email and social posts.
- `packages/connectors`: the browser classifier's `unknown` and `outward` classes have no hints (they run like a reversible step); the write tools' static fallback drops `unclassified`. Notion `notion-update-page` and `notion-update-database`, and HubSpot `manage_crm_objects`, `manage_blog_post`, `manage_landing_page` and `manage_website_page`, become `writes: true` with no hints. CLI-Anything `release_output` has no hints. Each is on `INTERNAL_WRITE_TOOLS` with its reason. The mock Wave dashboard gains a "Got it" button so a test can press an `unknown` step.
- Tests: the policy table (Notion change, HubSpot record, release, unknown browser step: allow in every mode; HubSpot marketing email: ask in every mode); the gateway browser test (an unknown step runs with no approval row in augmented, assisted and automated); the gateway Notion test (a listed change runs in every mode and on vacation; an unlisted tool still asks). The existing `Buy now` / `Continue` tests still pass: a `hard_gate` step is denied in every mode and gives the founder a task. The CLI logo eval no longer expects an approval.
- Copy: FOUNDMILL.md (the connector paragraph's "Anything outward or costly asks first" sentence and the CLI-Anything line), packages/connectors/CLAUDE.md, the `make_brand_assets` and `browser_work` skills (and the generated catalog), the `release_output` description and staged notice, and the Settings › Integrations explainer.

## Decisions
- Already ran without asks, so not changed: Gmail drafts, Google Calendar events with no attendees (`add_event`), GitHub branch, commit and pull request tools, and the Shopify draft order.
- A browser step classified `outward` (send, post, invite, publish) also runs with no approval in every mode: the founder chose this in this session when asked (Nov 23, 2026), "Run them too". Its hints are empty, as for read and reversible steps; the write tools' static hints still mark them outward, so a repeat of the same step in one session is answered from the first run (`doneKeyOf`).
- HubSpot's four manage tools that now run unasked are on the gateway's `ONCE_PER_SESSION_TOOLS`, so a repeat does not create a second record.
- Not changed because they are first contact with an outside person (point 3b, waiting for the founder): Calendar `create_event` / `update_event` / `delete_event` (they send invitations, policy 16); Gmail `send_message`; HubSpot marketing email and social posts; a Notion comment (it notifies people). Spending (point 3a) is untouched.
- `call_unlisted_tool` (policy 46) still asks: a tool on no list cannot say what it does, and it could send or post.
- `notion-move-pages` is unchanged: `remoteHardGateCall` always denies it as an access change.
- HubSpot blog, landing and website pages run unasked: they are the founder's own pages, like the project page, not contact with a person.
- `FOUNDER_ONLY_TOOLS` in packages/db `repos/approvals.ts` is unchanged (point 4). Entries for tools that no longer ask are kept, so any ask that is still raised (a call above the spend threshold, say) goes to the founder only.
- The `unclassified` tool attribute stays in the Cedar schema and `pipeline.ts`, unused, to keep the shared files' diff small.

## Not done
- A new undo action. Undo is what the vendor already has (Notion page history); a released logo replaces the old one, which is not kept, and the founder can change it again. No new undo flow was built.
- An activity-feed change. Every call is still audited and the browser step keeps its before-screenshot; this change does not alter how the feed words these calls.
