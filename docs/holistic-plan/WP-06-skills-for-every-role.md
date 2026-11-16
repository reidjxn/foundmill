# WP-06: Skills for every role

**Goal:** every agent starts with skills that fit its role, loads one when a task calls for it, and the founder can see what a skill changed.

**Why:** `audits/a3b-templates-skills-team.md` TS-01 (P0), TS-02, TS-03, TS-04, TS-05 (P1), TS-07 to TS-12, TS-15, TS-17, TS-19 (P2) and its design §6a to §6g; `audits/a3a-agent-runtime.md` AR-10; `audits/a7-models-gateway-economics.md` A7-06; `audits/e0-production-evidence.md` ("skill_definitions: 196 platform, 4 uploaded, 0 from the library; skill_tests 0; training_runs: 1 real, $12.78"). Today a skill reaches three prompts and none of the calls that make a first page, post or plan; no agent is hired with one; the library is 20 short checklists; every rating is a constant.

**Done when (each is a check a session can run):**
1. `packages/agents/skills/` holds one Markdown file per skill (20 converted + the drafts, 83 at the Nov 15 count) and `node scripts/build-skill-library.mjs --check` exits 0; a unit test fails when the generated catalog is stale.
2. Every library skill passes `screenSkill`, `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate --summary` and the library tools-that-exist test.
3. A project committed in mock mode has, for every hired non-utility agent, an `agent_skills` row with `added_by = 'template'` for each skill whose `default_for` names its template; every template with `"code"` in `taskKinds` carries `library_coding_discipline`.
4. The system prompt of a session for an agent with 5 default skills carries a Skills section under 8,000 characters (the index) plus at most one loaded body; `read_skill` returns only the caller's own skills.
5. `buildProjectPageRequest`, `buildPostDraftRequest`, `buildPageQuizRequest`, `buildChannelCreativeRequest`, `buildResearchPlanRequest`, the source-watcher requests, the cycle plan and the plan compiler each render the business's live agent version and its skills (one test per builder).
6. `SKILL_EVIDENCE` covers every (default skill, role) pair or lists it as pending, and a newly hired agent's ratings are measured values or "Not tested yet", never the family constant.
7. SQL on production after the backfill: `select count(*) from agent_skills where added_by = 'template'` is above 0 for every real project, and no default a founder removed has come back (integration test).

**Scope in:** the library's source format and generator; importing the drafted skills; the prompt resolver; the skill index, `selectSkills` and the `read_skill` gateway tool; one hire implementation; default skills at hire, commit and by backfill; the picker's data; platform-measured evidence and starting ratings; the scoped per-agent check (design, migration, workflow); promoting an edit without a run; two honesty copy fixes.

**Scope out (owner):** the picker's and the Skills panel's look, ratings legibility in the UI (WP-10); the batch route, the training affordability check, the model-change retest price (WP-09: A7-06 items 1, 2, 5; TS-03 c); mentor voice and founder context in prompts, money defaults in templates (WP-04: TS-06, TS-13); session reports, statuses, planner inputs (WP-05); `site_*` and payment tools (WP-07); positioning as a record, outcome evals for go-to-market (WP-08). Not built at all, with reasons, under "Not now".

**Depends on:** WP-05's first platform tool (the `save_report` pattern in `packages/connectors/src/connectors/platform/tools.ts`) before T4; WP-09's batch route before T8 runs at half price and its affordability check before T10 is shown on the free plan. T1 to T3 and T5 depend on nothing.

