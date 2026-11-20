---
date: 2026-11-19
branch: claude/guidance-host-flake
title: The guidance-host test waits for the render instead of reading it at once
areas: [web, tests]
supersedes: []
---
## What changed
`guidance-host.test.tsx` ("writes no second answer when the API's equals the optimistic one") read the rendered probe
right after `act`. React Query tells its readers on a later macrotask (`notifyManager`'s `setTimeout`), which `act` does
not always flush on a loaded runner, so the probe still showed the state from before the save. The test now waits for
the render with `waitFor`, as the file's other save tests already do. It failed on three unrelated pull requests on
Nov 19 (#300, #335, #336) and passed on the laptop and in the nightly run.

## Decisions
### Only the test changes
The component's behavior is right: the cache holds the server's time, and the count of cache writes is asserted
first. The race is only in when the test reads the screen.

## Not done
- Proof: the providers tests run 8 times under CPU load on the laptop failed once before the change (the CI error
  exactly) and 16 times with no failure after it. CI itself is the final check.
