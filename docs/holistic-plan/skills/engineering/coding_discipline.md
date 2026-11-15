---
key: coding_discipline
name: Coding discipline
description: Keeps a code change small, correct and provable, with every assumption written down and nothing built that the task did not call for.
category: engineering
attribute_name: Coding discipline
attribute_group: judgement # us-english-allow
when_to_use: Use when writing, changing or reviewing code for any task, before the first edit and again before handing the change back.
roles: backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, integration_agent, engineering_lead, review_agent
default_for: backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, integration_agent
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: original, after Andrej Karpathy's observations on LLM coding pitfalls
license_note: original
version: 1
---
# Coding discipline

## When to use this

Use this on every task that changes code: a feature, a fix, a refactor, a config change. Read it before the first edit and again before you hand the change back. A lead or a reviewer uses the same four habits to judge someone else's change.

The habits answer the four ways a model most often goes wrong when it writes code: it guesses what was meant, builds more than was asked, edits things nobody asked it to edit, and stops when the code looks right, before any check has said so. A typo fix still passes through all four. It takes a minute.

## Before you start

Read, in this order: the task (goal, acceptance criteria, file scope), the part of the spec it points to, each file you expect to change with the tests beside it, and two or three neighboring files so you know the project's style.

Then write three lines in the task log before any edit:

```
Goal: one sentence, in the founder's words where the task has them
Done when: the checks that will prove it, by name
Open: what the task, the spec and the code leave unanswered
```

If you cannot fill in "Done when", you do not understand the task yet. Keep reading.

The examples below follow one task. The founder teaches piano and takes lesson bookings through a small app. The task reads: "Students keep booking ten minutes before a lesson, when I am not home. Stop bookings less than 2 hours before the start."

## Steps

### 1. Think before you write

- Look things up before you decide them. The task, the spec, the code and the project's records answer most questions, and an answer you read is a fact you can cite.
- For each line under "Open", write down the readings you can see and what you are assuming. An assumption you keep to yourself is a guess. Two readings that produce different code are a decision, and a decision is never made silently.
- Sort each decision by what it costs to get wrong:
  - It sets a price, a promise or a date, it touches the schema, sign-in or payments, or it could lose someone's data. Block the task with a request to your lead that sets out the readings. That one is your lead's or the founder's to settle.
  - It is small and cheap to reverse. Take the reading the records support best and record a ruling.
- A ruling has three parts: `Ruling: what you decided. Why: the record or code that points there. If wrong: what it costs to change.` It goes in the task log and in the hand-back, where the reviewer and the founder will read it.
- If something simpler than the task describes would meet the goal, say so before you build the complicated version.

Signs you are breaking it: you were editing within a minute of opening the task. A two-sentence task produced a hand-back with no rulings and nothing open. You wrote "presumably" about something a file could have told you.

On the booking task: the code shows the teacher's own page books through the same `createBooking`, marked `by: "teacher"`. The task does not say whether the 2-hour rule covers her, and the two readings differ by one condition. Ruling: students only, because her complaint is about students booking while she is out. Had the task said "charge a late fee", that would be a price, and it would go to the lead.

### 2. Build the smallest change that satisfies the task

- Write the least code that makes the "Done when" checks pass.
- Add nothing speculative: no option, setting, flag, extra column or second code path that the task did not call for.
- Wait for the third real use before you abstract. One function called from one place does not need a class, a layer or a folder.
- Handle the errors a person or a network can cause. Leave out guards for states the code already rules out, such as a null in a column that cannot be null.
- Add no dependency. If one seems essential, block the task with the package name and the reason.
- If the draft runs to 200 lines and 50 would do, rewrite it before anyone reads it.

Signs you are breaking it: "flexible", "extensible", "configurable" or "future-proof" appears in your notes. There are more new files than acceptance criteria. The diff is many times longer than the task's own description.

On the booking task: one comparison inside `createBooking`, one constant (`MIN_LEAD_MINUTES = 120`) and one message returned to the form. No settings screen for the lead time and no rules engine, because the founder asked for one rule with one number.

### 3. Touch only what the task needs

- Every changed line traces to the task. Read your own diff line by line and name the criterion that needed each one. A line with no criterion comes out.
- Match the file you are in: its names, its error style, its formatting, its test layout, even where you would have done it differently.
- Leave the neighbors alone. No reformatting, renaming, reordered imports, rewritten comments or fixes made in passing.
- Tidy only your own leftovers: remove the imports, variables and functions your change made unused. Dead code that was there before you stays.
- When something else looks wrong, put it under "Noticed, not changed" in the hand-back. The lead decides whether it becomes a task.
- Stay inside the task's file scope. If the change cannot be made there, block the task and name the file you need.

