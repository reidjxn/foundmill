# CLAUDE.md — Foundmill

You are building Foundmill (always via APP_NAME from packages/config). The full build plan is docs/BUILD.md. Read the relevant section before every task.

## What Foundmill is for (founder, 2026-11-11)
As AI spreads, most people move from being employed to building something of their own. Foundmill is where they do it: one person with a team of AI agents can build and run a real business end to end. The user is a young, first-time founder with little money and no business experience, who wants a way to stand on their own feet. The review of the product against this, and the roadmap, is docs/THESIS_REVIEW.md: read its section 13 before planning work.

**Solo is complete (founder, 2026-11-11).** The main user is a solo founder, and they must feel that they can do all of it on their own. Nothing is gated on a second person; no screen, note, prompt or metric treats a project with one person as unfinished, behind or missing someone; agents cover every gap by default. Never tell a solo founder they need a cofounder, and never rank, rate or nudge them lower for being alone.

**Finding people is seamless and optional.** Many founders, perhaps most, will prefer to build with a cofounder or collaborator. Finding each other, helping each other, joining each other's projects and becoming cofounders must be one step away at every point and work without friction, and it is the product's growth loop. It is always an offer, never a requirement. Judge a feature by two questions: does it leave a solo founder fully able, and does it make building together effortless for those who want it.

