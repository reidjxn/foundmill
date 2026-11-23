---
date: 2026-11-23
branch: claude/team-call-always-ends
title: Team calls always end, and agreed next steps become action items
areas: [api, db, models, agents, web, evals]
---
## What changed
The founder reported that the team calls they tested (Nov 12 to 18) all still said "In progress" and noted no action items. Production had four calls, all `live`, with no `team_call.end` audit row at all.

- **Root cause, reproduced locally.** `TeamCallWrapUpDraft` has an open `params` map, so the live client sends it as prompt JSON instead of a structured-output grammar, and then validated the reply strictly. A realistic reply that leaves out a nullable key (`detail`, `action.agent_id`) or names an unknown action type failed validation, then failed the repair retry, so `wrapUp` threw and the call was reopened as `live`. In mock mode the fixture always matched, so tests never saw it. The draft is now loose (every key `nullish`, `action.type` a string), and `finaliseTeamCallWrapUp` fills a missing `params` or agent id before it parses each action, dropping what still does not parse. A test in packages/models fails on the old schema and passes on the new one.
- **The second cause.** Leaving the room (the sidebar, a closed tab, a reload) ended nothing, and nothing swept calls left open.
- **A call always ends.** The room ends the call when it unmounts (any route change) and on `pagehide` (a `keepalive` POST of `teamCall.end` with `via: "left"` to the same-origin tRPC path, with a token read beforehand). The api runs a sweep every minute (`services/team-call-sweep.ts`, the idea-box and showcase sweep pattern) that ends any call live with no turn for 15 minutes, or a wrap-up whose request was lost, as the person who started it through the in-process `teamCall.end` with `via: "idle"`.
- **A failed wrap-up is retried, then shown.** `endTeamCall` tries the wrap-up twice. A second failure marks the call `wrap_up_failed` (migration 0170 adds the status). The room shows "Ended, couldn't write up" with Try again, the transcript stays, and the lobby never shows such a call as "In progress". `claimWrapUp` accepts `wrap_up_failed`. `reopenAfterFailedWrapUp` is replaced by `markWrapUpFailed`.
- **Write-up quality.** The wrap-up prompt (v2) says that a step an agent proposed and the founder accepted ("yes", "do that") is agreed and becomes an action item, and that agreed steps are never left only in the summary. The mock reads the same way: a founder line that agrees takes the steps the agents proposed since the founder last spoke. A new eval case (tc06) covers it live, and an api test files the steps from a realistic transcript.

## Decisions
### The draft is loose instead of the grammar being fixed
Structured outputs cannot express an open `params` map, and each action type has its own params. Typing every action's params as a union would make the grammar large and is a bigger change. The repair step already existed in `finaliseTeamCallWrapUp` ("never throws for a malformed draft"), but the client's strict validation in front of it defeated it.

### A failed wrap-up ends the call
Before, a failed wrap-up reopened the call so that "nothing said is lost". The turns are kept either way. A founder who pressed End, or left, wants the call over, and a call that went back to live is what showed "In progress" for good.

### The sweep ends a call as its starter
The sweep goes through the same `teamCall.end` the founder would press, so every gate applies: membership, the Team section, the entry plan, the model allowances, and the filing under that person's permissions (routeOf decides what is filed and what waits). When the starter can no longer end it (they left the project, or a gate refuses), the call is marked `wrap_up_failed` and anyone with Team write can press Try again.

### A reload ends the call
`pagehide` cannot tell a reload from a closed tab. A reload now ends the call and writes it up. This is accepted: starting a new call is one press, and a call that never ends was the bug.

### The four production calls
After deploy the sweep finds them (live, last change before Nov 19) and writes each one up with the wrap-up model on the founder's account, so each gets a summary, its action items and a "Notes from your team call" note in the Inbox. No database write by hand.

## Not done
The live eval was not run here (no key in this session). A keepalive request that the browser drops leaves the call to the sweep, 15 minutes later. STATUS.md is not edited.
