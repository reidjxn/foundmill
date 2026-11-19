---
key: ponytail
name: Smallest complete change
description: Solves a coding task with the least new code that still does the whole job, so every change stays short and easy to read.
category: engineering
attribute_name: Lean changes
attribute_group: execution
when_to_use: Use when writing, fixing, refactoring or choosing a package for code, before the first edit, to keep the change as small as the task allows.
roles: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
default_for: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: ponytail:ponytail
license_note: MIT, Copyright (c) 2026 DietrichGebert
improves: cost_efficiency, scope_control
version: 1
---
# Smallest complete change

## When to use this

Use this on every task that changes code. The best code is the code nobody has to write, read or fix later. The aim is the smallest change that solves the whole problem, not the shortest one that looks finished.

## Before you start

Read the task and the code it touches. List every place the change must reach: callers, tests, test data, settings and exports. Check what the change could break for the people who use the project: data it could destroy or expose, and callers that would stop working. That list is the scope. Extra features are not part of it.

## Steps

Take the first option that fully works:

1. **Does it need to exist?** Skip features, options and flexibility nobody asked for, and name each one in a line of your hand-back. A vague request gets the smallest version that does the core job.
2. **Is it already in the project?** Reuse the helper, component or pattern the nearby code uses, the way the nearby code uses it.
3. **Does the language or platform already do it?** Use that, unless the project has its own. A component the project already owns beats a native one.
4. **Is a package already installed that does it?** Use it. Never add a package for a few lines. A new package is a decision for your lead, with its cost.
5. **Can it be one line a reader understands at a glance?** Write the one line. A one-liner that needs decoding is not short.
6. **Otherwise** write the least code that works.

Rules that keep a small change complete:

- Be lazy about the solution and never about the change. Finish every part the task needs, including the callers, tests and test data your change breaks.
- Add no layer, wrapper, option, setting or "for later" code that nobody asked for. Deleting beats adding. Keep the structure the project already has.
- For a bug, find every caller of the function you touch before you edit, then fix the root cause once, in the shared code.
- Code you move or merge keeps its error handling and its checks on input.
- Between two options of the same size, take the one that is right on edge cases.
- New logic that is not trivial (a branch, a loop, a parser, anything with money or security) comes with one small test. Trivial changes need none.
- A shortcut with a known limit gets a one-line comment in this form: "shortcut: the limit, and when to upgrade".
- Comment only the reason the code cannot show.

Never cut these to save lines: checks on input from outside, error handling that prevents lost data, security, access for people with disabilities, and anything the task asked for.

## What good looks like

The task: "Show the plan name on the billing page." The project already has a `planLabel(tier)` helper and the page already loads the account.

A lean change adds one line to the page that calls `planLabel(account.tier)`, and one assertion to the existing page test. A change that adds a new formatter, a setting for the label's style and a package for text casing does more than the task needs and gives a reviewer more to read.

## Output

End your hand-back with one or two lines: what you chose not to build or did not check, and any risk your lead or the founder must know about. Write these lines in plain, full sentences.

## Check before you hand it over

- Every place the change must reach is changed: callers, tests, test data, settings.
- No option, wrapper, package or file was added that the task did not need.
- Any new logic that is not trivial has its test.
- Checks on input, error handling and security are as strong as before.
- The hand-back names what you skipped.

## What needs the founder

Adding a package that costs money, or one that changes who can see the project's data, is the founder's call, through your lead. Nothing else in this skill needs the founder.

## If a tool is missing

If you cannot run the project's tests, say so in the hand-back and keep the change small enough to check by reading. Never write that a test passes unless you saw it pass.
