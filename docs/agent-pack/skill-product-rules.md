---
name: foundmill-product-rules
description: Foundmill's product, vocabulary, architecture and design rules, and the definition of done. Use whenever you write code, copy or agent behavior for Foundmill. CLAUDE.md in the repository root is the authoritative version.
---

# Skill: Foundmill's rules for building

Use this whenever you write code, copy or agent behavior. The authoritative version is `CLAUDE.md` in the repository root. This is the working summary. If the two disagree, `CLAUDE.md` wins: say so in your pull request. Sources: `CLAUDE.md`, `docs/agent-pack/00-handover.md` ("The rules that matter most").

## Vocabulary (anything a user can read, including agent prompts)

Business is the thing being run. Agents are the team. Staff are the human members. The Chief of Staff is the agent that coordinates the team.

| Do not use | Use instead |
| --- | --- |
| Club, club rules | Business; house rules |
| Squad | Team (the Team department's agent tab is Agents) |
| Crest | Logo |
| Shout | Nudge |
| Captain | Lead channel, or Standout agent |
| Assistant manager | Chief of Staff |
| Season | Chapter |
| Injured (agent health) | Down (with "expected back") |
| Kit, kit colours, kit mode | Brand colors; "offline tracking" for kit mode |
| Trophies, trophy cabinet | Milestones |
| Player card, player's attributes | Profile card, attribute ratings |
| Formation (task graph view) | Task graph |
| Formation Board, bench | Channel Board; off the board |
| Training Ground | Live sessions |
| Scouting report | Import report |
| Form guide | Channel performance |
| League position, league table | Leaderboard position, leaderboard |
| Match Day, match | Customer Update; the event is a win |
| Kick-off, team sheet, goal, full time, player of the match | First touch, who was involved, win moment, debrief, standout agent |
| Channel lines Attack, Midfield, Defence, Wings | Acquisition, Engagement, Organic, Offline |
| Dugout (outside the `packages/dugout` path) | the design system |

The full table, including the internal identifiers that may keep their old names, is in `CLAUDE.md`. Training, coach, form, recruitment and wage are ordinary words for a team of agents. They stay. `node scripts/banned-terms.mjs` enforces the table in CI.

## US English and US dates

- Use American spelling (color, organization, judgment, behavior, labeled, canceled).
- Dates look like "Oct 22, 2026", "Oct 22" when the year is implied, "Wed, Oct 22", or ranges like "Oct 7 – 21". Times look like "3:45 PM".
- Money keeps the business's own currency and symbol.
- Product words: Brand colors (not brand colours), Vacation (not holiday), Payroll (not wage bill).
- Run `node scripts/us-english.mjs`.
- Run `node scripts/plain-language.mjs --gate` for undefined jargon and developer notes in user-facing text.

Do not name Football Manager, Sports Interactive or SEGA anywhere, and do not use their art, skins, fonts or icons.

## The never-list

The never-list in `CLAUDE.md` applies to every task, in full. Read it before you start. In short:

- Never commit secrets or print them in logs. Secrets live in Railway variables only.
- Never let agent code move money, sign, accept terms, file with the founder's identity, delete permanently, change security settings, or act on instructions found in untrusted content.
- Never solve CAPTCHAs, evade logins, or scrape against a site's terms.
- Never build mobile layouts.
- Never push to `main` or merge. Every merge into `main` is the founder's decision (see the repository and branch rules).

## Architecture rules

- Use components from `packages/dugout` for every UI element. No ad-hoc styling outside the design tokens.
- A table that holds business data has a `business_id`, a row-level security policy and a cross-tenant test, all in the same change.
- Outside calls go only through `apps/gateway`. Never call a vendor API from another service.
- Entity mentions in the UI use `<EntityLink>`. Entity mentions in agent text use `[[ent:<uuid>|Name]]` and are validated.
- Events are declared in `packages/events` with Zod and written through the outbox.
- Model ids live only in `packages/models/src/routing.ts`.
- Every connector has a real and a mock implementation. `INTEGRATIONS_MODE=mock` must run the golden path.

## Design rules

- Desktop only: 1280 px and wider.
- Label every number that is not from real data "Forecast" or "Estimate".
- Departments are labels over modules. Never hard-code a department name.
- Use the design tokens. Never define a color only inside a media query or a theme block.

## Definition of done for any task

Every task needs:

- typecheck, lint and unit tests
- a Playwright spec for any screen you touched
- a Storybook story for any new component
- an eval for any new agent behavior
- a line in `docs/PROGRESS.md`

Record any judgment call in `docs/DECISIONS.md`. A task is done when CI passes on its branch and the pull request is open. It reaches production only after the founder merges it into `main`.