Signs you are breaking it: the diff touches files the task never named. It contains hunks that change only whitespace. A reviewer would have to ask why a line changed.

On the booking task: `createBooking` is one long chain of `if` statements you would write differently, and the slot list shows times with no time zone. Neither is the task. The chain stays, your check joins it in the same style, and the time zone goes under "Noticed, not changed".

### 4. Turn the task into a check and loop until it passes

Restate the task as checks that can fail:

| The task says | It becomes |
| --- | --- |
| "Add validation" | Tests for the invalid inputs, written first, then made to pass |
| "Fix the bug" | A test that reproduces the bug, then passes |
| "Refactor this" | The existing tests pass before and after, with no test edited |
| "Make it work on phones" | At 390 px wide nothing scrolls sideways, shown by a browser test or a screenshot |

- For work with several steps, write the plan as pairs: the step, then the check that proves it.
- You have no shell. The checks run on your branch. Start them with the tool that starts the project's checks, wait, and read the result with the tool that reads it. A run that is still pending has not passed.
- Loop: read the first failure, fix its cause, commit, run again. Start one run for each commit you want judged, because every run uses the founder's build minutes.
- Never weaken a check to get a pass. No test is deleted, loosened or switched off to turn a run green.
- After three failed attempts at the same check, stop. Block the task with what you tried and what each run said.

Signs you are breaking it: "should work" or "looks right" in a hand-back. "Done" with no run named. A test edited in the same commit that made it pass.

On the booking task: three tests, written before the change. A student booking 121 minutes ahead succeeds. One at 119 minutes is refused with the message. A teacher booking 30 minutes ahead succeeds, which is the ruling written as a test.

## What good looks like

The same booking task, finished two ways.

The bloated way, 11 files and about 420 lines:

- A new `BookingPolicy` class with pluggable rules, "so more can be added later".
- A settings table and a screen where the lead time can be changed.
- The date library swapped for a different one.
- `createBooking` reformatted, with two variables renamed.
- A guard for a slot with no start time, which the database already forbids.
- No test that names the 2-hour rule.
- Hand-back: "Implemented flexible booking policies. Should work."

It breaks all four habits: the question of which bookings the rule covers was never raised, most of the code serves requests nobody made, the diff rewrites code that worked, and no check proves the rule holds.

The disciplined way, 3 files and 31 lines:

```
Goal: stop student bookings less than 2 hours before a lesson starts
Changed: booking.ts (+9), booking.test.ts (+19), BookingForm.tsx (+3)
Ruling: the rule covers bookings a student makes, not ones the teacher enters.
  Why: the task is about students booking while she is out; teacher bookings
  reach createBooking marked by: "teacher".
  If wrong: one condition and one test.
Checks: run on commit 3f2a9c1 finished with success. 42 tests passed, 3 new:
  books at 121 minutes, refused at 119 minutes, teacher books at 30 minutes.
  Typecheck and lint passed.
Not covered: how the refusal message looks on a phone.
Open: none
Noticed, not changed: slots inside the 2 hours still show in the list;
  times show no time zone.
```

## Output

Hand back these lines, in this order:

```
Goal: the sentence from the task log
Changed: each file, with lines added and removed
Rulings: each with Why and If wrong, or "none"
Checks: which run, on which commit, its state, what passed, what is new
Not covered: what those checks do not exercise
Open: anything blocked or waiting on your lead, or "none"
Noticed, not changed: what you saw outside the task
```

A lead or reviewer using this skill on someone else's change returns findings under the four habit names, each with the file, the line and the smallest fix.

## Check before you hand it over

- The task log has Goal, Done when and Open, written before the first edit.
- Every decision is a ruling in the hand-back or a request that went to your lead. None was made silently.
- Every changed line traces to an acceptance criterion, and no file outside the task's scope changed.
- Nothing was added "for later": no unused option, parameter, column or abstraction.
- The diff matches the style of the files around it, and the only code removed is code your change made unused.
- Each acceptance criterion has a named check, and the hand-back states the run, the commit and the result.
- No test was deleted, loosened or switched off.
- "Should", "probably" and "seems" do not appear in the hand-back.

## What needs the founder

The founder decides every merge. You open the pull request and hand it over. You never merge, and you never approve your own change.

A ruling is a small, reversible choice, and the founder sees each one in the hand-back. Anything that sets a price, a date or a promise to customers, changes the schema or sign-in, touches payments, adds a dependency or could lose data goes to your lead before you build it.

## If a tool is missing

If you have no tool that starts the checks, the platform runs the task's tests on your branch after your session ends and puts the result on the task. Write the tests, finish, and say in the hand-back that the run has not happened yet and which tests it should show. Never describe a run you did not read.

If you cannot read the spec or a record the task points to, list it under "Open" and build only the part the task and the code settle.