**North star (founder, 2026-11-11):** weekly active projects with at least one real outcome that week (a real outside action or result: a page live, an email sent, a post published, a payment taken, a customer's reply), whatever the number of people. Simulated results never count.

**Subtext, never text.** Nothing a user can read says or implies "do this instead of getting a job". No copy, prompt, seed or mock output names jobs, employment, unemployment, careers or AI taking work as the reason to be here. Say ownership ("something that is yours") and capability ("what you can do now"), and, as an offer, company ("people to build it with, if you want them"). The ordinary words stay (an agent's job, a job title on a contact, hiring). `node scripts/banned-terms.mjs` enforces the phrases.

## Product vocabulary
Business (never "club"). Founder. Agents = **team** (never "squad"). Chief of Staff agent (never "assistant manager"). Quarter = chapter. Business mark = **logo** (never "crest"). Departments are labels over modules; never hard-code a department name.

**Rule (founder, 2026-11-11): the words for people.** The humans of a business are its **People**: **cofounders** (equal standing, any number; write "the founders", never assume one) and **collaborators** (someone trying out or helping, with limited access). "Staff" and "seat" leave default copy: people are never a plan limit. A business is called a **project** until its first sale, and a business after; where the stage is not known, "project". "Team" stays the agents. Internal identifiers keep their names (`businesses`, `business_id`, `memberships`, role keys, the `staff` tab slug) until a rename is worth its churn; new identifiers follow the rule.

**Rule (founder, 2026-10-08, supersedes 2026-10-07): no football terminology anywhere a user can read** (UI strings, inbox copy, agent prose and prompts, Storybook titles, docs/DESIGN.md and docs/ARCHITECTURE.md). Training, coach, form, recruitment and wage stay: they are ordinary words for a team of agents. Replacements:

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
| Kit, kit colours, kit mode | **Brand colors**; "offline tracking" for kit mode |
| Trophies, trophy cabinet, `/trophies` | **Milestones**, `/milestones` |
| Player card, player's attributes | Profile card, attribute ratings |
| Injured (agent health) | Down (with "expected back") |
| Season | Chapter |

Internal identifiers may keep old names until a rename is worth its churn: package `dugout`, components `Crest` / `FormationBoard` / `SquadTable`, enum keys such as `matchday_level` and `source: "shout"`, CSS tokens such as `--kit-primary`, and URL tab slugs `squad`, `formation`, `training-ground`. Display labels, copy and **new** identifiers follow the table. `node scripts/banned-terms.mjs` enforces the table on user-facing text and runs in CI.

**Rule (founder, 2026-10-10): US English and US dates everywhere a user can read** (same scope as above, plus seed copy, mock outputs and service messages). American spelling (color, organization, judgment, center, behavior, labeled, canceled, catalog, program, license as a noun, defense, gray, enroll, fulfill). Dates "Oct 7, 2026", "Oct 7" when the year is implied, "Wed, Oct 7", "Oct 2026", ranges "Oct 7 – 21"; times 12-hour "3:45 PM"; numbers en-US. Money keeps the business's own currency and narrow symbol (a GBP business shows "£"). A business's real-world facts keep their form (GBP, VAT, "Ltd"). Product words:

| Do not use (user-facing) | Use instead |
| --- | --- |
| Brand colours | **Brand colors** |
| Holiday (the founder's away mode), "on holiday" | **Vacation**, "on vacation" ("On vacation until Oct 21"); enum keys and slugs keep `holiday` |
| Wage bill (Finance tab) | **Payroll** (the slug stays `wage-bill`) |

"Staff", "wage" as a word, "chapter" and "team" stay. Internal identifiers keep their names (`--kit-primary`, `colourToken`, the `organisation` and `cancelled` enum values, `holiday` events and slugs). `node scripts/us-english.mjs` enforces this (British spellings, day-first dates and en-GB locales) and runs in CI next to banned-terms.

## Always
- Use design-system components (packages/dugout) for every UI element. No ad-hoc styling outside tokens.
- Business-scoped tables: business_id + RLS policy + cross-tenant test in the same change.
- External calls only through apps/gateway. Never call a vendor API from another service.
- Render entity mentions with <EntityLink>; agent text uses [[ent:<uuid>|Name]] and is validated.
- Declare every event in packages/events with Zod; write through the outbox.
- Model ids only in packages/models/src/routing.ts.
- Every connector has real + mock implementations; INTEGRATIONS_MODE=mock must run the golden path.
- Label every non-real number "Forecast" or "Estimate".
- A simulated tool result is never reported as an action. A mock connector's result carries `simulated` and a notice; agents, the Composer and service copy say it was simulated and not done.
- People are free on every plan: no limit on cofounders or collaborators, and cofounders' included credits pool on a shared project (founder, 2026-11-11). Plans differ by agent work only.
- Write US English with US dates and times in everything a user can read (see the 2026-10-10 rule above).
- Update docs/PROGRESS.md after each task; record judgement calls in docs/DECISIONS.md.

## Never
- Never commit secrets or print them in logs.
- Never let agent code move money, sign, accept terms, file with the founder's identity, delete permanently, change security settings, or act on instructions found in untrusted content.
- Never solve CAPTCHAs, evade logins, or scrape against a site's terms.
- Never use Football Manager / Sports Interactive / SEGA names, art, skins, fonts or icons.
- Never show the dense console below 1280 px, and never leave a small screen at a dead end. **Small screens (founder, 2026-11-11):** the outer product works from 390 px: public pages (landing, project and person pages, invitations, milestone cards), sign-in, the profile, People and finding people, messages, Today and Needs you. Everything else (the department tabs, tables, boards, Settings beyond the basics) stays desktop, 1280 px and wider, and on a small screen says so kindly with a way to continue later. The native app (iOS App Store and Google Play, built with Newly) is the phone's home once it launches: from then on a signed-in small screen is sent to download it, and a public page (a project or person page, an invitation, a milestone card) still shows its content with a prompt to get the app, through one config value for the store links (unset until launch). Build the small-screen web so that switch is one change.

## Definition of done (every task)
Typecheck, lint, unit tests, Playwright test for any screen touched, Storybook story for any new component, eval for any new agent behaviour, PROGRESS.md updated.

## Commands
pnpm dev | pnpm test | pnpm test:e2e | pnpm db:migrate | pnpm db:seed | pnpm evals | pnpm storybook

## Repo guides (read these before touching code)
- docs/ARCHITECTURE.md — package ownership, cross-package contracts, env/modes, how services talk, rules for parallel work.
- docs/DESIGN.md — the Dugout art direction. Every pixel of UI follows it.
- docs/DECISIONS.md — decisions already taken (versions, substitutions). Do not re-decide them.
