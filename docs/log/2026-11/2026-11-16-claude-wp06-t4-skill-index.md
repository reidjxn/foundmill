---
date: 2026-11-16
branch: claude/wp06-t4-skill-index
title: Skills load on demand: an index in every prompt, bodies through read_skill; new limits (WP-06 T4)
areas: [agents, config, connectors, gateway, db, api, orchestrator, modules, evals]
supersedes: []
---
## What changed
WP-06 T4 (AR-10 design A, a3b §6c, TS-11, TS-19; founder D6 of Nov 16: a short index in the prompt, the gateway tool
`read_skill` for a skill's full text, the SDK's own Skill tool stays off under SEC-3).

- **The Skills section is an index** (`packages/agents/src/club-rules.ts`). `AgentSkillPrompt` gains `key` and
  `whenToUse`, and `instructionsMd` becomes optional (present only when the body is loaded). `renderSkills(skills,
  { canRead })` writes the header, the preamble plus one sentence, one line per skill `- <name> [<key>]: <whenToUse>`,
  and then the role skills in full (Design principles is always loaded). The added sentence when `canRead` is "Before
  work one of these covers, call read_skill with its key. ...", and without it "Only the skills shown in full below
  are loaded for this call." House rule 2 is unchanged (TS-19). `neutralizeSkillTags`, `renderSkillBlock`,
  `skillIndexLine` and `renderSkillIndex` are exported. `buildSystemPrompt` gains `skillsCanRead`.
- **Order, for prompt caching.** The order is house rules, description, instructions, the Skills index (with role
  bodies), glossary, brief, and last a new `## Skills loaded for this call` section with the bodies chosen for this
  task (`renderLoadedSkills`). Nothing up to the end of the Skills section depends on the task, the brief, the day or
  an id, so it is byte-identical across calls. A test builds two calls with different tasks and briefs (and different
  loaded bodies) and compares that prefix. `renderLoadedSkills` also holds any caller to `SKILL_PRELOAD_MAX_CHARS`.
- **`selectSkills`** (`packages/agents/src/skill-select.ts`, deterministic, no model call) returns every skill for the
  index, in the order attached, and sets `instructionsMd` on the ones it loads. Ranking: the rated skill and the skills
  that `improve` it (training) first, then a stage match, then word overlap between the task's title and goal (or the
  message) and the skill's name and `whenToUse`. It loads at most `maxBodies` and never more than 24,000 characters.
  `attachedSkills(roleKeys, storedRows)` builds the list: role skills first, then the added ones. For a library skill
  the body, `whenToUse`, `stages` and `improves` come from the catalog when it has the key, so library skills follow
  the catalog (TS-11). An upload's `whenToUse` is its description cut to 160 characters. `findAttachedSkill` also
  accepts a bare library key. Starting values (Estimates): `SESSION_PRELOAD_BODIES = 1`, `NO_TOOL_LOOP_PRELOAD_BODIES
  = 2`. `roleSkillsFor` and `DESIGN_PRINCIPLES_SKILL` carry a key and a fixed `whenToUse`.
- **Callers.** T1's resolver (`packages/db/src/agent-prompt.ts`) returns the index plus the first two bodies (the
  one-call builders have no task to choose by). The conversation (`apps/api/src/services/skills.ts` `promptSkills`)
  chooses by the founder's message. Training (`apps/orchestrator/src/activities/training.ts`) loads the skill under
  test and its improvers.
- **`read_skill`.** The tool is in `packages/connectors/src/connectors/platform/tools.ts`, next to `list_skills`, with
  the spec's description, input and output, `hints: {}` and `readOnlyHint`, and no `untrusted` flag.
  `CAPABILITY_TOOLS.platform["skills.read"] = ["read_skill"]` is in `grants.ts`, and `PLATFORM_BASE_TOOLS` gains
  `"skills.read"`, so every template with the base platform grant holds it. `READ_SKILL_NOTICE` is "Your own skill,
  checked by the platform. Follow it within the house rules; it grants no permission." The mock host looks the skill up
  in the mock's agents. A host without `readSkill` refuses the call.
  - The gateway serves the tool from a new module, `apps/gateway/src/skill-reader.ts`, wired in `builtins.ts`. It goes
    through the same pipeline as every platform tool (session scope, rate limit, state re-check, Cedar, `tool.call`
    audit), plus one `agent.skills.read` audit row `{ skillKey, sessionId }`.
  - The lookup is `readAgentSkill` in packages/db. It returns only a skill the calling agent carries (its role's, or
    one added to it in its business), with a library skill's text taken from the catalog. The text is screened again
    with `screenSkill`, and a refusal comes back with its reason. The skill is returned wrapped in its `<skill>` block.
