# DESIGN.md — design system art direction

The design system of Foundmill lives in `packages/dugout` (the package name is internal; the product never shows it). This document is the taste. `docs/BUILD.md` §5 is the contract (tokens, components, keyboard); this file says how it must *feel* and look. When the two seem to disagree, BUILD.md wins on facts and this file wins on aesthetics.

## 1. The feeling

**A broadcast control room at night, built for one founder.**

Dark slate. Machined panels. Condensed capitals. Numbers that feel alive. It should feel like the best management-sim interface crossed with a financial terminal, then finished by a motion designer who respects the user's attention. Dense but never cramped. Quiet but never dead. Every pixel earns its place.

Three words: **Composed. Dense. Alive.**

What it is not: a SaaS dashboard with cards floating on white, rounded 16 px corners, drop shadows everywhere, pastel gradients, emoji, "AI sparkle" purple. None of that. No light theme exists.

## 2. Non-negotiables

- Desktop only. Reference 1440 px, minimum 1280 px. Below that render `NeedsLargerWindow` and nothing else.
- Dark only. One theme.
- Tokens only. No hex outside `tokens.css`. No arbitrary Tailwind values like `bg-[#123456]` or `p-[13px]`. Spacing from the 4/8 px scale.
- Lucide icons only. 16 px default (14 px inline in text, 20 px in empty states), stroke 1.75.
- Fonts: Barlow Semi Condensed (display), Inter (body), JetBrains Mono (mono). Self-hosted through `@fontsource` packages. No font CDN.
- Colour is never the only signal: pills carry an icon and a word, ratings carry a number, deltas carry an arrow.
- `prefers-reduced-motion` turns every animation into an instant state change with identical information.
- Never use Football Manager, Sports Interactive or SEGA names, art, skins, icons or fonts. Reproduce the layout grammar only.

## 3. Surfaces and depth

Depth comes from a luminance ladder, not from shadows.

| Layer | Token | Use |
| --- | --- | --- |
| Page | `--bg-base` #0F1318 | The canvas behind everything |
| Panel | `--bg-panel` #171C23 | Every panel body, table body, tile body |
| Raised | `--bg-panel-alt` #1D232B | Panel headers, hover rows, nested controls, inputs |
| Hairline | `--line-subtle` #2A313B | 1 px borders and dividers |

- **Panel**: `bg-panel`, 1 px `line-subtle` border, 4 px radius, inner highlight `inset 0 1px 0 rgba(255,255,255,0.03)`. No drop shadow.
- **Panel header**: 32 px tall, `bg-panel-alt`, title in the label style (§4), caret menu on the right (swap content, settings, Pin to Home). A thin 1 px hairline under it.
- **Overlays** (hover cards, menus, dialogs, command palette): `bg-panel-alt`, hairline border, shadow `0 12px 32px rgba(0,0,0,0.55)`, 4 px radius. Dialog backdrop `rgba(15,19,24,0.72)` with 2 px blur.
- **Terminals and diffs** sit on a deeper ink `--bg-ink` #0B0E12 so code reads as code.
- **Table rows**: hairlines at 50 % opacity between rows; zebra at 2 % white; hover at 4 % white; selected rows get a 3 px `kit-primary` left edge.
- **Scrollbars**: 6 px, thumb `line-subtle`, track transparent.
- **Focus**: 2 px `--accent-link` outline, 1 px offset, on `:focus-visible` only.

## 4. Typography

