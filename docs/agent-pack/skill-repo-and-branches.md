---
name: foundmill-repo-and-branches
description: The repository and branch rules for reidjxn/foundmill. Use whenever you change code or docs in the repository, from the first commit on an agent/<task> branch to the pull request the founder decides on.
---

# Skill: work in the Foundmill repository

Use this whenever you change code or docs in `reidjxn/foundmill`. Sources: `docs/agent-pack/00-handover.md` ("The rules that matter most"), the plan's "Engineering workflow" section (`docs/foundmill-plan/foundmill-plan.md`), and the GitHub tools in `packages/connectors/src/connectors/github/tools.ts`.

## How a change reaches production

1. The Engineering Lead turns a Now roadmap item into tasks with acceptance criteria and assigns them.
2. You read the code you need through the GitHub tools, make the change in your session, and commit it to the task's own branch, `agent/<task>`, with `commit_files`.
3. The QA Engineer or the Engineering Lead starts CI on that branch with `run_checks`, and reads the result with `get_checks` (see the checks skill).
4. When `get_checks` reports `success`, you open a pull request to `main` with `open_pr`.
5. The Review Agent reviews the pull request before it reaches the founder.
6. The founder approves the merge in the Inbox or on GitHub. That is the only way a change gets into `main`.
7. A push to `main` deploys the web app on Vercel and the services on Railway. The api applies migrations when it boots (`docs/DEPLOY.md`).

Agents do not deploy production. There is no deploy connector yet. When it is built, it will deploy only the production service, only from `main`, and only after CI has passed for that exact commit (handover, "Where production stands").

## The branch rule

- You write only to an `agent/` branch, named after your task: `agent/<task>`. The GitHub tools refuse `main` and any branch outside `agent/`.
- Branch from `main` (the default branch). `commit_files` creates the branch from `main` if it does not exist yet. You can also create it first with `create_branch`.
- Each commit is one logical change. Write the message in plain words: what changed and why.
- Never push to `main`. Never merge. Never approve your own pull request. Every merge into `main` is the founder's decision, whoever is delegated.

## What you may and may not change

- You may change code, tests, docs and the agent pack, but only the files in your task's scope.
- The tools refuse every path under `.github/`. If `.github` on your branch differs from `main`, `run_checks` refuses to start.
- Secrets live in Railway variables and nowhere else. They never appear in the repository, in a pull request or in a message.
- Keep the change to what the task needs. If you find something else worth fixing, note it in the pull request and leave the code as it is.

## Before you commit

1. Read the files you are changing and the tests next to them, through the GitHub tools. Your session starts from an empty workspace or from the task's last saved files, not from a checkout of the repository.
2. Make the change.
3. Add or update its tests. A bug fix needs a test that fails without the fix.
4. Run whatever checks your workspace allows (`pnpm --filter <package> typecheck`, `lint`, `test`). What you could not run here is covered by CI on the branch. List it under "Not verified".
5. If you touched a screen, add or update its Playwright spec. If you added a component, add a Storybook story. If you added agent behavior, add an eval.
6. Add one line to `docs/PROGRESS.md`: what you did and where.
7. If you made a judgment call (a trade-off, a substitution, a rule you decided), record it in `docs/DECISIONS.md`.

## The pull request

Open it only after `get_checks` reports `success` for your branch's head commit. `open_pr` opens a draft by default, so leave it as a draft unless the founder asks otherwise. The title says what the change does. The body follows this layout:

- **What changed:** two or three sentences
- **Why:** the task or the bug
- **Tested:** the exact checks that ran (including the CI run) and their results
- **Not verified:** anything you could not check here, for example a live GitHub call or a production-only setting

## Common mistakes to avoid

- Editing a generated file by hand. Regenerate it with the repository's tool.
- Changing a shared type without updating its callers in other packages.
- Adding a vendor call outside `apps/gateway`.
- Using a British spelling, a day-first date or a banned term in anything a user reads.
- Opening the pull request before the checks have passed on the head commit.
