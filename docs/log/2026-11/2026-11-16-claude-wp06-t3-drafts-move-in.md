---
date: 2026-11-16
branch: claude/wp06-t3-drafts-move-in
title: The library type grows; the 64 drafted skills move into packages/agents
areas: [agents, db, api, evals, scripts]
supersedes: []
---
## What changed
WP-06 T3 (TS-05, TS-10, TS-12, a3b §6e provenance; planner's calls 6 and 7; founder D4 and D6 of Nov 16). The skills
library holds 83 skills: the 20 converted in T2 and the 64 drafts from `docs/holistic-plan/skills/` (listed again when
the branch was cut: still 64), moved with `git mv` to `packages/agents/skills/<category>/<key>.md`. The draft
`pricing_analysis` replaced the old body under the same key, at `version: 2` (its name is now "Pricing"). The authoring
spec (`README.md`, now v2, with the field mapping) and `THIRD_PARTY_NOTICES.md` moved with them; the old folder is gone
and `docs/holistic-plan/README.md`, `OUTLINE.md` and one path in `WP-08-go-to-market.md` point at the new one.

`LibrarySkill` (`packages/agents/src/skill-library/types.ts`) gains `whenToUse`, `roles`, `defaultFor`, `defaultSince`
(1 for all), `stages`, `requires` (`SkillRequirement`, all `better_with`), `notYetOnFoundmill`, `improves` and
`provenance` (`SkillProvenance`). The categories gain `design` and `customers` ("Design", "Customers").
`scripts/build-skill-library.mjs` maps the authoring words onto these fields as the spec's table says and refuses a
value outside it (an unknown stage or need, a bad attribute group, a key outside 3 to 48 characters, a `when_to_use`
that does not start with "Use when", an adapted skill without an MIT or Apache-2.0 license). The catalog keeps every
skill's full body (D6: a person reads a skill's text inside Foundmill; the screen is T7's).

Front matter edits on the way in: `triage` and `moderation` left `roles` (`support_desk`, `inbound_triage`,
`marketing_compliance`), `inbound_triage.default_for` is empty, `coding_discipline` is in `roles` and `default_for` of
the eleven templates with `"code"` in `taskKinds` (checked against the code: the same eleven), `support_desk` and
`churn_prevention` list `chief_of_staff` (D4), and every file has `improves` from the plan's inventory table (the 20
converted from its second table, with new `when_to_use`, `roles`, `stage`, `needs` and provenance lines).
Defaults per template come out exactly as the inventory's count line (chief_of_staff, distribution_strategist and
qa_engineer 5; backend_engineer 4; ...). Bodies run 322 to 11,258 characters; 52 skills are adapted.

Text fixed because a test or linter named it (bodies of drafts that never shipped, so they stay `version: 1`):
`seo_plan` no longer names Search Console; `seo_page_audit` says "one-line summary" for "pitch"; plain-language gate
fixes in `unit_economics` (attribute "Money per sale"; "unit economics" and "replace with" reworded),
`first_sale_path`, `copy_editing`, `coding_discipline` ("hunks") and `structured_data` (an example product named
"Cedar"). `api_reference`'s description no longer says "examples that run" (T2 left it for here).

TS-12: `attachAddedSkills` (`packages/db/src/skill-attach.ts`) refuses (409) an added skill whose name reads as a
rating the agent carries ("Debugging" on a Backend Engineer), unless it is a library skill that lists that rating in
`improves`. `agent.profile.get` leaves out a `library_` row that improves a rating the agent carries under the same
name, so a Planner with `acceptance_criteria` shows one "Acceptance criteria" row; `agent.skills.added` still lists it.