| Style | Spec | Where |
| --- | --- | --- |
| display-hero | Barlow Semi Condensed 600, 64/64 | The signed-out landing page's two headlines only |
| display-xl | Barlow Semi Condensed 600, 40/44 | Win moment, hero numbers, landing section titles |
| display-lg | Barlow 600, 28/32 | Tile numbers, status strip figures |
| display-md | Barlow 600, 20/24 | Screen titles in the top bar, profile names |
| display-sm | Barlow 600, 15/20 | Panel subtitles, section headings inside notes |
| tab | Barlow 600, 13/16, uppercase, tracking 0.04em | Tab bar, sidebar labels |
| label | Barlow 600, 11/14, uppercase, tracking 0.06em, `text-secondary` | Panel titles, table headers, chips, metric captions |
| body | Inter 400, 13/19 | Everything else |
| body-strong | Inter 500, 13/19 | Subjects, names in rows |
| reading | Inter 400, 15/24 | Inbox note body only (a 640 px measure) |
| small | Inter 400, 12/16 | Metadata, timestamps, provenance |
| mono | JetBrains Mono 400, 12/18 | Logs, diffs, ids, terminals |

`font-variant-numeric: tabular-nums` on every element that shows a number next to another number. Numbers right-align in tables. Big numbers never animate digit by digit; they settle once.

## 5. Colour

- **Text**: `text-primary` for content, `text-secondary` for labels, metadata and placeholders. Disabled is `text-secondary` at 50 %.
- **Links and entities**: `accent-link`. No underline at rest, underline on hover. Entity links carry a 14 px kind icon before the name, so a person, an organisation and an agent read differently at a glance.
- **Status**: `status-good`, `status-warn`, `status-bad`, `status-info`. Pills are icon + word, text in the status colour on a 12 % tint, 20 px tall, 3 px radius. Never a bare coloured dot without a word nearby.
- **Rating ramp (1–20)**: `rating-1` red for 1–5, `rating-2` amber for 6–10, `rating-3` light green for 11–15, `rating-4` bold green for 16–20. 16–20 also set in weight 600. Skill bars are 20 discrete cells, filled cells in the ramp colour, empty cells `bg-panel-alt`.
- **Brand colours** (`--kit-primary` / `--kit-secondary`) are the business's identity and are used with restraint, only here: the top bar gradient, the Continue button at rest, the active sidebar item's 3 px edge, the revenue line on the Journey Ribbon, the Channel Board surface, the Win moment, the logo, the selected-row edge. Nowhere else. `kit-on-primary` is computed (white or near-black) so text on a brand colour always passes APCA Lc ≥ 75.
- **Department colours** `--dept-1` … `--dept-8`: #5B8CFF blue, #3DD68C green, #F5B841 amber, #F2545B red, #B98CFF violet, #4FD1C5 teal, #FF8A5B orange, #E879C8 pink. Used for Ribbon bands, department dots, processing-strip segments, sidebar badges, avatar palettes.
- **Gold** `--gold` #E8C56B (gradient to #B8923A) is reserved for Customer Updates, milestones and the customer-won inbox edge.

## 6. Spacing and sizes

8 px grid, 4 px half-steps for inline tightness. Panel padding 12 px. Content gutters 16 px. Sidebar 232 px (64 px collapsed). Top bar 56 px. Processing strip 3 px. Tab bar 40 px. Right rail 320 px. Rows 28 px compact, 34 px comfortable. Chips 20 px. Buttons 28 px (sm) and 32 px (md), 4 px radius, label in the tab style at 12 px. Inputs 32 px on `bg-panel-alt` with a hairline border that brightens on focus.