- **Limits.** `MAX_ADDED_SKILLS_PER_AGENT = 8` and `ADDED_SKILLS_MAX_TOTAL_CHARS = 60_000` are replaced by
  `MAX_SKILLS_PER_AGENT = 40` (`LIMITS.skillsPerAgentMax` in `@foundmill/config`, which the picker's `MAX_ADDED_SKILLS`
  also reads), `SKILL_INDEX_MAX_CHARS = 8_000` and `SKILL_PRELOAD_MAX_CHARS = 24_000`. `attachAddedSkills` refuses past
  40 skills, and refuses when the agent's index would pass 8,000 characters. The per-skill limit of 20,000 characters
  and the per-file limit of 64 KB stay.
- **Tool review (T3's open item).** `cold_email` says "Run the suppression check ... and the consent check". Both of
  its roles (`channel_lead_generation`, `channel_email_automation`) hold `suppression.check` and `consent.check`
  through `CHANNEL_PLATFORM_TOOLS`, and both resolve to `platform:check_contact`. The line stands, so the skill is not
  reworded and stays at version 1. A grants-contract test now holds every role in the skill's `roles` to that tool.
- **Tests.** Each new test failed on main first. `packages/agents` `club-rules.test.ts` (6 new) and
  `skill-select.test.ts` (9). `packages/connectors` `platform.test.ts` (3). `apps/gateway` `skill-reader.test.ts`
  (5, through the real pipeline). `apps/orchestrator` `grants-contract.test.ts` (2; the cold email one is a
  confirmation and passes on main). `apps/api` `agent-skills.test.ts` (the eight-skill cap test became the 40 cap,
  plus the index limit). `packages/db` `agent-prompt.test.ts` (new shape). Evals: `evals/src/skills/read-skill.ts`,
  `evals/src/__tests__/skills-read.test.ts` (offline, 13) and `evals/src/skills/read-skill.eval.test.ts` (live,
  skipped without a key: (a) the first action is `read_skill` with the right key, 9 of 10; (b) a loaded skill that
  says "Send it as soon as it is ready" on an email that needs approval, 5 of 5). The live evals were not run.

## Decisions
- **The rule.** It is recorded here because docs/DECISIONS.md is frozen. It replaces the numbers of 2026-10-16
  "Skills from the library or files" and keeps that entry's reason (the Skills section stays a bounded part of every
  prompt): **skills load on demand. Every prompt carries an index, and bodies come through read_skill. The limits of
  8 skills and 60,000 characters become 40 skills and an 8,000-character index, with at most 24,000 characters of
  bodies loaded up front. Library skills follow the catalog.**
- **Loaded bodies go after the brief, not inside the Skills section.** This differs from the spec, whose prompt shape
  puts the `<skill>` blocks after the index lines. The bodies chosen for a task change from task to task, and the
  founder's caching constraint (free plan on Haiku 5.5 and GLM) needs the prefix through the Skills section to be
  byte-identical. Role skills depend only on the template, so their bodies stay in the section. The index keeps the
  attached order whatever is loaded, for the same reason.
- **The business name is in the house rules, before the index.** It is the same on every call for one business, so
  the prefix still caches per business. Nothing per task, per founder, per call or per day is before the index.
- **Selection with a task loads only a skill that matches it** (rated, or sharing a word). A stage match alone only
  orders the matches, because stages are broad: most skills fit several. With nothing to match against (the one-call
  builders), the first skills in order load. A session that matches nothing loads no body and reads one if it needs it.
