# CLAUDE.md — Founder Manager

You are building Founder Manager (working title; use APP_NAME from packages/config). The full build plan is docs/BUILD.md. Read the relevant section before every task.

## Product vocabulary
Business = club. Founder = manager. Agents = squad. Human team = staff. Chief of Staff agent = assistant manager. Customer won (signup, activation, payment) = match. Quarter = season/chapter. Brand colours = kit. Logo = crest. Departments are labels over modules; never hard-code a department name.

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