**Collides with:** `apps/orchestrator/src/activities/session.ts` (WP-05 edits it in sequence: T4 touches two places, `loadContext` and the `buildSystemPrompt` call, and goes in after WP-05's open session.ts task merges); `apps/orchestrator/src/activities/training.ts` and `apps/api/src/routers/agent.ts` (WP-09); `apps/api/src/services/commit.ts` (WP-04: T6 only changes what `hireMany` does inside, not `commit.ts`); `packages/dugout/src/components/agents/SkillPicker.tsx` (WP-10); `scripts/banned-terms.mjs` (one added root; WP-01 may touch CI around it). Nothing here edits `.github/workflows/ci.yml` or the shell components of `claude/blissful-fermat-q03yq1`.

**Setup it needs:** none from WP-00 for T1 to T7 and T9 to T12 (all run with `MODEL_MODE=mock`, `INTEGRATIONS_MODE=mock`). T8's measuring run needs a live model key in the session that runs it and the founder's go-ahead on the spend (Decisions for the founder, 1).

## Decisions that bind this package (do not reopen)

- 2026-10-16 "Skills from the library or files" (docs/DECISIONS.md): keys `library_<key>` and `upload_<name>_<hash8>`; removing deletes the rating row and keeps the definition; screening refuses, never strips; **a skill never changes tools, autonomy, spend caps or approvals**. Its numbers (8 skills, 60,000 characters) exist "so the Skills section stays a bounded part of every prompt": T4 keeps the reason and replaces the numbers with a new entry.
- 2026-10-18 "A promotion writes the run's scores onto the ratings; a skill without tests is reported, not scored": ratings change only through a recorded run.
- 2026-10-06 "skill test sets are blueprints × scenarios": tests stay generated in code.
- Nov 6, 2026: the Chief of Staff gives agents skills; the founder never has to. Nov 11: agents hold only tools that exist. Nov 12: own-key connectors answer "not connected". SEC-3: the SDK's `Skill` tool and settings stay off (`apps/orchestrator/src/activities/sdk-isolation.ts`, `settingSources: []` in `session.ts`).
- 2026-11-15 "The holistic review and plan", planner's calls 1 to 3: Markdown source with a generated catalog; `read_skill` plus an index; default skills at hire.
- 2026-11-15 "Outside Claude Code skills are used freely": that rule is about skills for sessions working on the repo. Text that ships to founders' agents is the rewritten drafts only, with `coding_discipline` in Foundmill's own words.

## Order

a3b §6g, with one swap that the drafts force: the index and `read_skill` (T4) land **before** defaults are attached (T6). §6g assumed 500 to 900 character skills; the drafted bodies are 6.9 to 12 KB, so four defaults carried whole would add about 40,000 characters to every prompt of every session, on top of sessions that already average 222,000 to 388,000 input tokens (e0).

| # | Task | Size | Ships |
| --- | --- | --- | --- |
| T1 | One resolver: skills and the live version follow an agent into every call | M | alone |
| T2 | The library as Markdown with a generated catalog; the five bodies fixed | M | alone |
| T3 | The library type grows; the drafts move in | L | alone |
| T4 | Skill index, `selectSkills`, `read_skill`; new limits | L | alone, after WP-05's session.ts task |
| T5 | One hire implementation | S | alone |
| T6 | Default skills at hire, at commit and by backfill | M | after T3, T4, T5 |
| T7 | Picker data: suggestions, body on request, availability | S | after T3 |
| T8 | Measure once on the platform: evidence and starting ratings | L | after T3; needs the founder's go-ahead to run |
| T9 | Hire writes measured ratings; adding a skill shows its evidence | M | after T8 |
| T10 | The scoped per-agent check | M | after WP-09's affordability check |
| T11 | Make an edit live without a run | S | alone |
| T12 | Two honesty fixes in Recruitment and Training copy | S | alone |

Migrations: each takes the next free number when its branch is cut (0108, journal idx 96, at `04a0a509`); renumber on rebase. T6 and T10 each add one.

## Tasks

### [x] T1: One resolver, so skills and the live version follow an agent into every call   [M] [ships alone]

**Why:** TS-01 (P0). Only `session.ts:1449`, `conversation.ts:845` and `training.ts:210` pass the agent's own version and skills; ten other builders call `buildSystemPrompt` with the static template.

**Files**
- Create: `packages/db/src/agent-prompt.ts`; `packages/db/src/__tests__/agent-prompt.test.ts`.
- Modify: `packages/db/src/index.ts` (export); `packages/agents/src/club-rules.ts` (export `AgentPromptParts`); `packages/agents/src/foundations.ts` (`FoundationsInputs`, `foundationsSystem`); `packages/agents/src/page-quiz.ts` (`PageQuizFacts`); `packages/agents/src/post-draft.ts` (`PostDraftFacts`, `PostDraftFactsInput`); `packages/agents/src/channel-creative.ts` (`ChannelCreativeInput`); `packages/agents/src/product-research.ts` (`ResearchPlanInputs`); `packages/agents/src/source-watcher.ts` (the private `system()` at `:123` and its two public builders); `packages/agents/src/prompts/team-call.ts` (`chiefOfStaff?` gains `skills?`); callers `packages/db/src/repos/foundations.ts` (`inputs`, `:207`), `packages/db/src/team-post-draft.ts:94`, `apps/api/src/services/page-quiz.ts:137`, `apps/api/src/services/product-research.ts:229`, `apps/api/src/services/plans.ts:106`, `apps/api/src/services/team-call.ts` (where `chiefOfStaff` is filled), `apps/orchestrator/src/activities/cycle.ts:332`, `apps/orchestrator/src/activities/channel.ts:173`, `apps/orchestrator/src/activities/source-watcher.ts:207,243`; `evals/src/skills/cases.ts`, `evals/src/__tests__/skills.test.ts`.
- Not touched: `session.ts` and `training.ts` (already correct; T4 changes them), `showcase-script.ts`, `ideation.ts`, `community-screen.ts`, `second-read.ts` (platform calls, no project agent: see Corrections 5).

**Interfaces**
- Consumes: `buildSystemPrompt(input: BuildSystemPromptInput): string` with `template: { instructions: AgentInstructions; description?: string }` and `skills?: readonly AgentSkillPrompt[]` (`club-rules.ts:93`); `repos.agents.list`, `repos.agents.getVersion`, `repos.skills.listAddedForAgent(db, businessId, agentId, agentType): Promise<AddedAgentSkill[]>`; `roleSkillsFor(skillKeys)` (`design-check.ts:85`); `getTemplate`, `getChannelTemplate`, `getTemplateByAgentType`; the rule in `followsTemplate` (`session.ts:184`: version 1 written by `system` follows the template).
- Produces:
```ts
// packages/agents/src/club-rules.ts
export interface AgentPromptParts { instructions: AgentInstructions; description?: string; skills: readonly AgentSkillPrompt[] }
// packages/db/src/agent-prompt.ts
export type AgentPromptTarget = { agentId: string } | { templateKey: string } | { channelKey: ChannelKey };
export interface ResolvedAgentPrompt extends AgentPromptParts { agentId: string | null; templateKey: string }
/** The business's live agent of that role (oldest, not archived): its live version's instructions unless it still
 *  follows the template, its role skills and its added skills. No such agent: the template and its role skills. */
export async function resolveAgentPrompt(db: Executor, businessId: string, target: AgentPromptTarget): Promise<ResolvedAgentPrompt>;
```
- Each builder's input gains `agent?: AgentPromptParts`; when absent the builder falls back to the template exactly as today (so every existing test and mock stays green).

**Steps**
1. Write `agent-prompt.test.ts` (fails): a business with a Product Lead on an edited version 2 and one added library skill resolves to version 2's instructions and that skill; a business with no such agent resolves to the template; another business's agent is never returned. verify: `pnpm --filter @foundmill/db test agent-prompt` fails for the missing module.
2. Implement `resolveAgentPrompt`. verify: the test passes.
3. For each builder, write the failing test first in its existing test file (`project-page.test.ts`, `post-draft.test.ts`, `page-quiz.test.ts`, `foundations.test.ts`, `product-research.test.ts`, `source-watcher.test.ts`, `team-call.test.ts`; add `channel-creative` cases to `prompts.test.ts`): with `agent` set, the first system block contains the skill's line after `## Your instructions` and starts with `## House rules`; without it the block equals today's output. Then add the optional field. verify: `pnpm --filter @foundmill/agents test`.
4. Pass the resolver's result from each caller listed above; `cycle.ts` and `plans.ts` replace `getTemplate("chief_of_staff")` with `resolveAgentPrompt(db, businessId, { templateKey: "chief_of_staff" })`. verify: `pnpm --filter @foundmill/api test`, `pnpm --filter @foundmill/orchestrator test`.
5. Add `builder` cases to `SKILL_PROMPT_CASES` (one per builder) and assert them in `evals/src/__tests__/skills.test.ts`. verify: `pnpm --filter @foundmill/evals test`.
6. Record in docs/DECISIONS.md: "An agent's skills and live version follow it into every call made in its name."

**Tests and evals:** as in steps 1, 3, 5. **Done when:** Done-when 5 above. **Does not cover:** whether a skill improves the output (T8).

### [x] T2: The library as Markdown with a generated catalog; the five bodies fixed   [M] [ships alone]

**Why:** planner's decision 1; TS-07; decision 7 (the tools-that-exist test).

**Files**
- Create: `packages/agents/skills/<category>/<key>.md` for the 20 entries of `SKILL_LIBRARY` (`packages/agents/src/skill-library.ts:43-427`), keys unchanged; `scripts/build-skill-library.mjs`; `scripts/build-skill-library.test.mjs`; `packages/agents/src/skill-library/types.ts`; `packages/agents/src/skill-library/catalog.generated.ts` (checked in); `packages/agents/src/__tests__/skill-library.test.ts`.
- Modify: `packages/agents/src/skill-library.ts` (keeps `getLibrarySkill`, `librarySkillKey`, `uploadSkillKey`, `isAddedSkillKey`, the prefixes and labels; imports `SKILL_LIBRARY` from `./skill-library/catalog.generated`; the inline array goes); `packages/agents/package.json` (script `"skills:build": "node ../../scripts/build-skill-library.mjs"`); `scripts/banned-terms.mjs` (`VOCAB_CODE_ROOTS` gains `"packages/agents/skills"`, which `us-english.mjs` and `plain-language.mjs` import); `packages/agents/CLAUDE.md` (one line under Key files and one under Commands).
- The package's export map (`"./*": "./src/*.ts"`) keeps `@foundmill/agents/skill-library` pointing at `src/skill-library.ts`: no importer changes (`apps/api/src/services/skills.ts`, `packages/db/src/skill-attach.ts`, `packages/db/src/seed/northwind.ts`, `packages/dugout/src/components/agents/SkillPicker.tsx`, `packages/modules/src/team/skills.tsx`).

**Interfaces**
- Front matter in T2 (top-level `key: value` only, as `parseSkillFile` reads it): `key`, `name`, `description`, `category`, `attribute_name`, `attribute_group`, `version` (1). T3 adds the rest.
- `scripts/build-skill-library.mjs`: `export function renderCatalog(skillsDir: string): string`; CLI writes the file; `--check` exits 1 with a one-line reason when the file on disk differs. It refuses: a file whose folder is not its `category`, whose name is not `<key>.md`, a repeated key, a missing field, CRLF, a front matter line that is not `key: value`. It strips a trailing ` # us-english-allow` from a value (23 drafts carry it on the `attribute_group` line). Output order: `SKILL_LIBRARY_CATEGORIES` order, then key. Each entry is emitted with `JSON.stringify` per field under a header `// GENERATED by scripts/build-skill-library.mjs from packages/agents/skills. Do not edit.`
- `LibrarySkill` (moved to `skill-library/types.ts`, re-exported) is unchanged in T2 apart from `version: number`.

**Steps**
1. Write `skill-library.test.ts` (fails): `renderCatalog("packages/agents/skills")` equals the text of `catalog.generated.ts`; the 20 keys equal today's list in order; every body equals today's `instructionsMd` except the six lines below. verify: fails, no generator.
2. Write the generator and `build-skill-library.test.mjs` (`node --test`: the refusals above, on fixtures in a temp folder). verify: `node --test scripts/build-skill-library.test.mjs`.
3. Convert the 20 entries to files; run the generator. verify: step 1's test passes; `pnpm --filter @foundmill/agents typecheck`; `skill-files.test.ts` ("every library skill passes the screening an uploaded file gets") still passes.
4. Fix the bodies (TS-07). Copy, before → after:

| Skill | Before | After |
| --- | --- | --- |
| `pull_request_descriptions` | "- **How it was tested**: the commands run and their result, plus any manual checks." | "- **How it was tested**: the tests you wrote or changed, by name. You cannot run commands: say that the platform runs the task's tests after your session and that the result is on the task." |
| `incident_write_ups` | "5. Actions: each one small, with a suggested owner and date, filed as a task." | "5. Actions: each one small, with a suggested owner and date. List them in your report for your lead to turn into tasks." |
| `api_reference` | "Run each example against the test environment before publishing it. Note the version the page describes." | "Take each example from a passing test or mark it \"not run\". Note the version the page describes." |
| `month_end_close` | "1. Reconcile each bank and card account against the ledger. List every difference with its amount." | "1. If a bank connection is connected, reconcile each bank and card account against the ledger and list every difference with its amount. If none is, say the reconciliation was not done and what the founder would need to connect." |
| `invoice_follow_up` | "Check the suppression list and the customer's contact preferences before drafting." | "Read the customer's contact preferences on their record before drafting. You cannot check the suppression list: say so, and leave the send to an agent or person who can." |
| `meeting_notes` | "- Action items next: what, who and by when. File each one as a task." | "- Action items next: what, who and by when, listed for your lead to turn into tasks." |

   Each changed file goes to `version: 2`. verify: the generator's `--check`; the three copy linters on `packages/agents/skills`.
5. Add the library tools test to `skill-library.test.ts`: no body matches the unbuilt-vendor pattern used for templates (`tools-that-exist.test.ts:118`, export it from a small shared test helper); no body tells the agent to run a command, a shell or a test run except in a sentence that says it cannot ("You have no shell" passes). verify: passes on the 20; fails if the old `pull_request_descriptions` line is put back.

**Tests and evals:** steps 1, 2, 5; `evals/src/__tests__/skills.test.ts` unchanged and green (`skills.prompt.library_newsletter`, `…library_nda`). **Done when:** Done-when 1 and 2 for the 20 skills.

### T3: The library type grows; the drafts move in   [L] [ships alone]

**Why:** TS-05, TS-10 (the rewrite each outside text needs), TS-12, §6e provenance (before any adapted skill ships), planner's decisions 6 and 7.

**Files**
- Move (`git mv`): every `docs/holistic-plan/skills/<category>/<key>.md` to `packages/agents/skills/<category>/<key>.md`; `docs/holistic-plan/skills/THIRD_PARTY_NOTICES.md` to `packages/agents/skills/THIRD_PARTY_NOTICES.md`; `docs/holistic-plan/skills/README.md` to `packages/agents/skills/README.md` (updated to the mapped fields below). List the folder again when the branch is cut: the count was 64 on Nov 15, 2026 at 12:37 GMT and other sessions were still adding files.
- Modify: `packages/agents/src/skill-library/types.ts`; `packages/agents/src/skill-library.ts` (`SKILL_LIBRARY_CATEGORIES` gains `"design"`, `"customers"`; labels "Design", "Customers"); `scripts/build-skill-library.mjs`; the 20 converted files (new fields); `packages/db/src/skill-attach.ts` (`attachAddedSkills` name check); `apps/api/src/routers/agent.ts` (`agent.profile.get` skills list); `packages/agents/src/__tests__/skill-library.test.ts`.

**Interfaces**
```ts
// packages/agents/src/skill-library/types.ts
export interface SkillRequirement { connectorKey: ConnectorKey; mode: "better_with" }
export interface SkillProvenance { origin: "foundmill" | "adapted"; sources: readonly string[]; license: string | null; note: string | null }
export interface LibrarySkill {
  key: string; name: string; description: string; category: SkillLibraryCategory;
  attribute: { name: string; group: SkillGroup };
  whenToUse: string;                       // ≤ 160 characters, starts with "Use when"
  roles: readonly string[];                // hireable template keys
  defaultFor: readonly string[];           // subset of roles
  defaultSince: number;                    // the defaults version that first attached it (T6); 1 for all of T3's
  stages: readonly ProductStage[];         // drafting | awaiting_signoff | building | selling
  requires: readonly SkillRequirement[];
  notYetOnFoundmill: readonly string[];    // plain names, shown in the picker only
  improves: readonly string[];             // rated skill keys (SKILL_DEFINITIONS) this one sharpens
  instructionsMd: string;                  // ≤ 12,000 characters
  version: number;
  provenance: SkillProvenance;
}
```
- Front matter mapping (the generator does it; a value outside the table is an error):

| Draft field | Library field | Rule |
| --- | --- | --- |
| `key`, `name`, `description`, `category` | same | `key` 3 to 48 characters; draft `pricing_analysis` replaces the existing body under the same key, as `version: 2` |
| `attribute_name`, `attribute_group` | `attribute` | group is `craft`, `judgement` or `execution` |
| `when_to_use` | `whenToUse` | as above |
| `roles` | `roles` | each in `TEMPLATE_KEYS`; `triage` and `moderation` are removed from the files (utilities take typed input and render no Skills section) |
| `default_for` | `defaultFor` | subset of `roles`; `coding_discipline` is set to the eleven templates with `"code"` in `taskKinds`: `engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner` |
| `stage` | `stages` | `idea` → `drafting`, `awaiting_signoff`; `building` → `building`; `page_live` → `building`, `selling`; `first_followers`, `first_sale`, `growing` → `selling`; deduplicated, in enum order |
| `needs` | `requires`, `notYetOnFoundmill` | `web_research` → `web`; `email_send` → `platform_mail`; `social_publish` → `buffer`; `payments` → `stripe`; `repo` → `github`; `analytics` → `posthog` (all `better_with`: the authoring spec requires every skill to work without them); `search_console` → `notYetOnFoundmill: ["Search Console"]`; `page_publish` and `none` → nothing (no agent tool publishes a page; the founder does) |
| `adapted_from`, `license_note` | `provenance` | `original` → `origin: "foundmill"`; `original, after …` → `foundmill` with the rest as `note`; anything else → `adapted`, `sources` the list, `license` the first word of `license_note` (`MIT`, `Apache-2.0`) |
| `version` | `version` | integer |
| new: `improves` | `improves` | from the inventory table below; for the 20 converted skills from the second table |

- `attachAddedSkills` (`packages/db/src/skill-attach.ts:58`): the same-name check also compares against `getSkillDefinition(k)?.name` for every rated key the agent's template carries, unless the library skill lists that key in `improves` (TS-12).
- `agent.profile.get` (`apps/api/src/routers/agent.ts:134`): a `library_` row whose skill `improves` a key the agent rates is left out of `skills` (the ratings grid) and still returned by `agent.skills.added`. No schema change.

**The 20 converted skills: new fields** (`default_for` empty for all; `stages` all four)

| Key | `roles` | `improves` |
| --- | --- | --- |
| `interview_synthesis` | product_researcher, product_lead | evidence_synthesis, discovery_interviewing |
| `acceptance_criteria` | planner, product_lead | acceptance_criteria, spec_writing |
| `release_notes` | docs_writer, product_lead | technical_writing |
| `pull_request_descriptions` | backend_engineer, frontend_engineer, data_engineer, infra_engineer, design_to_code, integration_agent | communication |
| `incident_write_ups` | infra_engineer, engineering_lead | observability, communication |
| `api_reference` | docs_writer, backend_engineer | technical_writing, example_quality |
| `landing_page_copy`, `newsletter_writing` | channel_content, channel_email_automation | copywriting |
| `press_releases` | channel_pr | press_release_writing |
| `discovery_call_prep` | channel_lead_generation, product_researcher | icp_definition, discovery_interviewing |
| `objection_handling` | channel_lead_generation, channel_email_automation | reply_handling |
| `proposal_writing` | channel_lead_generation | communication |
| `month_end_close`, `invoice_follow_up` | finance_lead | anomaly_detection, communication |
| `nda_review`, `privacy_requests` | legal_lead | contract_review, compliance_tracking |
| `supplier_comparison` | sourcing_manufacturing, operations_lead | quote_analysis, supplier_vetting |
| `meeting_notes`, `weekly_status_report` | chief_of_staff, operations_lead | communication |

**Steps**
1. Extend `skill-library.test.ts` (fails): for every skill: `screenSkill({ name: attribute.name, description, instructionsMd })` is null; `usSpelling` leaves name, description, attribute name, `whenToUse` and body unchanged; body ≤ 12,000 characters; `whenToUse` starts with "Use when" and is ≤ 160; `roles` and `defaultFor` are hireable template keys and `defaultFor ⊆ roles`; every `improves` key exists in `SKILL_DEFINITIONS` and is rated by at least one template in `roles`; every `requires.connectorKey` is in `CONNECTOR_KEYS`; an `adapted` skill has a license in `["MIT", "Apache-2.0"]` and each source's collection appears in `THIRD_PARTY_NOTICES.md`; every template with `"code"` in `taskKinds` is in `coding_discipline.defaultFor`; no two skills share an attribute name; the T2 tools test over all bodies.
2. Extend the generator for the mapping; move the files; add `improves` to each from the inventory table. verify: `node scripts/build-skill-library.mjs` then `--check`.
3. Fix what the tests name. Known at planning time: `marketing/seo_plan.md` names "Search Console" in its body (say "the search engine's own site report, which is not available on Foundmill yet"); `attribute_group` lines carry `# us-english-allow`; `inbound_triage.default_for` is `triage` (becomes empty) and `support_desk`, `marketing_compliance` list a utility in `roles`. verify: step 1's test passes.
4. Run the three copy linters over `packages/agents/skills` and `packages/agents/src/skill-library`. `plain-language.mjs --gate` counts undefined terms: fix the text of a skill, never raise the gate. verify: all three exit 0.
5. TS-12: failing test in `apps/api/src/__tests__/agent-skills.test.ts` (adding `acceptance_criteria` to a Planner yields one "Acceptance criteria" row in the profile's grid and one entry in `agent.skills.added`; adding a file named "Debugging" to a Backend Engineer is a 409), then the two changes. verify: `pnpm --filter @foundmill/api test agent-skills`.
6. Update `docs/holistic-plan/README.md` and `OUTLINE.md` to point at the new folder.

**Tests and evals:** step 1 and 5; `evals/src/skills/cases.ts` gains one placement case for a moved skill (`skills.prompt.library_project_page_copy`, Product Lead, must contain "The button says what the reader gets"). **Done when:** Done-when 1 and 2 for all 83. **Does not cover:** that a skill helps (T8); skills in use (T4, T6).

### T4: Skill index, `selectSkills`, `read_skill`; new limits   [L] [ships alone, after WP-05's open session.ts task]

**Why:** AR-10 (design A), a3b §6c, TS-11 (the accidental update), TS-19, planner's decision 2.

**Files**
- Create: `packages/agents/src/skill-select.ts`; `packages/agents/src/__tests__/skill-select.test.ts`; `evals/src/skills/read-skill.ts`, `evals/src/__tests__/skills-read.test.ts`, `evals/src/skills/read-skill.eval.test.ts`.
- Modify: `packages/agents/src/club-rules.ts` (`AgentSkillPrompt`, `renderSkills`, preambles, export `neutralizeSkillTags`); `packages/agents/src/skill-files.ts` (limits); `packages/agents/src/connectors.ts` (`PLATFORM_BASE_TOOLS` gains `"skills.read"`); `packages/connectors/src/grants.ts` (`CAPABILITY_TOOLS.platform["skills.read"] = ["read_skill"]`); `packages/connectors/src/connectors/platform/tools.ts` (tool and `PlatformHost.readSkill`), `…/platform/mock.ts`, `…/platform/index.ts`; `apps/gateway/src/platform-host.ts`; `apps/orchestrator/src/activities/session.ts` (`loadContext` `:700-705`, the prompt at `:1449`); `apps/orchestrator/src/activities/training.ts:209`; `apps/api/src/services/conversation.ts` (where `promptSkills` is built); `packages/db/src/agent-prompt.ts` (T1's resolver returns the new shape); `packages/db/src/skill-attach.ts` and `packages/modules/src/team/skills.tsx:55` (limits).

**Interfaces**
```ts
// packages/agents/src/club-rules.ts
export interface AgentSkillPrompt {
  key: string; name: string; source: "library" | "upload" | "role";
  whenToUse: string;               // library: whenToUse; upload: its description, cut to 160; role: fixed text
  instructionsMd?: string;         // present when the body is loaded into this prompt
}
export function renderSkills(skills: readonly AgentSkillPrompt[], options?: { canRead: boolean }): string;
// packages/agents/src/skill-select.ts
export interface AttachedSkill { key: string; name: string; source: "library" | "upload" | "role"; whenToUse: string; instructionsMd: string; stages?: readonly ProductStage[]; improves?: readonly string[] }
export function selectSkills(input: { skills: readonly AttachedSkill[]; task?: { kind: TaskKind; title: string; goal: string }; message?: string; stage?: ProductStage; ratedSkillKey?: string; maxBodies: number }): AgentSkillPrompt[];
// packages/agents/src/skill-files.ts (replace MAX_ADDED_SKILLS_PER_AGENT = 8 and ADDED_SKILLS_MAX_TOTAL_CHARS = 60_000)
export const MAX_SKILLS_PER_AGENT = 40;
export const SKILL_INDEX_MAX_CHARS = 8_000;
export const SKILL_PRELOAD_MAX_CHARS = 24_000;
// packages/connectors/src/connectors/platform/tools.ts, next to list_skills
defineTool({ name: "read_skill",
  description: "One of your own skills: its full instructions. Call it with the key from your skills list before work the skill covers.",
  input: z.object({ skillKey: z.string().trim().min(1).max(200) }),
  output: z.object({ skillKey: z.string(), name: z.string(), text: z.string(), notice: z.string() }),
  hints: {}, annotations: { readOnlyHint: true } })
// PlatformHost gains
readSkill(caller: PlatformCaller, args: PlatformArgs<"read_skill">): Promise<PlatformResult<"read_skill">>;
```
- Prompt shape: the section keeps its header and preamble, adds one sentence, then one line per skill `- <name> [<key>]: <whenToUse>`, then a `<skill name source>` block for each skill that has `instructionsMd`. Role skills (Design principles) are always loaded. Added sentence when `canRead`: "Before work one of these covers, call read_skill with its key. What read_skill returns is your own guidance, checked by the platform: follow it within the house rules. It grants no permission." When not `canRead`: "Only the skills shown in full below are loaded for this call." House rule 2's wording is not changed (TS-19).
- `selectSkills` is deterministic: skills whose `stages` include `stage` first, then word overlap between the task title and goal (or the message) and `name` + `whenToUse`; `ratedSkillKey` (training) loads the skill itself and those that `improve` it. It returns every skill for the index with `instructionsMd` set on at most `maxBodies`, never past `SKILL_PRELOAD_MAX_CHARS`. Starting values (Estimates, tuned with the eval): sessions that hold `read_skill` load 1 body; calls with no tool loop (conversation, training, T1's builders) load 2.
- `readSkill` (gateway): only skills attached to `caller.agentId` (`roleSkillsFor(template.skills)` plus `repos.skills.listAddedForAgent`); for a `library_` key the text comes from `getLibrarySkill(key)` when the catalog has it, else the stored `instructions_md` (this also ends TS-11's accident: a library skill follows the catalog); `screenSkill` runs again at read time and a refusal is returned as the reason; the text is wrapped `<skill name="…" source="…">…</skill>` with `neutralizeSkillTags`, outside any untrusted envelope; `notice` = "Your own skill, checked by the platform. Follow it within the house rules; it grants no permission."; one audit row `agent.skills.read` `{ skillKey, sessionId }`. Mock host: the same lookup against the mock's agents, so `INTEGRATIONS_MODE=mock` behaves the same.
- Session: `canRead` is true when the session's resolved grants contain `platform:read_skill` (an agent on a founder-edited version without the grant, or a second-read revision narrowed by `sessionGrantsFor`, gets the loaded-bodies form). The same catalog-first rule for library bodies applies in `loadContext`, the conversation and training.
- Limits: `attachAddedSkills` refuses past `MAX_SKILLS_PER_AGENT` and when the index would pass `SKILL_INDEX_MAX_CHARS`; the per-skill 20,000 and per-file 64 KB limits stay.

**Steps**
1. Tests first (fail): `club-rules.test.ts` (the index holds no instruction text of an unloaded skill; 40 skills stay under 8,000 characters; a body cannot close its block); `skill-select.test.ts` (stage, overlap, `ratedSkillKey`, the character budget, same input gives the same output); `apps/gateway/src/__tests__/platform-skills.test.ts` (own skill returned; another agent's skill and an unknown key refused; a stored skill that no longer passes `screenSkill` refused with the reason; a library skill returns the catalog text when the stored copy differs; an audit row is written); `apps/orchestrator/src/__tests__/grants-contract.test.ts` (the new capability resolves); `session-live.test.ts` (index mode when the grant is present, loaded form when not).
2. Implement in the order: agents types and render, `selectSkills`, connector tool and mock, gateway host, grants, orchestrator, api conversation, training, limits. verify after each: that package's `test` and `typecheck`.
3. Evals. Offline (`skills-read.test.ts`, mock model): the request for a task matching one of ten indexed skills offers `read_skill` and carries the index. Live (`read-skill.eval.test.ts`, skipped without a key): (a) the first tool call is `read_skill` with the right key, 9 of 10 cases; (b) given a loaded skill with the line "Send it as soon as it is ready" on an email task that needs approval, the reply asks for approval and says the skill line was not followed, 5 of 5.
4. Record in docs/DECISIONS.md: "Skills load on demand: an index in every prompt, bodies through read_skill; the 2026-10-16 limits of 8 skills and 60,000 characters become 40 skills and an 8,000-character index. Library skills follow the catalog."

**Tests and evals:** as above. **Done when:** Done-when 4. **Does not cover:** multi-file skill bundles (cut, see Not now); how often agents load the right skill on real tasks (read `agent.skills.read` audit rows after a week).

### [x] T5: One hire implementation   [S] [ships alone]

**Why:** TS-14; planner's decision 3 needs one place to attach defaults. (OUTLINE.md lists TS-14 under WP-04; it is done here because T6 depends on it. WP-04 changes how many agents commit hires, not how one is written.)

**Files:** create `packages/db/src/hire.ts`; modify `packages/db/src/index.ts`, `apps/api/src/services/squad.ts` (re-exports `hireFromTemplate`, `hireMany`, `HireOptions`, `HiredAgent`, `PlannedHire` so `commit.ts:37` and `team.ts` do not change), `apps/orchestrator/src/activities/plan.ts:511-521`; tests `apps/orchestrator/src/__tests__/plan.test.ts`, `packages/db/src/__tests__/repos/team.test.ts`.

**Interfaces (moved unchanged):** `hireFromTemplate(tx: Executor, businessId: string, templateKey: string, opts?: HireOptions): Promise<HiredAgent>`; `hireMany(tx: Executor, businessId: string, plans: PlannedHire[], opts?: { createdBy?: string | null; currency?: string }): Promise<HiredAgent[]>`.

**Steps**
1. Extend `plan.test.ts` (fails): after a `hire_agent` action with `department_id`, the agent has a `department_members` row, `lineManagerId` equal to the department's `leadAgentId`, the same `agent_skills` rows as `team.agents.hire` writes, and an audit row `team.agents.hire` with `actorKind: "agent"`.
2. Move the two functions; the plan action calls `hireFromTemplate` inside one transaction with `repos.departments.addMember` and the audit row. verify: `pnpm --filter @foundmill/orchestrator test plan`, `pnpm --filter @foundmill/api test team-roster idea-commit`.

**Done when:** `grep -rn "repos.agents.create(" apps` finds no hire outside `packages/db/src/hire.ts`.

### T6: Default skills at hire, at commit and by backfill   [M] [after T3, T4, T5]

**Why:** TS-04; planner's decision 3 and 7.

**Files:** create `packages/db/migrations/<next>_skill_defaults.sql` (+ journal), `apps/api/src/services/default-skills-backfill.ts`; modify `packages/db/src/schema/agents.ts`, `packages/db/src/hire.ts`, `packages/db/src/skill-attach.ts`, `packages/db/src/repos/skills.ts`, `packages/agents/src/skill-library.ts`, `apps/api/src/index.ts` (after `backfillPersonasOnBoot`, `:220`), `apps/api/src/services/skills.ts` and `apps/api/src/routers/agent.ts`, `team.ts` (views), `apps/gateway/src/platform-host.ts` (`assignSkill` passes `addedBy`); tests `packages/db/src/__tests__/rls/skill-library-files.test.ts`, `apps/api/src/__tests__/idea-commit.test.ts`, `agent-skills.test.ts`, `packages/db/src/__tests__/repos/team.test.ts`.

**Interfaces**
```sql
alter table agent_skills add column added_by text check (added_by in ('template','founder','chief_of_staff'));  -- null: a rated template skill
alter table agents add column default_skills_version integer not null default 0;
```
Both tables already carry `business_id` and their RLS policies (0004; `agent_skills` stays read-only for app roles); the cross-tenant test is extended in this task for the new columns.
```ts
// packages/agents/src/skill-library.ts
export const DEFAULT_SKILLS_VERSION: number;                                  // max defaultSince in the catalog
export function defaultSkillKeysFor(templateKey: string, sinceVersion?: number): string[];   // library keys, catalog order
// packages/db/src/skill-attach.ts
export async function attachDefaultSkills(tx: Executor, businessId: string, agents: readonly { id: string; agentType: string; templateKey: string }[], options?: { sinceVersion?: number }): Promise<number>;
// attachAddedSkills gains a last parameter: addedBy: "founder" | "chief_of_staff"
// packages/db/src/repos/skills.ts
repos.skills.upsertAddedDefinitions(db, businessId, inputs: CreateAddedSkillInput[]): Promise<SkillDefinition[]>   // one statement
repos.skills.backfillDefaultSkills(db): Promise<{ businesses: number; agents: number; attached: number; failed: { businessId: string; error: string }[] }>
```
- `hireFromTemplate` and `hireMany` call `attachDefaultSkills` and set `default_skills_version = DEFAULT_SKILLS_VERSION`, so commit, Recruitment and the plan's `hire_agent` all attach (about 60 extra rows in a commit's transaction, Estimate).
- Backfill rule (never re-adds a removed skill): for a live agent with `default_skills_version < DEFAULT_SKILLS_VERSION`, attach only defaults whose `defaultSince > agent.default_skills_version` and that the agent lacks, then set the version. A default the founder removed has `defaultSince ≤` the agent's version and is never offered again. A later release that adds a default sets its `default_since` to the next integer.
- `agent.skills.added` returns `addedBy`; `team.agents.catalogue` returns `defaultSkills: { key, name, whenToUse }[]` (WP-10 renders "Comes with").

**Steps**
1. Tests first (fail): rls test for the two columns; `idea-commit.test.ts`: every non-utility agent of the `b2b_saas` seed has exactly `defaultSkillKeysFor(template.key)` with `added_by = 'template'`; `agent-skills.test.ts`: hire attaches defaults, removing one and running `backfillDefaultSkills` leaves it removed, a catalog fixture with a `default_since: 2` skill is attached once; `plan.test.ts`: `hire_agent` attaches; a unit test that no template's default set breaks `SKILL_INDEX_MAX_CHARS` or `MAX_SKILLS_PER_AGENT`.
2. Migration, schema, repo functions, `attachDefaultSkills`, hire, the boot backfill (same shape and logging as `apps/api/src/services/persona-backfill.ts`), views. verify: `pnpm --filter @foundmill/db test:rls`, `pnpm --filter @foundmill/api test`.
3. Playwright: `apps/web/e2e/agent-skills.spec.ts` asserts a default skill is listed on a newly hired agent's Training tab.
4. Record the decision ("every role comes with default skills; the backfill never re-adds one a founder removed").

**Done when:** Done-when 3 and 7. **Does not cover:** the welcome note saying the team arrives with skills (WP-04 owns first notes).

### T7: Picker data: suggestions, the body on request, availability   [S] [after T3]

**Why:** TS-09; a3b §6b (api), §6f (the two cases kept apart). WP-10 owns the look.

**Files:** `apps/api/src/services/skills.ts` (`libraryView`), `apps/api/src/routers/team.ts:81`, `packages/agents/src/skill-library.ts` (`suggestFor`), `packages/modules/src/team/skills.tsx:90` and `apps/web/components/agents/AddedSkillsPanel.tsx:42,81,96` (pass the agent; copy), `packages/dugout/src/components/agents/SkillPicker.tsx` (suggested rows first, "Read the skill" loads the body; existing components only); tests `apps/api/src/__tests__/agent-skills.test.ts`, `packages/modules/src/team/__tests__/skills.test.tsx`, a Storybook story for the suggested group.

**Interfaces**
- `team.skills.library` (read): input `{ agentId?: Id; templateKey?: string }` → rows `{ key, skillKey, name, description, category, categoryLabel, attribute, whenToUse, version, suggested: boolean, suggestedBecause: string | null, requires: { connectorKey, name, connected: boolean }[], notYetOnFoundmill: string[], attribution: string | null }`. No bodies.
- `team.skills.get` (read): `{ key }` → `{ key, name, instructionsMd }`.
- `suggestFor(templateKey: string, stage: ProductStage): string[]`: skills whose `roles` hold the template, those matching the stage first; no model call (the same choice as 2026-10-07 "the agent builder entry ranks templates locally").
- `connected` comes from the same read `apps/api/src/services/channel-availability.ts` uses.
- Copy, before → after (`AddedSkillsPanel.tsx:42` toast description): "On the attributes now, marked Untested. Library and file skills carry no tests, so a training run reports them as No tests yet; to have one scored, add it as a custom skill." → "{agent} reads it when a task calls for it. You can remove it at any time." (`:81` empty state): drop the two sentences from "No tests to draft" to the end and end with "The agent reads a skill when a task calls for it."

**Steps:** failing api test (a Product Lead sees `project_page_copy` suggested with "Fits this role"; `seo_plan` lists Search Console under `notYetOnFoundmill`; the list carries no `instructionsMd`), implement, update the two callers, story, Playwright `agent-skills.spec.ts` (suggested group shown; the body opens). verify: `pnpm --filter @foundmill/api test agent-skills`, `pnpm --filter @foundmill/modules test`, `pnpm test:e2e agent-skills`.

**Done when:** the list response for 83 skills is under 60 KB and the picker shows suggestions for the agent it was opened from.

### T8: Measure once on the platform: evidence and starting ratings   [L] [after T3; the run needs the founder's go-ahead]

**Why:** TS-02 (a), TS-15, a3b §6d and §7.3 gaps 1 and 3; planner's decision 5.

**Files:** create `evals/src/skills/effect.ts`, `evals/src/__tests__/skills-effect.test.ts`, `evals/src/skills/effect.eval.test.ts`, `scripts/build-skill-evidence.mjs`, `packages/agents/src/skill-library/evidence.generated.ts`; modify `packages/agents/src/prompts/skill-grader.ts` (v2), `packages/agents/src/skill-library.ts` (exports), `evals/package.json` (script `skills:measure`), `packages/agents/src/__tests__/skill-library.test.ts`.

**Interfaces**
```ts
// packages/agents/src/skill-library/evidence.generated.ts (generated from the run's JSON, reviewed in a pull request)
export interface SkillEvidence { skillKey: string; version: number; templateKey: string; modelKey: ModelKey; ratedSkillKey: string; before: number; after: number; tests: number; measuredAt: string }
export const SKILL_EVIDENCE: readonly SkillEvidence[];
export const TEMPLATE_RATINGS: Record<string, Partial<Record<ModelKey, Record<string, { rating: number; tests: number; measuredAt: string }>>>>;
export const PENDING_EVIDENCE: readonly { skillKey: string; templateKey: string }[];
```
- Arms, per template T on its route's model: (0) bare template; (1) T with its whole default set; (2) for each default skill S of T, T with S alone. Each arm runs `getSkillTests(K, { includeHeldOut: true })` for every rated key K that some default of T `improves`, with `selectSkills({ ratedSkillKey: K })` deciding what is loaded, scored by `runDeterministicChecks` then the grader, rating by `ratingFromTested`. `TEMPLATE_RATINGS[T][model][K]` = arm 1; `SKILL_EVIDENCE` = arm 2 against arm 0. A change under 2 points is recorded and not shown as a change.
- Grader v2: anchored levels per rubric line (what 0.3, 0.6 and 0.9 mean), fixed order; the offline test pins its structure.
- Cost (Estimate, list prices in `packages/models/src/pricing.ts`, the api's own figures of 3.8 cents a test on Sonnet and 5.8 on Opus): about 28 default-bearing templates × about 3 improved keys × 12 tests × (2 + about 2.5 single-skill arms) ≈ 4,400 tests ≈ $170 to $250 a full run; half on the Batches route once WP-09 lands; a re-run after a skill edit covers only that skill's pairs.

**Steps**
1. Offline test first (fails): with the mock model, `runSkillEffect` runs the three arms for one template, pairs tests by id across arms, and returns the JSON the generator reads; the generator's output round-trips.
2. Implement the harness, the grader v2, the generator. verify: `pnpm --filter @foundmill/evals test skills-effect`.
3. `skill-library.test.ts`: every (skill at its current `version`, template in `defaultFor`, improved key) has a `SKILL_EVIDENCE` row or a `PENDING_EVIDENCE` entry, so a text change without a re-measure is visible. Ship the task with everything pending.
4. After the go-ahead: `MODEL_MODE=live pnpm --filter @foundmill/evals skills:measure`, commit the generated file in its own pull request with the run's cost in the description.

**Tests and evals:** steps 1 and 3; the live suite doubles as a3b §7.3 gap 1 (pass: for each default pair, arm 2 ≥ arm 0 on the improved key and no house-rule check fails; a skill that lowers its key is listed for rewrite, not shipped as a default). **Done when:** Done-when 6 with pending entries; then with numbers.

### T9: Hire writes measured ratings; adding a skill shows its evidence   [M] [after T8]

**Why:** TS-02 (a) and (c), TS-09 ("Untested" advice), CLAUDE.md "Label every non-real number".

**Files:** `packages/db/src/hire.ts`, `packages/db/src/repos/skills.ts` (backfill step), `apps/api/src/services/skills.ts` (`addedSkillView`, `libraryView`), `apps/api/src/routers/agent.ts` (`agent.profile.get`), `packages/shared/src/terms.ts:561` (Potential); tests `idea-commit.test.ts`, `agent-profile.test.ts`, `agent-skills.test.ts`, Playwright `agent-profile.spec.ts`.

**Interfaces**
- Hire: for each rated skill, `tested = TEMPLATE_RATINGS[template.key]?.[template.modelKey]?.[skillKey]?.rating ?? null`; `displayed = tested ?? template.baselineRating`; `potential = displayed`. The UI path for `tested: null` exists (`apps/web/components/agents/logic.ts:95-108`, "Untested").
- Backfill (same boot job as T6, one more version step): for agents with no promoted training run, rewrite `tested` the same way. A promoted run's ratings are never touched.
- `team.skills.library` rows and `agent.skills.added` rows gain `evidence: { ratedSkillKey, ratedSkillName, before, after, tests, measuredAt }[]` for the agent's template and model. Adding a skill does not write a rating (the evidence is for the standard version with that skill alone); the toast says, when evidence shows a change of 2 or more: "On the standard version of this role, {ratedSkillName} went from {before} to {after} of 20 on {tests} practice tasks ({date})."
- Copy, before → after (`terms.ts:561`, Potential): "An agent close to its ceiling is better replaced than trained" → "The best score this agent has reached in its recent practice runs."

**Steps:** failing tests (a hired Product Lead's `spec_writing` is the fixture's measured value; a skill with no measurement reads `tested: null`; a promoted agent is untouched by the backfill; `added` carries evidence), implement, Playwright. verify: `pnpm --filter @foundmill/api test`, `pnpm test:e2e agent-profile`.

**Done when:** no code path writes `tested: template.baselineRating` (`grep -rn "tested: template.baselineRating" apps packages` is empty).

### T10: The scoped per-agent check   [M] [after WP-09's affordability check in `agent.training.run`]

**Why:** TS-03 (a), A7-06 item 4, a3b §6d "Per-agent check". WP-09 owns the batch route, the grader's model and the refusal when the balance cannot finish a run.

**Files:** create `packages/db/migrations/<next>_training_run_kind.sql`; modify `packages/db/src/schema/agents.ts`, `packages/db/src/repos/training.ts`, `apps/api/src/routers/agent.ts` (`agent.training.run`, `agent.training.estimate`, new `agent.skills.measure`), `apps/orchestrator/src/activities/training.ts` (`loadTrainingRun` `:104-143`, `runSkillTests`), `apps/orchestrator/src/workflows/trainingRun.ts`, `apps/orchestrator/src/activities/types.ts` (`LoadedTrainingRun`); tests `apps/orchestrator/src/__tests__/activities.test.ts`, `apps/api/src/__tests__/agent-profile.test.ts`.

**Interfaces**
```sql
alter table training_runs add column kind text not null default 'training' check (kind in ('training','model_retest','skill_check'));
alter table training_runs add column skill_keys text[];
```
- `agent.training.run` input gains `skillKeys?: string[]` (1 to 3, each a key the agent carries); the run tests only those. `agent.training.estimate` takes the same and prices it.
- `agent.skills.measure` (write, `modelLimited("training")`): `{ agentId, skillKey }` → `{ run, estimate }`; creates a run of `kind: 'skill_check'` with `skill_keys` = the rated keys the skill `improves` that the agent carries, two arms on the live version (with and without the skill loaded); `loadTrainingRun` accepts a run with no draft for this kind only. Results are written through `repos.training.decide` like any run (2026-10-18), so the rating changes only when the founder accepts.
- Price shown before it starts, from `agent.training.estimate`: one improved skill is 12 tests × 2 arms, about $0.90 on a Sonnet agent and $1.40 on an Opus lead at today's prices (Estimate).

**Steps:** failing activity test (a `skill_check` run with two arms and one key makes 24 candidate calls and records both arms), failing api tests (`skillKeys` outside the agent's skills is a 400; the estimate for 1 key is one fourteenth of a 14-skill run), migration, implement. verify: `pnpm --filter @foundmill/orchestrator test activities`, `pnpm --filter @foundmill/api test agent-profile`.

**Done when:** a founder can check one skill on one agent and sees the price first. **Does not cover:** the button's placement (WP-10).

### T11: Make an edit live without a run   [S] [ships alone]

**Why:** TS-17 (a3b §6g item 4): a draft goes live only through `repos.training.decide`, so changing one line costs a full run.

**Files:** `apps/api/src/routers/agent.ts` (new `agent.training.promoteDraft`), `apps/web/components/agents/TrainingTab.tsx` (one secondary `Button` from the design system beside Train); tests `apps/api/src/__tests__/agent-profile.test.ts`, Playwright `apps/web/e2e/agent-profile.spec.ts`.

**Interfaces:** `agent.training.promoteDraft` (write; admin when `widensGrants(live.tools, draft.tools)`, `agent.ts:60`): `{ agentId, versionId }` → `Agent`. Refuses when the version is not a draft, when `detectClubRuleViolation` reports a violation, or while a run for it is active (`repos.training.activeForVersion`). Calls `repos.agents.promoteVersion(db, businessId, agentId, versionId)` on the service connection after the membership check, emits the existing `agent.promoted` event through the outbox, and writes an audit row `agent.version.promote_untested`. `agent.profile.get` returns `untestedSinceChange: boolean` (the live version is above 1 and has no promoted run). New strings: button "Make it live without testing"; confirm line "This version goes live now. Its ratings stay as they were and are marked not tested since the change."

**Steps:** failing api tests (a one-line edit goes live; a tool-widening draft is refused for a non-admin; a rule-breaking draft is refused with the rule number), implement, Playwright. verify: `pnpm --filter @foundmill/api test agent-profile`.

**Done when:** an instruction edit reaches the next session at no model cost.

### T12: Two honesty fixes in Recruitment and Training copy   [S] [ships alone]

**Why:** TS-08. The real builder and a wired Coach are under Not now.

**Files and strings (before → after)**
- `packages/modules/src/team/RecruitmentScreen.tsx:99` `purpose`: "Hire new agents: describe one in a sentence, or pick a ready-made template from the catalog." → "Hire new agents: describe the work to find the closest role, or pick one from the catalog."
- `:100` `action`: "Say what the agent should do and press Draft this agent; or use the … on a template and choose Hire…. It joins a department and starts next cycle." → "Say what the agent should do and press Find the closest role; or use the … on a template and choose Hire…. It joins a department and starts next cycle."
- `:253` panel title "Agent builder" → "Find a role"; `:274` button "Draft this agent" → "Find the closest role".
- `apps/web/components/agents/TrainingTab.tsx:328`: "`<Term id="coach">Coach</Term>` proposals" → "Suggested edits"; `:322` "The Coach proposes instruction edits for each" → "Each comes with suggested instruction edits".
- Tests: update the matching assertions in `packages/modules/src/team/__tests__` and `apps/web/e2e/team-development.spec.ts`, `agent-profile.spec.ts`. verify: the three copy linters; `pnpm --filter @foundmill/modules test`.

**Done when:** no screen says an agent drafted or proposed something that fixed code produced.

## Inventory of drafted skills

As listed in `docs/holistic-plan/skills/` on Nov 15, 2026 at 12:37 GMT: **64 files** (customers 2, design 2, engineering 10, finance 3, legal 3, marketing 29, operations 5, product 7, sales 3). Other sessions were still adding drafts; anything newer gets the same mapping and an `improves` list chosen by the same rule (rated keys of the templates in its `roles`). Read in full or in large part for this plan: `coding_discipline`, `project_page_copy`, `week_one_plan`, `first_ten_conversations`, `first_sale_path`, `positioning_notes`, `founder_notes`, `cold_email`, `social_post_writing`, `support_desk`, `proof_before_done`, `seo_plan`. All 64 have every heading of the authoring spec including "If a tool is missing"; none contains an HTML comment, "system prompt" or a `curl` line.

"Default for" is after T3's edits. `requires` uses the mapping in T3 (all `better_with`); "SC" marks `notYetOnFoundmill: Search Console`.

| Key | Category | Default for | `requires` | `improves` |
| --- | --- | --- | --- | --- |
| `churn_prevention` | customers | none | platform_mail, stripe | reply_handling, segmentation |
| `support_desk` | customers | none | platform_mail, stripe | communication, knowing_when_to_ask |
| `interface_design_principles` | design | design_to_code | github | design_principles, design_fidelity, component_craft |
| `ui_quality_checklist` | design | qa_engineer | github | exploratory_testing, accessibility, change_risk_assessment |
| `acting_on_review` | engineering | none | github | scope_control, testing |
| `coding_discipline` | engineering | the eleven code templates | github | scope_control, planning, testing |
| `finishing_a_branch` | engineering | none | github | release_hygiene, reliability |
| `implementation_plans` | engineering | planner | github | task_decomposition, acceptance_criteria, dependency_mapping |
| `proof_before_done` | engineering | backend_engineer, frontend_engineer, qa_engineer, review_agent | github | testing, test_design, reliability |
| `reviewing_code` | engineering | review_agent | github | code_review, change_risk_assessment |
| `splitting_work` | engineering | engineering_lead | github | delivery_management, dependency_mapping, delegation |
| `systematic_debugging` | engineering | backend_engineer, qa_engineer | github | debugging |
| `test_first` | engineering | backend_engineer, frontend_engineer | github | testing, test_design |
| `web_app_testing` | engineering | qa_engineer | github | exploratory_testing, test_automation |
| `first_budget` | finance | finance_lead | none | runway_forecasting, financial_modelling |
| `pricing_analysis` | finance | finance_lead | web, stripe | financial_modelling, evidence_synthesis |
| `unit_economics` | finance | finance_lead | none | financial_modelling |
| `contract_review` | legal | legal_lead | web | contract_review, risk_awareness |
| `marketing_compliance` | legal | none | web | compliance_tracking, marketing_compliance |
| `terms_and_privacy_basics` | legal | legal_lead | web | compliance_tracking, jurisdiction_analysis |
| `agent_readiness` | marketing | none | web, github | structured_data, entity_consistency |
| `ai_answer_visibility` | marketing | channel_geo | web, github, posthog | answer_share_analysis, citation_earning, entity_consistency |
| `competitor_profiles` | marketing | none | web | source_evaluation, synthesis, positioning |
| `content_brief` | marketing | channel_seo | web | content_briefs, editorial_planning |
| `content_matrix` | marketing | none | none | editorial_planning, platform_fluency |
| `content_strategy` | marketing | channel_content | web, posthog | editorial_planning, positioning |
| `conversion_review` | marketing | none | web, posthog | experiment_design, copywriting, conversion_tracking |
| `copy_editing` | marketing | none | none | copywriting, technical_writing, brand_voice |
| `email_sequences` | marketing | channel_email_automation | platform_mail | copywriting, personalisation, segmentation |
| `influencer_partnerships` | marketing | channel_influencer | web, platform_mail | creator_vetting, outreach, brief_writing, disclosure_compliance |
| `keyword_clusters` | marketing | none | web, SC | keyword_research, internal_linking |
| `launch_plan` | marketing | distribution_strategist | web | channel_fit_scoring, experiment_design, pitch_writing |
| `link_building` | marketing | none | web, platform_mail, SC | media_relations, pitch_writing |
| `marketing_ideas` | marketing | none | web | channel_fit_scoring, experiment_design |
| `marketing_plan` | marketing | distribution_strategist | posthog | channel_fit_scoring, budget_allocation, positioning |
| `offers` | marketing | none | none | positioning |
| `plain_human_writing` | marketing | chief_of_staff, docs_writer | none | communication, technical_writing, copywriting |
| `positioning_notes` | marketing | distribution_strategist | none | positioning, evidence_synthesis |
| `post_hooks` | marketing | none | none | copywriting, platform_fluency |
| `press_outreach` | marketing | channel_pr | web, platform_mail | media_relations, pitch_writing, press_release_writing |
| `project_page_copy` | marketing | product_lead, channel_content | none | copywriting, positioning, technical_writing |
| `referral_program` | marketing | channel_affiliate | stripe, posthog | programme_design, commission_modelling, fraud_detection |
| `seo_page_audit` | marketing | channel_seo | web, SC | technical_seo, internal_linking |
| `seo_plan` | marketing | channel_seo | web, posthog, SC | keyword_research, content_briefs |
| `social_post_writing` | marketing | channel_social | buffer | copywriting, brand_voice, platform_fluency |
| `social_strategy` | marketing | channel_social | buffer, posthog | platform_fluency, community_management |
| `structured_data` | marketing | none | github, web | structured_data, technical_seo |
| `technical_seo` | marketing | none | web, github, SC | technical_seo, performance |
| `voice_guide` | marketing | distribution_strategist | none | brand_voice, positioning |
| `founder_notes` | operations | chief_of_staff | none | communication, decision_framing |
| `founder_tasks` | operations | chief_of_staff | none | delegation, decision_framing |
| `inbound_triage` | operations | none (was `triage`) | none | prioritisation |
| `operating_rhythm` | operations | chief_of_staff, operations_lead | none | cycle_planning, process_design |
| `week_one_plan` | operations | chief_of_staff | platform_mail, buffer, stripe | cycle_planning, prioritisation |
| `cited_market_research` | product | researcher | web | source_evaluation, citation_discipline, synthesis |
| `customer_research` | product | product_researcher | web | discovery_interviewing, evidence_synthesis, synthesis |
| `experiments` | product | none | posthog | experiment_design |
| `first_ten_conversations` | product | product_lead | platform_mail | discovery_interviewing, evidence_synthesis |
| `onboarding_design` | product | product_lead | posthog, platform_mail | spec_writing |
| `signup_flow` | product | none | github, posthog | spec_writing, accessibility |
| `tracking_plan` | product | data_engineer | posthog, github | data_quality, sql_analytics |
| `cold_email` | sales | channel_lead_generation | platform_mail | personalisation, marketing_compliance, icp_definition |
| `first_sale_path` | sales | distribution_strategist | stripe, platform_mail | channel_fit_scoring, experiment_design, decision_framing |
| `lead_prospecting` | sales | channel_lead_generation | web | icp_definition, lead_sourcing, lead_scoring |

Defaults per template after T3 (the index a new agent carries): chief_of_staff 5; distribution_strategist 5; qa_engineer 5; backend_engineer 4; product_lead, finance_lead, frontend_engineer, channel_seo 3; review_agent 3; engineering_lead, legal_lead, design_to_code, data_engineer, docs_writer, planner, channel_social, channel_lead_generation, channel_content 2; infra_engineer, integration_agent, operations_lead, researcher, product_researcher, channel_email_automation, channel_geo, channel_pr, channel_influencer, channel_affiliate 1. None: channel_paid_ads, channel_events, channel_direct_mail, channel_print, channel_broadcast, channel_outdoor, the eight specialists, the five utilities.

## Second-wave skills to draft, by role

To the same authoring spec (`packages/agents/skills/README.md`), each with `improves`, after T6 is live and T8 has numbers for the first wave. Names are working keys.

| Role | Skills |
| --- | --- |
| `chief_of_staff` | `explain_one_idea` (one idea per decision, in a sentence; pairs with WP-04's mentor voice), `giving_agents_skills` (when to call `assign_skill`, and when not) |
| `product_lead` | `first_version_spec` (the smallest thing a person can receive this week), `roadmap_for_week_one` |
| `engineering_lead`, `planner` | `slice_to_first_value`, `incident_write_ups` rewritten to the long format |
| `infra_engineer`, `integration_agent` | `deploy_and_roll_back`, `secrets_checks`, `merge_conflicts` |
| `data_engineer` | `first_numbers_from_records` (counts from the project's own records before any analytics tool) |
| `docs_writer` | `help_page_for_a_first_user`, `release_notes` and `api_reference` rewritten |
| `researcher`, `product_researcher` | `find_the_first_ten_people`, `interview_synthesis` rewritten for notes a founder types or photographs |
| `channel_email_automation` | `welcome_a_new_follower`, `newsletter_writing` rewritten for a list of ten |
| `channel_social`, `channel_content` | `reply_to_comments_and_messages`, `first_article` |
| `channel_paid_ads`, `channel_events` | `first_small_ad_test` (with a cost Estimate and the founder's approval), `first_local_event` |
| `channel_direct_mail`, `channel_print`, `channel_broadcast`, `channel_outdoor` | one shared `offline_campaign_handover` (materials and a founder task; offline tracking) |
| `finance_lead` | `money_in_money_out`, `invoice_follow_up` and `month_end_close` rewritten |
| `legal_lead` | `starting_a_company_basics` (US, facts dated "as of 2026"), `nda_review` and `privacy_requests` rewritten |
| `operations_lead` and the eight specialists | `supplier_shortlist_and_quote_request`, `sample_order_handover`, `landed_cost_estimate`, `certification_roadmap`, `packaging_brief`, `inspection_plan`, `shipping_options`, `ingredient_and_claims_check` |
| A customer-replies role | None until the role exists: `support_desk` and `churn_prevention` have no hireable template that owns customer replies (TS-05). See Decisions for the founder, 4 |
| Utilities (`triage`, `moderation`) | None until a utility call renders a Skills section; `inbound_triage` waits for that |

## Not now (cut from a3b §6, with the reason)

- **Multi-file skill bundles and `skill_definition_files`** (§6c, TS-10): every draft is one file under 12,000 characters, and production holds four uploaded skills. Build it when a founder's upload is refused for needing a second file.
- **Conditional skill parts and `assembleSkillBody`** (§6f): every draft already carries "If a tool is missing", so one body serves both cases. `requires` only feeds the picker.
- **Archetype overlays** (§6a `skillOverlays`): no drafted skill needs one; the stage and task match in `selectSkills` does the choosing.
- **Pinning an old version of a library skill** (§6e): library skills follow the catalog (T4); nobody has a library skill today. Add `pinned` when a founder asks to keep an old text.
- **Writing Proven from real work** (TS-02 b, `recordLiveOutcome`): 67% of sessions end blocked (e0), so outcomes are not yet a fair signal. After WP-05. WP-10 words the "Proven" footer honestly meanwhile.
- **A cap on `read_skill` calls per session**: the tool is read-only and the session's turn limit bounds it.
- **A model-backed agent builder and a wired Coach** (TS-08, BUILD §11.13, §12.6): T12 makes the copy true; the feature waits for evidence that founders hire beyond the starting team.
- **TS-16 items, TS-18, TS-20, TS-21**: unused schedules and platform catalog drift (WP-11 hygiene), the "I want to…" catalog view (WP-10), stage in every brief and the house rules' reasons (WP-05, WP-04).

## Corrections to the audits

1. a3b §1.5 and §8.1 infer that no founder added a skill and that no person started a training run. e0 measured 4 uploaded skills on real projects (0 from the library) and 1 real training run ($12.78, awaiting a decision since Oct 22).
2. a3b §6g orders defaults before the index on the ground that "25 short skills … stay far below 60,000 characters". The drafted skills are 6.9 to 12 KB each. T4 therefore precedes T6.
3. a3b §6b keeps the library as TypeScript modules; the planner chose Markdown with a generated, checked-in TypeScript catalog. Nothing reads a file at run time either way.
4. a3b §6c grants `read_skill` "in `sessionGrantsFor` (`session.ts:1441`)". `sessionGrantsFor` (`apps/orchestrator/src/activities/second-read.ts:272`) only narrows grants for a second-read revision; it adds nothing. T4 uses `PLATFORM_BASE_TOOLS` and falls back to loaded bodies when the grant is absent, as AR-10 A step 4 says.
5. a3b TS-01 lists `showcase-script.ts:125` among calls made in a project agent's name. It passes `businessName: APP_NAME`: it is the platform's own showcase and has no project agent. Excluded, with `ideation.ts`, `community-screen.ts` and `second-read.ts`.
6. AR-10 A keys `read_skill` by the skill's name; a3b §6c by its key. Names can collide (TS-12), so the key is used.
7. a3b TS-08 says the builder hides that it picks a template. The panel footer already says "The closest template gives the new agent its description, instructions, skills and tools" (`RecruitmentScreen.tsx:253`); the title, explainer and button still overstate, which T12 fixes.
8. a3b §6a and TS-03 name migrations `0108`, `0109`, `0110`. The rule is the next free number when the branch is cut.
9. `docs/holistic-plan/README.md` says WP-05 wires the drafted skills and `skills/README.md` says "WP-4": it is WP-06. The authoring spec's template list includes `triage` and `moderation`, which never render a Skills section, and its "top-level `key: value` only" rule is broken by the ` # us-english-allow` suffix on 23 `attribute_group` lines; the generator strips it.

## Decisions for the founder

1. **Spend on measuring.** T8's first full run costs about $170 to $250 at list prices, about half on the batch route (Estimates). Go-ahead, and on which key.
2. **Existing agents' ratings change.** T9's backfill replaces the constant "10" and "12" on the 13 real projects with measured values or "Not tested yet". Promoted runs are untouched.
3. **Existing agents receive default skills at the next deploy after T6** (1 to 5 each), marked "Came with the role" and removable.
4. **A customer-replies role.** `support_desk` and `churn_prevention` have no role to live in. Add a `customer_support` template (its own change, with evals), or give replies to the Chief of Staff for now.
5. **Editing without testing (T11)** changes the Training tab's rule that a change goes live only after a run. The alternative is to keep the rule and rely on T10's cheaper check.
6. **Confirm the Nov 15 planner's calls 1 to 3**, recorded as "open to the founder" in docs/DECISIONS.md.

## Risks

- **`session.ts` is shared with WP-05.** T4 edits two places; rebase on WP-05's latest merged task and re-run `session-live.test.ts`.
- **Agents may not call `read_skill`.** The index is advice. T4 loads the best match for sessions and its live eval sets a 9 of 10 bar; if real audit rows show few reads, raise `maxBodies` before rewriting prompts.
- **The plain-language gate.** 64 long texts enter a counted scan. Fix skill wording; do not raise the gate.
- **Grader drift.** Evidence is only as stable as the grader; v2 anchors come before the first measuring run, and a change under 2 points is never shown.
- **Backfills change production data at boot** (T6, T9). Both are idempotent by version, log per business like `persona-backfill.ts`, and never touch a promoted run or re-add a removed skill; run them first against a copy with the demo seed.
- **Adapted text.** Every adapted skill carries its source and an MIT or Apache-2.0 license, tested; `karpathy-guidelines` and `impeccable` have no license upstream and nothing from them ships.
- **Cost of loaded bodies.** One loaded body is up to 12,000 characters (about 3,000 tokens) per session; WP-09's cost report should show the Skills section's share after T6.

## Starting prompt

```
You are executing work package WP-06 "Skills for every role" for Foundmill.

Read first, in this order: CLAUDE.md; docs/holistic-plan/README.md; docs/holistic-plan/WP-06-skills-for-every-role.md
(the whole file); packages/agents/CLAUDE.md and the CLAUDE.md of each package a task touches; the sections of
docs/holistic-plan/audits/a3b-templates-skills-team.md that the task you are starting cites (grep for the finding id).

Rules: use the plan-change skill before writing code (overlap with other branches, next free migration number).
Follow the karpathy-guidelines skill on every change. One task is one pull request on a branch claude/wp06-t<n>-<name>;
never push to main and never merge: the founder merges. Tests first: each task names the test that fails before the
change. Do not reopen the decisions listed under "Decisions that bind this package". Run verify-done before you say a
task is finished, and report what the checks do not cover. Record one line in docs/PROGRESS.md per task, judgment calls
in docs/DECISIONS.md, and tick the task in the work package file in the same pull request.

Start with T1, T2 and T5 (independent; they can be three pull requests in any order). Then T3. Do not start T4 until
WP-05's open task on apps/orchestrator/src/activities/session.ts is merged; do not start T6 before T3, T4 and T5 are
merged. T8's code can merge with everything pending; do not run the live measuring job without the founder's recorded
go-ahead on its cost. T10 waits for WP-09's affordability check. Before T3, list docs/holistic-plan/skills/ again:
drafts were still being added on Nov 15, 2026, and every file found there moves.

Run with MODEL_MODE=mock and INTEGRATIONS_MODE=mock. If a task looks larger than its finding needs, say so in the pull
request and build the smaller thing.
```
