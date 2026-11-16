---
date: 2026-11-16
branch: claude/wp04-t10-mentor
title: The Chief of Staff as mentor, with the founder's own context (WP-04 T10)
areas: [shared, db, agents, composer, api, orchestrator, evals]
supersedes: []
---
## What changed
- `packages/shared/src/founder-context.ts`: `FounderContext` (first name, experience, strengths, wants to learn, what
  they are here for, budget none / some / not said, the other founders' first names), `founderContextFrom`,
  `founderContextJson` (what the prompts carry) and `founderBriefSection` (the brief's "## Founder"). The experience
  answers and `founderExperienceFrom` moved here from packages/agents, which re-exports them unchanged.
- `repos.founders.contextFor(db, businessId, userId?)`: one statement over the business's memberships joined to the
  profiles. The person's own profile, the first names of the other owners and cofounders; without a person, the primary
  owner (the one `ownerExperience` picks).
- House rules line for the founder: "I'm your Chief of Staff. I run the team beside you and tell you what matters and
  why. Some things are always yours: ...". The Chief of Staff's role line now says it helps the founder learn to run
  the project. Seven `MENTOR_RULES`, each with its reason, are in the Chief of Staff's rules only: the name, one
  explained idea per decision for a first-timer, mark a first, the free option first when there is no budget or none
  was given, one person is a complete team, no jobs or employment as the reason. The "€500 on LinkedIn ads" example is
  now a no-budget one: draft a message and ask five people the founder knows. The invoice example is in dollars.
- Voice register `mentor` for the assistant family (the Chief of Staff), with its own greeting.
- The desk conversation (`ConversationRequestInput.founder`, `agent_conversation` v3) and the Composer (`founder` in
  its inputs, `inbox_composer` v10, apps/composer `composerInputs` and the api's in-process fallback) get the founder as
  trusted JSON. The cycle brief gets "## Founder" right after "## About".
- Eval `evals/src/mentor.ts`: four cases (a first-timer with no budget, an operator, two cofounders, a founder with no
  name), each running the Chief of Staff's conversation reply and the Composer's decision note. Offline checks run in
  CI (`__tests__/mentor.test.ts`); the live run is `__tests__/mentor.eval.test.ts` (nightly, skipped without a key).

## Decisions
- **The rule for prompt caching (coordinator, 2026-11-16):** free accounts run on Haiku 5.5 and their sessions on
  GLM-5.3 Flash. On both, prompt caching works only when the stable part of the prompt comes first and is
  byte-identical across calls. So the house rules, the agent's instructions, voice and skills form the opening block.
  The founder context and anything else per call (the brief, dates, names) come after it. No timestamp, id or
  per-founder value goes inside it, and the whole platform prompt stays under 100K tokens. Here:
  - The founder is sent only in the user message (conversation and Composer) and in the brief. The brief is already
    the last section of `buildSystemPrompt`.
  - The Composer's `founder_experience` was a per-founder value spliced into its system text. It moved to
    `founder.experience` in the inputs, and the variable is gone. `apps/composer` always sends `founder` (from the
    context's experience when a hand-built context has none), and the eval corpus sends it too.
  - `mentor.test.ts` checks that the conversation's and the Composer's system blocks are byte-identical for two
    founders, that a brief carrying "## Founder" leaves the prefix before "## Business brief" unchanged, and that every
    request stays under 100K tokens (about four characters a token).
- The spec puts the founder in `InboxComposerVariables.founder`. A prompt variable is pasted into the system text, and
  the spec also says "never spliced into instructions", so the founder travels in the Composer's inputs JSON (the user
  message) and the prompt only describes that input. The same holds for the conversation.
- A project with one founder carries no field about people at all: `other_founders` appears only when there are some.
  An offline test checks that a solo context, its JSON and its brief section have no word of lack in them.
- A missing experience still reads as `first_time` (the Composer's existing default, so every term gets defined); the
  other missing fields read "not_said".
- The conversation reads the context for the person who is talking (an admin is addressed by their own name). Notes
  and the brief read it for the primary owner, with every other founder named so a note goes to all of them. It reads
  on the service connection because the other founders' profiles are outside the asker's RLS. The caller has already
  checked the membership, and only first names and the person's own fields leave the repo.
- The desk reply makes one more database round trip (the context read), so the budget in `round-trips.test.ts` is
  16, up from 15. The read cannot join the reply's RLS transaction because the other founders' profiles are outside
  the person's RLS.
- The mentor rule on people lets the Chief of Staff mention people to build with when the founder asks or when their
  profile says they are looking. The spec says "only when asked". Their own "What are you here for?" answer counts as
  asking.
- The "one explained idea" check in the eval is a narrow phrase count ("means", "is when", "which is", ...). It is
  approximate on purpose: it catches stacked lessons and does not try to grade teaching.
- Agents whose live version is the system's version 1 follow the template (`followsTemplate`), so the new rules reach
  every Chief of Staff nobody has edited. An edited one keeps its own instructions.

## Not done
- The live eval has not been run. The founder's rule is no dispatching by hand, so it runs with the nightly.
- The concept card's Ask (Ideation, no business yet) gets no founder context.
- The welcome note at commit is a template, not a model call. It only picks up the new founder line.
- The conversation's second system block (the conversation rules) names the agent by the viewer's display setting.
  That block comes after the stable one, so the cached prefix holds, but the second block is per viewer. This was
  already the case before this change, and it is left as it was.
- `repos.founders.ownerExperience` stays, with its test, but nothing calls it now. It can go in a later cleanup.
