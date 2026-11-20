---
key: implementation_plans
name: Implementation plans
description: Turns a spec or roadmap item into small ordered tasks, each with exact files, interfaces and the tests that prove it is done.
category: engineering
attribute_name: Implementation planning
attribute_group: craft
when_to_use: Use when a spec, roadmap item or multi-step request has to become tasks that other agents can build without guessing.
roles: planner, engineering_lead
default_for: planner
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: superpowers:writing-plans
license_note: MIT, Copyright (c) 2025 Jesse Vincent
improves: task_decomposition, acceptance_criteria, dependency_mapping
version: 1
---
# Implementation plans

## When to use this

Use this when you have a spec or a roadmap item that takes more than one step to build, before anyone writes code. A one-file fix does not need a plan.

Write for an engineer agent who has never seen this codebase or this spec. Assume they write good code once they know the exact interface and the exact test, and that they will make a reasonable choice wherever the plan leaves one open. What they cannot know is what you decided: which files, which names and types, which values from the spec, which tests prove each task. A plan is that set of decisions.

## Before you start

- Read the whole spec item, including the parts that look obvious.
- Read the repository: its layout, its naming, where tests sit, which modules already do part of the work. Reuse before you add.
- Check which worker types the team has, and the project's finished tasks, which are your best basis for estimates.
- Check the scope. If the item covers several independent parts, write one plan per part. Each plan should leave working, testable software behind.
- List what the spec does not answer. Those are questions for the founder, sent through your lead. Never settle one by writing your preferred answer into a task.

## Steps

1. **Map the files first.** List every file to create or change and what each is responsible for. One responsibility per file. Files that change together live together. Follow the patterns the codebase already has, even where you would lay it out differently.
2. **Draw the task boundaries.** A task is the smallest unit that carries its own test and that a reviewer could accept or reject on its own. Fold setup, config and docs into the task that needs them. A task one agent cannot finish in about 4 hours is two tasks.
3. **Give schema, sign-in and payment changes their own tasks,** each with "ask before changing" in its criteria.
4. **Write each task in full** (the format is under Output): the goal, the exact files, what it consumes from earlier tasks and what it produces for later ones, the tests by name with the spec's exact values, the worker type and an estimate.
5. **State interfaces exactly.** Function names, parameters, return types, error values. The agent on Task 3 sees only Task 3, and the "consumes" and "produces" lines are how it learns the names its neighbors use.
6. **Order the tasks.** Add an edge wherever one task needs another's output. Add an edge between any two tasks that change the same file, so they never run at the same time. Check there is no round of work.
7. **Put the test before the code inside every task:** write the failing test, write the code, run the checks, commit.
8. **Copy the global constraints once, word for word from the spec:** version floors, naming and copy rules, "works at 390 px wide", limits on dependencies. Every task inherits them.
9. **List what no test covers yet.** Under "Review focus", name up to five inputs or conditions the spec implies but no task's test exercises, most likely first: the same email twice, an empty list, a double click, a slow network. A spec's silence on an input is not permission to break on it. Add a test for each to the task that owns the code.
10. **Review your own plan** with the checklist below and fix what you find.
11. **Hand it over.** Create the tasks on the board if you have the tool for it, and give your lead the plan with its risks and the questions for the founder.

What each kind of step holds:

| Step | Holds | Leaves out |
| --- | --- | --- |
| A test | Its name and its assertions, with the spec's exact values | Vague lines such as "write tests for the above" |
| Code | The signature, the file and the values the spec fixes | The body, unless the signature and tests leave the algorithm open |
| A check | Which checks must pass and what result means done | "Make sure it works" |
| A reference to another task | That task's "produces" line | A copy of that task's code |

A step is finished when the assignee can write exactly one reasonable thing from it. Lines that decide nothing ("TBD", "handle edge cases", "add validation as needed") are gaps. A function body the signature and tests already determine is the opposite fault: the plan has started writing the program.

## What good looks like

Roadmap item: "Visitors can join a waitlist from the project page, and the founder can see who joined."

```
Plan: Waitlist
Goal: a visitor leaves an email on the project page; the founder sees the list.
Spec: product spec, "Waitlist"
Constraints: emails stored in lowercase; the form works at 390 px wide;
  copy in sentence case; no new dependency
Review focus: the same email twice; spaces around the email;
  300 characters in the field; the list with nobody on it

Task 1: Store a waitlist entry
  Worker: backend_engineer    Estimate: 1 hour    After: none
  Files: create src/waitlist/store.ts, src/waitlist/store.test.ts
  Produces: addEntry(email: string):
    Promise<{ ok: true } | { ok: false; error: "invalid" | "duplicate" }>
  Done when these tests pass:
    "stores a new email in lowercase": addEntry(" Ana@Example.com ") saves "ana@example.com"
    "refuses the same email twice": the second call returns error "duplicate"
    "refuses an email with no @": returns error "invalid"
  Ask before changing: this task adds a table. Confirm the schema with the lead first.

Task 2: Form on the project page
  Worker: frontend_engineer   Estimate: 2 hours   After: Task 1
  Files: change src/pages/index.tsx; create src/waitlist/Form.tsx, e2e/waitlist.spec.ts
  Consumes: addEntry
  Done when these tests pass:
    "a visitor joins the waitlist": after submit the page shows "You are on the list"
    "an empty email shows the reason": "Enter your email address" under the field
    "the form fits a phone": at 390 px wide nothing scrolls sideways

Task 3: The founder's list
  Worker: frontend_engineer   Estimate: 1 hour    After: Task 2 (both change src/pages)
  ...

Questions for the founder:
  Should joining send a confirmation email? The spec does not say, so no task plans one.
```

Task 3 waits for Task 2 although it does not need its output, because both change files under `src/pages`.

## Output

One plan, in this shape:

```
Plan: name
Goal: one sentence
Spec: where the requirement lives
Constraints: the spec's project-wide rules, exact values
Review focus: up to five untested inputs, most likely first
Task N: name
  Worker, Estimate (labeled Estimate), After
  Files: create, change, test, with exact paths
  Consumes / Produces: exact names and types
  Done when these tests pass: test names with exact values
  Ask before changing: any schema, sign-in or payment change
Risks: what could make this plan wrong
Questions for the founder: each thing the spec does not answer
```

## Check before you hand it over

- Coverage: for each requirement in the spec you can point to the task that builds it.
- Each step lets the assignee write exactly one reasonable thing. No "TBD", no "as needed".
- Names and types match across tasks. `addEntry` in Task 1 is not `createEntry` in Task 2.
- Every task has at least one criterion a test can check, and fits in about 4 hours.
- Tasks that share a file are joined by an edge, and the graph has no round of work.
- Every review-focus line has a test in the task that owns the code.
- Proportion: if the plan is several times longer than the spec, or is mostly code blocks, replace bodies with signatures and test names.
- No task contains a requirement the spec does not. Uncertainty is a question, never a hidden choice.
- Every estimate is labeled Estimate.

## What needs the founder

The founder answers the questions the spec leaves open. Do not start a task that depends on an unanswered one. Anything that costs money, such as a paid service the plan would rely on, is put to the founder with a cost Estimate and a free alternative first. Schema, sign-in and payment tasks carry their "ask before changing" line so the decision reaches the founder at the right moment.

## If a tool is missing

If you cannot create tasks on the board, hand the plan to your lead as text in the format above and say that no tasks were created.

If you cannot read the repository, plan from the spec alone, mark every file path "proposed", and say so at the top of the plan.
