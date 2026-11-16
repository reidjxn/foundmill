---
key: test_first
name: Tests first
description: Writes the test before the code, so each new behavior has a check that was seen to fail and then seen to pass.
category: engineering
attribute_name: Test-first work
attribute_group: craft
when_to_use: Use when adding a feature, fixing a bug or changing how code behaves, before writing any of the code the change needs.
roles: backend_engineer, frontend_engineer, data_engineer, qa_engineer
default_for: backend_engineer, frontend_engineer
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: superpowers:test-driven-development
license_note: MIT, Copyright (c) 2025 Jesse Vincent
improves: testing, test_design
version: 1
---
# Tests first

## When to use this

Use this for every new behavior, every bug fix and every change to how existing code behaves. Use it for a refactor too: the tests exist and pass before you move anything.

A test written after the code passes the first time it runs, and a test that has never failed has not shown it can catch the break. Written first, it starts out failing for a reason you can name.

Config files and generated code do not need a test of their own. If you think a task is another exception, put the reason in a request to your lead before you write code without a test.

## Before you start

- Read the acceptance criteria. Each one becomes at least one test.
- Find how this project tests: where test files sit, which runner it uses, how tests are named, what fixtures exist. Match all of it.
- Know how tests run for you. You have no shell. Tests run in the project's checks, on your branch, and you read the result. If you have a tool that starts the checks, you can get a failing run and a passing run. If you do not, the platform runs the task's tests after your session ends.
- For each test, before writing its body, name the break it catches: the wrong change to the code that would make this test fail. If you cannot name one, it is not a test yet.

## Steps

1. **Write one test for one behavior.** The name says what the code does: "refuses an empty email". If the name needs "and", split it into two tests.
2. **Work out the expected value by hand.** Use a literal: `"Enter your email address"`, `120`, a small fixture you checked yourself. An expected value computed by the code under test, or by its helpers, passes whatever that code does.
3. **Test the real code.** Replace only what is slow or outside the project: the network, the clock, a payment or mail provider. Assert what your code did, never what a stand-in was told to return. If the stand-ins take more lines than the test, use the real parts.
4. **Predict the failure in writing.** In the task log: which assertion fails, with what message, and why. "Fails with `expected "Enter your email address", received undefined`, because `joinWaitlist` has no check for an empty email." The right failure is the missing behavior. A typo or a bad import is the wrong one.
5. **Commit the test on its own, before the code.** The order is then visible in the branch history to the reviewer and the founder.
6. **See it fail.** For a bug fix, and for anything that touches sign-in, payments or stored data, start the checks on the test commit and read the result. The new test must fail with the message you predicted, and the others must pass. If it passes, it tests something the code already does, so fix the test. If it errors before it reaches the assertion, fix that and run again. For other changes one run at the end is enough, because each run uses the founder's build minutes. Your written prediction then stands in for the failing run, and the hand-back says so.
7. **Write the least code that passes.** No options the test does not ask for, no tidying of other code.
8. **Run the project's whole set of checks and read the result.** Your new tests appear by name and pass. Every other test still passes. A failure you did not cause still goes in your report, by name. If your test fails, change the code, never the test.
9. **Tidy while the tests pass.** Remove duplication, fix names, pull out a helper. Add no behavior. If you changed code after the passing run, run again.
10. **Take the next behavior and start at step 1.**

Rules that keep a test honest:

| Rule | Good | Bad |
| --- | --- | --- |
| Test behavior, not a setting | "a failed call is retried 3 times and a 4th never happens" | `expect(MAX_RETRIES).toBe(3)` |
| Test your code, not the framework | The response your route returns for a bad input | That the router calls a handler you registered |
| Stand-ins mirror the real thing | A fake response with every field the real one has | A fake with only the two fields this test reads |
| Test-only helpers stay in test files | A cleanup function in the test utilities | A `reset()` method added to the real class for tests |
| Wait for conditions | Wait until the row appears | Sleep 500 ms and hope |

Before you finish, change the code in your head, one realistic mistake at a time: a wrong constant, the wrong branch taken, a side effect left out, an empty return, no check on empty or unauthorized input. At least one test should fail for each. A mistake that no test catches is behavior you have not protected.

When you catch yourself reasoning like this, go back to step 1:

| The thought | What is true |
| --- | --- |
| "It is too simple to test" | Simple code breaks too, and the test takes a minute. |
| "I will add tests after" | Tests written after check what you built. They pass at once, which shows nothing. |
| "I already wrote the code" | Take it out of the change, write the test, then write the code again from the test. Keeping it open beside you is testing after. |
| "The test is hard to write" | Code that is hard to test is hard to use. Simplify the interface. |
| "This file has no tests yet" | Add one for the behavior you are changing. |

## What good looks like

A week-one project has a waitlist page. The bug: the form accepts an empty email.

The test, committed first as `test: waitlist refuses an empty email`:

```ts
test("refuses an empty email", async () => {
  const result = await joinWaitlist({ email: "   " });
  expect(result.error).toBe("Enter your email address");
});
```

Prediction in the task log: fails with `expected "Enter your email address", received undefined`. The run on that commit: 1 failed with that message, 17 passed.

The code, committed second:

```ts
if (!input.email.trim()) return { error: "Enter your email address" };
```

The run on the second commit: 18 passed.

## Output

Add these lines to your hand-back:

```
Tests added: each test's name, its file, and the break it catches
Failing run: the commit and the failure message, or "predicted, not run" with the predicted message
Passing run: the commit, the state of the run, totals, new tests by name
Other failures: any test that fails and that you did not cause, by name
Not tested: any behavior left without a test, and why
```

## Check before you hand it over

- Every new behavior has a test, committed before the code that satisfies it.
- Each test failed for the reason you predicted, or the hand-back says the failure was predicted and not seen.
- Expected values are literals or hand-checked fixtures.
- No assertion checks a stand-in.
- You read the result of the whole set of checks, and your new tests are in it by name.
- No test was deleted, loosened or switched off to get a pass.
- For each realistic mistake in the new code, at least one test would fail.
- The change holds only the code the tests needed.

## What needs the founder

Writing tests needs nothing from the founder. Tests use the project's test data and the test mode of any outside service, so a test never emails a real person and never charges a real card. The merge of your branch is the founder's decision.

If a criterion cannot be tested as written, block the task with a request to your lead that says what you would need.

## If a tool is missing

If you cannot start the checks, the platform runs the task's tests on your branch after your session ends and puts the result on the task. Commit the test first and the code second anyway. In the hand-back write "Failing run: predicted, not run" and "Passing run: pending". Never write that the tests pass.

If the project has no test runner, adding one is a new dependency. Block the task with a request to your lead that names the smallest runner that fits the stack and what it costs. Most are free.
