---
name: foundmill-design
description: Use whenever you style, lay out, animate or theme any screen or component of the Foundmill mobile app. Carries the exact color tokens, type scale, radii, motion timings and component anatomy of Foundmill's design system, translated to React Native. No hex value, font, radius or timing may be invented outside this file.
---

# Foundmill design system, mobile edition

## 1. The feeling

**A broadcast control room at night, in your pocket: precise, lit and unmistakably 2027.**

The room is dark and deep; the instruments are lit. Cards are machined plates whose 1 px edge catches light at a corner. Numbers are tabular and quiet, with their currency symbol and units dimmed so the figure reads first. Status glows softly in its own color. A department's color lives inside a card as light from its lit corner, never as a painted fill. The brand slab across the top is deep glass that lights the canvas beneath it. Generating is a visible live process, never a modal spinner. Agents are crew you talk to: they have faces, presence and a voice, and the founder can always answer with one tap.

Three words: **Composed. Dense. Alive.** On a phone, add a fourth: **Immediate.** Everything important is reachable with the thumb, and every important moment (a decision made, a customer won, a goal reached) is felt through motion and haptics.

Think: a financial terminal crossed with the best management sim and a modern instrument cluster, finished by a motion designer who respects the founder's attention. On a phone it should feel closer to a premium trading app or a sports broadcast companion than to a to-do list.

**What it is not:** a SaaS dashboard of white cards; radii of 16 px or more; heavy drop shadows; glows on static surfaces or on text; pastel gradients; generic "AI" violet or sparkle; frosted glass everywhere; grain, scanlines or noise; emoji anywhere in the UI; uppercase buttons, tabs or titles. There is **no light theme**. The app is dark only, and it must look superb on OLED (true-black-adjacent canvas, lit edges).

Never use Football Manager, Sports Interactive or SEGA names, art, icons, skins or fonts, and never describe the product as a game in copy.

## 2. Tokens (copy these into `theme/tokens.ts` exactly)

### Surfaces

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#08090C` | Screen background. A faint radial light in the brand's aura color at 11 % sits under the top slab, as if the slab lights the room. |
| `rail` | `#0B0D11` | Tab bar, list backgrounds, sheets' handle area |
| `surface1` | `#0F1217` | Card body, with a 1.8 % white top light over its first 120 px |
| `surface2` | `#151920` | Raised controls, quick replies, pressed rows, chat bubbles |
| `surface3` | `#1C212A` | Active segment, menus, bottom sheets |
| `surface4` | `#252B36` | Pressed state |
| `ink` | `#05070A` | Logs, diffs, code, the session terminal |

Lines are white at low alpha so one set works on every layer: `lineFaint` rgba(255,255,255,0.045) row dividers; `line` 0.075 hairlines and card header rule; `lineStrong` 0.13 control borders; `edgeHi` 0.24 light caught at a corner. Dividers inside cards fade out toward their end; never a hard full-width rule.

**The gradient edge.** A card's 1 px border is a 145° gradient: `edgeHi` at the top left, falling to 7 % by 16 %, 3.5 % through the middle, rising to 15 % at the bottom right. In React Native build it with `expo-linear-gradient` as a 1 px frame behind the card body (a wrapper with the gradient and 1 px padding; the body on `surface1` with radius minus 1). Department cards add a radial light of the department color at 13 % from the top-left corner (90 % × 140 px) drawn with `@shopify/react-native-skia`; brand-lit cards use the brand aura.

Elevation is soft and layered: `elev1` cards (shadow 0 1 2 rgba(0,0,0,.35) plus 0 8 24 rgba(0,0,0,.28)), `elev2` sheets and menus, `elev3` dialogs. Always with an inner 1 px top highlight (white at 6 %). Glows come only from a source: status dots, badges, the Today marker, the active tab glyph, Continue, presence rings. **Never on a static card, never on text.**

Glass: `glass` is surface3 at 86 % over a 16 px blur (`expo-blur`), with a `lineStrong` hairline whose top edge is a little brighter. Used for the top slab (over the brand color), the decision sheet and the tab bar. Backdrop behind sheets: canvas at 66 % with a 6 px blur.

### Text ramp

