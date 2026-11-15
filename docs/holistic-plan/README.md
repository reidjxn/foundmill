# docs/holistic-plan: how to use this folder

This folder is the working detail behind `docs/HOLISTIC_REVIEW.md` (what was found) and `docs/HOLISTIC_PLAN.md` (what to do, in what order). It was written on Nov 15, 2026 at commit `04a0a509`. Line numbers will drift: re-find a citation by the function or string it names before relying on it.

| Path | What it is |
| --- | --- |
| `WP-00-…md` to `WP-12-…md` | One work package each. A work package is what one session takes from start to merged pull requests. |
| `OUTLINE.md` | The diagnosis, the list of work packages and the boundaries between them. |
| `landing/` | The landing page's own session: `PROMPT.md` to paste, and the draft WP-03 T5 held, as research. |
| `audits/` | The evidence. Eleven read-only audits of the code at `04a0a509`, four reviews made with the copied skills (design, activation, search and AI visibility, market), and production facts measured through the Vercel, Railway and Supabase connectors. Every finding has an id (`AR-07`, `TS-01`, `A4-03`, `FR-02`, …) that the work packages cite. |
| `skills/` | Drafted skills for the product's agents, the authoring spec (`skills/README.md`) and the notices for adapted text. WP-06 wires them into `packages/agents`. |

## Rules for a session executing a work package

These repeat CLAUDE.md where it matters most here; CLAUDE.md wins on any difference.

1. **Read first:** CLAUDE.md, the package CLAUDE.md files for the code you touch, the work package, and the audit sections it cites. Use `plan-change` before writing code: it checks other sessions' branches for overlap and gives you the next free migration number.
2. **Karpathy guidelines on every change** (the `karpathy-guidelines` skill): state assumptions; the simplest change that solves the problem; touch only what the task needs; define the check that proves it and loop until it passes. A work package that looks larger than its tasks need is a mistake in the work package: say so in the pull request instead of building the excess.
3. **One task, one pull request**, unless the work package says tasks ship together. Branch `claude/<wp>-<task>`. Never push to `main`, never merge: the founder merges (`ship-change`).
4. **Tests first.** Each task names the test that fails before the change and passes after. Agent behavior gets an eval. A new business-scoped table gets RLS and a cross-tenant test in the same change.
5. **`verify-done` before saying a task is finished.** Report each check with its result, and say what the checks do not cover.
6. **Other skills in `.claude/skills/`** that the work packages call for: `executing-plans` or `subagent-driven-development` to run a package task by task, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, and for copy and pages `copywriting`, `copy-editing`, `humanizer`, `onboarding`, `cro`, `frontend-design`, `design-taste-frontend`, `schema`, `ai-seo`. Where one of them disagrees with CLAUDE.md, docs/DESIGN.md or docs/DECISIONS.md, the repo's documents win.
7. **Do not start a task marked "needs setup" or "needs the founder"** until the step it names is recorded as done in `docs/DEPLOY.md`. Build the code path behind its switch, with the mock passing, and stop there.
8. **Record as you go:** one line in `docs/PROGRESS.md` per merged task, judgment calls in `docs/DECISIONS.md`, and tick the task in the work package file in the same pull request.

## Shape of a work package file

```
# WP-NN: <name>
Goal (one sentence) · Why (finding ids) · Done when (observable, measurable)
Scope: in / out · Depends on · Collides with (branches, files) · Setup it needs (WP-00 ids)
## Tasks
### T<n>: <name>            [size S/M/L] [ships alone | ships with T<m>]
Why: finding ids
Files: create / modify (exact paths)
Interfaces: consumes (existing names and signatures) / produces (new names and signatures)
Steps: numbered, each with its check ("verify: <command or assertion>")
Tests and evals: file names and the assertions they make
Done when: the observable result
## Starting prompt
The message to paste into a cloud session to start this package.
```
