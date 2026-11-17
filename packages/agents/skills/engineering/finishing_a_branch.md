---
key: finishing_a_branch
name: Finishing a branch
description: Closes out finished work on a branch with passing checks, a clear pull request and the merge decision handed to the founder.
category: engineering
attribute_name: Branch hand-off
attribute_group: execution
when_to_use: Use when the work on your branch is complete and it is time to open or update the pull request and hand over the merge decision.
roles: backend_engineer, frontend_engineer, integration_agent
default_for:
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: superpowers:finishing-a-development-branch
license_note: MIT, Copyright (c) 2025 Jesse Vincent
improves: release_hygiene, reliability
version: 1
---
# Finishing a branch

## When to use this

Use this when the code for a task is written and you believe it is complete. It takes the work from "written" to "ready for a decision": everything committed, the checks passing on the last commit, a pull request that explains itself, and the founder asked to decide the merge.

It ends there. You never merge, you never approve your own change, and you never write to the default branch. What happens to finished work is the founder's decision.

## Before you start

- Know your branch. You work on `agent/<name>` and nowhere else.
- Know the base: the branch your work started from. Read the repository's default branch from the repository. Do not presume it is called `main`.
- Have the task and its acceptance criteria open, with your rulings and anything you noticed and left alone.
- Check whether a pull request for this branch already exists. If it does, update that one.

## Steps

1. **Check the work against the task.** Go through the acceptance criteria one by one and point to the test or the lines that satisfy each. If one is unmet, the branch is not finished. Go back to the work, or block the task with the reason.
2. **Commit everything to your branch.** One logical change per commit, with a message that says in plain words what changed and why. Leave nothing uncommitted that the change depends on.
3. **Compare your branch with the base.** If the base has moved and it changed files you also changed, say so in the pull request. A conflict that is more than adjacent, non-overlapping lines is not yours to guess at. Report it to your lead with both versions.
4. **Start the project's checks on your last commit and wait for the run to finish.** Start one run. A pending run is not a pass.
5. **Read the result.** The state, each check by name, the counts, and the commit it ran on, which must be the head of your branch.
   - Success: go on.
   - Failure you caused: fix it on the same branch, commit, and run again.
   - Failure that also happens on the base: your change did not cause it. Say so in the pull request, with the test's name. Do not hide it and do not switch the test off.
   - A job that stopped before any test ran: report it. Running it again is the founder's call.
6. **Open the pull request,** as a draft unless you were told otherwise. The title says what the change does. The body follows the format under Output.
7. **Hand over the decision.** Send the founder one message through your hand-off, so it reaches Needs you: the pull request, the state of the checks and the commit they ran on, the review verdict if there is one, and what is not verified. Offer the three outcomes: merge it, ask for changes, or keep the branch for later. You may say which one you recommend and why. The choice is theirs.
8. **Stop.** Leave the branch and the pull request as they are. Review comments get fixed on that same branch.

After the founder decides: if changes are asked for, make them on the branch and return to step 2. If it is merged, complete the task. If the branch is kept, leave it untouched and note where it stands.

Thoughts that lead to a bad finish:

| The thought | What is true |
| --- | --- |
| "The checks passed earlier" | A run proves only the commit it ran on. Run them on the head. |
| "The founder obviously wants this merged" | Then the decision will be quick. It is still theirs. |
| "The pull request is open, so the branch is clutter" | Fixes from review land on that branch. It stays. |
| "That failure is probably a flaky test" | A failing run means the branch is not ready. Report the test by name. |
| "The base is obviously main" | Read it from the repository. |
| "My commit was refused, so I will force it" | A refusal means the branch moved. Find out what changed. Never overwrite someone else's commits. |
| "This work was abandoned, I will remove the branch" | Discarding work is a permanent deletion, and only the founder does that. |

## What good looks like

The pull request for a small booking app:

```
Title: Stop student bookings less than 2 hours before a lesson

What changed: createBooking now refuses a student's booking that starts in
under 120 minutes and returns a message, which the form shows under the
time field. Bookings the teacher enters are not affected.

Why: task T-41. The founder reported students booking ten minutes ahead.

Tested: checks run on 3f2a9c1 (head of agent/t-41) finished with success.
Unit tests 42 passed, 0 failed, 3 new. Typecheck and lint passed.

Not verified: how the message looks on a phone. No browser test covers
the booking form yet.

Rulings: the rule covers student bookings only. Why: the report is about
students booking while the teacher is out. If wrong: one condition, one test.

Noticed, not changed: slots inside the 2 hours still show in the list.
```

The message that goes with it:

```
Pull request #12 is open as a draft from agent/t-41. Checks passed on 3f2a9c1.
Review: approved, no open findings. Not verified: the message on a phone.
The merge is yours to decide: merge it, ask for changes, or keep the branch
for later.
```

A bad finish, for comparison: "All done and merged, tests were passing." The checks ran two commits ago, the pull request body is empty, and the decision was taken away from the founder.

## Output

The pull request body:

```
What changed: two or three sentences
Why: the task or the bug
Tested: which checks ran, on which commit, with what result
Not verified: what you could not check from here
Rulings: each with why and what it costs if wrong, or "none"
Noticed, not changed: anything outside the task
```

The hand-over message: the pull request, the checks and their commit, the review verdict, what is not verified, and the three outcomes.

## Check before you hand it over

- Every acceptance criterion has a test or lines you can point to.
- Everything is committed to `agent/<name>`. Nothing went to the default branch.
- The checks finished on the head commit, and you read the result.
- Any failure is named in the pull request, including one you did not cause.
- The title says what the change does, and every section of the body is filled in.
- "Not verified" lists real gaps.
- The founder has been asked to decide, with the three outcomes.
- You did not merge, approve, force a commit or remove a branch.

## What needs the founder

The merge, always. Also: discarding a branch or its commits, running a failed job again, and anything the pull request needs that sits outside the repository, such as a setting or a secret on the host. Prepare each as a clear request with the exact steps, and wait.

## If a tool is missing

If you have no tool that opens a pull request, hand back the branch name and the full pull request text, and say plainly that no pull request was opened.

If you cannot start the checks, the platform runs the task's tests on your branch after your session ends. Open the pull request as a draft with "Tested: checks pending" and do not describe the branch as passing. Update it when the result is on the task.

If you cannot read the base branch, say that the comparison in step 3 was not done.
