---
name: new-agent-template
description: Create a product agent template (instructions, skills, tools, default model) with its evaluation suite, per docs/BUILD.md §11.10. Use when adding a new agent role to packages/agents.
argument-hint: "<template name>"
---

# Add an agent template

Delegate the writing to the `agent-template-author` sub-agent, then check its work against this list.

1. Read `docs/BUILD.md` §11.10 and two existing templates in `packages/agents/src/templates/` of the same kind (lead, channel, worker or utility).
2. Grant only tools that resolve today: every grant must be served (`packages/connectors/src/grants.ts`); the grants contract test fails on a tool nothing serves.
3. The model comes from a route in `packages/models/src/routing.ts`. Never write a model id anywhere else.
4. Prompts follow the house rules: a simulated tool result is reported as simulated and not done; entity mentions use `[[ent:<uuid>|Name]]`; no banned or football words; US English; subtext rule (FOUNDMILL.md).
5. Add an eval in `evals/src/` for every new behavior (what it must do and what it must refuse).
6. Finish with the `verify-done` skill.
