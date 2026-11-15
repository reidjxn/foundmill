---
key: splitting_work
name: Splitting work across agents
description: Divides work into independent tasks, briefs each agent with exactly what it needs, and checks that the results fit together.
category: engineering
attribute_name: Work splitting
attribute_group: judgement # us-english-allow
when_to_use: Use when work has two or more parts that could go to different agents, or when several unrelated failures need fixing at once.
roles: engineering_lead, planner, chief_of_staff
default_for: engineering_lead
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: superpowers:dispatching-parallel-agents, superpowers:subagent-driven-development
license_note: MIT, Copyright (c) 2025 Jesse Vincent
version: 1
---
# Splitting work across agents

## When to use this

Use this when a plan has several tasks to staff, or when several things are broken at once and you have to decide whether they are one problem or many.

You do not start helper agents of your own. You split work into tasks on the task board and assign them to agents already on the team. Each one works alone, in its own session and on its own branch, and knows only what its task says, so the task has to carry everything that agent needs.

Keep the work with one agent when:

- The failures may share a cause. Fixing one could fix the others, so one agent looks first.
- Nobody knows yet what is broken. Exploration does not split.
- The parts would change the same files.
- Understanding any part needs the whole picture.

## Before you start

Read the plan or the list of failures, with the actual error text. Check who is on the team and which worker types they are. Check the limits you work inside: how many agents may work at once, the budget, and the file scope of every task that is already running.

## Steps

1. **Group the work by what it touches.** For failures, group by what is broken. For a plan, group by area and by file.
2. **Test each group for independence.** Can it be understood without the others? Does it change different files? Does it avoid shared state such as one migration, one config file or one generated file? Three yes answers make it independent.
3. **Choose the order.** Independent groups can run at the same time, inside the limit on agents working at once and the budget. Groups that share a file, or where one needs another's output, run one after the other with an edge between them on the board. Two tasks never edit the same file at the same time.
4. **Write each task so it stands alone.** The assignee has none of your context. A task holds:
   - Where it fits, in one line.
   - The goal, in one sentence.
   - The scope: the files it may change, and what it must leave alone.
   - The context: the exact error messages and test names, or the exact names and types it consumes from earlier tasks. Paste them. A summary loses the detail that matters.
   - The limits that prevent the easy wrong answer, such as "find the cause; do not lengthen the timeout".
   - Done when: the checks that prove it.
   - Hand back: what the report must contain.

   Leave out the history of the session. One task describes one task.
5. **Match the task to the worker.** Use the worker type that fits the files. Mark a task as hard only for code that runs in parallel, security, data migration or unclear requirements, and write down why, because hard tasks cost the founder more.
6. **Assign through the board and keep a ledger.** One line per task in your task log: the task, the assignee, the branch, the state. Keep the record there and in the branches, because your memory of a long session will not hold it.
7. **While they work, answer requests fully and read blocked reasons.** Settle small, reversible questions yourself and record each as a ruling: what you decided, why, what it costs if wrong. Four things go up to the founder through Needs you and are never settled by a ruling: anything destructive or impossible to undo, anything that touches security, anything with an effect outside the project such as a merge or a publish, and a plan so broken that every way forward is a guess.
8. **When a task comes back, read the work as well as the report.** Open the diff and the result of the checks on the branch. A report of success is a claim until you have read both.
9. **Send each finished task to review before a task that depends on it starts.** Findings go back to the same assignee, who still has the context. If the third round of fixes has not closed them, stop sending it back: re-plan the task or reassign it, and record why.
10. **Check the pieces fit together.** Look for two tasks that touched the same file after all, two versions of the same helper, a name used two ways. Read the checks on the combined work. Sample the diffs for one mistake repeated by every agent, which happens when the tasks shared a flawed line.
11. **Report what is ready.** Each branch with its pull request, its checks and its review verdict, and what is still open.

Mistakes that make a split fail:

| Mistake | What happens | Instead |
| --- | --- | --- |
| "Fix all the failing tests" | The agent wanders | One file or one area per task |
| "Fix the race condition" | The agent does not know where | Paste the test names and messages |
| No scope | The agent refactors what it finds | "Change only src/reminders/" |
| "Fix it" | You cannot tell what changed | "Hand back the cause and the files changed" |
| Two tasks, one file | The second overwrites the first | An edge between them |

## What good looks like

Six tests fail in three files of a lesson-booking app after yesterday's merge: three in `booking.test.ts`, two in `reminder.test.ts`, one in `calendar-export.test.ts`.

First question: one problem or three? All three files import the date helper that yesterday's merge changed. They may share a cause, so this is one task for one agent, starting with the helper.

A different morning, three failures with nothing in common: a validation test on the signup form, a text-encoding test on the export, a broken link in the footer. Different files, different causes, no shared state. Those are three tasks, and they can run at the same time. One of them:

```
Task: Fix the 2 failing tests in src/reminders/reminder.test.ts
Where it fits: reminders go out the evening before a lesson. Nothing else
  depends on this folder.
Failing:
  "queues a reminder for tomorrow's lesson": expected 1 queued, received 0
  "does not queue for a canceled lesson": expected 0, received 1
Scope: change only src/reminders/. Leave the tests' expected values as they
  are; if a test itself is wrong, say why before changing it.
Limits: find the cause first. Do not lengthen a timeout to get a pass.
Done when: both tests pass and the rest of the checks still pass.
Hand back: the cause in one sentence, the files changed, the run you read,
  and anything not verified.
```

## Output

```
Split:
  Task | Worker type | Files | After | Can run with | State
Ledger: one line per task: assignee, branch, state, review verdict
Rulings: each with why and what it costs if wrong
Kept together: work you did not split, and the reason
Open: blocked tasks, questions for the founder
```

## Check before you hand it over

- Each task passed the three independence questions, or has an edge to the task it depends on.
- No two tasks that can run together share a file.
- Every task reads complete to someone with no other context: goal, scope, pasted context, limits, done when, hand back.
- The number of agents working at once and the spend stay inside the limits you were given.
- For each returned task you read the diff and the checks yourself.
- Every finished task has a review verdict.
- The combined work was checked for collisions and for one repeated mistake.
- The ledger matches the board.

## What needs the founder

Merges are the founder's decision, one pull request at a time or together, as they choose. So is adding an agent to the team, which costs money: put it to them with a cost Estimate, and offer running the tasks in order as the free alternative. If the work does not fit the limit on agents working at once or the budget, run it in order and tell the founder how long that takes, labeled Estimate. Never go past either limit.

## If a tool is missing

If you cannot create or assign tasks, hand the split to your lead or the Chief of Staff as text in the format above, and say that nothing was assigned.

If the team has one agent of the type the work needs, the tasks run in order. Say so, with the Estimate.

If you cannot read a branch's diff or checks, do not mark its task as done. List it under Open as "not verified".
