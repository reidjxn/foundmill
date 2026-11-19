---
key: smallest_change
name: Smallest complete change
description: Solves a code task with the least new code that fully works, finishing every caller, test and fixture the change reaches.
category: engineering
attribute_name: Smallest change
attribute_group: judgement # us-english-allow
when_to_use: Use when writing, fixing, refactoring or reviewing code, before the first edit, to pick the smallest change that fully solves the task.
roles: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
default_for: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
default_since: 2
load: always
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: ponytail:ponytail
license_note: MIT, Copyright (c) 2026 DietrichGebert
improves: scope_control, cost_efficiency
version: 1
---
# Smallest complete change

## When to use this

Use this on every task that changes code, before the first edit. Solve the whole task with the least new code. Less code costs less to build, to check and to keep working, and it spends fewer of the project's credits.

Small means small in what you add, never small in what you finish. A change that leaves a caller broken or a test failing is not small, it is unfinished.

## Before you start

1. Read the task, its acceptance lines and the code it touches.
2. List every place the change must reach: callers, tests, fixtures, configuration and exports. That list is the scope. Features nobody asked for are not.
3. Check what the change could break for the project's users: data it could destroy or expose, and callers that would stop working.

## Steps

Take the first option that fully works:

1. **Does it need to exist?** Leave out features, options and flexibility nobody asked for, and name them in one line of your hand-back. A vague task gets the smallest version that does its core job.
2. **Is it already in the codebase?** Use the existing helper, component, service or pattern, the way the code around it uses it.
3. **Does the language or platform already do it?** Use the standard library or the platform feature, unless the project has its own. The project's own component comes before a native one.
4. **Is a dependency the project already has enough?** Use it. Never add a dependency for a few lines.
5. **Can it be one clear line?** Write one line a reader understands at a glance. A one-line trick that needs decoding is not short.
6. **Otherwise** write the least code that works.

While you write:

- Add no abstraction, wrapper, option, setting or "for later" code the task did not call for. Keep values in the form the platform already gives you. Deleting code beats adding it.
- Keep the structure the codebase already has: its layers, interfaces and naming.
- For a bug, find every caller of the function you touch before you edit, then fix the cause once, in the shared code.
- Code you move or merge keeps its error handling and its validation.
- Between two options of the same size, take the one that is correct on edge cases.
- Comment only the reason the code cannot show, in one line. A known limit of a shortcut gets a comment that names the limit and when to replace it.
- New logic that is not trivial (a branch, a loop, a parser, anything about money or security) leaves one small test. A trivial change needs none.

Never cut: validation where outside input enters, error handling that prevents data loss, security checks, accessibility, or anything the task asked for.

## What good looks like

A reviewer reads the diff once and sees why each line is there. Nothing in it waits for a future that may not come. Every caller, test and fixture the change reached still works, and the project's tests pass.

## Output

The change itself, and a hand-back that says in a few lines what changed, what you left out on purpose and why, and any risk your lead or the founder must know.

## Check before you hand it over

- Every place on your scope list is done, including the tests and fixtures the change broke.
- The diff holds nothing the task did not ask for.
- No validation, error handling or security check was removed to make the change smaller.
- The hand-back names what you skipped or did not check.

## What needs the founder

Nothing in this skill needs the founder. A change that deletes data, touches security settings, spends money or reaches people outside the project still waits for the approval it always needs. Smaller code never skips an approval.

## If a tool is missing

If you cannot run the tests, say so in the hand-back: the platform runs the task's tests after your session and the result is on the task. If you cannot read part of the codebase, state what you assumed about it.
