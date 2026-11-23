---
date: 2026-11-22
branch: claude/beautiful-turing-ke5wjw
title: WP-08 T8, the page tools for the SEO and GEO agents and the page suggestion panel
areas: [agents, connectors, gateway, api, db, events, modules, evals, docs]
supersedes: []
---
## What changed
Two platform tools, `read_public_page` and `propose_page_edit` (capabilities `page.read` and `page.propose`), granted to
the SEO, GEO and content channel agents. An agent reads the hosted page (words, stage, live, listed
and why not, dates, limits, shown milestones) and proposes new words for the pitch, about or who it is for, with a reason.
A proposal never touches the draft or the published copy: it waits in four new columns on `project_pages` (migration 0171,
no new table), one at a time, and a new one replaces it. The event `page.change_proposed` names the agent and the fields.
In Product › Public page a panel above the editor reads "‹Agent› suggests a change" with the reason, the words now beside
the words suggested, "Use this" (copies them into the draft; publishing stays the founder's press) and "Dismiss"
(`page.proposal.use`, `page.proposal.dismiss`). The SEO and GEO templates gain a hosted-page example, and the golden task
`channel_seo.hosted_page` checks that an agent with only these two tools proposes a short pitch that names who it is for,
says nothing changed, and reports search data as not connected.

## Decisions
### The channels are not made "available" by the proposal tool
The plan adds `platform:propose_page_edit` to `CHANNEL_ACTING_TOOLS` for SEO and GEO so both show on the Board for a project
with a page and no repository. I built it and backed it out: it makes both channels act on every real project, which flips
eight existing tests of first-day Distribution (the empty Board "email opens first", the starting note, the strategist's
"no channel can run"), and the availability rule has no fact for "the page is live". The agents have the tools in a task or
session either way. Changing the Board needs a page-live fact in `ChannelAvailabilityFacts` and a decision about those first-day words.

### The tools are short, and the Product lead does not get them
The orchestrator's tool-budget test caps a template's tool definitions at 6,500 tokens (Estimate). The two tools first came
to 287 tokens and put the Product lead (6,732) and the content channel (6,610) over. Shortened to 171 tokens, the content
channel fits (about 6,494); the Product lead, 55 under the cap before, cannot hold even the shortened pair, so it keeps
drafting the page through its own flow and the SEO, GEO and content agents get the tools. The detail that left the
descriptions belongs in a skill (WP-06).

### The hold check runs when a founder uses the words, not in the tool
`pageHoldReason` lives in the api and uses `communityScreenLocalFlags` from packages/agents, which the gateway does not depend
on. The tool applies the shared limits (`pageProposalProblems`); `page.proposal.use` refuses held words (an address, a phone
number, markup) in the hold's own message, so they never reach the draft by this route.

### `post.published`-style wall for the event
`page.change_proposed` is filed under Settings in `EVENT_WALLS`, so a collaborator never receives it and
`fm_collaborator_event_types()` needs no new definition.

### Proposals are for pitch, about and who it is for
`offer`, `price` and `cta` do not exist until WP-08 T6, and the plan keeps `price` and `cta` away from agents in any case.

## Not done
- The Board change above, and the Playwright spec "use a proposal, publish, see it live" (the panel is covered by a component test; the api, the gateway host and the repo by their own).
- A cross-tenant assertion on the new columns: the table's existing RLS suite covers `project_pages`.