`text1` `#EDF0F4` content · `text2` `#A9B3C1` secondary and labels · `text3` `#8A94A3` captions, units, metadata (passes 4.5:1 on every surface) · `text4` `#5A6370` **disabled only** · `reading` `#DFE4EA` note bodies · `accent` `#7CC4FF` focus, selection and links outside prose.

### Status

`good` `#3DD68C` · `warn` `#F5B841` · `bad` `#F36066` · `info` `#5E8EFF`. Pills are icon + word in the status color on a 12 % fill with a 30 % ring, 22 px tall, fully round. **Never a bare colored dot without a word next to it.**

### Rating ramp 1–20

`rating1` `#F2545B` for 1–5 (Poor) · `rating2` `#F5B841` for 6–10 (Average) · `rating3` `#9ADF7E` for 11–15 (Good) · `rating4` `#3DD68C` for 16–20 (Excellent, also drawn in weight 600). Skill bars are 20 discrete cells; lit cells take the ramp color with a top light and a faint glow; empty cells are white at 5 %.

### Brand colors (per business)

Each business has `kitPrimary` and `kitSecondary` (defaults: Foundmill steel `#3570CC` and `#FFFFFF`). Derive a ramp in OKLCH from the primary (use `culori`): `kitLift` (lifted toward text1, at least 7:1 on the canvas; default `#7CC4FF`), `kitHi` (`#5F9DFF`), `kitLo` (`#1E4A8F`), `kitDeep` (`#15325E`), `kitAura` (`#3A87FF`). `kitOnPrimary` is white or `#0F1318`, whichever passes 4.5:1 on the primary.

Use the brand with restraint, only here: the top slab and logo tile; primary actions (Continue at rest, Approve, Save); the active tab glyph and its lit edge; the revenue line and the Today marker on the Journey; the Channel Board hub; the Win moment; the initials mark that stands in for a missing logo; a selected row's left edge; a landed card's edge flash. **No AI purple**: violet is department 5's color and nothing else.

### Department colors

`dept1` `#5B8CFF` blue · `dept2` `#3DD68C` green · `dept3` `#F5B841` amber · `dept4` `#F2545B` red · `dept5` `#B98CFF` violet · `dept6` `#4FD1C5` teal · `dept7` `#FF8A5B` orange · `dept8` `#E879C8` pink. The API tells you which token a department uses (`colorToken`). Used for department dots (with glow), badges, avatar palettes, the light inside department cards, and a 4 % tint on an agent's chat bubbles.

### Gold

`gold` `#E8C56B` to `goldDeep` `#B8923A`. Reserved for Customer Updates, milestones, customers and stars. Nothing else is ever gold.

## 3. Typography

Fonts, loaded with `expo-font` from bundled files (no CDN): **Barlow Semi Condensed 600** for figures, screen titles and data labels; **Inter 400 / 500 / 600** for everything you read or press; **JetBrains Mono 450 / 500** for timestamps, ids, counts in headers, logs. Case rule: sentence case everywhere. Caps appear only in the `data` style, set by code, never typed.

| Style | Spec | Where |
| --- | --- | --- |
| `figureHero` | Barlow 600, 48/52, tabular | The one hero figure on a screen (Journey revenue per day, Finance cash) |
| `displayXl` | Barlow 600, 36/40 | Win moment, goal reached |
| `displayLg` | Barlow 600, 28/32, tabular | Tile figures |
| `displayMd` | Barlow 600, 22/26 | Screen titles, agent and contact names, note subjects (24/30) |
| `displaySm` | Barlow 600, 17/22 | Business name, card names |
| `title` | Inter 600, 15/20, −0.003em | Card titles |
| `action` | Inter 500, 15/20 | Buttons, tabs, quick replies, segmented options |
| `actionSm` | Inter 500, 13/18 | Small buttons, chips with text |
| `label` | Inter 500, 13/18, text2 | Form labels, list section labels |
| `data` | Barlow 600, 11/14, caps, +0.09em, text3 | The only caps: tile captions, "Your decision", "Next step", Estimate, Forecast |
| `body` / `bodyStrong` | Inter 400 / 500, 15/22 | Everything else |
| `reading` | Inter 400, 17/26, −0.006em, color `reading` | Note bodies and Customer Update commentary |
| `chat` | Inter 400, 15.5/22 | Conversation bubbles |
| `small` | Inter 400, 13/18 | Captions, metadata |
| `mono` | JetBrains Mono 450, 13/18, tabular | Timestamps, ids, provenance, logs |
| `micro` | JetBrains Mono 500, 11/12, +0.02em | Axis ticks |

