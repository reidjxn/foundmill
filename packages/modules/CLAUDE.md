# packages/modules (`@foundmill/modules`)

The built-in module screens (product, development, distribution, finance, team, legal), registered by module key and tab slug and shown as full-screen widgets on department tabs. It never imports the tRPC client or the Next.js router, and holds no server code.

## Invariants
- **Data contract:** read and write only through `WidgetDataSource` (packages/widgets `src/data.tsx`): `useWidgetQuery(path, input)`, `mutate(path, input)`, `navigate(href)`, `subscribe(channel, handler)`, `businessId`, `currency`. Host-only needs come through `src/env.tsx` (`useModuleEnv`).
- Register with `registerModule({ key, screens })`; hosts find screens with `getModuleScreen(moduleKey, tabSlug)`. Code that needs only a helper imports a subpath (`@foundmill/modules/registry`, `/lazy`, `/product/foundations`), not the barrel, which loads all six packs.
- **Departments are labels over modules:** never hard-code a department name.
- Design-system components (`@foundmill/dugout`) for every element; tokens only, no ad-hoc styling. These screens are the dense console: desktop, 1280 px and wider.
- Money in the business's own currency (`currency` from the data source, never a fixed code); amounts in different currencies are never added. Label every non-real number "Forecast" or "Estimate".
- Dates through `useFormatters()` or `src/dates.tsx` (ARCHITECTURE §20), never a literal pattern.
- Copy is user-facing (scanned): no football words (the display names in the CLAUDE.md table: Agents, Live sessions, Task graph, Board, Payroll, Milestones), US English, plain words. Tab slugs keep their old names (`squad`, `formation`, `training-ground`, `wage-bill`).
- Solo is complete: no screen treats a one-person project as unfinished or missing someone; People are never a plan limit.
- A simulated result is shown as simulated, never as done.

## Read when needed
- docs/ARCHITECTURE.md §18 Widget and module data contract , §14 Web (department screens at 251), §20 Date and time formats. Lines are very long: grep for the section heading and read only that section, never the whole file.
- docs/BUILD.md §6.1 Modules vs departments, §6.3 Default department tabs (its tab names predate the vocabulary rules: use the CLAUDE.md table), and the module's §11 section (§11.5 Product to §11.11 Legal).
- docs/DESIGN.md §8 Component anatomy, §9 Screen notes.
- Decisions: `node scripts/decisions-index.mjs module` plus the screen's words (`node scripts/decisions-index.mjs roadmap module`), then read only the printed range.
- Skill: `new-screen`.

## Commands
- `pnpm --filter @foundmill/modules typecheck` | `lint` | `test`
- A screen touched: its Playwright spec, `pnpm --filter @foundmill/web exec playwright test e2e/<spec>.ts --trace off`
- Copy and focus: `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate --summary`, `node scripts/focus-visible.mjs`

## Key files
- `src/registry.ts`: `ModuleScreen`, `registerModule`, `getModuleScreen`
- `src/lazy.ts`: `useModulePacks` (one chunk per pack)
- `src/index.ts`: the barrel (loads every pack)
- `src/<module>/index.ts`: each pack registers its screens (`product/`, `development/`, `distribution/`, `finance/`, `team/`, `legal/`)
- `src/env.tsx`: host environment context
- `src/dates.tsx`: dates in the person's own format
- `packages/widgets/src/data.tsx`: `WidgetDataSource` and `useWidgetQuery`
