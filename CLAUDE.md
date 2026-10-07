# CLAUDE.md — Foundmill

You are building Foundmill (always via APP_NAME from packages/config). The full build plan is docs/BUILD.md. Read the relevant section before every task.

## Product vocabulary
Business = club. Founder = manager. Agents = squad. Human team = staff. Chief of Staff agent = assistant manager. Quarter = chapter. Logo = crest. Departments are labels over modules; never hard-code a department name.

**Rule (founder, 2026-10-07): avoid football terminology that cannot also be said of AI agents.** Squad, training, Training Ground, tactics, formation, coach, captain, bench, form, shouts, scouting, recruitment, holiday, wage are fine: they describe a team of agents. Words that only make sense on a football pitch are not used in anything a user can read (UI strings, inbox copy, agent prose, routes, docs, Storybook titles). Replacements:

| Do not use (user-facing) | Use instead |
| --- | --- |
| Match Day, match, "customer won = match" | **Customer Update** (the replay and inbox item for a won customer); the event is a **win** |
| Kick-off / Team sheet / Goal / Full time / Player of the match | First touch / Who was involved / Win moment / Debrief / Standout agent |
| Match-day levels friendly / league / cup | Update levels **brief / standard / featured** |
| Pitch (Formation Board) | Board |
| Channel lines Attack / Midfield / Defence / Wings | **Acquisition / Engagement / Organic / Offline** |
| Kit, kit colours, kit mode | **Brand colours**; "offline tracking" for kit mode |
| Trophies, trophy cabinet, `/trophies` | **Milestones**, `/milestones` |
| League table | Leaderboard |
| Injured (agent health) | Down (with "expected back") |
| Season | Chapter |

Internal identifiers that already exist (enum keys such as `matchday_level`, CSS tokens such as `--kit-primary`, the `dugout` package name) may stay until the wave-3 vocabulary sweep renames the cheap ones; display labels, copy and new identifiers follow the table now. `scripts/banned-terms.mjs` gains these terms for user-facing files in wave 3.

## Always
- Use Dugout components (packages/dugout) for every UI element. No ad-hoc styling outside tokens.
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
