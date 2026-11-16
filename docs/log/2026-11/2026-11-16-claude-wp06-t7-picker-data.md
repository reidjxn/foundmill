---
date: 2026-11-16
branch: claude/wp06-t7-picker-data
title: The skill picker suggests for the agent's role, shows what a skill is better with, and opens its whole text
areas: [agents, api, dugout, modules, web]
supersedes: []
---
## What changed
WP-06 T7 (TS-09; a3b §6b, §6f; founder D6 of Nov 16: a person reads a skill's whole text inside the product, without
going to GitHub).

- `suggestFor(templateKey, stage)` (`packages/agents/src/skill-library.ts`): the library skills whose `roles` hold the
  template, those whose `stages` hold the project's stage first, catalog order within each part. No model call.
- `team.skills.library` (`apps/api/src/services/skills.ts` `libraryView`, `routers/team.ts`) takes
  `{ agentId?, templateKey? }` and returns, per skill: `key, skillKey, name, description, category, categoryLabel,
  attribute, whenToUse, version, suggested, suggestedBecause, requires: { connectorKey, name, connected }[],
  notYetOnFoundmill, attribution`. Suggested rows come first ("Fits this role"). **No bodies**: the 83-skill list is
  under 60 KB (a test holds it there). An `agentId` is read under RLS, so another business's agent is not found; an
  unknown `templateKey` is a 400.
- `team.skills.get` (read, Team section) `{ key }` → `{ key, name, version, attribution, instructionsMd }`; 404 for an
  unknown key.
- `connected` reads the same facts as the channel rules (`channelAvailabilityFacts` over the business's integrations):
  the project's sending address where it really sends (`platformMail`), a connector with no account (`web`) always,
  any other once its integration is connected or degraded. Names are each connector's own `displayName`.
- Design system (`SkillPicker.tsx`): `SkillLibraryList` puts suggested rows in a first group, "Suggested for this
  agent" (each listed once, with its reason as a chip), names on the row only what is not connected ("Better with
  PostHog, not connected") and what is not built yet ("Not built yet: Search Console"), and with `onRead` shows "Read
  the skill" on every row. New `SkillReader`: back button (takes focus), name, version, every connector with its state,
  the body through the existing `Markdown` (raw HTML skipped, `images={false}`, `entities={false}`, `webLinksOnly`),
  the attribution line. Stories `Suggested`, `Reader`, `ReaderLoading`.
- `SkillLibraryDialog` (`packages/modules/src/team/skills.tsx`) takes `pickerFor` (`{ agentId }` or
  `{ templateKey }`), loads a body only when "Read the skill" is pressed, and keeps the list mounted under the text, so
  Back returns to the same search, choice and button. The hire dialog passes its template; Training's
  `AddedSkillsPanel` passes the agent.
- Copy (`AddedSkillsPanel.tsx`, as the spec's before → after): the add toast now reads "{agent} reads it when a task
  calls for it. You can remove it at any time." (plural: "reads each one ... remove them"); the empty state drops the
  two sentences about tests and ends "The agent reads a skill when a task calls for it."

Tests (each failed on main first): `packages/agents/src/__tests__/skill-suggestions.test.ts` (3: missing
`suggestFor`); `apps/api/src/__tests__/agent-skills.test.ts` (4 new or changed: no bodies and under 60 KB; Product
Lead sees `project_page_copy` suggested with "Fits this role", from a template and from an agent, cross-tenant
NOT_FOUND; `seo_plan` lists Search Console, GitHub not connected then connected, web always connected, attribution;
`team.skills.get` for a viewer and 404); `packages/dugout/.../SkillPicker.test.tsx` (4: suggested group, read button,
Markdown not HTML with focus on Back, loading and error); `packages/modules/.../skills.test.tsx` (1: the hire dialog
asks for its template, shows the suggested group, opens the text from `team.skills.get`, Back keeps the choice and
returns focus). `apps/web/e2e/agent-skills.spec.ts` gains the suggested group in the hire flow and from the profile,
and reading Newsletter writing's text and coming back.

## Decisions
- **Spec versus code.** The spec's `get` returns `{ key, name, instructionsMd }`; it also returns `version` and
  `attribution`, so the reader can show them without the list row. `suggestFor` takes a `ProductStage` from
  `loadProductStage`, the stage the rest of the api uses.
- **One reason for every suggestion**, "Fits this role": the stage only orders them. `defaultFor` is not shown as a
  separate reason; T6 marks attached defaults "Came with the role".
- **The row names only what is missing.** Every skill that searches the web would otherwise carry "Better with Web
  search and pages, connected"; the reader lists every connector with its state.
- **"Not built yet"**, not "Not on Foundmill yet": the product name is never written in copy (APP_NAME rule), as T3
  found for `seo_plan`.
- **`connected` on a test or sample stack** reads the real integration rows, not the "everything simulated" answer
  `channelFactsFor` gives there: a connector is not called connected because results would be simulated.
- **Attribution** is "Adapted from <sources> under the <license> license."; the copyright lines stay in
  `skills/THIRD_PARTY_NOTICES.md` (not in the list, to keep it small).
- `SkillLibraryList` group headings get index-based ids: "Suggested for this agent" has spaces, which an
  `aria-labelledby` id cannot hold.

## Not done
- WP-10 owns the picker's final look; this uses existing components only.
- The library dialog's own description still says skills show "untested until a training run scores it" (T12's
  honesty fixes cover Recruitment and Training copy).
- No eval: no agent behavior changed.
