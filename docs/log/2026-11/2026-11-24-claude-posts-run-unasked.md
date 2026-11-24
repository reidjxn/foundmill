---
date: 2026-11-24
branch: claude/posts-run-unasked
title: Buffer posts, HubSpot posts and marketing email, and SendGrid campaigns run without approval in assisted and automated mode
areas: [policy, connectors, gateway, agents, shared, docs]
supersedes: []
---
## The founder's rule
Founder, Nov 24, 2026, as relayed by the coordinating session:

> "yes, Buffer posts should run without approval too."

## What changed
- `buffer` `queue_post`, `sendgrid` `schedule_campaign`, and `hubspot_mcp` `manage_social_posts` and `manage_marketing_email` lose `irreversible` and keep `contactsThirdParty`. They run in assisted and automated mode, on vacation too, and ask in augmented mode.
- `packages/policy`: `48-remote-change.cedar` is removed. It held only the two HubSpot tools, which asked in every mode.
- Tests: the policy table (a HubSpot marketing email and a Buffer post; both run on vacation), the Buffer, SendGrid and remote MCP hint tests, and the gateway Buffer contract (augmented asks; assisted queues the post).
- Copy:
  - FOUNDMILL.md and packages/connectors/CLAUDE.md;
  - the `queue_post` description and the `channel_social` template;
  - the `social_strategy` and `social_post_writing` skills, plus the generated catalog;
  - the assisted description in Settings › What the team can do ("It emails and posts for the project on its own").

## Decisions
- HubSpot social posts, HubSpot marketing email and SendGrid campaigns follow the Buffer rule: the founder chose all three in this session when asked.
- The skills no longer require the founder to approve the first post on each network, or a post that quotes the founder. A customer is still quoted only with their permission on record.
- Unchanged: hard gates, suppression, the daily caps, the untrusted-recipient check on links and pictures, and `call_unlisted_tool`.
- A Notion comment (`notion-create-comment`) keeps its hints: it notifies people, and it is not a public post.
- The golden eval `channel_social.own_buffer_account` still feeds a "waiting for the founder's approval" result, which is what augmented mode returns; it is unchanged.

## Not done
- Launch S28's end-to-end gate expects Buffer to end with "one approval asked, nothing posted". S28 is told the new expected end in assisted mode: the post is queued, and nothing is reported as published until `get_post` says it was sent.