## 7. Motion

Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`. Durations: 120 ms micro (hover, press), 200 ms overlays and panel state, 320 ms view transitions, 1200 ms the Ribbon flow-in. Motion carries meaning or it does not exist.

- **Continue**: at rest a `kit-primary` fill. When a cycle finishes and new items arrive, one 600 ms soft ring pulse, never a loop. Blocked is `status-bad` with "Respond · N". Processing shows an indeterminate 2 px sweep along the bottom edge and the label "Pause". A Customer Update is gold. Holiday is neutral with "Come back".
- **Processing strip**: each active department segment shimmers with a 1.6 s gradient sweep in its department colour.
- **Journey Ribbon**: the data draws left to right over 1.2 s on first load. Live events ripple into the Today line with a 300 ms ring. The Today line glows (`kit-primary`, 8 px blur).
- **Hover cards**: 300 ms delay, then fade + 4 px rise over 160 ms.
- **Sidebar collapse**: 200 ms width, labels fade in 120 ms after.
- **Win moment**: a 1.2 s full-bleed brand-colour wipe with a PixiJS particle burst in `kit-secondary` and gold; sound off by default. Reduced motion shows a static gold card with the same facts.
- **Tables**: no row animation. Selection and sort are instant.
- **Skeletons**: `bg-panel-alt` bars with a 1.6 s shimmer; never spinners inside panels.

## 8. Component anatomy (the pieces that define the look)

- **AppShell**: sidebar left, top bar, processing strip under it, tab bar, content grid, optional right rail. Nothing floats.
- **Sidebar**: 232 px. Items 32 px tall: icon 16 px + tab-style label; active item has a 3 px `kit-primary` left edge and `bg-panel-alt`; badges are 18 px pills in the department colour with a 11 px number. Groups: Home, Inbox, departments in the founder's order, CRM; a hairline; LIVE items; foot: Settings, Anthropic key. Collapsed state keeps icons and badges.
- **KitBar**: 56 px, gradient from `kit-primary` to `kit-primary` darkened 14 %, text in `kit-on-primary`. Left: logo 32 px, business name (display-sm), back/forward. Centre: screen title (display-md) and universal search (320 px, `bg-ink` at 40 % with white text). Right: date + runway chip, business-mode chip, **Continue**, **Stop all agents** (icon button, `status-bad` on hover).
- **TabBar**: 40 px, `bg-panel`, tabs in tab style; active tab has a 2 px `text-primary` underline; tabs with sub-views show a 12 px caret.
- **Panel**: see §3. Empty state: 20 px Lucide icon in `text-secondary`, one line of body text, one small button. Error state: `status-bad` pill + one line.
- **DataTable**: label-style header, sticky; sort caret 12 px; filter chips above; right-click context menu; saved-view selector at the top left; CSV export in the caret menu; virtualised body; keyboard nav with a visible row focus ring.
- **EntityLink**: inline, kind icon 14 px, `accent-link`, hover card 320 px after 300 ms with avatar/logo, name, kind/role chips, three key facts, actions.
- **StatusPill**: icon + word, 20 px.
- **StarRating**: 0–5 with halves, 12 px stars in `--gold`, empties `line-subtle`. Current stars solid, potential stars outlined.
- **SkillGrid**: three columns (Craft, Judgement, Execution), each row: skill name (body), value (display-sm in ramp colour, tabular), 20-cell bar, delta arrow (▲ good, ▼ bad, tinted). Hover reveals "Tested 15 · Proven 13 · 42 tasks".
- **DecisionBar**: sticky at the bottom of the reading pane, 64 px, `bg-panel-alt`, 2–4 buttons; the recommended option carries a thumbs-up icon and a `kit-primary` fill, the others are outlined; hover shows consequence, cost and reversibility in a small card; free-text input + "Execute" on the right.
- **AgentTile**: header 32 px (avatar 20 px with status ring, name, task link, phase pill, progress ring 16 px), body (Terminal on `bg-ink`, Diff, Preview, Plan), footer 24 px small-style (elapsed, tokens, cost, ETA, last note), controls on hover (Pause, Nudge, Reassign, Upgrade model, Stop).
- **Channel Board** (`FormationBoard`): a quadrant map, 16:10, on `bg-ink`. A hub in the brand colour sits at the centre (running count in display-lg, a slow sweep around its rim) under a soft glow of `kit-primary`; a fine dot grid fades towards the edges. Each channel family owns a quadrant (Acquisition top left, Engagement top right, Organic bottom left, Offline bottom right) with a faint wash in its accent (`dept-8`, `dept-6`, `dept-1`, `dept-5`: hues that never collide with the rating ramp) and its label, count and members in the corner. Every channel has a fixed home on its quadrant's diagonal: the closer to the hub, the stronger the fit, on elliptical rings that mark the bands (Excellent, Good, Fair, Weak, captioned on the upper axis, which stays clear). Running channels are 56 px tokens ringed and haloed in their family accent, joined to the hub by a curved signal line whose dashes travel outwards (static and dimmed when paused, brighter on hover or focus); channels not running wait as 32 px dashed ghosts at their home, and the ghost lights up while its token is dragged. Below the board, the tray holds every channel that is not running in four family columns. Homes come from a deterministic layout (`boardLayout`) that keeps every token and its full name clear of every other and never moves a channel when another is toggled.
- **JourneyRibbon**: the business's story on one time axis, as labelled rows, so nothing needs a key to read. A 36 px toolbar carries the legend (Revenue, Forecast, Milestones, Planned) and the zoom (Week, Month, Quarter, All time, Today). A 184 px label column names each row and shows its value for the last 7 days, or for the hovered day: revenue per day as a display-sm number with "per day, 7-day average" and the change on the week before (`status-good` / `status-bad`), then New signups, Paying customers and Agent hours with right-aligned tabular numbers. The plot: quarters as chapters along the top ("Q3 2026 · Building momentum", body 11 px, alternately shaded, the current one in `text-primary`); revenue per day as a 2 px line with a soft gradient fill in the brand colour lifted towards `text-primary` (so it reads whatever the brand), on a round money scale whose values sit at the left edge; milestones and planned roadmap items as labelled pins packed into up to three rows so no label overlaps (a pin without room keeps its name in the tooltip); bar rows for new signups (`accent-link`), paying customers (`gold`, click to open the day or the one Customer Update) and agent hours (`text-secondary` at 50 %, the department split is in the hover card); everything after Today hatched, the forecast dashed with a 12 % cone, the runway as "Cash runs out ~Mar 2027 · Estimate" (a dashed line in amber under 9 months, red under 6) or "Cash lasts N months" past the horizon; the axis in small style. No text sits on a colour fill; labels over lines get a 3 px `bg-panel` halo.
- **JourneyStage** (Customer Update): full content area, `bg-base` with a vignette in `kit-primary` at 10 %; Who was involved on the left (channels and agents, lead channel and standout agent starred); First touch timeline; touches as commentary rows in reading style; rails with customer facts and stat panels; Win moment; Debrief card with agent ratings (1–10, display-lg) and the Standout agent.
- **CodeViewer**: a read-only source file on `bg-ink` in a 4 px panel. A 32 px `bg-panel-alt` header carries a file icon, the path in mono `text-primary`, then line count and size in small tabular `text-secondary`. The body is two `<pre>` columns in the mono face: line numbers right-aligned in `text-secondary` at 70 % behind a hairline (not selectable, so copying takes only code), then the code; long lines scroll sideways, never wrap. A binary file shows the empty state "This is a binary file, so it is not shown as text."; a file cut at 1 MB says so in a small footer.
- **WidgetGrid**: react-grid-layout with 12 columns, 16 px gutters, row height 8 px. Edit mode shows a dotted outline on each widget, a drag handle in the header and a resize corner; a 1 px dotted grid appears on the canvas.
- **Logo** (`Crest` component): procedural SVG. One of four shield silhouettes chosen by seed, split or quartered in the brand colours, a 1–2 letter monogram in display style, a 1 px inner outline in `kit-secondary` at 40 %. `generateCrest({ seed, kitPrimary, kitSecondary, monogram })` returns an SVG string. Sizes 20, 32, 48, 96.
- **Avatar** (agents): a procedural geometric portrait, three to five overlapping shapes in a palette derived from the department colour, seeded by `avatar_seed`; status ring 2 px (good green, waiting amber, failing red, idle `line-subtle`). Humans get initials on `bg-panel-alt`. Sizes 20, 24, 32, 48, 64.
- **ProfileHeader**: 96 px, avatar/logo 64 px, name display-md, role and kind chips, three key facts in label + body pairs, actions right, model chip (mono, `bg-panel-alt`) and current/potential stars.
- **NeedsLargerWindow**: centred mark without a business logo, display-md "This needs a larger window", body line with the minimum width, the current width in mono.

## 8a. Brand marks

The founder's lettering (2026-10-07) is the only logo. It lives as vector path data in `packages/dugout/src/brand/marks.ts` (`@foundmill/dugout/brand`) and as two components in the foundation barrel:

- **`<Wordmark height={16} />`** — "FOUNDMILL" in wide machined capitals, one path filled with `currentColor`, 10.97 : 1. Cap heights used: 12 (footers, dense chrome), 16 (sidebar foot, top bar when the business has no logo yet), 20–28 (login lock-up with the tagline under it in body/`text-secondary`), 40 (empty first-run screens). Never below 12 px, never stretched, never with a drop shadow or gradient.
- **`<LogoMark size={24} />`** — the "FM" monogram cut from the same lettering, 2.73 : 1, `currentColor`. `variant="tile"` draws it in `text-primary` on a rounded `bg-ink` square for launchers and places that need an opaque square. `tone="duo"` colours the M in `kit-primary` (falls back to `accent-link`); use it only where the business's brand colours are already on screen (the top bar, the logo editor), otherwise stay mono.
- Colour: `text-primary` on `bg-base`/`bg-panel`/`bg-ink`; `kit-on-primary` inside the top bar. On a light surface (emails, printed exports) use `--bg-base` ink. No other colours.
- Spacing: clear space of one cap height on every side; the wordmark sits on the 4 px grid with its baseline aligned to adjacent body text.
- The business logo (procedural, §8) is the *business's* mark; the wordmark/monogram are *Foundmill's*. The top bar shows the business logo, the sidebar foot and the login page show the Foundmill marks. Never place the wordmark inside a business logo.

Static files for `apps/web` are generated by `pnpm exec tsx scripts/brand-assets.mts` (colours read from `tokens.css`): `app/icon.svg` (favicon: ink tile, light letters), `app/apple-icon.png` (180), `app/opengraph-image.png` (1200 × 630: wordmark + tagline on ink), and `public/brand/` (`foundmill-wordmark-{light,ink}.svg`, `foundmill-monogram-{light,ink}.svg`, `foundmill-icon-tile.svg`, `foundmill-icon-transparent.svg` with scheme-aware letters, `foundmill-icon-{192,512}.png`). Regenerate rather than hand-edit.

## 9. Screen notes

- **Home**: the Ribbon is the hero, 12 columns, 300 px. Below it a status strip of six tiles (cash, runway, revenue, customers this week, business health, leaderboard position when LIVE) with display-lg figures and label captions. Department cards 4 columns each: header with department dot, name, lead avatar, health pill; team strip of avatars with status rings; "Now" with up to three live lines, entities linked; headline metric with a 48 px sparkline; "Next up". Team pulse: a 7 × 24 heatmap, cells in the department colour at activity alpha. Inbox preview: four rows.
- **Inbox**: 380 px list, rows 56 px (avatar 24, subject body-strong, preview small in `text-secondary`, time right, red 6 px dot when required, gold edge for customer won). Reading pane: 64 px header (persona link, date, department chip, related entities), note in reading style within a 640 px measure, status strip of up to four metric tiles with provenance on hover, exhibit panel, DecisionBar.
- **Ideation Studio**: concept cards are profile cards: logo 48, name display-sm, pitch body, current and potential stars, ten attributes as label + 20-cell bars, evidence on hover. Compare shows attribute bars side by side and a radar in department colours.
- **Live sessions**: tiles on `bg-base` with 1 px gaps, grid adapts to 1/2/4/6/9/12/16/24, focused tile takes two thirds with a rail of the rest.
- **Development › Code** (after Pull requests): the code agents wrote on code tasks, saved when each session ends. A 4-column "Saved code" table (task with the saving agent's avatar, files, saved as narrow relative time; the selected row carries the 3 px `kit-primary` bar), and an 8-column panel titled with the task: status pill, "Show in Plan" and "Forget" (ghost, trash icon; a danger confirmation dialog, owners and admins only) in the header; a 32 px line with the branch chip (mono, branch icon) and the saved-session picker ("Latest · 8 Oct, 23:50 · 5 files"; a plain line when there is one); a 256 px file list (directory in `text-secondary`, file name in `text-primary`, size right; the open file has the 3 px `kit-primary` edge, a filter box above 12 files) beside a CodeViewer. The footer reads "5 files · 1.2 KB · saved 3 min ago by Juno · 2 added, 1 changed, 0 removed by that session". With nothing saved, one full-width panel explains where saved code comes from and offers "Go to Plan".
- **Finance**: display-lg figures with label captions and sparklines; the P&L is a DataTable with indented rows, subtotal rules (1 px `text-secondary` top border) and a "Management P&L, unaudited, cash basis" label when there is no ledger. Forecast values are always captioned "Forecast".
- **Team**: agents DataTable with the Form column as five 8 px cells (good/warn/bad), Rating as display-sm, Model as a mono chip, Wage tabular.
- **Agent profile**: ProfileHeader, SkillGrid, position map (role cells tinted Natural/Accomplished/Competent/Unconvincing in the rating ramp), trait chips, coach report in reading style, development chart (skill history lines in the department colour, training sessions as diamonds).
- **Legal**: jurisdiction cards with a "date checked" stamp in small style; every recommender output captioned "Information, not legal or tax advice".
- **Settings**: a left list of sections (tab style), right panel forms with 32 px inputs; danger zone outlined in `status-bad` at 40 %.

## 9a. The landing page (signed-out `/`)

The one page a visitor sees before signing in, and the only place the app speaks to someone who has not met it yet. It uses the same surfaces, tokens and components as the app; nothing is drawn as a marketing illustration that the product does not actually contain.

- **Backdrop**: `bg-base`, a wide glow of `kit-primary` behind the hero and the same fading dot grid as the Channel Board.
- **Top bar**: sticky, 64 px, `bg-base` at 70 % with a blur, hairline under it. Logo tile and wordmark left, section links in the tab style, Sign in (ghost) and Start your business (primary) right.
- **Hero**: headline in display-hero (the tagline), a 15/24 reading lede, two large buttons (`h-control-lg`, 40 px), three assurances with green icons. On the right the `TeamOrbit`: the founder at the centre in the brand colour, the Chief of Staff, six department leads joined by signals in their department colours, the agents on the outer orbit; rings turn slowly in opposite directions, portraits stay upright, reduced motion holds still. Two glass cards sit at its corners: a decision waiting for the founder and a live activity list.
- **Sections**: facts strip (four product facts, no invented metrics), How it works (three numbered steps), Departments (six cards with each module's real tab names), Live sessions (four real `AgentTile`s replaying recorded sessions, labelled "Recorded example, replayed" and Estimate), the Channel Board on an example business (interactive, labelled), You decide (the house rules and three controls), a final call with a glow from below.
- **Glass**: `bg-panel` at 80 % with a blur and a hairline; an accent card tints its border and inner highlight with the accent. Still no drop shadows.
- Every call to action goes to `/login`. Desktop only, like the app: under 1280 px it renders `NeedsLargerWindow`.

## 10. Writing in the interface

Plain, specific, short. Sentence case everywhere except label and tab styles, which are uppercase by CSS, not by typing. No exclamation marks. No "Oops". Numbers carry units. Non-real numbers carry "Forecast" or "Estimate" in a label chip next to them. Empty states say what will appear and how to make it happen.
