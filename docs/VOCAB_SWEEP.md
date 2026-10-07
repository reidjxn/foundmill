# Vocabulary sweep — football-only terms still in user-facing text

Generated 2026-10-07 by `node scripts/banned-terms.mjs --sweep docs/VOCAB_SWEEP.md` (CLAUDE.md "Product vocabulary"). This file is regenerated, not edited: fix the copy in the package, rerun the script, and the row disappears. Every hit is a string literal, template literal, JSX text or doc sentence a user can read; identifiers, enum keys, CSS tokens, import paths, class names, tests and fixtures are not scanned.

Scope: apps/web, packages/dugout, packages/widgets, packages/modules, packages/agents/src/prompts, packages/agents/src/templates, apps/composer, docs/DESIGN.md, docs/ARCHITECTURE.md.

**32 hit(s) in 4 package(s).** CI (`banned-terms` job) fails while this number is above zero.

| Term                             | Replace with                               | Hits |
| -------------------------------- | ------------------------------------------ | ---- |
| Match Day                        | Customer Update (the event is a win)       | 3    |
| kick-off                         | First touch                                | 1    |
| team sheet                       | Who was involved                           | 2    |
| full time                        | Debrief                                    | 3    |
| player of the match              | Standout agent                             | 0    |
| goal moment                      | Win moment                                 | 0    |
| half-time                        | (drop; describe the moment)                | 0    |
| pitch (the board)                | Board                                      | 0    |
| trophy                           | Milestone(s)                               | 1    |
| league table                     | Leaderboard                                | 0    |
| injured / injury                 | Down (with "expected back")                | 0    |
| kit colours / kit mode / kit bar | Brand colours / offline tracking / top bar | 18   |
| season                           | Chapter                                    | 4    |

## apps/composer (2)

