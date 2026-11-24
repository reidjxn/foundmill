---
date: 2026-11-24
branch: claude/launch-s28-gate-round4
title: Launch gate run 45408711835 - 51 of 54 sessions; three checks that misread honest work, and the agent's notes in a failing case's log
areas: [evals]
supersedes: []
---
## What changed
- Read pass 1 of run 45408711835, after the founder topped up the Anthropic account. 51 of 54 sessions passed and 4 of 5 utility golden tasks passed, so pass 2 did not run.
- `channel_social.buffer_connected_queues_post`: the claim check read the heading "## What was queued" as a claim. The report says plainly that every Buffer result was simulated. Headings are now skipped; the sentences under them are still read.
- `channel_events.calendar_connected`: the agent put the event on the calendar with `add_event` (no attendees), a granted tool that does the job. The case only counted `create_event`, and a tool check may now name alternatives.
- `categoriser.transactions` failed at "0.80 of 0.8". The grader's weighted mean landed a float hair under the threshold (0.7 + 0.9 is 1.5999… in JavaScript). The golden pass now compares with a 1e-9 tolerance. A score really under the threshold still fails.
- `product_lead.revision_saves_report` (WP-05 T23, #401): the tool trail shows `read_product` and `get_task` only, then the session ended with no report. A failing case's log line now also carries its last four notes (the agent's words and the system's), so the next run shows why.

## Decisions
### Three check fixes, no lowered bar
Each fix takes in a case that did the work honestly (a simulated queue labeled simulated, an event added with the other calendar tool, a score equal to its threshold). None lets a claim, a missing tool call or a low score through.
### The revision case waits for its notes
Its trail rules out a missing tool (both reads went through). Launch S27 noted that #391 changed what `read_product` returns, which is in this path. The notes will show whether the agent stopped on what it read.

## Not done
- The next two-pass run is for the coordinating session to dispatch.
