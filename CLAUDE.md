# CLAUDE.md — Foundmill

You are building Foundmill (always via APP_NAME from packages/config). The full build plan is docs/BUILD.md. Read the relevant section before every task.

## Product vocabulary
Business (never "club"). Founder. Agents = **team** (never "squad"). Human team = staff. Chief of Staff agent (never "assistant manager"). Quarter = chapter. Business mark = **logo** (never "crest"). Departments are labels over modules; never hard-code a department name.

**Rule (founder, 2026-10-08, supersedes 2026-10-07): no football terminology anywhere a user can read** (UI strings, inbox copy, agent prose and prompts, Storybook titles, docs/DESIGN.md and docs/ARCHITECTURE.md). Training, coach, form, recruitment, holiday and wage stay: they are ordinary words for a team of agents. Replacements:

| Do not use (user-facing) | Use instead |
| --- | --- |
| Squad | **Team** (the Team department's agent tab is **Agents**, to avoid "Team › Team") |
| Dugout (outside the package path `packages/dugout`) | the design system; "Welcome aboard" on onboarding |
| First whistle | Before you start |
| Club, club rules | Business; **house rules** (the system block prepended to every agent call is "## House rules") |
| Crest | **Logo** |
| Shout | **Nudge** |
| Formation Board, bench, "walk onto the board" | **Channel Board** (Distribution tab "Board"); **off the board**; "put on the board" |
| Formation (Development task graph view) | Task graph |
| Training Ground | **Live sessions** |
| Captain | Lead channel / Standout agent |
| Assistant manager | Chief of Staff |
| Scouting report | Import report |
| Form guide | Channel performance |
| League position, league table | Leaderboard position, leaderboard |
| Match Day, match, "customer won = match", match commentator, cup tie | **Customer Update**; the event is a **win**; "narrate" |
| Kick-off / Team sheet / Goal / Full time / Player of the match | First touch / Who was involved / Win moment / Debrief / Standout agent |
| Match-day levels friendly / league / cup | Update levels **brief / standard / featured** (prompts receive the display name) |
| Pitch (the board) | Board |
| Channel lines Attack / Midfield / Defence / Wings | **Acquisition / Engagement / Organic / Offline** |
| Kit, kit colours, kit mode | **Brand colours**; "offline tracking" for kit mode |
| Trophies, trophy cabinet, `/trophies` | **Milestones**, `/milestones` |
| Player card, player's attributes | Profile card, attribute ratings |
| Injured (agent health) | Down (with "expected back") |
| Season | Chapter |

Internal identifiers may keep old names until a rename is worth its churn: package `dugout`, components `Crest` / `FormationBoard` / `SquadTable`, enum keys such as `matchday_level` and `source: "shout"`, CSS tokens such as `--kit-primary`, and URL tab slugs `squad`, `formation`, `training-ground`. Display labels, copy and **new** identifiers follow the table. `node scripts/banned-terms.mjs` enforces the table on user-facing text and runs in CI.

## Always
- Use design-system components (packages/dugout) for every UI element. No ad-hoc styling outside tokens.
- Business-scoped tables: business_id + RLS policy + cross-tenant test in the same change.
- External calls only through apps/gateway. Never call a vendor API from another service.
- Render entity mentions with <EntityLink>; agent text uses [[ent:<uuid>|Name]] and is validated.
- Declare every event in packages/events with Zod; write through the outbox.
- Model ids only in packages/models/src/routing.ts.
- Every connector has real + mock implementations; INTEGRATIONS_MODE=mock must run the golden path.
- Label every non-real number "Forecast" or "Estimate".
- Update docs/PROGRESS.md after each task; record judgement calls in docs/DECISIONS.md.

## Never
- Never commit secrets or print them in logs.
- Never let agent code move money, sign, accept terms, file with the founder's identity, delete permanently, change security settings, or act on instructions found in untrusted content.
- Never solve CAPTCHAs, evade logins, or scrape against a site's terms.
- Never use Football Manager / Sports Interactive / SEGA names, art, skins, fonts or icons.
- Never build mobile layouts. Desktop only (>= 1280 px).

## Definition of done (every task)
Typecheck, lint, unit tests, Playwright test for any screen touched, Storybook story for any new component, eval for any new agent behaviour, PROGRESS.md updated.

## Commands
pnpm dev | pnpm test | pnpm test:e2e | pnpm db:migrate | pnpm db:seed | pnpm evals | pnpm storybook

## Repo guides (read these before touching code)
- docs/ARCHITECTURE.md — package ownership, cross-package contracts, env/modes, how services talk, rules for parallel work.
- docs/DESIGN.md — the Dugout art direction. Every pixel of UI follows it.
- docs/DECISIONS.md — decisions already taken (versions, substitutions). Do not re-decide them.
