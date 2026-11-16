---
date: 2026-11-16
branch: claude/wp08-t1-positioning
title: The positioning record, read by every marketing call (WP-08 T1)
areas: [shared, db, agents, connectors, gateway, orchestrator, api, modules, web, events, evals]
supersedes: []
---
## What changed
- `packages/shared/src/positioning.ts`: `PositioningNotes` in the `positioning_notes` skill's layout (header and eight
  sections, names and order kept), `readPositioning` (defensive), `positioningProblems` (a one line; every line that is
  not an assumption names its source; at most eight a section), `renderPositioning` (the one text prompts get, cut on a
  line boundary), `PositioningNotesInput` (zod, for the api and the agent tool), `POSITIONING_NOTE`.
- Migration 0118: `business_foundations.positioning` (approved), `positioning_draft` (waiting), `positioning_approved_at`,
  `positioning_approved_by`. No new table, so no new RLS; `fm_collaborator_event_types()` gains `positioning.approved`.
  Cross-tenant and no-client-write test: `packages/db/src/__tests__/rls/positioning.test.ts`.
- `repos.positioning`: `get`, `approvedText`, `writeDraft` (raises one note while it is open; `onlyIfEmpty` for the
  first draft), `approve` (version + 1, a Changes line, clears the draft), `heard` (empty until T5).
- Agents: `prompts/positioning.ts` (route `projectPage`, no new route or model id), `positioning.ts`
  (`buildPositioningRequest`, `finalisePositioning`, `starterPositioning`, `runPositioningDraft`, `positioningBlock`).
  The channel creative, post draft and project page builders and the Distribution Strategist's message take
  `positioning?: string | null` and add it as an `<untrusted_content kind="positioning_notes">` block headed "Positioning
  notes (the founders' record; use only facts in it)". Contract test `packages/agents/src/positioning.test.ts` names
  every builder in `MARKETING_REQUEST_BUILDERS`.
- Callers pass `repos.positioning.approvedText`: the channel engine's creative step, `draftTeamPost`,
  `distribution.recommend`. The page step's context takes it too (`ProjectPageStepContext.positioning`); its caller is
  wired with the foundations step below.
- Platform tools `read_positioning` (read-only, untrusted document) and `propose_positioning_change` (writes the
  waiting copy and the note; nothing changes until a founder approves). Capabilities `positioning.read` (every channel,
  the strategist, Product lead, Chief of Staff, researcher, product researcher) and `positioning.propose` (strategist and
  Product lead).
- Channel templates swap the record-id rule for: "Every claim about the project comes from its positioning notes
  (read_positioning). If the notes do not say it, do not say it; propose a change to the notes instead." Other workers
  keep the old sentence.
- api `positioning.get | save | approve | requestDraft`; event `positioning.approved { version, sectionsChanged }`.
- `PositioningPanel` on Product › Vision; Playwright `apps/web/e2e/positioning.spec.ts`.
- Eval `evals/src/positioning.ts`: `positioning.from_founder_words`, `positioning.one_person` (offline rubric tests and a
  live suite that skips without a key).

## Decisions
- Only the approved copy reaches a prompt. A draft (the team's, a member's or an agent's) is shown to the founder and
  read by `read_positioning` marked `approved: false`, never put into a marketing call.
- The notes travel as untrusted data, not trusted JSON: once approved they can hold lines an agent proposed from web
  pages.
- The first draft's check is strict: a line keeps `founder` only when most of its content words are in the founder's own
  words (the idea card does not count); every other label becomes `assumption`; proof that is not the founder's, any
  quotation and any figure the founder did not give are dropped.
- The note is an `update`, not a decision with options, so no new decision handler: it says where to read and approve.
- `positioning.requestDraft` runs the one call in-process in the api (like `pageQuiz.draft`) instead of a new
  `positioningDraft` workflow; rate-limited by a new `positioning` model limit (3 an hour, 10 a day per business).
- `positioning_approved_by` has no foreign key (the audit row names who); the migration test requires an index for every
  foreign key, and nothing reads it by user.
- The post-draft check does not read the notes, so a draft that repeats a fact only the notes carry is still refused.
  That keeps T1 from loosening a guard; T4 changes the post prompt.

## Not done
- The foundations step that drafts the notes on its own (`draftPositioning` after the page in `businessFoundations`,
  behind `patched("foundations-positioning")`) is held out of this change: WP-04 T5 (#239) is rewriting
  `apps/orchestrator/src/activities/foundations.ts`, and its session asked for those files to wait. Until it lands, the
  founder asks for the draft from Product › Vision ("Ask the team to draft it"), which runs the same `runPositioningDraft`.
- Migration is 0118: 0116 is held by WP-13 (the `glm` model key) and 0117 by WP-09 T2.
- The panel edits the one line, the step and the five line sections; objections, voice and the learned log are shown
  read-only (agents propose changes to them).
- No Storybook story: module panels have none in this repo (the stories are `packages/dugout` components); covered by
  the Playwright spec instead.
- The tests and the eval were written alongside the code; they were not each run failing before the change.
