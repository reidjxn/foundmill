---
name: ship-change
description: Commit, push and open a pull request for a finished Foundmill change without colliding with other sessions. Use after verify-done passes.
---

# Ship a change

1. Rebase or merge `origin/main` into the branch and re-run the checks it affects.
2. Re-check overlap (step 2 of `plan-change`): branches can merge while you work.
3. Commit one logical change per commit, message in plain words: what and why. No secrets, no model ids in messages.
4. Push only your own branch. Never push to `main`, never merge by hand, never approve your own PR. A pull request that is not a draft merges itself (squash) once the required checks pass: run `gh pr merge <n> --auto --squash` after opening it (founder, Nov 19, 2026; the `auto-merge` workflow also does it for `claude/*` branches). Open a draft when the change must wait.
5. Every push to a PR starts paid builds (Vercel previews, CI minutes): push once when ready, not after every edit.
6. Open the PR with: **What changed**, **Why**, **Tested** (exact commands and results), **Not verified**. If a coordinating session runs a merge queue, tell it the PR, its migrations and anything it must merge after.
7. A change to a procedure or event that the mobile backend skill names (`docs/mobile/skills/foundmill-backend/SKILL.md`) updates the skill in the same pull request; `apps/api/src/__tests__/mobile-contract.test.ts` fails otherwise.
