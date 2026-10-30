# PR note: fix stale package-scope rename step in docs/BUILD_RUNBOOK.md

Task: 8752a67a-9662-4b64-b5d7-4ffea8214f48 (working note for the PR description; not a repository file, do not commit)

## Issue
- File: `docs/BUILD_RUNBOOK.md`, line 18 (section "## Waves", bullet "**Rename**"), blob sha 13beacf50e9b7fa62de31fb3973a808d2c32ef75 at reidjxn/foundmill HEAD (first read at root tree 7cb25b43a440ab68cba22d70448594044bd009e8; checked again Oct 27, 2026 at root tree dbff88a895829688d37780a41cd025827d57249d, same blob and same line 18; read audit 02a5f9f4-cfc3-44ff-8243-252dfe7e1439).
- Current text:
  > - **Rename**: between waves, rename the package scope `@foundmill/*` → `@foundmill/*` (sed over package.json, imports, tsconfig paths, Dockerfile, docs) and run `pnpm install`.
- The source and target scopes are the same, so the step renames nothing. Root `package.json` (blob sha 712184470ca5daa67f2dc585295dda106d62c863) already uses `@foundmill/*` throughout (`@foundmill/db`, `@foundmill/e2e`, `@foundmill/evals`, `@foundmill/dugout`), so the rename is done and the instruction is stale.
- Risk if left: a session that follows the runbook could run a pointless repo-wide sed between waves. That also cuts against ground rule 6 in the same file (line 11: "Never rename the package scope mid-wave.").

- Re-checked Oct 30, 2026 against the working checkout of main at commit 730c456: line 18 and line 11 text unchanged; all 25 workspace `package.json` files (apps/*, packages/*, e2e, evals) are named `@foundmill/*`; no root `README.md` (only `apps/web/e2e/README.md`, `infra/e2b/README.md`).

## Intended change (one line, documentation only)
Replace line 18 with:
> - **Package scope**: the scope is `@foundmill/*` and the rename is complete; do not rename it again (see ground rule 6).

## Scope check
- Touches only `docs/BUILD_RUNBOOK.md`, inside the task's file scope `docs/`.
- No code, config, CI, lockfile or package.json changes.
- The original pre-rename scope name is not in the files read, so the new text does not name it (nothing invented).
- `docs/PROGRESS.md` gets its entry under task 355d9518 ("Record the engineering loop in docs/PROGRESS.md"), not in this change.

## Other observation (not in this fix)
- There is no root `README.md` in the repo (root trees 7cb25b43… and dbff88a8…, audit 92d551c5-c7b0-4b62-bba5-148dd394d552), although task scopes refer to one. Writing a README is bigger than a small fix, so it's raised as a question, not bundled here.