Mobile sizes are two points larger than the desktop scale because the reading distance is shorter and the thumb is coarser. Nothing below 11 px. Tabular figures on numbers only (`fontVariant: ["tabular-nums"]`), never on body text. Figure micro-typography: the currency symbol is smaller, dimmed and raised (66 %, text3), decimals are dimmed (66 %, text2), units are mono (62 %, text3): "£72K" reads as a dim £, a bright 72, a dim K. Big numbers never count up digit by digit; they settle once. Respect the OS font scale up to 130 % and let rows grow; never clip.

## 4. Spacing, sizes, radii

8 px grid, 4 px half-steps. Screen side gutter 16. Card padding 14. Card header 44 (title, mono meta, Estimate chip, a ghost "…" menu; a 1 px rule fading out underneath). Rows 52 compact, 60 comfortable (minimum touch target 44 × 44).

| Token | px | Use |
| --- | --- | --- |
| `controlXs` | 24 | Chips, pills, tags |
| `controlSm` | 32 | Small buttons, segmented track |
| `controlMd` | 44 | Buttons, quick replies, list rows' action |
| `controlLg` | 52 | Primary and decision buttons |
| `field` | 48 | Text fields |
| `continue` | 56 | The Continue button |
| `badge` | 18 | Badges, Estimate chips |

Radii (nothing reaches 16): `rXs` 3 cells, Estimate chips · `rSm` 6 controls, chips · `rMd` 10 cards, tiles · `rLg` 14 sheets, dialogs, chat bubbles (5 at the tail) · `rPill` 999 pills, avatars, Continue.

Avatars: 20, 24, 28, 36, 48, 64, 88 (the agent profile header). Business logos: 24, 32, 48, 72.

Shell: top slab 56 + safe area; tab bar 56 + safe area, glass over the rail; the Continue pill floats 12 px above the tab bar, centered, 56 tall, at least 160 wide.

## 5. Motion and haptics

Three curves: `easeOut` cubic-bezier(.2,.8,.2,1) for reveals and sheets; `easeSpring` cubic-bezier(.34,1.45,.64,1) for press release and chip pops; `easeInOut` cubic-bezier(.65,0,.35,1) for sliding indicators. Linear for progress, orbit, shimmer and streaming. Use `react-native-reanimated`.

| Name | ms | Use |
| --- | --- | --- |
| press | 90 | Scale to .985 on press, spring back on release |
| hover | 140 | (long-press highlight) |
| overlay | 200 | Sheets and menus: scale .98 → 1 and fade |
| slide | 260 | Tab underline, segmented plate |
| view | 320 | Screen cross-fade; a landed card rising in |
| pulse | 600 | One-shot ring on Continue when new notes land |
| draw | 1200 | Journey line draw; a landed card's edge settling |
| shimmer | 1600 | Skeleton band |
| breathe | 2400 | Presence ring of a live agent |

Cadences: streaming text at 22–34 ms a character with a 120 ms pause at commas; typing dots loop every 1200 ms, 160 ms apart; skeleton bars start 60 ms apart; quick replies rise 40 ms apart.

Haptics (`expo-haptics`): light impact on selecting a tab or an option; medium on pressing Continue; success notification on a decision sent, a goal approved or a customer won; warning on a red note arriving; error on a refused action. Never a haptic on scroll or on a toast that only informs.

Signature moments:
- **Continue**: at rest the brand gradient with an inner top highlight and a brand glow below. When a run finishes and new notes land, one 600 ms ring pulse. **Blocked**: a solid red gradient with ink text "Respond · N" and an alert icon. **Processing**: a dark slab with an orbiting light arc on its edge (one turn per 2400 ms) and the label "Pause". **Customer Update**: gold with "Watch the update". **Vacation**: neutral with "Come back".
- **Win moment**: a 1.2 s full-bleed brand wipe with a particle burst in the brand's secondary color and gold (Skia), then the customer's name in `displayXl` and the amount. Sound off by default. Reduced motion shows a static gold card with the same facts.
- **Landed card**: a new note rises 8 px and fades in over 320 ms, flashes a `kitLift` left edge that settles over 1200 ms, and carries a "Just in" tag.
- **Presence**: a live agent's ring breathes outward (scale 1 → 1.35, fading, 2400 ms).
- **Journey**: the revenue line draws left to right over 1.2 s on first open; live events ripple into the Today marker with a ring.
- **Skeletons**: surface2 bars with a 100° light band, staggered; never spinners inside cards. A skeleton names what it waits for ("Queued for Teodor"). Spinners live only inside buttons.

