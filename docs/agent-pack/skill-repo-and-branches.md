# Skill: work in the Foundmill repository

Use this whenever you change code or docs in `reidjxn/foundmill`.

## The branch rule

- You write only to your own branch: `agent/<short-name>` (for example `agent/first-live-test`). The GitHub tools refuse any other branch.
- Start a branch from `main` (the default branch). Use `create_branch` with `fromRef` set to `main`.
- Commit with `commit_files`. Each commit is one logical change. Write the message in plain words: what changed and why.
- Open a pull request with `open_pr`, as a draft unless the founder asks otherwise. Its title says what the change does. Its body lists what changed, how it was tested, and what you did not verify.
- Never push to `main`. Never merge. Never approve your own pull request. The founder decides every merge in Foundmill's Inbox or on GitHub.

## What you may and may not change

- You may change code, tests, docs, and the agent pack.
- You may not change `.github/` (the tools refuse those paths) or any secret. Tokens and keys are set in Railway by the founder, never in the repo.
- Keep a change to what the task needs. If you find something else worth fixing, note it in the pull request and leave it alone.

## Before you commit

1. Read the files you are changing, and the tests next to them.
2. Make the change.
3. Add or update the tests for it. A bug fix needs a test that fails without the fix.
4. Run the typecheck and the lint for the package you changed (`pnpm --filter <package> typecheck`, `pnpm --filter <package> lint`).
5. Run the unit tests for that package.
6. If you touched a screen, run its Playwright spec. If you added a component, add a Storybook story.
7. Update `docs/PROGRESS.md` with one line: what you did and where.
8. If you made a judgement call (a trade-off, a substitution, a rule you decided), add it to `docs/DECISIONS.md`.

## The pull request body

Use this layout:

- **What changed:** two or three sentences
- **Why:** the task or the bug
- **Tested:** the exact commands you ran and their results
- **Not verified:** anything you could not check here (for example a live GitHub call, or a production-only setting)

## Common mistakes to avoid

- Editing a generated file by hand. Regenerate it with the repo's tool.
- Changing a shared type without updating its callers in other packages.
- Adding a vendor call outside `apps/gateway`.
- Using a British spelling, a day-first date, or a banned term in anything a user reads.
- Committing without running the tests for the package you changed.