Tests: `skill-library.test.ts` gains the T3 checks over every skill (screen, US spelling of every text field, sizes,
hireable roles, `defaultFor` within `roles`, `improves` keys real and rated by a role, a same-named rating listed in
`improves`, connector keys, licenses and the notices' collections, `coding_discipline` on every code template, D4,
unique attribute names, category labels) and the T2 tool tests now run over all 83; `build-skill-library.test.mjs`
covers each mapping and refusal; `agent-skills.test.ts` covers TS-12 and the two new category labels; evals gain
`skills.prompt.library_project_page_copy` (Product Lead, "The button says what the reader gets").

## Decisions
- **The `# us-english-allow: ...` comment lines are dropped**, not parsed: 14 files carried one (T2 counted 23, which
  is the number of `attribute_group: judgement # us-english-allow` value lines). The suffix on the value line is all
  the linter needs. The same suffix is used on the `improves` lines that name `prioritisation` or `personalisation`.
- **The source files keep the authoring words** (`stage: idea`, `needs: web_research`) and the generator maps them, as
  the spec says. An empty value is allowed only for `default_for`; an empty `roles` is a missing field.
- **Provenance where the spec's rule is ambiguous.** `support_desk` is `adapted_from: original,
  marketing-skills:churn-prevention` with a `license_note` that starts "original; ... adapted under MIT": it is
  `adapted` with that one source and license MIT. The license is the first `MIT` or `Apache-2.0` named in
  `license_note`, not its first word (which would be "original;" there and "Apache-2.0," for
  `interface_design_principles`). For adapted skills `note` keeps the whole `license_note`, because the copyright
  lines are what the MIT notice requires to travel with the text; the spec had `note` only for "original, after".
- **The notices name each collection as `adapted_from` spells it** (`example-skills` was only "Anthropic example
  skills"), so the test can match sources to the table.
- **TS-12 narrowed.** The spec hides from the ratings grid any library row whose skill improves a rating the agent
  carries. Since nearly every skill improves `communication` or another judgment or execution rating every template
  carries, that would hide almost every library skill from the grid, contrary to the existing e2e
  (`agent-skills.spec.ts`: an added Newsletter writing row shows "Untested" on the profile). Only the duplicate the
  task is about is hidden: same name as the improved rating.
- **D4: roles only.** `support_desk` and `churn_prevention` list `chief_of_staff` in `roles`; neither is a default,
  as in the inventory. Making `support_desk` a Chief of Staff default would raise that role to 6 defaults; T6 can
  decide it with the index's size in view.
- **The tool test's heuristic.** The T2 check for sentences that send an agent to run commands or tests caught 17
  sentences in the drafts that do not (a fair test of an offer, crawlers that do not run scripts, an HTML shell, the
  platform's own checks). Each was read and is allowed by its opening words in `READ_AND_ALLOWED`; a test fails if an
  allowance outlives its sentence, and any new catch still fails. The regex is unchanged.
- **`seo_plan`'s wording.** The spec suggested "not available on Foundmill yet"; the banned-terms scan refuses the
  product name in copy (APP_NAME rule), so it reads "which you cannot read yet: no tool for it is built".
- The "caps an agent at eight" API test now adds the eight shortest skills: the first eight in catalog order now pass
  `ADDED_SKILLS_MAX_TOTAL_CHARS` (60,000) before the count, which T4 replaces.
- Model note (Nov 16 rule, free accounts on Haiku 5.5 or GLM-5.3 Flash): the bodies are plain Markdown instructions
  with no provider-specific features; nothing here depends on the model.

## Not done
- Defaults are not attached (T6), the index and `read_skill` are T4, the picker's body view and `requires` /
  `notYetOnFoundmill` display are T7. `apps/orchestrator/src/activities/session.ts` is untouched.
- Whether each body's claims about tools match what the gateway serves was checked only by the library tests (unbuilt
  vendors, running commands); `cold_email` says "Run the suppression check", which T4's tool review should confirm.
- The product's own notices page (named in `THIRD_PARTY_NOTICES.md`) is not built.
- The Playwright suite was not run here; no screen changed, and the e2e's library flow uses the 20 converted skills.
