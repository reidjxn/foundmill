---
date: 2026-11-17
branch: claude/wp06-t4-session-skills
title: Live sessions carry the skill index and load bodies by their read_skill grant (WP-06 T4 session follow-up)
areas: [orchestrator, agents, evals]
supersedes: []
---
## What changed
The held session.ts follow-up of WP-06 T4 (the "Not done" of 2026-11-16 "Skills load on demand", steps 1 to 6).

- **`loadContext`** (`apps/orchestrator/src/activities/session.ts`) builds the agent's skills with
  `attachedSkills(template.skills, added)`, so a live session gets the same list as every other caller: role skills
  first, library text from the catalog (TS-11), and stored uploads screened again on use (`storedSkillRefusal`). This
  closes M1 and L2 of the T4 review for sessions.
- **`LiveContext.skills`** is `AttachedSkill[]`.
- **`sessionSystemPrompt`** (new, exported): `canRead` is true when the resolved tool refs hold `platform:read_skill` or
  `platform:*`; it runs `selectSkills` with `SESSION_PRELOAD_BODIES` (1) or `NO_TOOL_LOOP_PRELOAD_BODIES` (2) and
  returns `buildSystemPrompt({ ..., skills, skillsCanRead: canRead })`.
- **The live runner** calls it with the already-resolved `grants.toolRefs` (after `sessionGrantsFor`), so a
  founder-edited version without the grant, or a second read narrowed to the document tools, gets the loaded-bodies
  form.
- **`AgentSkillPrompt.key` and `whenToUse` are required** (`packages/agents/src/club-rules.ts`), and the comment about
  session.ts building skills by hand is gone. Two test callers that the stricter type broke now pass both:
  `packages/agents` `club-rules.test.ts` (the preload-budget case, which was written for session.ts's keyless skills)
  and `evals/src/__tests__/skills.test.ts` (`promptSkill`).
- **Tests** (`apps/orchestrator/src/__tests__/session-live.test.ts`). The runner case now checks the index line with its
  key and the catalog's `whenToUse`, the read sentence, and that a skill the task does not match is not loaded. A new
  case calls `sessionSystemPrompt` directly: index mode with one body when `read_skill` is granted (and with
  `platform:*`), the loaded-only sentence with two bodies when it is not, bodies after the brief, and the prefix through
  the Skills index the same in both but for the one sentence. Both fail on main (main shows name-only lines and has no
  `sessionSystemPrompt`).
- Not touched: `SAVE_REPORT_RULE`, any channel template's report wording, the recorder, `taskPrompt`, the acceptance
  lines and `ACCEPTANCE_UNMET_REASON`.

## Decisions
### Where the code differed from the spec
- Line numbers moved: `loadContext`'s skills line is now near `:812` and the prompt near `:1630`, after the free-plan
  cap check (WP-13 T6), the not-connected check (WP-05 T12) and the session budget. The resolved grants are still
  computed above the prompt, so step 5 applied as written.
- Step 1 asked to add `type TaskKind` to the `@foundmill/shared` import. `sessionSystemPrompt` takes `task: Pick<Task,
  "kind" | "title" | "goalMd">` from the `Task` type session.ts already imports from `@foundmill/db`, so the shared
  import is unchanged. `goalMd` is `not null` in the schema; the `?? ""` stays as the spec wrote it.
- `business` in `sessionSystemPrompt` is `{ name, glossary }`: the old call passed the glossary and the prompt still
  needs it.
- The old runner test asserted that a library skill's stored text reached the prompt. With `attachedSkills` the catalog
  text replaces it (TS-11), and the research task ("Shortlist three suppliers") matches no word of Meeting notes, so no
  body loads. The test was rewritten to assert that, rather than kept on a fact the spec deliberately changed.
- `skillIndexLine` keeps its guards for an empty key or `whenToUse`. They cost nothing and no caller needs them changed.

### WP-06 T6 (default skills at hire) is safer merged after this
T6 attaches 1 to 5 library defaults to every agent as stored rows that `repos.skills.listAddedForAgent` returns, and it
does not touch session.ts. On main before this change, session.ts maps those rows by hand: no key and no `whenToUse`, so
the index lines are names only and the agent cannot name a skill to `read_skill`, and the stored body (not the
catalog's) is loaded in attached order up to 24,000 characters. With defaults of 6.9 to 12 KB, that is two or three
bodies loaded into every live session whatever the task, which is the cost T4 exists to avoid (plan, Corrections 2),
with read_skill of no use. After this change a session sees every default with its key and loads at most one that
matches the task. T6's file list and this one do not overlap, so the order matters for behavior, not for conflicts:
merge this first. If T6 merges first, nothing breaks, but live sessions run with that extra load until this lands. T6's
new `added_by` column only adds a field to the rows; `attachedSkills` reads the fields it needs and passes the rest by.

## Not done
- No stage is passed to `selectSkills` in sessions (needs a `loadProductStage` read; as in the T4 entry).
- `read_skill` staying optional on `PlatformHost` and moving into `apps/gateway/src/platform-host.ts` is unchanged
  (optional, T4 entry).
- The live evals were not run, and Playwright was not run: no screen changed.
- Nothing in the WP-06 plan is ticked: T4 is already ticked and the plan has no line of its own for this follow-up.