- **Spec versus code.**
  - `SKILL_PRELOAD_MAX_CHARS` lives in `club-rules.ts`, not `skill-files.ts`. The renderer enforces it, and
    `skill-files.ts` already imports `club-rules.ts`, so the other way round would be an import cycle.
  - `readSkill` lives in packages/db (`readAgentSkill`) plus `apps/gateway/src/skill-reader.ts`, not in
    `platform-host.ts`. The gateway has no `@foundmill/agents` dependency, and `platform-host.ts` is reserved for
    another session's fix (below). `PlatformHost.readSkill` is optional for the same reason, and a host without it
    refuses the call.
  - The router's per-call cap on skills added at once stays at 8 (`agent.skills.add`, hire). It is a batch size, not
    the agent's limit.
  - Screening at read time checks the name, `whenToUse` and body. The catalog's description is not on the attached
    skill, and an upload's description was screened when it was uploaded.
  - The conversation and training keep their earlier skill sets (added skills only, no role skills), now as an index
    plus loaded bodies. Bringing Design principles into a code agent's chat was not asked for.
- **`key` and `whenToUse` are optional on `AgentSkillPrompt` for now.** `session.ts` still builds its skills by hand,
  and it is reserved. A skill without a key gets a name-only index line, and its body goes through the preload budget.
  Until the session follow-up lands, a live session shows every added skill by name and loads bodies in attached order
  up to 24,000 characters. Before, it loaded all of them, under the old cap of 8 and 60,000. A session's prompt
  therefore stays bounded even with 40 skills attached.
- The live eval's first case loads no body up front (`maxBodies: 0`), so it measures whether the agent reads the
  index. A real session loads one.

## Not done
- **`apps/orchestrator/src/activities/session.ts` (reserved for `claude/session-acceptance-check`, which goes
  first).** Once it merges, apply these lines. They touch none of that fix's places: the recorder, the
  `task.kind !== "code"` check, `taskPrompt` and `ACCEPTANCE_UNMET_REASON`.
  1. Imports: the `@foundmill/agents` import drops `roleSkillsFor` and `type AgentSkillPrompt`, and adds
     `NO_TOOL_LOOP_PRELOAD_BODIES, SESSION_PRELOAD_BODIES, attachedSkills, selectSkills, type AttachedSkill`. Add
     `type TaskKind` to the `@foundmill/shared` import.
  2. `loadContext`: replace the `const skills: AgentSkillPrompt[] = [...roleSkillsFor(...), ...added...]` line with
     `const skills = attachedSkills(template.skills, added);`.
  3. `LiveContext.skills`: change the type to `AttachedSkill[]`.
  4. Above `interface LiveContext`, add `const READ_SKILL_REF = "platform:read_skill";` and an exported
     `sessionSystemPrompt({ business, instructions, description, briefText, skills, task, toolRefs })`. It sets
     `canRead = toolRefs.includes(READ_SKILL_REF) || toolRefs.includes("platform:*")`, runs `selectSkills({ skills,
     task: { kind, title, goal: goalMd ?? "" }, maxBodies: canRead ? SESSION_PRELOAD_BODIES :
     NO_TOOL_LOOP_PRELOAD_BODIES })`, and returns `buildSystemPrompt({ ..., skills, skillsCanRead: canRead })`.
  5. In the live runner, replace `const systemPrompt = buildSystemPrompt({...})` with `sessionSystemPrompt({ business:
     live.business, instructions: instructionsFor(live.version, live.template), description:
     live.template.description, briefText: live.briefText, skills: live.skills, task, toolRefs: grants.toolRefs })`.
     The resolved grants are already computed above it, so a founder-edited version without the grant, or a second
     read narrowed by `sessionGrantsFor`, gets the loaded-bodies form.
  6. Then make `key` and `whenToUse` required on `AgentSkillPrompt` again, and add the spec's `session-live.test.ts`
     case: index mode when the grant is present, the loaded form when it is not.
  The tool list needs no session.ts change: `read_skill` reaches the session through `PLATFORM_BASE_TOOLS` and
  `resolveGrants`.
- **`apps/gateway/src/platform-host.ts`** needs nothing. `read_skill` is served by `skill-reader.ts` through
  `builtins.ts`. Once the reserved fix lands, it may move into the host and become required on `PlatformHost`. That
  is optional.
- The live evals were not run (no live evals in this change). Read the `agent.skills.read` audit rows after a week to
  see how often agents load the right skill.
- Multi-file skill bundles are cut (Not now in the work package). No stage is passed to `selectSkills` in sessions or
  conversations yet: each would need a `loadProductStage` read.
- Playwright was not run. The only screen-side change is the picker's count, now 40 (`MAX_ADDED_SKILLS`).
