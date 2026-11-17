---
date: 2026-11-16
branch: claude/wp06-t2-skills-markdown
title: The skills library as Markdown with a generated catalog; six lines fixed
areas: [agents, scripts]
supersedes: []
---
## What changed
WP-06 T2 (planner's call 1, confirmed by the founder as D6 on Nov 16; TS-07). The skills library's source is now one
Markdown file per skill, `packages/agents/skills/<category>/<key>.md`: front matter of top-level `key: value` lines
(`key`, `name`, `description`, `category`, `attribute_name`, `attribute_group`, `version`) and the instructions as the
body. The 20 skills moved with their keys, names, descriptions, categories, attributes and bodies unchanged (checked
field by field against the old array with a one-off script before the fixes below).

`scripts/build-skill-library.mjs` compiles them into the checked-in
`packages/agents/src/skill-library/catalog.generated.ts` (`pnpm --filter @foundmill/agents skills:build`; `--check`
exits 1 with a one-line reason when the file is stale). It refuses a file whose folder is not its category, whose name
is not `<key>.md`, a repeated key, a missing field, a version that is not a whole number, CRLF, and a front matter line
that is not `key: value`; it strips a trailing ` # us-english-allow` (used on `attribute_group: judgement`, the enum
key). `LibrarySkill` moved to `src/skill-library/types.ts` with a new `version` field; `src/skill-library.ts` keeps
the lookups, prefixes and labels and re-exports the catalog, so `@foundmill/agents/skill-library` and every importer
are unchanged.

The catalog carries each skill's whole body as `instructionsMd`, so the app holds the full text of every skill. The
founder asked (D6) that a person can read a skill's text inside Foundmill, without going to GitHub: that screen is
**T7's** (the body on request in the picker), which carries the ask; this change only makes sure the body is there.

TS-07, six lines that asked an agent for something it has no tool for, rewritten as the spec's table says; each of
those files is at `version: 2`: `pull_request_descriptions` (no commands run), `incident_write_ups` and `meeting_notes`
(actions listed for the lead, not filed as tasks), `api_reference` (examples from a passing test or marked "not run"),
`month_end_close` (reconcile only with a bank connection), `invoice_follow_up` (no suppression list check).

The copy linters cover the new folder: `packages/agents/skills` is in `VOCAB_CODE_ROOTS` (scripts/banned-terms.mjs),
which us-english.mjs and plain-language.mjs import. Checked by putting a British spelling, a day-first date and a
football word in one file: all three linters reported it, and it was taken out.

Tests: `packages/agents/src/__tests__/skill-library.test.ts` (the catalog equals what the files generate; the 20 keys;
each body is the whole file body; the six fixes and versions; no body names an unbuilt vendor; no body tells an agent
to run a command, a shell or tests unless the sentence says it cannot, and the old pull request and API lines fail
that check) and `scripts/build-skill-library.test.mjs` (each refusal, on fixtures in a temp folder). The unbuilt-vendor
pattern moved from `tools-that-exist.test.ts` to a small shared helper, `src/__tests__/tool-patterns.ts`.
`scripts/ci-affected.mjs` TEST_READS gains `scripts/build-skill-library.mjs` for `@foundmill/agents`.

## Decisions
- **Order.** The spec asks both for "the 20 keys equal today's list in order" and for output in category order, then
  key. They disagree inside a category (today: `interview_synthesis`, `acceptance_criteria`, `release_notes`). The
  generator's rule wins: the catalog is in category order, then key, and the test checks the same 20 keys and that
  order. Nothing depends on the old order (the picker groups by category; `agent-skills.test.ts` takes any eight).
- **One list of categories.** `SKILL_LIBRARY_CATEGORIES` moved to `skill-library/types.ts` (re-exported as before) and
  the generator reads it from there, so the TS and the generator cannot drift. The labels stayed in `skill-library.ts`.
- **"Today's bodies except six lines"** was checked once, by a script against the old array, rather than by keeping a
  second copy of every old body in the test; the test pins the six before and after lines and the versions.
- **Spec versus code.** The task's title says five bodies; its table, which was followed, has six lines.
- **Strict front matter.** As specified, a line that is not `key: value` is refused, so a standalone comment line is
  too. The drafts in `docs/holistic-plan/skills/` carry a `# us-english-allow: ...` comment line above
  `attribute_group` in 23 files; T3 drops those lines when it moves the drafts in (the suffix on the value line is
  enough for the linter), or widens the parser then.
- `api_reference`'s description still says "examples that run": the spec fixes the body only, and the description
  is what a founder picks by; left for T3's rewrite of the library type.
- Out of scope by agreement: the builders that open PR #224 (WP-06 T1) edits.

## Not done
- T7: showing a skill's body to a person in the picker (the founder's ask from D6).
- T3: the drafts, the new front matter fields, and the categories `design` and `customers`.
- The `evals/` skill cases are unchanged (`skills.prompt.library_newsletter`, `…library_nda` still pass).
