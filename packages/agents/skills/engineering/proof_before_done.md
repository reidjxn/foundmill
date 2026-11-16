---
key: proof_before_done
name: Proof before saying done
description: Checks every claim that work is done, fixed or passing against a result that was read, and reports what that result does not cover.
category: engineering
attribute_name: Proof of done
attribute_group: execution
when_to_use: Use when about to say a task is done, a bug is fixed or the checks pass, in a commit message, a pull request, a report or a hand-back.
roles: backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, integration_agent, review_agent, engineering_lead
default_for: backend_engineer, frontend_engineer, qa_engineer, review_agent
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: superpowers:verification-before-completion
license_note: MIT, Copyright (c) 2025 Jesse Vincent
improves: testing, test_design, reliability
version: 1
---
# Proof before saying done

## When to use this

Use this before any statement about the state of work: done, fixed, passing, ready, working, green. It covers softer wording that implies the same thing, and it covers what you repeat from another agent's report.

The moments it applies: completing a task, opening or updating a pull request, handing work to review, moving to the next task, and, for a lead or reviewer, accepting someone else's "done".

The rule: no claim without evidence you read in this session, from a tool result, about the code as it is now.

## Before you start

List the claims you are about to make. A typical hand-back holds four or five: the criteria are met, the tests pass, the bug is gone, nothing else broke, the page works on a phone. Each one needs its own proof. One passing check does not carry the others.

Know what does not count as evidence:

- A result from before your last commit. It judged different code.
- A run that is still pending.
- A simulated or sample tool result. A simulated result is not an action and not a proof. Label it "simulated".
- Another agent's report that it succeeded.
- Your own confidence, or how the code reads.

## Steps

1. **Name the claim.** One sentence: "The waitlist form refuses an empty email."
2. **Name the proof.** Which result would show exactly that? Use the table below. If the only proof you can name is weaker than the claim, weaken the claim.
3. **Get the result.** Start the project's checks on your last commit if you have the tool for it, and wait until the run has finished. Start one run per commit. Do not start another to see whether a failure goes away.
4. **Read all of it.** The state of the run, each check by name, the counts of passed and failed, and the commit it ran on. That commit must be the head of your branch.
5. **Compare it with the claim.** If the result confirms it, state the claim with the evidence beside it. If it does not, state what is true, with the evidence.
6. **Say what the result does not cover.** Every set of checks has gaps. Name the ones that matter for this change.
7. **Only then write the hand-back.**

| Claim | What proves it | What does not |
| --- | --- | --- |
| The tests pass | The finished run on your head commit lists the tests, with 0 failed | An earlier run, a run on another commit, "should pass" |
| The code is correct | Tests that exercise the behavior pass | A passing typecheck or lint. Types show the pieces fit together. They do not show the code does the right thing |
| The bug is fixed | A test of the original symptom failed before the fix and passes after | The code changed and reads right |
| The criteria are met | Each criterion checked one by one against a test or a result | "The tests pass" |
| The page works on a phone | A browser test or a screenshot at 390 px wide | Reading the styles |
| Nothing else broke | The whole set of checks ran, not only your file | Your new test passing |
| Another agent finished | Its diff and its checks, read by you | Its report |
| It was sent, published or merged | The tool result that says so | A plan to do it, or a simulated result |

Gaps worth naming, when they apply: no test loads the page in a browser; the mail or payment provider was a stand-in in tests, so delivery was not exercised; nothing ran against real volumes of data; no check looked at keyboard use or contrast; the change was not seen on the live site.

Wording that means you have not verified: "should", "probably", "seems", "I believe", "looks good". So does any sign of relief before a run has finished.

| The thought | What is true |
| --- | --- |
| "It should pass now" | Start the run and read it. |
| "The typecheck passed" | That is one check. Say which others ran. |
| "It passed before my last commit" | That run judged other code. |
| "The other agent reported success" | Read its diff and its checks yourself. |
| "The run is nearly finished" | Pending is not a pass. Report it as pending. |
| "It is a small change" | Small changes break things too. |
| "The failure is probably a flaky test" | A failing test is a fact about the code. Report it by name. |

## What good looks like

A hand-back that claims without proof:

> Fixed the signup bug and all tests pass.

The same work, with proof:

```
Claim: the waitlist form refuses an empty email.
Proof: checks run on a41c9e2 (head of agent/t-18) finished with success.
  Unit tests: 58 passed, 0 failed, including the new "refuses an empty email",
  which failed on the test-only commit 9d0f3b7 with
  'expected "Enter your email address", received undefined'.
  Typecheck and lint passed.
Not covered: no browser test submits the form. The welcome email is a
  stand-in in tests, so delivery was not exercised.
Status: done
```

And when the result says no:

```
Claim: none yet.
Proof: checks run on a41c9e2 finished with failure. 57 passed, 1 failed:
  "shows the waitlist count" expected 12, received 11.
  The same test fails on the default branch at 77b03de, so this change
  did not cause it.
Status: not done. The failing test is reported to the lead.
```

## Output

For each claim in a hand-back, a pull request or a report:

```
Claim: one sentence
Proof: the run or tool result, the commit, the state, the checks by name with counts
Not covered: what that proof does not exercise
Status: done, not done, or pending
```

Several claims proved by the same run can share one Proof line.

## Check before you hand it over

- Every claim has a proof you read in this session.
- The run you cite finished, and it ran on the head commit of your branch.
- You named each check that ran. A typecheck is not presented as proof of behavior.
- "Not covered" is filled in, with real gaps.
- No simulated result is presented as something that happened.
- Any failing test is reported by name, including ones you did not cause.
- The words "should", "probably" and "seems" are gone.
- Anything unfinished is labeled "not done" or "pending".

## What needs the founder

The founder decides the merge, and reads "Not covered" to decide it.

If a job stopped before any test ran (a download timed out, the runner was lost), say so. Running it again is the founder's call. Say so too when a claim can only be proved on the live site or with a real account or payment. That check is the founder's to make.

## If a tool is missing

If you cannot start the checks, the platform runs the task's tests on your branch after your session ends. Your status is "pending", and the hand-back names the tests the run should show.

If you cannot see screenshots or a browser result, say the page was not looked at. Reading the styles is not a look.

In both cases the work may be right. You have not shown it yet, so say that.
