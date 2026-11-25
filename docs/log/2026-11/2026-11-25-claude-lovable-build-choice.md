---
date: 2026-11-25
branch: claude/lovable-build-choice
title: The Chief of Staff recommends building ourselves or with Lovable, and Lovable joins the connectors
areas: [connectors, agents, db, api, web, evals, docs]
supersedes: []
---
## What changed
- A new remote MCP connector, `lovable_mcp`, for Lovable's own server at https://mcp.lovable.dev (`LOVABLE_MCP` in `packages/connectors/src/remote-mcp/servers.ts`). It is wired like Sentry: catalogue, grants and capabilities, `PlatformSecrets.lovableMcpClientId`, `LOVABLE_MCP_CLIENT_ID`, `FOUNDER_ACCOUNT_CONNECTORS` and the agents' connector keys.
- Lovable shows in Settings › Integrations from the catalogue.
- Lovable's list: reads run. `create_project`, `send_message` and `set_project_knowledge` are changes in the founder's own Lovable workspace (`INTERNAL_WRITE_TOOLS`). `deploy_project` is public, like a post, so it asks in augmented mode. Anything else goes through `call_unlisted_tool`, which asks first.
- The recorded mock answers every tool. A prompt starting `REFUSE` makes `create_project` refuse with `insufficient_credits`, so the fallback can be tested.
- Foundmill's OAuth client at Lovable is a Client ID Metadata Document. apps/web serves it at `/oauth/lovable-client.json` (public), and `LOVABLE_MCP_CLIENT_ID` is set to that URL. Nothing is registered at Lovable.
- Discovery handles an issuer with a path, as RFC 8414 asks: Lovable's authorization server is https://lovable.dev/oauth (`discoverEndpoints` in `oauth.ts`). It tries `/.well-known/oauth-authorization-server/oauth` first, then the root.
- The connect asks for `offline projects:read projects:write projects:create workspaces:read`. If Lovable sends back `invalid_scope`, Settings asks once more, by itself, without `projects:create` (`retryScopes`). A second refusal shows the way in below.
- A refused connect, at the consent page or at the code exchange, shows a plain sentence and the "Open Lovable with your plan" link (`LovableWayIn` in `OAuthFinish.tsx`, `integrations.lovableBuildLink`). It is never a dead end.
- Logs for the first real connects:
  - the web callback logs the vendor's OAuth error code (`sign-in: the vendor refused it`);
  - the api logs a refused code exchange by its code (`integrations: sign-in refused at the code exchange`);
  - the build logs a refused `create_project` by a fixed reason code (`lovable: create_project refused`). The code comes from `remoteErrorReason` and is never the vendor's text.
- The Chief of Staff's build recommendation (packages/agents `build-choice.ts`). When the plan's drafting applies (`repos.foundations.apply`), the Chief of Staff writes one note next to "Your plan is ready".
  - It says "Build it ourselves" or "Build it with Lovable", quotes the founder's words that decide it, and states both costs once. It never holds Continue.
  - An idea with no software to build gets an update with no buttons that says so.
  - The rubric (`BUILD_RULES`) is also in the Chief of Staff's playbook.
- The press, in the api (`services/build-choice.ts`, routed from `decideInboxItem`).
  - Build it ourselves is recorded.
  - Build it with Lovable answers the note first, in its own transaction, so two presses make one project. Then, when Lovable is connected (or mock), it calls `create_project` with a prompt compiled from the idea, the approved positioning and the specification, then `set_project_knowledge`.
  - The outcome follows as the Chief of Staff's next note. Its link is built from the checked project id on lovable.dev, never from the vendor's own URL.
  - Otherwise, or when Lovable refuses, that note gives Lovable's Build with URL link with the same prompt. A mock result says it was simulated.
  - The note cannot be answered from an email.
