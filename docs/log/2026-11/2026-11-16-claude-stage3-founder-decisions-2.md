---
date: 2026-11-16
branch: claude/crm-saved-view-reload
title: The founder's remaining Stage 3 answers, and free users run on GLM-5.3 Flash
areas: [agents, models, gateway, api, web, orchestrator]
supersedes: []
---
## What changed
On Nov 16, 2026, in the execution session, the founder answered the decisions left open in
docs/log/2026-11/2026-11-16-claude-stage3-founder-decisions.md. On D9 they gave a new rule about which models a person
who has not paid uses. Both are recorded here because docs/DECISIONS.md is frozen.

## Decisions
WP-06 D6, the Nov 15 planner's calls 1 to 3: **all confirmed**.
- (1) One Markdown file per skill, with a generated catalog. The founder added: a person must be able to read a
  skill's text **in the Foundmill product itself**, without going to GitHub. WP-06 T2 and T7 carry this: the body is
  shown on request in the picker.
- (2) A short index in the prompt, plus the gateway tool `read_skill`. The SDK's own Skill tool stays off (SEC-3).
- (3) Every template gets default skills at hire and at commit, marked "Came with the role" and removable.

WP-09:
- D2 Model moves: **yes, where the eval passes**. Each route moves in its own pull request, only after its eval passes
  on the new model. A failed eval changes nothing; live evals run on their schedule and never gate a pull request.
  `departmentLead` is tested first.
- D8 Pro's price and included credits: **wait for T14's numbers**. Top-ups cover extra work meanwhile.
- D11 On the free plan a training check **defaults to "Run within a day at half price"**; the founder can pick
  "Run now".
- D9 A fourth model key: **replaced by a new rule** (below). T15's decision record, "no Fable 5.2 key now", still
  stands for paid plans.

**Free users run on GLM-5.3 Flash (founder, Nov 16).**
- A person who has not paid Foundmill anything gets GLM-5.3 Flash for everything before payment:
  - the landing page and the idea functions;
  - all agent work, up to the free plan's $5.00 of included credits.
- Anthropic models stay visible in the model choices, slightly grayed. Choosing one asks the person to upgrade or to
  connect their own Anthropic key.
- **Foundmill never pays Anthropic on a free user's behalf.**
- The one exception: a free user may connect their own Anthropic key and use Anthropic models on it. Their own vendor
  account is billed, as the own-key rule (Nov 12) already says.
- Once a person pays for a higher plan, Anthropic models are available on the platform key.
- The founder asked the session "Free open source LLM for pre-purchase" to build this alongside this session. The split
  proposed in the session: that session owns the GLM implementation (the provider client, routing by plan, the grayed
  picker and upgrade prompt, the free user's own Anthropic key, the free-tier evals). This session adjusts WP-09's money
  tasks to the rule and stays out of those files.
- Consequences already known:
  - WP-00 S6 (real web search through Anthropic's server tool on the platform key) is not switched on while free
    users would use it on Foundmill's account.
  - WP-09 T4, T5, T8 and the D2 moves wait for the GLM routing change, then build on it.

WP-04 D6: the day-3 and win-back letters are **signed "The Foundmill team"**, sent from and replied to at
hey@foundmill.com.

## Not done
- The GLM implementation itself, and the split's confirmation from the other session.
- WP-09's tasks are not yet rewritten for the rule; each is adjusted when it is built.