Respect `AccessibilityInfo.isReduceMotionEnabled`: every loop stops on a legible frame, streams render whole, nothing advances by itself.

## 6. Component anatomy (build these once in `components/`, use them everywhere)

- **TopSlab**: 56 px glass slab in the brand color (a 10 % white gloss, a brand gradient 92 % → 38 % alpha left to right over near-black, a fixed 104° specular streak, a 1 px light top edge, a `kitLift` line under it, a brand glow cast onto the canvas). Left: 32 px logo tile (7 px radius, inner ring) that opens the business switcher. Center: screen title in `displayMd`. Right: the "what the team can do" chip in words ("Asks over £50") and a ghost icon button for search. Text is `kitOnPrimary`.
- **TabBar**: five tabs on glass over the rail. Lucide icon 22 px, label in `actionSm`. Active tab: icon in `kitLift` with a 3 px lit bar above it and a soft glow. Badges: 18 px pills in the department color (Inbox's is red for Respond) with an ink number.
- **ContinueButton**: the floating pill described above. One per screen (Today and Inbox).
- **Card**: surface1, 10 px radius, the gradient edge, the top light, `elev1`. Department variant adds the corner light and a tinted lit corner. Brand variant (Journey, Goal) uses the brand aura. Header 44 px. Empty state: a 20 px Lucide icon on a soft disc of department light, one line of body text, one action. Error state: a `bad` pill plus one line, technical detail behind "Details" on ink.
- **MetricTile**: a `data` caption, a `displayLg` figure with currency and unit micro-typography, a `small` caption line, an optional Estimate chip, an optional delta pill (arrow + percent + "vs last week").
- **StatusPill**: icon + word, 24 px, fully round, 12 % fill, 30 % ring in the tone.
- **Chip**: 24 px, 6 px radius, a 3.5 % white plate with a hairline ring, `actionSm` in text2, an optional 6 px department dot with glow. Chips wrap; they never truncate.
- **EstimateChip** / **ForecastChip**: 18 px, a dashed 1 px edge at 22 %, the word in full in the `data` style. A dashed edge always means "not measured".
- **Button**: sentence case, Inter 500, icon before label, 6 px radius, press scale. Variants: `primary` (brand gradient, 20 % lighter at top, inner top highlight, brand glow), `secondary` (surface2 with a 5.5 % → 2 % sheen and a `lineStrong` ring), `ghost` (text2; pressed adds a 5 % plate), `danger` (bright red gradient, near-black text), `gold` (Customer Updates and milestones only). Two-line variant with `description` for decision options and an inline tag ("Recommended").
- **QuickReplies**: 2–4 secondary buttons under the last agent message, 44 px, rising 40 ms apart; the likeliest one brand-tinted; a ghost "Write" opens the composer. Typing is optional, never required.
- **DecisionSheet**: a bottom sheet on glass, `elev2`. Heading line "Your decision" in `data` style, "Expires in 5 days" in mono, and "Ask <Agent> · Talk it through first" as a ghost link. Options are full-width two-line buttons stacked vertically: label, then its consequence in `small` ("Deposit of 50 % leaves this week; stock lands in six weeks"), then a text2 "because" line when the agent gave one. The recommended option is `primary` with a thumbs-up "Recommended" tag and sits first. Long-press an option for a detail card (cost as an Estimate, Reversible / Not reversible, "Not stated" for what the option left out). The sheet grows; it never clips.
- **Avatar**: with "agent names and faces" on, the persona portrait (`expo-image`, rounded, 1.5 px status ring: good green, waiting amber, failing red, idle text4); otherwise a procedural mark in the department palette seeded by the agent id. Presence is separate from health and always has a word next to it ("Live · typing", "Away", "Down"). Humans show initials on surface2.
- **ProfileHeader**: 96 px, 64 px portrait, name in `displayMd`, role and department chips, three facts, a model chip ("Opus"), stars.
- **SkillBar**: 20 cells, 7 px each with 2 px gaps, ramp color, faint glow on lit cells; value in Barlow 600 in the ramp color with its band word (Poor / Average / Good / Excellent).
- **StarRating**: 0–5 with halves, 14 px gold stars, empties `lineStrong`; current solid, potential outlined, with the caption "Now 3.5 of 5 · could reach 4.5".
- **FormCells**: five 10 px cells for the last five tasks (good / partly / failed), with the key "Last 5 tasks: 4 went well, 1 partly, 0 failed" available on tap.
- **EntityText**: renders markdown plus `[[ent:…]]` mentions as underlined tappable names in the text's own color (1 px underline at 40 %, offset 3 px). Dotted underline for unresolved mentions.
- **ChatBubble**: founder bubbles right, in brand glass, 14 px radius with 5 at the tail, mono read receipt ("Read 2:02 PM"). Agent bubbles left on a 4 % department tint with a 16 % ring; the portrait on the last bubble of a group. A streaming bubble raises its ring to 32 % and shows the newest words in text2 until they settle, with a caret in the department color. The typing line names what the agent is reading ("Juno is typing · reading Boots UK's supplier terms").
- **Toast**: a tone tile (a 28 px square of status light holding the icon), a title, an optional line and action, a 2 px timer along its foot. Slides in from the top under the slab; swipe up dismisses. At most two stacked; older peeks behind.
- **Sheet**: bottom sheets on surface3 glass, 14 px radius, a 36 × 4 handle, scale from .98 and fade over 200 ms. Use `@gorhom/bottom-sheet`.
- **Segmented**: a 32 px well; the active plate is surface3 with a ring and highlight, sliding between options in 260 ms.
- **SectionLabel**: `data` style, 16 px side gutter, 24 above, 8 below.
- **JourneyRibbon (mobile)**: a horizontally scrollable Skia canvas, 220 px tall, with zoom Week / Month / Quarter / All time as a segmented control above it; revenue per day as the lit brand line; new signups, paying customers and team hours as small bars beneath; chapters along the top ("Q3 2026 · Building momentum"); pins for releases, gold-ringed milestones, dashed planned items; everything after Today hatched with a dashed forecast and a 7 % cone; a "Today · Oct 9" pill; pinch to zoom; tap a day for its facts.
- **ChannelBoard (mobile)**: a square map on ink with a brand hub at the center. Quadrants: Acquisition top left (dept8), Engagement top right (dept6), Organic bottom left (dept1), Offline bottom right (dept5). Distance from the hub = fit (rings for Excellent 16–20, Good 11–15, Average 6–10, Poor 1–5). Running channels are 48 px tokens; channels not running are 28 px dashed ghosts in a tray below. Tap a token for its card; long-press a ghost for "Put on the board".
- **LogView**: the session log on ink in `mono`, auto-scroll with a "Jump to latest" pill, test results as good/bad pills, file changes as "+12 −3 path" rows.

## 7. Never clip, never dash

Labels step their font down to a floor, then wrap to two lines, then truncate with a tooltip as the last resort. Numbers never truncate. Tabs that do not fit go into a "More" sheet. Never show "—" or "–" for a missing value: use the words the API gives.

## 8. Icons and images

Lucide only (`lucide-react-native`), 20 px default, 16 px inline, 24 px in empty states, stroke 1.75. The "generate" glyph is Lucide **Fan** (the mill). Icon identifiers: Milestones `Trophy`, Today `Sun`, Inbox `Inbox`, Team `Users`, Journey `Route`, Business `Building2` (identifiers only; the word a founder reads is always "Milestones"). Never emoji, never a shield, ball or sports image. Business logos are drawn as an image on a white tile with 22 % corner rounding; without a logo, an initials mark (rounded square in the primary brand color with 1–2 letters).

App icon: `foundmill-icon-512.png` (square, no transparency). Splash: canvas `#08090C` with the Foundmill wordmark in `#EDF0F4` at 120 px wide. The "FM" monogram is the app icon only; it never appears inside the UI.