| File:line                          | Term       | Text                                                                                                                                           |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/composer/src/chapter.ts:122` | team sheet | if (facts.signups > 0 \|\| facts.activations > 0) return { title: "First Names On The Teamsheet", subtitle: '${facts.signups} signups and ${fa |
| `apps/composer/src/chapter.ts:124` | season     | return { title: "A Quiet Pre-Season", subtitle: 'No customer activity recorded in ${facts.label}.', mood: "steady" };                          |

## apps/web (5)

| File:line                                              | Term                             | Text                                                                                                                                         |
| ------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/milestones/milestones.ts:71`      | trophy                           | trophy: "Trophy",                                                                                                                            |
| `apps/web/components/new/commit/CommitScreen.tsx:360`  | kit colours / kit mode / kit bar | {["Business, departments and squad are created", "The crest and colours go on the kit bar", "The first cycle starts", "The Board's first ite |
| `apps/web/components/new/commit/CrestKitEditor.tsx:60` | kit colours / kit mode / kit bar | <div className="flex h-10 w-32 items-center gap-2 rounded-panel bg-kit-primary px-2 text-kit-on-primary" aria-label="Kit bar preview" data-t |
| `apps/web/components/new/commit/CrestKitEditor.tsx:67` | kit colours / kit mode / kit bar | <ColourField label="Primary colour" hint="Kit bar, Continue button, revenue line, crest." value={kit.primary} onChange={(v) => onKitChange({ |
| `apps/web/components/settings/BusinessTab.tsx:31`      | kit colours / kit mode / kit bar | t.saved("Business saved", "The crest and kit bar follow the new colours.");                                                                  |

## packages/agents (20)

| File:line                                                           | Term                             | Text                                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agents/src/prompts/chapter-title.ts:17`                   | season                           | description: "Names a quarter of the Journey Ribbon like a season chapter, grounded only in the quarter's facts.",                            |
| `packages/agents/src/prompts/journey-commentary.ts:19`              | Match Day                        | description: "Writes Match Day commentary lines for a customer journey: one per touch, grounded in the touch records, entities linked.",      |
| `packages/agents/src/prompts/journey-commentary.ts:23`              | kick-off                         | Write commentary as JSON {{"lines": [{{"touch_index": number \| null, "text": string}}]}} with exactly {touch_count} touch lines (touch_index |
| `packages/agents/src/prompts/journey-commentary.ts:23`              | full time                        | Write commentary as JSON {{"lines": [{{"touch_index": number \| null, "text": string}}]}} with exactly {touch_count} touch lines (touch_index |
| `packages/agents/src/prompts/journey-commentary.ts:28`              | full time                        | - The agent with the highest attribution weight is the captain; say so once, in the full-time line.                                           |
| `packages/agents/src/templates/_shared.ts:99`                       | kit colours / kit mode / kit bar | "If a platform cannot be automated within its terms, switch to kit mode: prepare every material and a founder task; never call a booking API  |
| `packages/agents/src/templates/_shared.ts:100`                      | Match Day                        | "Attribute every result with links, codes or conversion APIs so Match Day can credit the channel; a result without attribution is reported a  |
| `packages/agents/src/templates/channels/_channel.ts:58`             | kit colours / kit mode / kit bar | ? "This channel runs in kit mode by default: I prepare every material and a founder task; the founder books and signs."                       |
| `packages/agents/src/templates/channels/broadcast.ts:10`            | kit colours / kit mode / kit bar | "Linear TV and radio run in kit mode: briefs, scripts and spots prepared; the founder books and signs.",                                      |
| `packages/agents/src/templates/channels/direct_mail.ts:16`          | Match Day                        | "Every mailer carries a unique response code or QR so Match Day can attribute; a mailing above threshold is an Inbox decision.",              |
| `packages/agents/src/templates/channels/direct_mail.ts:20`          | kit colours / kit mode / kit bar | "Create: design the mailer with the kit colours and a response code per recipient; verify addresses.",                                        |
| `packages/agents/src/templates/channels/print.ts:10`                | kit colours / kit mode / kit bar | "Kit mode: bookings and insertion orders are prepared with every material attached; the founder signs and sends; never call a booking API or  |
| `packages/agents/src/templates/channels/print.ts:16`                | kit colours / kit mode / kit bar | "Create: print-ready artwork to each title's spec in the kit colours with a unique code; a booking kit (IO draft, artwork, deadlines, contac  |
| `packages/agents/src/templates/channels/print.ts:18`                | kit colours / kit mode / kit bar | "Launch (kit mode): create the founder task with the kit; record the booking once the founder confirms.",                                     |
| `packages/agents/src/templates/channels/social.ts:20`               | kit colours / kit mode / kit bar | "Respect each platform's rate limits and automation terms; when a platform forbids automated posting for this account type, switch to kit mo  |
| `packages/agents/src/templates/leads/distribution_strategist.ts:27` | kit colours / kit mode / kit bar | "Channels that cannot be automated within their terms run in kit mode; say so on the card.",                                                  |
| `packages/agents/src/templates/leads/distribution_strategist.ts:33` | kit colours / kit mode / kit bar | "Enable the starters' engine workflows with their share, caps and guardrails; set kit mode where required.",                                  |
| `packages/agents/src/templates/leads/legal_lead.ts:27`              | kit colours / kit mode / kit bar | "Never solve a CAPTCHA or evade a login wall; if a portal blocks automation, switch to kit mode and prepare the documents for the founder.",  |
| `packages/agents/src/templates/specialists/packaging_design.ts:13`  | kit colours / kit mode / kit bar | "Artwork uses the kit colours and the design system's typography rules; print files meet the supplier's spec.",                               |
| `packages/agents/src/templates/specialists/packaging_design.ts:30`  | kit colours / kit mode / kit bar | input: "50 ml airless bottle, EU and UK, fragrance-free moisturiser; kit colours navy and cream.",                                            |

## packages/dugout (5)

| File:line                                                                  | Term                             | Text                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dugout/src/components/journey/fixtures.ts:188`                   | season                           | const titles = ["Finding the formula", "First customers", "The bundle season", "Scaling the lab", "Retail on the horizon", "Steady state", " |
| `packages/dugout/src/components/journey/fixtures.ts:203`                   | season                           | provisionalTitle: 'Season ${index + 1}',                                                                                                     |
| `packages/dugout/src/components/journey/stage/JourneyStage.stories.tsx:33` | team sheet                       | export const ReducedMotion: Story = { name: "Reduced motion (static summary)", args: { defaultSpeed: "full", overlay: "none" }, parameters:  |
| `packages/dugout/src/components/journey/stage/JourneyStage.stories.tsx:33` | full time                        | export const ReducedMotion: Story = { name: "Reduced motion (static summary)", args: { defaultSpeed: "full", overlay: "none" }, parameters:  |
| `packages/dugout/src/components/shell/KitBar.stories.tsx:6`                | kit colours / kit mode / kit bar | title: "Shell/KitBar",                                                                                                                       |

## How to read a hit

- `file:line:term` is printed by the script; the table above adds the source line.
- Internal identifiers (`matchday_level`, `--kit-primary`, `team_sheet`, `routes.trophies`) are never hits; only the display label beside them is.
- A sentence that must name an old word on purpose (a glossary entry, a redirect notice) gets `vocab-allow` in a comment on the same or the previous line. Do not use it to hide copy.
- The employment sense of "full-time" ("full-time employee", "went full-time", a label on a line that mentions hours or part-time), business seasons ("holiday season", "tax season"), "seasonality", "elevator pitch" / "pitch deck" / "the pitch holds" and "personal injury" are allowed by the scanner.
- Storybook `title:` values are read as words (`Shell/KitBar` reads as Kit Bar), because CLAUDE.md counts Storybook titles as user-facing; the component identifier itself may keep its name.
- Agent prompts and templates count: what an agent is told to say, it says. A template that still says kit mode produces agent prose that says kit mode.
