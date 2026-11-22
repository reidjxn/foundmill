# packages/dugout (`@foundmill/dugout`)

The design system: `tokens.css`, `fonts.css`, `dugout.css`, every UI component, the date formatters, and Storybook. It holds no data fetching (no tRPC client, no Next router) and no business rules. ("Dugout" is the internal package name; in copy say "the design system".)

## Invariants
- **Tokens only.** No hex outside `src/tokens.css`; no arbitrary Tailwind values (`bg-[#123456]`, `p-[13px]`): add a token instead. Spacing from the 4/8 px scale. Lucide icons only. Dark only, one theme.
- **Stories for components:** every new component gets a `<Name>.stories.tsx` next to it. Storybook titles are user-facing: no football words (FOUNDMILL.md table).
- **1280 px console vs 390 px outer product:** the dense console is desktop, laid out at 1280 px or wider; from 640 to 1279 px `AppShell` scrolls it sideways with `NarrowWindowNote`, below 640 px it renders `NeedsLargerWindow`, never a dead end (founder, Nov 16, 2026). The outer product (public project and person pages, invitations, milestone cards, `/a/<token>`, `/email/pause`, sign-in, `/home`, the profile, People, messages, Today, Needs you) works from 390 px.
- Structure never moves: sidebar 232, top bar 56, tab bar 40, inbox list 380, reading measure 640.
- WCAG AA is the floor; color is never the only signal; `prefers-reduced-motion` gives an instant state change with the same information.
- Client boundaries: a module that needs the browser opens with `"use client"`, file by file, never on a barrel; server-safe files are listed in `SERVER_SAFE_FILES` (`src/clientBoundaries.test.ts`).
- Dates through `useFormatters()` / `bindFormatters(prefs)` (ARCHITECTURE §20); never spell a day-first, ISO or 24-hour pattern outside `src/lib/date-preferences.ts`. A component whose dates follow the choice gets a test in a second format and keeps its US story.
- Copy is US English, plain words, no football terms; entity mentions render through `<EntityLink>`.
- **Estimates (founder, Nov 17, 2026; DESIGN §8 and §10):** a number that was not measured is passed as the children of `<ProvenanceChip kind="estimate" | "forecast">`, which draws it in the one estimate style and names the word for hover, focus and screen readers. `<ProvenanceChip kind />` with no children shows the word, for a chart, a panel or a sentence. `AppShell` shows the legend line (`EstimateLegend`) under any screen that holds one; a screen outside the shell renders `<EstimateLegend />` once. Never draw a second label beside a styled figure.
- No third-party game's names, art, skins, fonts or icons (the brands listed in the root FOUNDMILL.md "Never"): reproduce the layout grammar only.

## Read when needed
- docs/DESIGN.md (all UI follows it): §2 Non-negotiables, §3–§7 surfaces, type, color, spacing, motion, §8 Component anatomy, §9 Screen notes, §9a–§9e public pages, §10 Writing in the interface.
- docs/ARCHITECTURE.md §14 Web , §18 Widget and module data contract, §20 Date and time formats. Lines are very long: grep for the section heading and read only that section, never the whole file.
- docs/BUILD.md §5 Design system (§5.1 Tokens, §5.2 Typography, §5.3 Shell layout, §5.4 Core components, §5.5 Keyboard).
- Decisions: `node scripts/decisions-index.mjs Storybook` or `node scripts/decisions-index.mjs tokens`, then read only the printed range.

## Commands
- `pnpm --filter @foundmill/dugout typecheck` | `lint` | `test`
- `pnpm --filter @foundmill/dugout check:rsc` (loads the barrel as a Server Component would)
- `pnpm storybook` (dev, port 6006), `pnpm storybook:build` when stories changed
- Copy and focus: `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate --summary`, `node scripts/focus-visible.mjs`

## Key files
- `src/tokens.css`: every color and size token; `src/tokens.test.ts` holds the contract
- `src/dugout.css`, `src/fonts.css`: component styles, self-hosted fonts
- `src/index.ts`: the barrel
- `src/components/<group>/`: components with their stories and tests (`shell/` has `AppShell`, `NeedsLargerWindow`)
- `src/clientBoundaries.test.ts`: `SERVER_SAFE_FILES`, the `"use client"` rule
- `src/lib/date-preferences.ts`, `src/lib/format.ts`: date patterns and formatters
- `.storybook/main.ts`, `scripts/check-rsc.mjs`
