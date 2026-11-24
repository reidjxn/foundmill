---
date: 2026-11-24
branch: claude/categoriser-case
title: The categorizer's template matches its output schema, and the case asks for the non-operating note its rubric grades
areas: [agents, evals]
supersedes: []
---
## What changed
- The coordinating session reported that `categoriser.transactions` scored 0.7999 against its 0.80 threshold in the launch gate. The threshold is unchanged.
- That score is (1 + 0.4 + 1) / 3, so one rubric line drew 0.4. That line asked for the savings transfer and the SAFE proceeds to be "flagged as non-operating". The case was underspecified:
  - The output schema (`CategorisedTransaction`: id, category, confidence, rule) has no flag field.
  - The prompt never asked for one.
  - So the grader could only find the flag in the rule text, and only sometimes.
- The template contradicted the schema:
  - Its example used `account`, `rule_id` and `flow`.
  - Its category, `software_subscriptions`, is not in the chart.
  - Its goal and playbook asked for an operating or financing flag that has no field.
  - Haiku was told one shape and validated against another.
- `packages/agents/src/templates/utilities/categoriser.ts`:
  - The example matches the schema.
  - The description, goal and playbook say what the product does: `packages/db` `repos/finance.ts` reads the transfers and financing categories as non-operating.
  - The rule of such a row says it is non-operating.
- `evals/src/golden/tasks.ts`: the prompt asks for that note in the rule. The rubric line says it is what is graded, since the schema has no separate flag.

## Decisions
### No schema field
- A `flow` field would duplicate what the category already says, and the P&L reads only the category.
- The note in the rule keeps the reason visible to the founder without adding a field to keep in sync.

## Not done
- No live run.