- The engineering lead gets `lovable_mcp` `projects.read` only. Building there spends the founder's Lovable credits, so only the founder's press does it.
- A decision option may carry `cost_in_note: true` (`ComposerOption`). The note's own words state that option's cost, so the DecisionBar shows no cost line. It would otherwise say "No cost" for Lovable's credits.
- Quotes from the idea are markdown-escaped in the note, and `/oauth/lovable-client.json` is public as one exact path.
- Evals:
  - golden cases for the rubric (`evals/src/build-choice/`): two Lovable fits, two build-ourselves fits, two ideas with no software;
  - an agents-e2e pair, `engineering_lead.lovable_not_connected` and `engineering_lead.lovable_connected`: the engineering lead reads the started project, and the mock answers in a sample project. The spin-up itself runs from the press, not from an agent, so its mock-mode end to end is the api test and the Playwright spec.
- Tests: the connector (`remote-mcp.test.ts`), the apply (`foundations.test.ts`), the press (`apps/api build-choice.test.ts`), the metadata document (`well-known.test.ts`), and Playwright `build-choice.spec.ts` (the note and Settings › Integrations).
- FOUNDMILL.md: Lovable added to the vendors approved for an MCP OAuth client, with the founder's words and the rule for the build choice.

## Decisions
### The key is `lovable_mcp`, not `lovable`
Every vendor MCP server is `<vendor>_mcp` (`notion_mcp`, `sentry_mcp`). The coordinator's brief said `lovable`. The suffix keeps the naming consistent, and it leaves `lovable` free if Lovable ever ships an API.

### The press is the spend decision; no agent builds in Lovable
A build message spends the founder's Lovable credits. Marking it `spendsMoney` would make the default "Ask me every time" ask again after the founder's own press. So the press on "Build it with Lovable" is the decision for that spend in every mode, augmented included.
The security review found that an agent granted `projects.build` would spend those credits with no check at all. So agents get `projects.read` only. Letting the team carry a Lovable project on needs its own spend design first.

### `live: true` before the first real connect
The contract says `live` stays false until the server is checked against the vendor. It is true here because the coordinator's test is the first real connect (founder, Nov 25, 2026).
Until `LOVABLE_MCP_CLIENT_ID` is set, connect fails with "not configured", and Settings shows the Build with URL link. If the tool names are wrong, every tool lands on no list and asks first, which fails safe.

### A deterministic rubric, not a model call
"A written, testable rubric, not vibes": the note comes from rules over the founder's own words, each naming the words it matched. It needs no model call and never invents a reason. Lovable wins only with more signals than ours. A tie, or nothing to go on, goes to ours, since it needs no other account or bill.

### The note sits beside the plan note, not after the plan's approval
Approving the plan starts the build at once (`startBuilding`), so the choice has to come before it. If the founder chooses neither, the engineering agents build from the plan as before, and the note says so.

### Lovable's price is an Estimate
The note gives "about $25 a month" for Lovable's paid plans, labeled Estimate. It was not checked live today: Lovable's hosts are blocked from this session.

## Not done
- **Lovable's live metadata and tool schemas are not verified.** Every Lovable host was refused from the session's network. The schemas follow Lovable's documented tool names.
- **The first real connect is the test.** It needs `LOVABLE_MCP_CLIENT_ID=<APP_URL>/oauth/lovable-client.json` on the gateway, then Connect Lovable in Settings. The three log lines above say whether a Free or Pro workspace can sign in and create.
- **An `invalid_redirect_uri` is never sent back to us.** OAuth forbids redirecting it, so Lovable shows it on its own page and nothing is logged.
- **Discovery does not check the metadata's `issuer` field against the listed issuer (RFC 8414 §3.3).** This predates the change, and every server shares the code. The security review flagged it.
- **Day one now has three Needs you notes** (the page, the plan, the build choice). None holds Continue. For an idea with no software to build, the note is an update and folds into the note of the day.
- **Choosing Lovable does not stop the engineering agents.** They still plan the roadmap's Now items when the plan is approved. Skipping the app build when Lovable is chosen is a follow-up.
