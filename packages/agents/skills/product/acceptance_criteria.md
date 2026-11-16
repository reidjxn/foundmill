---
key: acceptance_criteria
name: User stories and acceptance criteria
description: Writes user stories with acceptance criteria a test can check, one behavior per criterion.
category: product
attribute_name: Acceptance criteria
attribute_group: craft
when_to_use: Use when a feature or task needs user stories and acceptance criteria that a test can check.
roles: planner, product_lead
default_for:
stage: idea, building, page_live, first_followers, first_sale, growing
needs: none
adapted_from: original
license_note: original
improves: acceptance_criteria, spec_writing
version: 1
---
# User stories and acceptance criteria

Write each story as: As a <kind of customer>, I want <capability> so that <outcome>.

- Give every story three to seven acceptance criteria in Given / When / Then form.
- One observable behavior per criterion. Name the screen, field or message it checks.
- Cover the empty state, the error state and the permission boundary as well as the happy path.
- Mark anything that depends on a decision not yet taken as an open question for your lead.
- Leave out implementation details unless the founder asked for them.
