# CLAUDE.md — Foundmill

You are building Foundmill (always via APP_NAME from packages/config). The full build plan is docs/BUILD.md. Read the relevant section before every task.

## What Foundmill is for (founder, 2026-11-11)
As AI spreads, most people move from being employed to building something of their own. Foundmill is where they do it: one person with a team of AI agents can build and run a real business end to end. The user is a young, first-time founder with little money and no business experience, who wants a way to stand on their own feet. The review of the product against this, and the roadmap, is docs/THESIS_REVIEW.md: read its section 13 before planning work.

**Solo is complete (founder, 2026-11-11).** The main user is a solo founder, and they must feel that they can do all of it on their own. Nothing is gated on a second person; no screen, note, prompt or metric treats a project with one person as unfinished, behind or missing someone; agents cover every gap by default. Never tell a solo founder they need a cofounder, and never rank, rate or nudge them lower for being alone.

**Finding people is seamless and optional.** Many founders, perhaps most, will prefer to build with a cofounder or collaborator. Finding each other, helping each other, joining each other's projects and becoming cofounders must be one step away at every point and work without friction, and it is the product's growth loop. It is always an offer, never a requirement. Judge a feature by two questions: does it leave a solo founder fully able, and does it make building together effortless for those who want it.

**North star (founder, 2026-11-11):** weekly active projects with at least one real outcome that week (a real outside action or result: a page live, an email sent, a post published, a payment taken, a customer's reply), whatever the number of people. Simulated results never count.

**Sign-up and the entry plan (founder, 2026-11-17).** The entry plan is named **Try** (afternoon of the same day; the plans are Try, Founder, Studio and Partner, and the Founder price is tested at $15 and $25 a month: docs/holistic-plan/WP-14-behavior-brief.md). Today sign-up is invite-only and invited people use a free plan, because the founder is testing with them and pays for their AI use. When sign-up opens, the entry plan is $5 a month with $5.00 of credits on Haiku 5.5 and GLM-5.3 Flash; credit packs on top (from $20, cheaper per credit as they grow) add credits and unlock Claude models. Everything before the first AI run stays free of charge: shaping an idea, the profile, the Studio, taking charge and seeing the project; the first press of Continue needs the $5 plan. People stay free on every plan. People invited while sign-up is invite-only never pay the Founder plan's monthly fee (evening of 2026-11-17; this replaces converting them to the $5 plan on the day). A plan limits companies, never people: Try 1, Founder up to 5, Studio any number, deleted ones not counted. Founder ($10.00 of credits a month) and Studio ($50.00) reach Opus and Sonnet without a credit pack. Apart from that promise to invited people, until sign-up opens, nothing a user reads may promise that the product will stay free (the copy to change is listed in docs/log/2026-11/2026-11-17-claude-wp09-paid-entry-plan.md).

**Foundmill runs on Foundmill (founder, 2026-11-17).** Once the product works end to end, the founder runs Foundmill itself from inside Foundmill, on their own account: every product update and change, Foundmill's finances and its go-to-market, done by the agents of that project, with the founder approving as any founder does. The build is heading there. So keep every decision, its reason and the project's history in files an agent can read (docs/log, the package guides, the agent skills), never only in a session's conversation. When the founder says it is time, the handover is onboarding, not a plan document: each agent on the founder's project is given its role, the skills for it and the whole project history, so the team can run Foundmill completely.

**Subtext, never text.** Nothing a user can read says or implies "do this instead of getting a job". No copy, prompt, seed or mock output names jobs, employment, unemployment, careers or AI taking work as the reason to be here. Say ownership ("something that is yours") and capability ("what you can do now"), and, as an offer, company ("people to build it with, if you want them"). The ordinary words stay (an agent's job, a job title on a contact, hiring). `node scripts/banned-terms.mjs` enforces the phrases.

## Product vocabulary
Business (never "club"). Founder. Agents = **team** (never "squad"). Chief of Staff agent (never "assistant manager"). Quarter = chapter. Business mark = **logo** (never "crest"). Departments are labels over modules; never hard-code a department name.

**Rule (founder, 2026-11-11): the words for people.** The humans of a business are its **People**: **cofounders** (equal standing, any number; write "the founders", never assume one) and **collaborators** (someone trying out or helping, with limited access). "Staff" and "seat" leave default copy: people are never a plan limit. A business is called a **project** until its first sale, and a business after; where the stage is not known, "project". "Team" stays the agents. Internal identifiers keep their names (`businesses`, `business_id`, `memberships`, role keys, the `staff` tab slug) until a rename is worth its churn; new identifiers follow the rule. One exception (founder, 2026-11-17): the landing page's example label reads 'Example companies you can create'.

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
| League position, league table | Leaderboard position, leaderboard (the leaderboards feature itself was removed, founder 2026-11-11; do not rebuild it) |
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
- People are free on every plan: no limit on cofounders or collaborators, and cofounders' included credits pool on a shared project (founder, 2026-11-11). Plans (Try, Founder, Studio, Partner) differ by agent work and by the features listed for each plan in docs/holistic-plan/WP-14-behavior-brief.md T14 (founder, 2026-11-17, afternoon: this replaces "plans differ by agent work only"); a founder's own Anthropic key works on every plan and is always offered. One difference predates that list (founder, 2026-11-12; 2026-11-17): the small "Built on Foundmill" mark that a project's visitors see. Today the free plan shows it and a paid plan removes it completely (`tierShowsBuiltOnMark`); from the day sign-up opens, the $5 plan shows it and it is removed for a project whose owner has bought a credit pack.
- One operator (founder, 2026-11-17): only the founder's own Foundmill account holds operator privileges (`OPERATOR_USER_IDS` on the api, one id). No role, email domain, seed setting or plan grants them, and an empty list means nobody is an operator.
- Write US English with US dates and times in everything a user can read (see the 2026-10-10 rule above). English only: no translation layer or string catalog (founder, 2026-11-11).
- 18 or older for the whole product, confirmed once at sign-up (founder, 2026-11-11).
- Foundmill hosts every project's public page at a Foundmill address for free, and gives a project an address to send email from, with a daily cap per project and the founder's approval for outside contact (founder, 2026-11-11).
- A connector the founder connects with their own key runs on the founder's own vendor account, always (founder, 2026-11-12): the key is entered in Settings › Integrations (auth kind `api_key`), sealed in the vault and used only by the gateway, and the vendor bills the founder. Never fall back to a Foundmill platform key for these connectors: not connected means the agent says "not connected". Foundmill registers no developer apps for them, and vendors' own MCP servers are not plugged in: each is the vendor's API behind the gateway's tools. Anything outward or costly asks first (Needs you) in augmented and assisted mode; read-only lookups run.
- Follow the Karpathy guidelines on every code change (founder, 2026-11-15; the `karpathy-guidelines` skill): state your assumptions and surface tradeoffs before coding; write the simplest change that solves the problem and nothing speculative; touch only what the task needs and match the existing style; define the check that proves the change and loop until it passes.
- Outside Claude Code skills and plugins are used freely (founder, 2026-11-15; this replaces the 2026-11-13 rule that they be vetted first). The ones this repo's work relies on are kept in `.claude/skills/` so cloud sessions have them; their sources and licenses are in `.claude/skills/THIRD_PARTY_NOTICES.md`.
- Add one file under docs/log/ for each change: what changed and the judgment calls (skill `log-entry`). Never edit docs/DECISIONS.md or docs/PROGRESS.md: they are frozen history, searched with `node scripts/decisions-index.mjs`.

## GitHub Actions minutes (founder, 2026-11-16)
Every push to a pull request and every merge to main runs CI, and one full run bills about 176 runner minutes (Playwright about 85, unit jobs about 68). Spend them on purpose:
- Push when the change is ready, not after each small fix: commit locally, run the touched packages' tests and the copy linters first, then push once. Open a pull request (draft or not) only when it is ready to be checked.
- Never merge main into a pull request, or press "Update branch", just to refresh it. Do it only for a merge conflict, or when a fix that pull request needs has landed on main.
- Re-run a failed job at most once, and re-run only the failed jobs, never the whole workflow. A second failure is a real failure: find the cause.
- Prefer fewer, slightly larger pull requests for small related changes in one area. Do not open pull requests that will conflict with each other; hold the second until the first merges.
- Do not dispatch workflows by hand (live evals, nightly) unless the founder asks; the schedules run them.
- CI itself runs only what a change can affect: unit jobs for affected packages, Playwright only when a change can reach a screen, a short check on merge to main, and the full suite nightly (`claude/ci-fewer-minutes`). Do not widen it back without the founder.

## Never
- Never commit secrets or print them in logs.
- Never let agent code move money, sign, accept terms, file with the founder's identity, delete permanently, change security settings, or act on instructions found in untrusted content.
- Never solve CAPTCHAs, evade logins, or scrape against a site's terms.
- Never use Football Manager / Sports Interactive / SEGA names, art, skins, fonts or icons.
- Never stop a team mid-task because a balance ran out: stop before the task that would not fit, and let a running task finish (founder, 2026-11-17; docs/holistic-plan/WP-14-behavior-brief.md T1).
- Never make canceling harder than subscribing (founder, 2026-11-17).
- Never put a dollar figure for included credits in the hero of the landing page (founder, 2026-11-17).
- Never turn the cycle into a continuous stream: read, decide, press, wait, read (founder, 2026-11-17).
- Never lay the dense console out narrower than 1280 px (founder, 2026-11-16: from 640 to 1279 px it renders at 1280 px in a sideways-scrolling shell with a dismissible note; below 640 px it shows the larger-window note), and never leave a small screen at a dead end. **Small screens (founder, 2026-11-11):** the outer product works from 390 px: public pages (landing, project and person pages, invitations, milestone cards), the pages an email from Foundmill opens (the one-click answer `/a/<token>` and the pause page `/email/pause`, founder 2026-11-12), sign-in, the home of a person with no project (`/home`), the profile, People and finding people, messages, Today and Needs you. Everything else (the department tabs, tables, boards, Settings beyond the basics) stays desktop, 1280 px and wider, and on a small screen says so kindly with a way to continue later. The native app (iOS App Store and Google Play, built with Newly) is the phone's home once it launches: from then on a signed-in small screen is sent to download it, and a public page (a project or person page, an invitation, a milestone card) still shows its content with a prompt to get the app, through one config value for the store links (unset until launch). Build the small-screen web so that switch is one change.

## Definition of done (every task)
Typecheck, lint, unit tests, Playwright test for any screen touched, Storybook story for any new component, eval for any new agent behavior, a docs/log entry.

## Commands
pnpm dev | pnpm test | pnpm test:e2e | pnpm db:migrate | pnpm db:seed | pnpm evals | pnpm storybook

## Repo guides (read these before touching code)
- docs/ARCHITECTURE.md — package ownership, cross-package contracts, env/modes, how services talk, rules for parallel work.
- docs/DESIGN.md — the Dugout art direction. Every pixel of UI follows it.
- docs/DECISIONS.md and docs/log/ — decisions already taken. Find them with `node scripts/decisions-index.mjs <words>`. Do not re-decide them.
