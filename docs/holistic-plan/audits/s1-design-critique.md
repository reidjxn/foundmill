# Foundmill design critique (S1: design reviewer)

## Skills used

All seven loaded. One ran degraded: impeccable's critique asks for two isolated sub-agents and its detector binary; this review was told not to spawn agents or install anything, so its design review ran in one context, by hand, and the detector did not run (impeccable's own rule is to say so up front: DEGRADED, single-context).

| Skill | Loaded | How it shaped this review |
| --- | --- | --- |
| `impeccable:impeccable` | Yes. Launcher/detector skipped (it downloads and runs a binary). `reference/critique.md`, `critique-rubric.md`, `audit.md`, `onboard.md`, `operate.md` read and applied by hand. | The structure of section 1 (specificity verdict, Nielsen scores, cognitive-load count, persona walk), the 0-4 audit scores, P0-P3 severities, and the mode split: landing = Persuade, console = Operate, notes and public pages = Read. Tag: **[IMP]** |
| `ui-ux-pro-max:ui-ux-pro-max` | Yes. Its local search script ran (Python stdlib, read-only, generic queries). `references/quick-reference.md` read. | Rule ids quoted in backticks (`readable-font-size`, `primary-action`, `input-labels`, `web-target-size`, `excessive-motion`...). Its `--design-system` answer (Swiss minimal, navy + green, Space Grotesk + DM Sans) was **not** adopted: the product pins its own fonts and palette, and nothing in the evidence says the fonts are the problem. Tag: **[UUX]** |
| `ui-ux-pro-max:design-system` | Yes. Scripts not run (they write files). | The primitive / semantic / component token layering used to judge `tokens.css` in section 2. Tag: **[DS]** |
| `ui-ux-pro-max:ui-styling` | Yes. | Mostly not applicable: it is shadcn/Tailwind setup guidance and Dugout is its own system (Tailwind v4 `@utility` + Radix). Only its mobile-first and Radix focus-management points were used (the Sheet in section 4). Tag: **[STY]** |
| `taste-skill:design-taste-frontend` | Yes. Its build pipeline (deal scripts, Chrome gate) not run: it is a page builder, not a reviewer. | Its checklist applied by hand to the landing page only (kind = software): one idea per screen, 60-80 words a screen, the h1 names the category and buyer, one hard fact on the first screen, every visual renders at 1440/1024/768/390, one main action per screen, no fade-in on every section. Where it conflicts with product rules (no captions vs. the required "Example" labels; violet ban vs. department 5), the product wins and I say so. Tag: **[TASTE]** |
| `example-skills:frontend-design` | Yes. | The "generated-page tells" list (near-black + one accent, eyebrow pill, one lit phrase in the headline, middots, mono micro-labels, arrows on every CTA, fade-up everywhere), the writing rules (name things in the user's words, a CTA says what happens), "spend boldness in one place". Tag: **[FD]** |
| `andrej-karpathy-skills:karpathy-guidelines` | Yes. | Every recommendation was passed through "smallest change that fixes it" and "nothing speculative". Section 8 lists what I cut because of it (a light theme, a new typeface, a new example business, a phone console). Assumptions are stated where I could not verify. Tag: **[KARP]** |

## 0. Evidence and limits

- Repo `main` at 04a0a509, reviewed 2026-11-15. Read-only: nothing in the repo was edited, built or run; no snapshot was written to `.impeccable/`.
- Read: `CLAUDE.md`, `docs/DESIGN.md` §1-§9i, `docs/THESIS_REVIEW.md` §4, §5, §12.6, `packages/dugout/CLAUDE.md`, `tokens.css`, `dugout.css` (base layer, type and focus utilities), `controls.css` (buttons), `tokens.test.ts`, and the components named per finding. 17 screenshots in `docs/ux-audit/` viewed. `https://foundmill.com` and `/login` fetched for served HTML and copy.
- Contrast ratios are computed by me from the hex values in `tokens.css` with the WCAG 2.x formula (alpha colors flattened over the surface they sit on; gradients and glass approximated by their flat base). They are not pixel reads from a browser.
- Not verified: I did not run the app or drive a browser at 375 px. Phone claims come from the code (`LandingPage.tsx`, `DesktopOnly.tsx`, `StudioFrame.tsx`), the 390 px screenshots, and what you reported seeing today. Today and Needs you at 390 px have no screenshot; I reviewed their code only.
- `CLAUDE.md` on disk is newer than the copy in my brief (modified 12:12 today). I read the current file: the purpose paragraph, "Solo is complete", the vocabulary table (so no "bench", "squad" or British spelling in suggested copy; "project" until a first sale), and the Small screens rule under Never. Two of its sentences matter below: **"never leave a small screen at a dead end"** / "says so kindly with a way to continue later" (the product breaks this today: P0-1), and **"Never show the dense console below 1280 px"** (P1-11 asks for an argued exception).
- `git status` shows uncommitted changes that are not mine (`CLAUDE.md`, `.claude/skills/*`, `docs/holistic-plan/`, and a git-excluded `.impeccable/hook.cache.json` created at 11:58 by the impeccable plugin's hook in the parent session). I wrote nothing inside the repo; everything I created is under the scratchpad.
- The native app (CLAUDE.md: "the phone's home once it launches... build the small-screen web so that switch is one change") bounds the phone recommendations: they reuse the existing outer frames and add no phone console.
- Several Oct 20 screenshots are stale. Checked against code: the red "Respond · 2" Continue is gone since Nov 7 (`ContinueButton.tsx` now shows amber "Needs you" only on a hard stop); the sidebar now reads Today / Needs you / Plan / Customers / Money / Product / Team; "Before you start" is four questions plus optional detail. I do not report those as open.

---

## 1. Design verdict

### 1.1 One paragraph

Foundmill has a rigorous, coherent design system built for the wrong moment of the wrong person. The console is a good operator's instrument: tokens are disciplined, the text ramp is AA and unit-tested, honesty is built into components (Estimate chips, consequence lines, "Sample card"). But the person in the brief arrives on a phone, anxious, with no money and no vocabulary, and what meets them is: a phone landing that explains nothing; a first signed-in step that says "This needs a larger window · Current width: 390 px"; 12-13 px type on near-black; a dark glass pill as the main button; an idea graded on ten analyst attributes, three of which are named backwards; and an example business two years and 215 cycles in. The design brief in DESIGN §1 ("a broadcast control room at night... Composed. Dense. Alive... a financial terminal crossed with the best management sim") describes an expert's fantasy of command. The production numbers (11 of 13 projects never revisited, 113 of 127 approvals unanswered, zero public pages, zero skills added) are what happens when a novice is handed a control room. The calm register this person needs already exists in the repo: the public project page at 390 px (`40-project-page-390.png`) is clear, large and warm. The work is to extend that register inward through sign-in, first run, Today and Needs you, and to keep the control room for the console once the person has a first week behind them. **[IMP][FD]**

### 1.2 Design specificity (impeccable's first question)

- **Console: authored.** The Journey ribbon, the DecisionBar with consequence and reversibility per option, the processing strip, department light inside panels, the generate control: no other product has this set. It is specific to "run a company with agents". **[IMP]**
- **Landing and first run: category-interchangeable chrome around one authored idea.** The idea box (type one line, get a rated card before sign-up) is the authored idea. Around it sits what `frontend-design` lists as generated-page tells: tinted near-black with one blue accent, an eyebrow pill ("For founders · ..."), one lit phrase in the headline ("real business"), middots joining meta ("Free to start · $5.00 of included credits · no card"), mono micro-labels, an arrow on every call to action, a dot grid, a marquee ticker, and every section rising in on scroll (`[data-reveal]`). Any "AI agents" startup could ship this page unchanged. **[FD][TASTE]**

### 1.3 What the design gets right for this person

1. **Honesty as a component.** Dashed "Estimate"/"Forecast" chips, "First read", "Sample card: the practice model wrote it, not a real read", `ConsequenceLine` (cost + reversible or not), the six house rules. For someone with little money this is the most trust-building thing in the product, and it is rare. Keep it and move it earlier. **[IMP]**
2. **Value before sign-up.** One field, "Shape my idea", "Surprise me", a card in seconds, kept for 7 days. This is correct onboarding: do, do not read (`impeccable/onboard`: "first success before account setup"). **[IMP]**
3. **The public pages.** One column, 15/24 prose, a brand color used once, 44 px targets, container queries. This is what "you can do this" looks like. **[UUX]**
4. **The decision note.** A recommendation, 2-4 options each with what happens and what it costs, "Ask Chief of Staff · Talk it through first", sticky at the foot. The right shape for a first-timer's judgment call. **[IMP]**
5. **System rigor that makes the fixes cheap.** A tested AA text ramp, a global `:focus-visible` outline (7.0 : 1 on the canvas), a global reduced-motion rule, `Field` with label, hint, `role="alert"` error and `aria-describedby`, the guidance switch, Builder view, `Term` definitions, comfortable text. Most of what follows is re-defaulting and re-ordering things that already exist. **[DS][KARP]**

### 1.4 The five things that most make it intimidating, generic or untrustworthy

1. **The phone path is a wall, twice (untrustworthy).** The landing at any width under 1280 px (phones, tablets, and 13-inch laptops at default scaling) is hero + idea box + one note: "The rest of Foundmill... is built for screens 1280 px wide or more." No proof, no example, no explanation (`LandingPage.tsx` `PhoneLanding`). Then the kept-card page's main button, "Answer three questions about you", goes to `/onboarding`, which is not in `SMALL_SCREEN_PREFIXES`, so the person gets `NeedsLargerWindow`: a monitor icon, "This needs a larger window", "Current width: 390 px". `/home`'s "Start something" (`/new`) does the same. We asked for their idea and their email and then told them their device is wrong. **[IMP][UUX `mobile-first`, `content-priority`]**
2. **Everything is small and dim, and the main button is the dimmest thing on the page (intimidating).** Body 13/19, helper 12/16, caps labels 11 px, on #08090C. Surfaces differ by 1.06 : 1, so grouping disappears on a phone in daylight. The marketing call to action is `btn-glass`: a fill 1.6 : 1 against the page, and on sign-in it starts disabled (1.1 : 1 fill, `text-2` label) beside a bright white Google button. Every ratio passes AA; the person still reads it as "not for me". **[UUX `readable-font-size`, `primary-action`][FD]**
3. **It grades before it helps (intimidating).** The first output is ten scores out of 20 in analyst words (Market pull, Capital intensity, Agent-executability, Defensibility, Regulatory load, Distribution clarity). Three are named for the bad thing while the score runs the good way: "Competition 6" means crowded, "Capital intensity 15" means cheap to start, "Regulatory load 18" means few rules (`journey/types.ts:288-297`; the direction lives only in a hover definition). "Before you start" can ask you to rate yourself 1-20, in amber when you say 10. Agents carry stars out of 5, an average out of 10 and attributes out of 20. A first-timer is being scored by a system they do not yet trust. **[IMP cognitive load][FD writing]**
4. **The proof is the far end, not day one (untrustworthy).** The hero example is Tutorlane at "Cycle 215 · Chapter 9 · 14 mo runway · Stripe payouts reconciled"; milestones run to $10K MRR; the example door is "a business two years in". Day one in production is 25-27 agents and 4-17 notes. Nothing shows a week-one project by someone like the reader, so the distance between "me" and "that" reads as proof it is not for me. **[TASTE "the real thing on every screen"][IMP emotional journey]**
5. **Generic AI-dashboard chrome on the surfaces that must persuade (generic).** See 1.2. At 1440 px the hero also runs four autonomous motions at once (typing placeholder and caret, the cycling deck, the marquee ticker, the auto-advancing team tabs lower down). `ui-ux-pro-max` `excessive-motion` caps this at 1-2 per view; `frontend-design` asks for one orchestrated moment. The typed placeholder is the moment; the rest is noise. **[FD][UUX][TASTE]**

### 1.5 Scores (impeccable rubric, judged for the target user on the first-run path)

| # | Nielsen heuristic | Score | Key issue |
| --- | --- | --- | --- |
| 1 | Visibility of system status | 3 | Good in the console (strip, named skeletons, toasts). No "step 2 of 4" on a phone; the wall gives no status of what was saved. |
| 2 | Match with the real world | 1 | Cycle, chapter, concept, deck, brief, archetype, runway, agent-executability; three inverted score names. |
| 3 | User control and freedom | 2 | Reversibility is stated everywhere (good). The phone wall has no exit, no "send me the link", no way back to the card. |
| 4 | Consistency and standards | 3 | One system, well kept. But the "main action" is glass on landing/sign-in, flat primary in first run, tinted on Follow; ratings use /5, /10 and /20. |
| 5 | Error prevention | 3 | Consequence lines and hard gates. Global Space starts paid work (5.1). |
| 6 | Recognition over recall | 2 | Score direction and definitions are hover-only; ten Settings tabs; the first-timer must remember what "Assisted" meant. |
| 7 | Flexibility and efficiency | 4 | Chords, palette, saved views, quick replies: excellent for an operator. |
| 8 | Aesthetic and minimalist | 2 | Overloaded at 1440 (12 sections), empty at 390 (one), 25+ agents on day one. |
| 9 | Error recovery | 3 | Sign-in errors say what to do; they sit in status pills not tied to the field. |
| 10 | Help and documentation | 3 | "Explain this page", "Ask <Chief of Staff>", `Term`: strong, but all pointer-and-desktop. |
| | **Total** | **26/40** | Mid-band. The console alone would score about 32; the phone first run about 18. |

Cognitive-load checklist on the first run: fails Single focus (doors: three equal primaries), Chunking (ten attributes; 25+ agents), Minimal choices (Commit: about 9 decisions shortest, about 30 full, per THESIS_REVIEW 5.6), Working memory (score direction), One thing at a time ("Before you start" is one long page). 5 of 8 failed = high load. **[IMP]**

Audit scores (impeccable `audit`, 0-4): Accessibility 3, Performance 2 (unmeasured; the phone downloads and hydrates the desktop landing first), Theming 3, Responsive 1, Implementation integrity 3 (detector not run). **12/20, "Acceptable: significant work needed"**, almost all of it in Responsive.

### 1.6 Persona walk (impeccable)

- **Maya, 22, first project, on a phone, $0 (project persona from THESIS_REVIEW).** Lands from a friend's link. Sees a headline, a field, a note about 1280 px. Types an idea: gets a card with ten bars. Reads "Competition 6" as "little competition, good". Signs in (the email field zooms the page on iPhone: 13 px input). Keeps the card. Taps "Answer three questions about you". Wall. Leaves. Nothing she made can be shown to a friend.
- **Jordan (confused first-timer, desktop).** Gets through "Before you start". Doors: "Door A / Door B / Example", three blue buttons. Ideation Studio: "Brief for the Ideation agent · What should exist that does not yet?" Commit: "Take charge". Today: 25 agents, 4-17 notes. Does not come back (11 of 13).
- **Casey (distracted mobile).** Gets the "Needs you" email, opens the one-click answer page (works at 390). Good. Opens the Inbox on the phone: the note is long, the decision is at the bottom under a sticky bar, 13 px. Postpones (113 of 127).
- **Sam (keyboard / assistive tech).** No skip link past 20-odd shell controls; single-key shortcuts cannot be turned off; fields lose their focus ring in forced-colors mode; sign-in has no h1.

---

## 2. Token and system audit

Architecture first **[DS]**: `tokens.css` has a clean primitive layer (surfaces, lines, text ramp, status, radii, durations), a semantic alias layer (`--bg-panel`, `--text-secondary`...) and component tokens (`--kitbar-chip`, `--decision-bar`...). One file holds every color literal and a unit test holds the contract. That is better than most products. The gaps are (a) no token set for the outer product's type, (b) no token for a control boundary that meets 3 : 1, (c) a few leaks: `text-[17px]`, `max-w-[60rem]`, `max-w-[47.5rem]`, `shadow-[0_0_10px_var(--kit-lift)]` in `IdeaBox.tsx`/`Hero.tsx`, `max-w-[22.5rem]` and the literal `primary="#3a87ff"` in `IdeaCard.tsx`, all against DESIGN §2 "Tokens only".

### 2.1 Color: computed WCAG contrast

Text on each surface (canvas #08090C, rail #0B0D11, s1 #0F1217, s2 #151920, s3 #1C212A, s4 #252B36):

| Token | canvas | rail | s1 | s2 | s3 | s4 | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `text-1` #EDF0F4 | 17.42 | 17.01 | 16.41 | 15.41 | 14.13 | 12.43 | Pass |
| `reading` #DFE4EA | 15.57 | 15.21 | 14.67 | 13.78 | 12.63 | 11.12 | Pass |
| `text-2` #A9B3C1 | 9.39 | 9.17 | 8.85 | 8.31 | 7.62 | 6.70 | Pass |
| `text-3` #8A94A3 | 6.49 | 6.34 | 6.12 | 5.74 | 5.26 | 4.63 | Pass (thin margin on s4) |
| `text-4` #5A6370 | 3.27 | 3.20 | 3.09 | 2.90 | 2.66 | 2.34 | Disabled only: exempt, and correctly never used for content |
| `accent` #7CC4FF (links) | 10.62 | 10.37 | 10.00 | 9.40 | 8.61 | 7.58 | Pass |
| `status-good` #3DD68C | 10.62 | 10.37 | 10.00 | 9.39 | 8.61 | 7.58 | Pass |
| `status-warn` #F5B841 | 11.20 | 10.94 | 10.56 | 9.91 | 9.09 | 8.00 | Pass |
| `status-bad` #F36066 | 6.33 | 6.18 | 5.96 | 5.60 | 5.13 | 4.52 | Pass (by 0.02 on s4) |
| `status-info` #5E8EFF | 6.44 | 6.29 | 6.07 | 5.70 | 5.22 | 4.60 | Pass |
| `gold` #E8C56B | 11.97 | 11.70 | 11.28 | 10.60 | 9.71 | 8.55 | Pass |
| `rating-1` #F2545B (the figure "4") | 5.87 | 5.74 | 5.53 | 5.20 | 4.76 | **4.19** | **Fail on s4** (pressed rows) |
| `dept-1` #5B8CFF as text | 6.30 | 6.15 | 5.93 | 5.57 | 5.11 | **4.49** | Fail on s4 by 0.01 |

Status word on its own pill fill (the word's color at 12 % over the surface, which is how `StatusPill` and tone chips draw):

| Pill | on s1 | on s2 | on s3 | on s4 | Verdict |
| --- | --- | --- | --- | --- | --- |
| good | 8.06 | 7.44 | 6.74 | 5.90 | Pass |
| warn | 8.46 | 7.82 | 7.08 | 6.20 | Pass |
| **bad** | 5.23 | 4.82 | **4.40** | **3.91** | **Fail on s3 and s4** |
| **info** | 5.21 | 4.82 | **4.38** | **3.85** | **Fail on s3 and s4** |

`tokens.test.ts` checks the four status colors against bare s3 and s4, not against the pill's own tint, so the test passes while the pill fails in menus, hover cards and definition cards (s3), which is exactly where DESIGN §5 says pills now sit. **[UUX `color-accessible-pairs`, `contrast-feedback`]**

Buttons and the brand:

| Pair | Ratio | Note |
| --- | --- | --- |
| White label on `kit-primary` #3570CC (flat primary) | 4.84 | Pass |
| `kit-primary` fill vs canvas / s1 (is the button visible as a shape) | 4.12 / 3.88 | Pass (3 : 1 for UI) |
| `btn-glass` label (`text-1`) on its fill (kit 42 % over canvas, about #1B345D) | 10.83 | Pass |
| **`btn-glass` fill vs canvas** | **1.61** | The shape is carried by a 1 px ring (4.55). As "the" call to action it is weak. |
| `btn-glass` disabled: fill vs s1 / ring vs s1 / label | 1.11 / 1.82 / 7.97 | Reads as absent. This is the sign-in button on arrival. |
| `btn-primary` disabled: fill vs s1 / label `text-2` | 1.22 / 7.27 | Fine for a disabled state |
| `btn-tinted` (public page "Follow"): fill vs s1 / ring / label | 1.25 / 3.26 / 13.13 | Legible, but the page's only action looks secondary |
| `btn-secondary`: fill vs s1 / ring | 1.06 / 1.57 | Labelled buttons are exempt from 1.4.11; acceptable |
| Ink number on department badge fills | 5.95-10.81 | Pass |
| Google button text / its stroke vs canvas | 16.48 / 4.40 | Pass |

Non-text contrast (WCAG 1.4.11, 3 : 1 for the boundary of a control and for focus):

| Element | Ratio | Verdict |
| --- | --- | --- |
| Field well (black 30 % over s1) vs panel | 1.04 | The fill does not identify the field |
| **Field border `line-strong` (white 13 %) vs panel** | **1.39-1.44** | **Fail**: the only boundary of every input, select, checkbox, radio and switch track |
| `edge-hi` (white 24 %), the brightest hairline | 2.15 | Still under 3 |
| White alpha needed on s1 for 3 : 1 | 34 % gives 3.11 (30 % gives 2.67) | See token proposal |
| Global `:focus-visible` outline (accent at 80 %, 2 px, 2 px offset) | 7.02 canvas / 6.71 s1 / 5.99 s3 | Pass, good |
| `--ring` used by `focus-ring` on fields and cards (1 px accent at 65 % + 4 px halo at 16 %) | 4.93 canvas / 4.84 s1 / 4.09 s4; halo 1.3-1.4 | Passes 2.4.7; it is 1 px, so thin. Invisible in forced-colors mode (box-shadow only, `outline: none`) |
| Rating cells: lit vs empty | 4.93 (red) to 10.53 | Pass |
| Entity-link underline (40 % of text) | 3.50 | Pass |
| Surface steps: canvas to s1 / s1 to s2 / s2 to s3 / s3 to s4 | 1.06 / 1.06 / 1.09 / 1.14 | Not a WCAG failure (panels are not controls), but grouping relies on a hairline that tops out at 2.15 |

Opacity-dimmed text found in passing: `mark-arrive` starts "Built on Foundmill" (`text-3`) at 55 % = 2.66 until it scrolls in; disabled skill rows `opacity-60` = 3.80 (exempt, disabled); the chip remove "x" at `opacity-75`.

**What this means.** The text ramp is sound; do not touch `text-1/2/3`. The sign-in page "looking low-contrast" is not a ratio failure: it is 12-13 px type at weight 400, a disabled glass button, and a panel 1.06 : 1 off the page. Fix size and the button, not the grays. The real color failures are narrow: bad/info pills on raised surfaces, the `rating-1` figure on pressed rows, and control boundaries. **[IMP audit][UUX]**

### 2.2 Type scale

Current: root 13 px; body 13/19; small 12/16; label 12/16; data 11/14 caps; reading 15/24 (Inbox note only, 640 px measure); chat 13.5/20; "comfortable" preference lifts body to 14/20, small to 12.5, chat to 14.

- **Is 13 px body right for long reading by a newcomer? No.** 13/19 Inter 400 is a data-UI size: right for table cells, chips, sidebar items. It is used for everything a first-timer must actually read: the agent's "What I do" (three columns of prose in `22-agent-profile.png`), Settings explanations (12 px), door ledes, the Commit explanations, `ReassuranceLine` (12 px `text-3`, the faintest text on the screen for the sentence meant to calm). `ui-ux-pro-max` `readable-font-size`: 16 px minimum on mobile; `line-height`: 1.5-1.75 for body; impeccable `operate`: "line length still applies for prose (65-75ch)". **[UUX][IMP]**
- **Console recommendation (no structure moves):**
  - Default `account_preferences.text_size` to `comfortable` for accounts with guidance on. The mode exists, is tested, and DESIGN §4 already proves it moves nothing. This is a default, not a token change. **[KARP]**
  - Any block of two or more sentences uses `t-reading`, not `t-body`: agent "What I do / How I work", `Explainer`, `DefinitionCard` long text, Settings section descriptions, door and Commit ledes.
  - `--fs-reading` 15 to **16px**, `--lh-reading` 24 to **26px**, `--ls-reading` -0.006em to **0**. At 16 px the 640 px measure is about 78 characters; acceptable, and the Inbox list width does not change.
  - Helper and reassurance text: `text-small text-tertiary` to `text-small text-secondary` in `ReassuranceLine.tsx` and `Field` hints (already `text-secondary`). Reassurance must not be the dimmest thing.
- **Outer product recommendation (the 390 px routes): a scoped type scale.** Add one utility in `dugout.css` that re-declares the type tokens on the page root. This works for both `t-*` and Tailwind `text-*` utilities because the type tokens are mapped in `@theme inline` (`dugout.css:48-148`), so they resolve at the use site:

```css
/* dugout.css: the outer product's type (DESIGN §4 "Outer type"). Put on the root of a small-screen page. */
@utility type-outer {
  --fs-body: 16px;    --lh-body: 24px;
  --fs-small: 14px;   --lh-small: 20px;
  --fs-reading: 17px; --lh-reading: 28px; --ls-reading: 0em;
  --fs-label: 14px;   --lh-label: 20px;
  --fs-action: 15px;  --lh-action: 20px;
  --fs-title: 16px;   --lh-title: 22px;
  --fs-chat: 16px;    --lh-chat: 24px;
}
```

  - Apply on: `PhoneLanding` root, `BrandFrame` when `smallScreen`, `StudioFrame` when `smallScreen`, `ProjectPage` / `PersonPage` / `MilestoneCard` roots, and `AppShell` in `phone` mode.
  - Why 16: it is the iOS no-zoom threshold for inputs. Today `Input` uses `text-body` (13 px), so focusing the sign-in email or the Follow email zooms the page on an iPhone (`Input.tsx:13,24`). With `type-outer` on the frame, both become 16 px with no component change. **[UUX `readable-font-size`, `touch-friendly-input`]**
  - Keep `t-data` (11 px caps) and mono out of outer pages entirely; `frontend-design` lists all-caps labels and mono micro-labels as template tells, and DESIGN §6 already says "the dense console components stay out of it". The idea card's "OVERALL" label is the one current offender on a phone.
- **Display sizes.** `display-hero` 80/80 is desktop-only. The phone hero uses `t-display-lg` 30/32, which is also the tile-figure style (tabular). Add `--fs-display-phone: 34px; --lh-display-phone: 38px` (`t-display-phone`) for the one h1 on outer pages; `display-lg` stays for figures.
- Fonts: keep Barlow Semi Condensed + Inter + JetBrains Mono. Barlow gives the product a voice; nothing in the evidence blames the typefaces. I am not adopting the `ui-ux-pro-max` font suggestion. **[KARP]**

### 2.3 Spacing and density

- The 4/8 grid, 12 px panel padding, 16 px gutters and 28/34 px rows are right for the console and should stay.
- Outer product: panel padding 12 to 16 (`--panel-padding` re-declared inside `type-outer`, or a sibling `space-outer`), vertical rhythm 24 px between blocks (the public page already does this), every control `min-h-tap` (already the rule).
- Density is a volume problem more than a pixel problem: 25-27 agents and 4-17 notes on day one, ten attributes per card, twelve landing sections, ten Settings tabs. Reduce the count shown by default before changing any spacing token. **[KARP][IMP "progressive disclosure"]**

### 2.4 Radius

3 / 6 / 10 / 14 / pill, "nothing reaches 16". Coherent and distinctive; no change. The idea field and "Shape my idea" at 12 are within it.

### 2.5 Depth

- Console: the gradient edge, top light and three elevations are well judged. Keep.
- Outer product: the public pages already drop the gradient edge for a plain hairline panel. Make that the rule: on `type-outer` pages a panel is `bg-surface-1` + `border-line-strong`, no `glow-brand`, no `edge-tint`. The idea card on a phone currently carries `surface-panel glow-brand`; fine on the hero, not on `/new/card/*`.
- Glows: "only from a source" is a good rule and is kept. The landing's dot grid and side washes (teal `dept-6`, violet `dept-5`) are decoration; `taste-skill` bans violet in a page's own design and the product's own rule says "No AI purple". Drop the violet wash (P3). **[TASTE]**

### 2.6 Motion

- Tokens (three curves, nine durations, reduced-motion rule) are complete. No token change.
- Budget, landing at 1440: typing placeholder + caret, the hero deck cycling by itself, the marquee ticker, section reveals, the auto-advancing team tabs. Keep the typing placeholder (the one orchestrated moment). Make the deck a still frame with "Watch it run" as the trigger. Remove the ticker. Remove `[data-reveal]` from every section (keep it, if at all, on the first product window). **[FD][UUX `excessive-motion`][TASTE "never a fade-in on every section"]**
- The global reduced-motion rule (0.01 ms) is the pattern impeccable's audit says to check; here it is acceptable because DESIGN §7 defines a legible rest frame per loop. No finding.

### 2.7 Focus

- Global `:focus-visible`: 2 px accent outline at 80 %, 2 px offset. Good.
- `focus-ring` utility (`dugout.css:1221`): `outline: none; box-shadow: var(--ring)`. Change to `outline: 2px solid transparent; outline-offset: 2px; box-shadow: var(--ring)` so Windows forced-colors mode draws an outline. Same for `focus-within-ring` on field wrappers (the inner input sets `focus-visible:outline-none`).
- `--ring`: `0 0 0 1px rgba(124,196,255,.65), 0 0 0 4px rgba(124,196,255,.16)` to **`0 0 0 2px rgba(124,196,255,.8), 0 0 0 5px rgba(124,196,255,.18)`**. 2 px at 80 % is 6.7 : 1 on s1 and matches the global outline's weight.
- `Chip` remove button: `focus-visible:outline-1` on a 14 px target; see 5.3.

### 2.8 Token changes, in one table

| Token / rule | Now | Proposed | Why | DESIGN.md section to amend |
| --- | --- | --- | --- | --- |
| Pill fill alpha (StatusPill, tone chips) | 12 % | **10 %** | bad 4.55 and info 4.52 on s3; negligible visual change | §5 Status ("on a 10 % fill") |
| `tokens.test.ts` | status on bare s3, s4 | add "status on its own pill fill over s1-s3" | The test should check what is drawn | §2 (the AA bullet names the test) |
| `--rating-1` | #F2545B | **#F36066** (same as `status-bad`) | The figure passes on s4 (4.19 to 4.52); one red instead of two | §5 Rating ramp |
| new `--line-control` | n/a (`line-strong` 13 %) | **rgba(255,255,255,0.34)** for field, select, checkbox, radio and switch boundaries only | 3.11 : 1 on s1 (1.4.11). Panels, dividers and buttons keep `line-strong` | §3 Lines; §8 Inputs |
| `--ring` | 1 px @ 65 % + 4 px @ 16 % | **2 px @ 80 % + 5 px @ 18 %** | Thicker, forced-colors-safe with the transparent outline | §3 Elevation table (`ring`), Focus bullet |
| `--fs-reading` / `--lh-reading` / `--ls-reading` | 15 / 24 / -0.006em | **16 / 26 / 0** | Long reading | §4 table (reading) |
| default `text_size` | standard | **comfortable when guidance is on** | 14/20 for first-timers, no layout change | §4 "Comfortable text" |
| new `type-outer` utility | n/a | body 16/24, small 14/20, reading 17/28, label 14/20, action 15/20, title 16/22 | The outer product is read on a phone; inputs stop zooming | §4 (new "Outer type"), §6 Small screens |
| new `--fs-display-phone` | n/a (`display-lg` reused) | **34 / 38** | The one h1 on an outer page | §4 table |
| Main action on outer pages | `btn-glass` (landing, sign-in, kept card), `btn-tinted` (Follow) | **`btn-primary`** | One filled primary per screen | §8 Buttons; §9a; §9b; §9e |
| `text-3` on reassurance | `ReassuranceLine` | `text-2` | The calming line should be readable | §8 Guidance (`ReassuranceLine`) |

Two honest notes. First, `--line-control` at 34 % is a visible change to the "machined hairline" look; if that is too much for the console, ship it on `type-outer` pages first, where the person is on a phone in daylight, and decide the console after seeing it. Second, DESIGN §7 still describes Continue's blocked state as "a solid red gradient... Respond · N"; the code changed on Nov 7. The doc should be corrected regardless of anything else here.

---

## 3. Screen-by-screen critique and redesign direction

Format per screen: what is there (evidence), what is wrong for this person, the direction. Copy in quotes is a suggestion in the 12.6 voice, to be run through the product's copy linters.

### 3.1 Landing at 1440 px (`apps/web/components/landing/LandingPage.tsx`, `Hero.tsx`, `Thesis.tsx`, `HowItWorks.tsx`, `TeamSection.tsx`, `LiveSessions.tsx`, `Journey.tsx`, `Control.tsx`)

**Now.** Top bar; hero (pill, 80 px headline with "real business" lit, lede, idea box, "Surprise me", three assurances); "Or watch an example run" + picker + the cycling deck (Tutorlane at Cycle 215); ticker; Why now + four pillars; How it works (four steps, ten-score concept cards); Your team (auto-advancing tabs, a SkillGrid); Live sessions (terminals and diffs); The journey (two years, $10K MRR); Distribution (fifteen channels, drag); You decide (the Inbox note, house rules, Stop all agents, key); closing call; footer with "Desktop only · 1280 px and wider".

**Wrong for this person.**
- Twelve sections, and the one that answers the anxious question ("will this do something behind my back, and what will it cost me?") is eleventh. **[TASTE one idea per screen][IMP]**
- DESIGN §9a says the page is "written for two readers at once", a first-timer and an investor. That is the root of the overload: the ratings grid, live terminals, the two-year ribbon and the channel board are for the investor. Pick the first-timer; give the investor a link. **[FD "ground the design in the subject"]**
- The example is the far end (1.4 item 4). The deck's chips read "Cycle 215 · Chapter 9 · 14 mo · Estimate".
- The idea field has no visible label: "Your idea, in a sentence" is `sr-only` and the typed placeholder is `aria-hidden` (`IdeaBox.tsx`). `ui-ux-pro-max` `input-labels`: visible label, not placeholder-only.
- "Shape my idea" is dark with a white hairline (`idea-gen`), "Start your business" and "Continue with email" are glass. No filled button on the page. **[UUX `primary-action`]**
- Template tells (1.2). Footer line "Desktop only · 1280 px and wider" tells a visitor about our constraint, not their benefit.

**Direction: section order and content (seven sections, one idea each).**
1. **Top bar.** Wordmark, Sign in (ghost), "Start with your idea" (flat primary; it focuses the idea field rather than going to `/login`, because the field is the better door).
2. **Hero.** h1 stays the tagline, without the lit phrase and without the pill. Lede, one sentence: "Type one line. In about 20 seconds you get an honest first read on it. Free, no sign-up." Visible label above the field. Field + filled "Shape my idea". Under it "No idea yet? Surprise me". Then all three assurances.
3. **What you get back.** Before the visitor types, show one finished card for a week-one idea (the three-answer card of 3.6), labeled Example, beside the three "what signing in unlocks" lines. When the visitor's own card lands it replaces this block (the current landed layout). This is the proof the phone page lacks too. **[TASTE "shows the real thing"]**
4. **How it goes: three steps, not four.** (1) Shape the idea. (2) Your team drafts the plan and builds the first thing: your public page. (3) You make the calls. Each step: one sentence and one product still. Fold "Make it yours" (logo, colors) into step 2 as a detail.
5. **You stay in charge** (today's "You decide", moved from eleventh to fifth). The Inbox note with its working DecisionBar, the six house rules as a checked list, and the money line: "Free to start: $5.00 of credits a month, no card. Nothing is spent without asking above your limit."
6. **A first week, then where it can go.** The deck frozen on the example's week one (the page live, a first follower, one decision waiting), with a quiet toggle "See it two years later" that swaps in today's Tutorlane view and the Journey ribbon. The current examples carry day-by-day stories (`__tests__/story-day.test.ts`), so this may be a re-dating rather than new content; I did not verify how much the ledgers support it. **[KARP: assumption stated]**
7. **Closing call + footer.** Repeat the idea field (or a button that scrolls to it). Footer: Terms, Privacy, and "Your idea card, Today and anything that needs your answer work on a phone. The full workspace needs a computer."

Cut from the default page: the ticker, Live sessions, Distribution/Channels, the SkillGrid in Your team. Keep them on a linked "See the whole product" page for the second reader (it can be today's page at `/tour`; no new design). **[KARP: remove, do not add]**

### 3.2 Landing at 390 px (`PhoneLanding` in `LandingPage.tsx`; `Hero layout="phone"`)

**Now.** Top bar; pill; h1 at 30/32; 15 px lede; the field; "Shape my idea"; "No idea yet? Surprise me"; two assurances (the third, "Nothing moves money or signs in your name without you", is dropped on phones: `{!phone ? <Assure icon={ShieldCheck}>` in `IdeaBox.tsx`); the note about 1280 px; Terms and Privacy. Shown to every width under 1280, so tablets and small laptops get it too.

**Also (verify before fixing).** The page is prerendered with no width (`useViewportWidth` returns `undefined` on the server, "treated as large enough"), so the served HTML is the full desktop page; a phone paints that until the script loads, then swaps to `PhoneLanding`. The fetched HTML of `/` today contains all twelve desktop sections, consistent with this. I did not time it on a device.

**Direction: the phone page must stand on its own.** One column, 16 px gutters, `type-outer`, no horizontal scroll, every target 44 px. It then also serves 391-1279 px in a centered 640 px column, which fixes the tablet and small-laptop case with no extra layout. **[UUX `mobile-first`, `content-priority`][TASTE "every visual renders at 390"]**

1. **Top bar** (56 px): wordmark, Sign in.
2. **Hero.** h1 at 34/38 (`t-display-phone`), the tagline in full. Lede 17/28: "Type one line. Get an honest first read in about 20 seconds. Free, no sign-up." Visible label "Your idea, in a sentence". Field (16 px+ text, 56 px tall). "Shape my idea": full width, 52 px, flat primary. "No idea yet? Surprise me" (44 px).
3. **Three assurances**, stacked, all three: free first card; private until you share; nothing moves money or signs in your name without you.
4. **What you get back.** One example card in the three-answer form (3.6), labeled Example, for a week-one idea in plain words (the "bike repairs at your door" project in `40-project-page-390.png` is the right flavor). Replaced by the visitor's card when it lands.
5. **How it goes.** Three steps as a vertical list (the `Stepper` of section 4 in its static vertical form), one sentence each, each with a phone-sized still: a card, a "Needs you" row with Approve, a public page.
6. **You stay in charge.** The six house rules as a checked list. The money line.
7. **What works where** (replaces the 1280 px note, and says the true thing kindly): "On your phone: your idea card, Today, and anything that needs your answer. On a computer: the full workspace. Sign in with the same email on either."
8. **Closing.** "Shape my idea" again (scrolls to and focuses the field), Sign in.
9. **Footer.** Terms, Privacy, (c) year.

Words on this page: about 220, under `taste-skill`'s 60-80 a screen.

### 3.3 Sign-in (`apps/web/app/login/LoginForm.tsx`, `SignInCode.tsx`, `components/shell/BrandFrame.tsx`)

**Now.** Wordmark, tagline (13 px `text-2`), a panel "Sign in" (an `h2`; the page has no `h1`), Continue with Google (white), "or", Email field (13 px), "Send sign-in link" (`btn-glass`, disabled until something is typed), "No password, no card. We email you a link." (12 px), the 18+/Terms/Privacy line (12 px), and a footer about 1280 px.

**Wrong.** The form is correct in logic and wrong in emphasis: the only bright thing is Google's button; our own action looks switched off; three lines of 12 px gray. On iPhone the 13 px input zooms the page. Errors render as `StatusPill tone="bad" role="alert"` holding a full sentence, outside the `Field`, so they are not tied to the input by `aria-describedby`. After "Link sent", the lead instruction is "open it in this browser", which fails for anyone whose mail app opens links in its own browser: the common phone case.

**Direction.**
- `BrandFrame`: the panel title renders as `h1` in this frame (one-line prop on `Panel`, or an `sr-only` h1). Put `type-outer` on the frame when `smallScreen`.
- "Send sign-in link": `variant="primary"`, always enabled; an empty submit shows the `Field` error "Type your email address" and focuses the field (`inline-validation`, `focus-management`). **[UUX]**
- Send and Google errors: pass through `Field error=` (send) and a plain `text-status-bad` line under the Google button, not a pill. Pills are for states, not sentences.
- Reassurance directly under the button at 14 px `text-2`. Legal line 14 px. Remove the footer about 1280 px here; the person is signing in, not shopping for a monitor.
- After sending, on small screens lead with the code: h1 "Check your email", then "Type the 6-digit code we sent to <email>" with the code field first (it already has `inputMode="numeric"` and `autoComplete="one-time-code"`), and "or open the link in the email on this device" second. The link stays the lead on desktop.

### 3.4 "Before you start" (`apps/web/components/onboarding/OnboardingScreen.tsx`, `profile-form.ts`, `components/new/StudioFrame.tsx`)

**Now.** Desktop only (`grid grid-cols-12`, a 3-column rail of "Sections · n of 5 done", "How the team reads you", privacy line; a 9-column form). Four required questions (name, experience, time, where you live), then "Add detail (optional)". On a phone: the wall.

**Wrong.** Four questions do not need a rail, a progress list and a summary panel; that scaffolding makes four questions look like a tax form. The copy disagrees with itself: the idea card footer and the kept-card button say "three questions about you", this page says "Four quick answers". The optional detail contains self-ratings 1-20 in operator terms, colored amber at 10.

**Direction.**
- One question per step, four steps, the same component at 390 and at 1440 (a 560 px column on desktop). The `Stepper` (section 4) shows "Step 2 of 4"; Back and Continue at the foot; Enter continues. `impeccable/onboard`: "one thing at a time, progress shown, skippable where possible".
  1. "What should your team call you?" (name; prefilled from Google when present).
  2. "Have you built something before?" Four radio cards; "This is my first" first, with no badge that implies less.
  3. "How much time can you give it?" Four radio cards.
  4. "Where do you live?" One select; the sentence under it says what it decides ("We start with customers in <country> and prices in <currency>. You can change both.").
- The "How the team reads you" sentence appears on the last step as the confirmation ("Here is how your team will read you: ..."), with "Change" beside it.
- "Add detail" becomes a link on the final step ("Add more about you, optional") and lives in Settings; it never blocks. Self-ratings there show the band word first and no ramp color (a self-rating is not a grade).
- Add `/onboarding` to `SMALL_SCREEN_PREFIXES` and pass `smallScreen` to `StudioFrame`. Fix the count in one place (say "four", or drop "where you live" by inferring it from locale and say "three").

### 3.5 The doors and idea shaping (`components/new/Doors.tsx`, `components/new/ideate/IdeationStudio.tsx`)

**Doors now.** Two or three equal panels, each with a caps kicker ("Door A", "Door B", "Example"), a display title, a 40-word lede, a "What happens" disclosure, and a blue primary button. A first-timer gets a "Recommended for you" chip on Door A.

**Wrong.** Three primaries of equal weight (`primary-action`). "Door A/B" is our build plan's vocabulary. For someone who said "this is my first", Door B ("I already run something") is noise and the example is the two-years-in business.

**Direction (smallest change).** When `experience === "first_time"` (or a kept card exists), render one door: the idea door as a single column with its field inline ("Your idea, in a sentence", prefilled with the kept card's words), and under it two text links: "I already run something" and "Look around an example first". For everyone else keep the grid but with one primary (the recommended or first door) and the others `variant="default"`. Remove the kickers.

**Ideation Studio now.** Title "Ideation Studio"; lede "Concepts drafted within your constraints · Operator · full time · GBP 60,000 · GB, IE, US"; panel "Brief for the Ideation agent"; h2 "What should exist that does not yet?"; a textarea; "Kind of business"; constraint chips; "Steer the next set: Cheaper to start / B2B instead / More defensible"; the generate slab "Draft 6-12 ideas for me"; then 6-12 cards of ten scores each; shortlist, merge, discard tray, compare bar, version history.

**Wrong.** A studio for someone who compares 12 concepts across 10 attributes. The first-timer who typed one line on the landing page wants that one idea made better, not eleven alternatives. 60-120 scores on one screen is the peak cognitive load in the product. **[IMP "wall of options"]**

**Direction.**
- Default mode for a first-timer or a kept card: **one card, in conversation.** The kept card on the left (three-answer form), and on the right the two or three things that would raise it most as quick replies ("Make it cheaper to start", "Find people who already pay for this", "Narrow who it is for") plus "Write". Each reply revises the same card (a new version; the version history exists). Primary action: "Start building this". Secondary: "Show me other directions" opens today's studio.
- Rename on screen: "Ideation Studio" to "Your idea"; "Brief for the Ideation agent" to "Tell your team more"; "What should exist that does not yet?" to "What do you want to make?"; "Concepts" to "ideas"; "Steer the next set" to "Change direction".
- Keep the studio as is behind "Show me other directions" and for Operator/Exited profiles. No component is deleted. **[KARP]**

### 3.6 The idea's profile card: ten scores versus three plain answers (`packages/dugout/src/components/public/IdeaCard.tsx`, `journey/concept/AttributeBar.tsx`, `journey/types.ts`)

**Now.** Logo tile, name, kind, stars "Now 3 of 5 · could reach 4 · Good", a 40-word pitch, "OVERALL 13 of 20 · First read", ten attribute bars with figures, "Founder fit -", "What would raise it most: Competition, now 6 of 20...", sample line, footer. On a phone the body is 13 px.

**Wrong.**
- Three scales in one card (stars /5, overall /20, band word) before the person knows what any of them measure.
- Three names point the wrong way (1.4 item 3). The honest line "What would raise it most: Competition, now 6 of 20" reads as nonsense if you think 6 means little competition.
- The pitch is in analyst voice ("helps operators in climate tech cut a weekly chore to minutes through a narrow, opinionated workflow").
- The best line on the card, "What would raise it most", is ninth in the reading order.

**Direction: three answers on the face, ten scores one tap away. Nothing is removed.**

| Question on the card | Built from | Shown as |
| --- | --- | --- |
| "Will people want it?" | market pull, market size | Band word pill + one sentence of evidence |
| "Can you start it?" | speed to first customer, capital, what the team can do, rules, (fit, once known) | Band word pill + one sentence |
| "Can it last?" | competition, hard to copy, way to reach customers | Band word pill + one sentence |

- Card order: name and one-line pitch in the visitor's own words; **"What would raise it most"** as the lead line under the pitch; the three answers; then a disclosure "See all ten scores" that opens today's list. The overall figure and the stars move inside the disclosure.
- Each answer's band is the rounded mean of its attributes mapped through the existing `ScaleLabel` bands; the sentence is the evidence of that group's lowest attribute. This is arithmetic on data the card already has; it needs no new model call. **[KARP]**
- Rename the ten so the name points the same way as the score (one file, `journey/types.ts`, the `word` fields; the `short` definitions already say it right):

| Now | Proposed |
| --- | --- |
| Market pull | People want it |
| Market size | Enough buyers |
| Competition | Room in the market |
| Speed to first customer | First customer soon |
| Capital intensity | Cheap to start |
| Agent-executability | Your team can do it |
| Founder fit | Fits you |
| Defensibility | Hard to copy |
| Regulatory load | Few rules to deal with |
| Distribution clarity | Clear way to reach customers |

- On `type-outer` pages the card's pitch is 16/24, labels 14, figures stay Barlow.
- In code: `IdeaCard` gains `view?: "answers" | "scores"` (default "answers"; the Ideation Studio's Compare keeps "scores").

### 3.7 Commit (`components/new/commit/CommitScreen.tsx`)

**Now.** Title "Commit to <name>", button "Take charge". Panels: Name; Check the name (domains and trademarks); Logo and brand colors; How it runs (a summary with the rest collapsed under guidance: Personal or live, Archetype, Business mode, spend cap, Autopilot); a rail with "Day one" (departments and every agent with its model chip, the monthly wage line) and "What happens next" with a second "Take charge".

**Wrong.** "Commit" and "Take charge" are heavy words for a reversible, free step; the stepper calls the same step "Launch" (three names for one action: `multi-step` consistency). The rail lists 25-27 agents with "Opus/Sonnet" chips and a monthly wage estimate before anything has happened: the first money figure a person with no money sees is a monthly cost. The domain and trademark check is real work the team can do after.

**Direction.**
- One name for the step everywhere: "Start building" (stepper label, page title "Start building <name>", button "Start building"). `frontend-design`: an action keeps one name through the flow.
- Face of the screen, in order: (1) Name (with the suggestions); (2) Logo and colors, defaulted, one tap to change; (3) one sentence + `ReassuranceLine`: "Your team asks before it spends over $X or does anything outside this workspace. You can change how much it asks later."; (4) "What happens next" as three steps with the honest time ("Your team drafts your plan. About 10 minutes (Estimate). You will get one thing to approve."); (5) the button. Everything else stays behind "Change how it runs", as now.
- The team preview becomes "Starting team: 4 working today" with four faces and "22 more join as the work needs them" behind a disclosure. Model chips and the wage line appear only in Builder view; the money line here is the credits line ("Starts on $5.00 of included credits, no card").
- Name checks move after the button ("We will check the web address and the name for you and tell you if there is a problem").

### 3.8 The first screen after commit

**Now (inferred from code and production facts).** `router.push` to Today, which on day one renders `FirstWeekTimeline`, the goal panel (a proposal to approve), Needs you (up to three of the 4-17 notes), this week, health tiles, plus the Home tour coach marks; the sidebar shows unread badges per area; Team lists 25-27 agents.

**Wrong.** The peak-end rule (impeccable): the peak of the first session should be "something I made exists". Instead it is a to-do list from 25 strangers. 11 of 13 projects were not opened again after this screen. I cannot prove this screen is the cause; it is the last thing those people saw.

**Direction: a day-one state of Today with one focus.**
- Lead panel (span 12, `t-reading`): "<Name> has started. Your team is drafting your plan. About 10 minutes (Estimate)." with the live drafting line (the `LiveRun` skeleton that names its queue already exists).
- Under it, exactly one of: the first thing to approve when it lands, or "Nothing needs you yet. We will email you when the plan is ready." (the notice emails exist, §9i).
- A "While you wait" row with one optional action that produces something showable: "See the page your team is drafting for <name>" (the public page is the first outcome per THESIS_REVIEW phase 1).
- Hidden on day one: health tiles (all empty), streak, sidebar badges except Needs you, the coach-mark tour (start it on the second visit).
- Team on day one opens filtered to "Working now".

### 3.9 Today (`components/today/TodayScreen.tsx`, `packages/dugout/src/components/today/*`)

**Now.** Since last visit; streak; first-week timeline; goal; Needs you (three rows, one-tap where possible); public-page and post notes; this week and next in sentences; health (cash, runway, customers, spend). Works in the shell's phone mode.

**Right.** This is the best-shaped screen in the console for this person: sentences, a goal, at most three asks, one-tap answers. Keep the structure.

**Direction.**
- Put `type-outer` on the shell in phone mode so Today reads at 16 px on a phone.
- Order on a phone: Needs you first (it is why they opened it), then the goal, then the week. On desktop keep the current order.
- The streak strip (founder, Nov 11) is a retention mechanic; for an anxious person its "Not opened" dots and the at-risk state ("the streak ends today unless...") are small failure notices. Keep the streak; show it from day 2, draw only the days opened, and drop the at-risk warning. This amends a founder decision, so it is a case to weigh, not a fix. **[IMP emotional journey]**
- Health tiles with nothing to show ("Not known yet") collapse to one line, "Money and customers show here once there are some", instead of four empty figures.

### 3.10 Needs you and the note with a decision (`components/inbox/*`, `packages/dugout/src/components/shell/DecisionBar.tsx`)

**Now.** List (380 px) and a reading pane: sender, title, "About" entity links, the note in 15/24, a metric strip, a data table, source line, then the sticky DecisionBar ("Your decision · Expires in 5 days", 2-4 options with consequence lines, "Ask Chief of Staff").

**Wrong.** 113 of 127 requests unanswered says the ask is not landing. From the design side: the decision is the last thing in a long document; the options are 13 px in a bar at the foot; the note assumes the reader wants the evidence before the question. A first-timer wants: what are you asking me, what do you suggest, what happens if I say yes, can I undo it. The evidence is for when they doubt.

**Direction (re-order, no new data).**
1. Title as a question (already the convention: "Approve batch 002 before the Ireland launch?").
2. **The recommendation block first**: "<Agent> suggests: <option>. <one sentence why>. Costs <x> (Estimate). <Reversible / Not reversible>." with the recommended option as a filled primary and the others as secondary, in the reading column, not only in the sticky bar.
3. "Not sure? Ask <name>" as a visible secondary beside the options (today a ghost at the bar's far right).
4. "Why" as a disclosure holding the current body, metric strip and table, open by default on desktop, closed on a phone.
5. The sticky DecisionBar remains for long notes.
- In the list, a Needs-you row shows the recommended answer as its one-tap button where `inbox.decide` allows it (Today already does this; make the Inbox list match).
- Several low-stakes approvals from one cycle should arrive as one note with a checklist and "Approve all 4" (the founder's own tap, so within the house rules). This needs orchestrator support; I flag it as product work, not a design change. **[KARP: outside this review's scope]**
- "Expires in 5 days" has no stated consequence. Say what happens: "If you do nothing by Nov 20, <agent> waits." One sentence removes a threat.

### 3.11 Agents list and an agent's profile (`packages/modules/src/team/SquadScreen.tsx`, `apps/web/components/agents/AgentProfileScreen.tsx`, `OverviewTab.tsx`, `packages/dugout/src/components/data/SkillGrid.tsx`, `RatingBar.tsx`, `guidance/ScaleLabel.tsx`)

**Now.** List: a DataTable; with guidance on it opens the "Simple" view (name, status, current task; the rating column is Builder view only). Profile: header (avatar, name, stars "3 > 3", role and department chips, Healthy pill, line manager, wage, tasks, model chip, Train, Talk); "What I do" in three 13 px columns; Traits; Skills (Craft / Judgment / Execution, each skill a 20-cell bar, figure, band word; with Builder view off, the band word alone).

**The founder's decision stands: ratings out of 20 stay.** Today they are hidden from the default view rather than made legible. Direction to make them legible everywhere:

- **One scale on agents: out of 20.** Drop the /10 average and the stars from agent surfaces (stars stay on idea cards if kept at all). Wherever a rating shows, it reads `14 of 20 · Good`: figure, "of 20", band word. Never a bare "14".
- **One legend per screen that shows ratings** (a small `RatingKey`, section 4): "1-5 Poor · 6-10 Average · 11-15 Good · 16-20 Excellent", with the four ramp swatches. Today the legend exists only on the landing page's channel board.
- **Say what a rating is evidence of.** Under the Skills panel title: "From <n> tests and <m> tasks. Last changed <date>." A number with a source is information; a number alone is a grade. The provenance component exists (`ProvenanceTip`).
- **Show movement with its cause.** "Product writing 15 of 20 · Good · up 1 since training on Nov 3" (the delta arrow exists; add the cause).
- **Lead with what the agent does, then how good it is.** Profile order: header; "Working on now"; "What I do" as one `t-reading` paragraph (the three columns "What I aim for / How I work / Never does" go behind "More about how <name> works"); Skills; Traits. Skills at a glance: the top three skills and the lowest one, with "See all 12".
- **The list** on day one: grouped "Working now (4)" and "Waiting for work (22)", the second group collapsed. Columns: who, what they are doing in a sentence, status. Rating as `14 of 20 · Good` is the fourth column once the legend is on the page.
- The amber ramp for 6-10 reads as a warning on a new agent. Keep the ramp (it is the system), and make sure the band word "Average" sits beside it so the color is never the message.

### 3.12 The skills picker and an agent's skills panel (`packages/modules/src/team/skills.tsx`, `packages/dugout/src/components/agents/SkillPicker.tsx`, `apps/web/components/agents/AddedSkillsPanel.tsx`, `CustomSkillsPanel.tsx`)

**Now.** On the agent's Training tab: a panel "Skills from the library or files" (buttons "Add from library", "Upload a skill file"; rows with a Library / Skill file chip and "Untested") and a separate "Custom skills" panel. The library dialog: a search field, then every skill in category groups, each a checkbox row with name, a chip "Shows as Craft · Press releases", and a description. Cap of 8. No one in production has added one.

**Wrong.**
- Buried: Training is the second tab of a profile nobody opens.
- Three kinds (library, file, custom), two panels, and the first thing the empty state explains is testing mechanics ("No tests to draft: they show on its attributes at once, marked Untested, and a training run reports them as No tests yet. To have a skill scored, add it as a custom skill...").
- The picker answers "what skills exist" but not "which should I add to this agent" or "what will it change". A flat grouped list is fine at 20 and unusable at 120.
- After adding, nothing shows what the skill did.

**Direction: one panel, one dialog, built to hold about 120.**

*Agent profile (Overview tab, under Skills):* one panel "Skills <name> has learned", replacing the two. Each row: name, one line, source chip, state (`Not tested yet` / `14 of 20 · Good`), **what it changed** ("Used in 3 tasks since Nov 3 · Product writing 13 to 15"), Remove. Header actions: "Add a skill" (primary, opens the dialog), and a menu with "Upload a skill file" and "Write your own". Empty state: "Teach <name> something. Suggested for <role>: [three SkillCards with Add]." The "used in n tasks" figure needs the orchestrator to record which skills a task loaded; if that is not recorded today, ship the row without it and add it when the data exists. **[KARP: assumption stated]**

*Add-a-skill dialog (desktop: 880 px dialog, two panes; phone: full-height `Sheet`):*

```
+--------------------------------------------------------------------------------+
| Add a skill to Quill                                                     [x]   |
| [ Search skills...                         ]   3 of 8 used                     |
| (Suggested) (All 118) (Marketing 22) (Sales 14) (Product 19) (Money 11) ...    |
+------------------------------------------+-------------------------------------+
| Suggested for Quill (Product writing)    | Release notes                       |
|  [ ] Release notes            Add        | Marketing · adds to Craft           |
|  [ ] Interview synthesis      Add        |                                     |
|  [ ] Pricing page copy        Add        | What Quill will do differently      |
| All skills                               |  - Writes a "what changed" summary  |
|  Marketing (22)                          |  - Groups changes by who they help  |
|  [x] Press releases           Added      | Example of the result  (Example)    |
|  [ ] Newsletter               Add        |  "Version 2.4: three things..."     |
|  ...                                     | It never changes tools, spend caps  |
|                                          | or approvals.                       |
+------------------------------------------+-------------------------------------+
| 2 selected                                        [Cancel]  [Add 2 skills]     |
+--------------------------------------------------------------------------------+
```

- **Suggested for this agent** first: 3-6 skills, each with a reason ("Suggested because Quill writes release notes most weeks"). Simplest honest source: match the skill's `attribute.group` and category to the agent's role and department; no model call. If no reasoned match exists, show "Popular for <role>" instead of pretending.
- **Search** over name, description, category (the current `matchesSkillQuery`), with the result count announced (`role="status"`).
- **Categories** as filter chips with counts, single-select, wrapping; "Suggested" is the default chip.
- **List** virtualized (`VirtualList` exists) once past about 50 rows; rows are `SkillCard`s (section 4).
- **Preview pane**: what the agent will do differently (3 bullets from the skill's description/instructions), an example of the result labeled Example, where it shows on the profile ("adds to Craft"), and the safety line. On a phone, tapping a row opens the preview as a `Sheet` with Add in its footer.
- **States**: loading (skeleton rows), empty search ("No skill matches 'x'. Try a kind of work, such as release notes or pricing."), at the cap ("Quill has 8 skills. Remove one to add another." with rows disabled and the reason on focus), already added (checked, "Added", not re-selectable), error on add (inline, the selection kept).
- The words "Untested" and "No tests yet" become "Not tested yet", with one line on what testing is, shown only when the person opens "How skills are scored".

### 3.13 Settings basics (`apps/web/components/settings/*`)

**Now.** Ten tabs in a left list: Business, Mode, Departments, Glossary, Members, Integrations, Keys, Billing, Preferences, Danger zone (plus Team can do). Text size, "Explain things as I go" and Builder view live in Preferences, the ninth.

**Wrong.** A first-timer needs five settings and has to find them among ten tabs named for the system.

**Direction (smallest change).** Add a first tab, "Basics", that holds links-with-values to the five things, each a row: Name and logo; How much your team asks before acting (the mode, in a sentence); Text size and explanations; Credits and spending ("$3.20 of $5.00 left this month"); Who else is here. Each row opens the existing tab. The other tabs stay, under a "Everything else" group label. No setting moves; nothing is rebuilt. Basics is also the one Settings surface that should work from 390 px (CLAUDE.md: "Settings beyond the basics stays desktop"): five 44 px rows in the outer type scale, each either editable in place (name, text size) or ending in the kind hand-off. Rename on screen: "Mode" to "How it runs", "Keys" to "Your own AI key", "Danger zone" to "Pause or delete".

### 3.14 The public project page and the milestone card at 390 px (`packages/dugout/src/components/public/ProjectPage.tsx`, `ProjectFollowForm.tsx`, `MilestoneCard.tsx`)

**Project page now.** Brand bar, logo + name, the pitch as h1, "Being built" pill + date, two paragraphs, "Who it is for", a Follow panel (email, consent checkbox, Follow), "Built on Foundmill".

**Right.** The best page in the product for this audience. Calm, legible, the founder's own words, one action.

**Fixes.**
- "Follow" is `btn-tinted`: a dark plum plate that reads as disabled. Make it the brand-filled `btn-primary` (the page's kit already supplies a checked `kit-on-primary`). One filled button per page.
- The email input is 13 px: iOS zoom. `type-outer` on the page root fixes it.
- Field border 1.39 : 1: this page is the first place to ship `--line-control`.
- "Published Nov 12, 2026" is `t-small text-secondary`; fine. Add the founder's first name ("by Jamie") when the person page is public: a face is the strongest trust signal a week-one project has.
- No page exists in production. The gap is upstream (3.8: make "see your page" the first outcome), not on this page.

**Milestone card now.** Logo + name, date, "Page live", "Verified by Foundmill", "Foundmill recorded this when it happened. It was not typed in.", a button to the project, a link to the story. Two thirds of the screen is empty.

**Fixes.**
- The card is a share object and should look finished at the size it is shared: center it vertically, put the milestone at `t-display-phone`, and add the project's one-line pitch under it so the card makes sense to a stranger.
- "It was not typed in." reads as an accusation. Say what it is: "Recorded automatically by Foundmill on Nov 12, 2026."
- "Page live" is a system event name; the card should say it the way the founder would: "<Name> is live."
- Add the visitor's action: "Follow <name>" as the primary (to the page's `#follow`), "See how it was built" secondary.
- The first milestone a first-timer can reach should be celebrated in the console where they see it (the Win moment exists for customers; "Your page is live" deserves the quiet gold card, not only a toast).

---

## 4. Component gaps

### 4.1 The pattern to follow

Components live at `packages/dugout/src/components/<group>/<Name>.tsx` with `<Name>.stories.tsx` and `<Name>.test.tsx` beside them, exported through the group barrel (`components/firstrun.ts`, `components/guidance.ts`...), `"use client"` per file only when the browser is needed (else add the file to `SERVER_SAFE_FILES` in `clientBoundaries.test.ts`), tokens only, Lucide only, printed words exported as a const so tests and linters can read them. A representative component, quoted from `packages/dugout/src/components/guidance/ReassuranceLine.tsx`:

```tsx
"use client";
/** One sentence of reassurance under a first-run commitment or in a dialog footer ... Hidden when guidance is off: it is tutoring. */
export interface ReassuranceLineProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {
  /** "undo" (default): the action can be undone; "settings": where to change it later. */
  icon?: "undo" | "settings";
  /** One sentence. */
  children: ReactNode;
}
export function ReassuranceLine({ icon = "undo", children, className, ...rest }: ReassuranceLineProps) {
  const guided = useGuided();
  if (!guided) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-small text-tertiary text-pretty", className)} data-reassurance={icon} {...rest}>
      <Icon icon={icon === "settings" ? Settings : Undo2} size="inline" className="mt-px" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
```

Shape to copy: a doc comment that says where it is used and why; props extend the element's HTML attributes; `className` merged with `cn`; a `data-*` hook for tests; one job.

### 4.2 What already exists (so nothing here duplicates it)

| Asked for | Exists as | Gap |
| --- | --- | --- |
| Checklist | `firstrun/FirstWeekChecklist.tsx` (seven fixed items) | Generic rows are not reusable; extract only when a second use ships (4.3 item 7) |
| Coach marks | `firstrun/Coachmark.tsx` (`Coachmark`, and `Callout` = a one-step coach mark) | Popover only: on a phone it should render in a `Sheet` |
| Callout (inline note) | Nothing generic. `Callout` is already the name of the anchored one-step coach mark; `today/PublicPageNote`, `PostReadyNote` are one-offs; the landing phone note is hand-rolled | New `Note` (the name `Callout` is taken) |
| Stat tile for phone | `data/MetricTile.tsx`, `StatusStrip wrap` (two to a row under `page-wide`) | No new component; it needs `type-outer` |
| Stepper | Inline in `apps/web/components/new/StudioFrame.tsx`; the same numbered disc is re-typed in `OnboardingScreen.tsx:355`, `Doors.tsx:179`, `CommitScreen.tsx:888` | Extract: four call sites justify it **[KARP]** |
| Bottom sheet | `shell/PhoneBar.tsx` builds a side panel from Radix Dialog inline | New `Sheet` |
| Skill card | Rows inline in `agents/SkillPicker.tsx` | New `SkillCard` |

### 4.3 New or extracted components

**1. `Stepper`**: `packages/dugout/src/components/firstrun/Stepper.tsx`
- Use: the first-run trail in `StudioFrame`; "Before you start" one question per step; "What happens next" lists; the landing "How it goes".
- Props: `steps: { id: string; label: string; href?: string; optional?: boolean }[]`; `current: string`; `variant?: "trail" | "compact" | "list"` ("trail": today's numbered discs joined by hairlines; "compact": "Step 2 of 4" plus a 4 px progress bar, for phones; "list": vertical, static, numbered, with `children` per step); `onSelect?(id)`; `aria-label`.
- States per step: done (check in `status-good` + `sr-only` "done"), current (`aria-current="step"`), upcoming, optional ("(optional)" in words), error (a `CircleAlert` + words; a step with an invalid answer).
- Keyboard: it is a `nav` with an ordered list, not a tablist. Done steps with `href` are links in the normal Tab order (Enter follows); current and upcoming steps are text. No arrow-key roving. In "compact", the bar is `role="progressbar"` with `aria-valuenow/max` and `aria-valuetext="Step 2 of 4: Experience"`.
- Reduced motion: the bar jumps; no slide.

**2. `Note`**: `packages/dugout/src/components/foundation/Note.tsx` (server-safe)
- Use: the landing "what works where" block, "Sample card" and "Team starts paused" lines, the day-one "your team is drafting" lead, the improved `NeedsLargerWindow` body, any inline "good to know".
- Props: `tone?: "neutral" | "info" | "good" | "warn"`; `icon?: LucideIcon` (a default per tone); `title?: ReactNode`; `children`; `action?: ReactNode` (one button or link); `onDismiss?()`; `live?: boolean`.
- States: default; with action; dismissible (a 24 px, 44 on outer pages, "Dismiss" icon button); `live` renders `role="status"`.
- Visual: `bg-surface-1`, `border-line-strong`, 10 px radius, the tone as a 16 px icon and the title's word, never a full tinted fill (keeps text contrast at the `text-1`/`text-2` numbers in 2.1). Icon + words, so color is never the only signal.
- Keyboard: not focusable itself; its action and Dismiss are ordinary tab stops. Default role `note`.

**3. `Sheet`**: `packages/dugout/src/components/foundation/Sheet.tsx` (`"use client"`, Radix Dialog)
- Use: skill preview on a phone, definition cards on touch (hover cards do not exist on touch), coach marks on a phone, the phone menu (replace the inline panel in `PhoneBar.tsx`).
- Props: `open`, `onOpenChange`, `side?: "bottom" | "left"`, `title: ReactNode` (required; rendered as the dialog title), `description?`, `children`, `footer?: ReactNode`, `size?: "auto" | "full"`.
- States: closed; open (the `surface-dialog` glass, 14 px top radius for "bottom", the canvas backdrop at 66 %); scrolling body with a sticky footer; loading body (skeleton).
- Keyboard and pointer: focus moves to the title on open, is trapped while open, returns to the trigger on close; Esc closes; a visible Close button always (a drag handle may be drawn but dragging is never the only way: WCAG 2.5.7). Tapping the backdrop closes. `overlay-motion` in, instant under reduced motion. Respects `env(safe-area-inset-bottom)`.

**4. `SkillCard`** (and changes to `SkillLibraryList`): `packages/dugout/src/components/agents/SkillCard.tsx`
- Props: `skill: LibrarySkillOption`; `state: "available" | "selected" | "added" | "unavailable"`; `reason?: string` (why unavailable, or why suggested); `suggested?: boolean`; `result?: { tested: boolean; rating?: number }`; `effect?: ReactNode` ("Used in 3 tasks since Nov 3 · Product writing 13 to 15"); `onToggle?()`; `onPreview?()`; `onRemove?()`; `density?: "row" | "card"`.
- States: available; selected (the `row-selected` edge + checked box); added ("Added", checkbox checked and disabled); unavailable (reason in place of the description, not `opacity-60` on the whole row, so the reason stays readable); suggested (a "Suggested" chip + reason line); previewing (`aria-current="true"` while its preview is shown); loading skeleton.
- Keyboard: the row's checkbox is the tab stop (Space toggles); the label is the row; "Preview" is a second tab stop (Enter opens the pane or `Sheet`); Remove is an icon button named "Remove <skill>". In the list, Up/Down move between rows only if the list is given `role="listbox"`; simplest is to keep native checkboxes and Tab (as today).
- `SkillLibraryList` gains: `suggested?: { key: string; reason: string }[]`, `category?: string` + `onCategoryChange`, `onPreview?(key)`, `previewKey?`, and renders through `VirtualList` above about 50 rows. Search result count in a `role="status"` line.

**5. `IdeaAnswers`** (the three-answer face of the idea card): `packages/dugout/src/components/public/IdeaAnswers.tsx`
- Props: `card: IdeaCardData`; `founderFitKnown?: boolean`; `onShowScores?()`.
- Renders three `AnswerRow`s (question, `ScaleLabel` band, one sentence) from `IDEA_ANSWER_GROUPS` (a const mapping each question to attribute keys, exported beside `IDEA_CARD_WORDS`). `IdeaCard` gets `view?: "answers" | "scores"`.
- States: drafting (three skeleton rows that fill as their attributes arrive), partial (a group with one of its attributes shows "First read"), complete, unmeasured ("Fits you: after four questions about you" in words, not "-").
- Keyboard: the rows are text. "See all ten scores" is a disclosure button (`aria-expanded`, `aria-controls`); Enter/Space toggles; focus stays on the button.

**6. `RatingKey`**: `packages/dugout/src/components/guidance/RatingKey.tsx` (server-safe)
- Props: `scale?: 20`; `compact?: boolean`; `className`.
- Renders "1-5 Poor · 6-10 Average · 11-15 Good · 16-20 Excellent" with the four ramp swatches (each swatch beside its word, so color is never alone). Used once per screen that shows ratings (agent profile Skills header, the agent list footer, the idea card's "all ten scores").
- Not interactive; no keyboard behavior. Always shown (information, not tutoring), like band words.

**7. `Checklist`** (extract, only with its second use): `packages/dugout/src/components/firstrun/Checklist.tsx`
- Props: `items: { id: string; label: ReactNode; done: boolean; action?: ReactNode }[]`; `aria-label`.
- States: done (`CircleCheck` in `status-good` + `sr-only` "done"), to do (`Circle`), with action (ghost "Go").
- Used by `FirstWeekChecklist` (unchanged outside) and the house-rules list on the landing page (all done, no actions). If the landing list ships as plain `<ul>` with icons, skip this extraction. **[KARP]**

**8. `NeedsLargerWindow` (extend, do not replace)**: `packages/dugout/src/components/shell/NeedsLargerWindow.tsx`
- New props: `title?: ReactNode` (default "This part needs a computer"), `children?: ReactNode` (what is saved and what to do), `actions?: ReactNode` (for example "Send myself the link" using `navigator.share` with a `mailto:` fallback, and "Back to my card").
- Remove the "Current width: 390 px" line from the default (keep it in Builder view if wanted).
- Keyboard: actions are ordinary buttons/links at `min-h-tap`.

---

## 5. Accessibility findings (WCAG 2.2 AA)

Overall: the foundations are better than most (tested text ramp, global focus outline, reduced motion, labelled fields, icon + word everywhere). The failures cluster where "desktop only" meets zoom and touch.

### 5.1 Keyboard

| # | Finding | Criterion | Evidence | Smallest fix |
| --- | --- | --- | --- | --- |
| K1 | Single-key shortcuts cannot be turned off or remapped: R, J, K, E, 1-4, /, ?, and G-chords "work anywhere outside a text field". Space is bound globally to Continue, which starts work that spends credits. | 2.1.4 Character Key Shortcuts (A) | `shell/keyboard.ts`, `ContinueButton.tsx` (`useHotkeys("space")`), `33-keyboard-help.png`; no setting found by search | A "Single-key shortcuts" switch in Settings > Preferences, off by default while guidance is on (the key caps are already hidden then). Space on Continue only when Continue has focus unless the switch is on. |
| K2 | No skip link. A keyboard user passes the sidebar (about 12 items) and the top bar (about 8 controls) on every page. | 2.4.1 Bypass Blocks (A): landmarks help; a skip link is the dependable technique | `AppShell.tsx` has `<main id="main" tabIndex={-1}>` but nothing links to it | One visually-hidden-until-focused link "Skip to content" as the shell's first child, `href="#main"`. |
| K3 | "Send sign-in link" is disabled until text is typed; a disabled button is not focusable and explains nothing. | 3.3.1 / 3.3.3 (advisory) | `LoginForm.tsx` `disabled={... email.trim().length === 0}` | Keep it enabled; validate on submit; error through `Field`. |
| K4 | Score direction and definitions open on hover or keyboard focus of a `Term` button; on touch there is no hover and the rows are 23 px apart. | 1.4.13 is met for pointer + keyboard; touch is the gap | `AttributeBar.tsx` `AttributeLabel`, `47-idea-box-phone-390.png` | Names that carry the direction (3.6); definitions in a `Sheet` on touch. |
| K5 | Channel board says "drag one up to start it". | 2.5.7 Dragging Movements (AA) | Landing copy; a key hint ("press O") exists | Verify a single-pointer alternative (a button on the token); I did not test it. |

### 5.2 Focus visibility

| # | Finding | Criterion | Fix |
| --- | --- | --- | --- |
| F1 | `focus-ring` and `focus-within-ring` draw the ring with `box-shadow` and set `outline: none`; inputs set `focus-visible:outline-none`. In forced-colors mode shadows are dropped, so fields and cards show no focus. | 2.4.7 Focus Visible (AA) in forced colors | `outline: 2px solid transparent; outline-offset: 2px` in both utilities (`dugout.css:1221-1235`). |
| F2 | `--ring` is 1 px (4.84 : 1 on s1, 4.09 on s4). Visible, thin. | 2.4.7 passes; 2.4.13 (AAA) would not | 2 px at 80 % (2.7). |
| F3 | Chip remove button: `focus-visible:outline-1` on a 14 px box. | 2.4.7 passes barely | Let it inherit the global 2 px outline. |
| F4 | Sticky bars (the top bar, the DecisionBar at the foot of the reading pane, the Compare bar) can cover a focused control while tabbing through a long note. | 2.4.11 Focus Not Obscured (AA) | Not verified in a browser. Add `scroll-padding-bottom: var(--decision-bar)` and `scroll-padding-top` on the scrolling pane; test with Playwright (section 6). |

### 5.3 Target size

| # | Finding | Criterion | Fix |
| --- | --- | --- | --- |
| T1 | Chip remove "x": `size-icon-inline` = 14 x 14 px (onboarding markets and constraints, filters). Passes only through the spacing exception on desktop; on touch it is unusable. | 2.5.8 Target Size Minimum (AA) | A 24 px hit area (`::after` like `tap-reach`), 44 on outer pages. `Chip.tsx:109-116`. |
| T2 | Idea card on a phone: ten `Term` label buttons stacked about 23 px apart (`gap-1` rows), on a touch surface whose rule is 44 px. | 2.5.8; the product's own `tap-target` rule | The three-answer face removes them from the default view; inside "all ten scores" on outer pages use 44 px rows. |
| T3 | Checkbox and radio are 16 px, small switch 28 x 16. Labels extend the target; the bare switch in Settings relies on spacing. | 2.5.8 (met by label or spacing) | No change on desktop; on outer pages wrap in a 44 px row (the Follow form already does). |
| T4 | 22 px chips used as buttons (filter chips, quick-add "+ EU", steering chips). | 2.5.8 met by spacing (rows 28 px apart) | Acceptable on desktop; `min-h-tap` wherever they appear on outer pages (the idea box already does this). |

### 5.4 Zoom, reflow and text resize (the largest AA gap)

| # | Finding | Criterion | Evidence | Smallest fix |
| --- | --- | --- | --- | --- |
| Z1 | Browser zoom shrinks `window.innerWidth`. On a 1440 px window, zooming to 125 % gives 1152 CSS px, and every console route swaps to `NeedsLargerWindow`. A low-vision user cannot enlarge the console at all; 200 % is impossible on any display under 2560 px. | 1.4.4 Resize Text (AA); 1.4.10 Reflow (AA) | `useViewportWidth.ts` (`MIN_VIEWPORT_WIDTH = 1280`, measured from `innerWidth`), `DesktopOnly.tsx` | Between 640 and 1279 px render the console at `min-width: 1280px` inside a horizontally scrolling shell with a dismissible `Note` ("Built for 1280 px. Scroll sideways or widen the window."), instead of replacing it. Keep the (improved) full-screen message under 640 px. This amends DESIGN §2 "Below that it renders NeedsLargerWindow and nothing else" and needs CLAUDE.md's "Never show the dense console below 1280 px" read as "never lay it out narrower than 1280 px" (the console still lays out at 1280; the window scrolls); the argument is that a hard wall fails AA and also walls 13-inch laptops, while a scroll costs nothing on a 1440 px screen. Needs the founder's call. |
| Z2 | The in-app answer to "bigger text" is one step (13 to 14 px). | 1.4.4 | `tokens.css:339-346` | Add a third step, "Large": body 16/24, small 14/20, chat 16/24 (the `type-outer` values), since the rem base does not move. |
| Z3 | Inputs at 13 px zoom the page on iOS focus (sign-in, Follow). | Not a WCAG failure; a real phone defect | `Input.tsx` `text-body` | `type-outer` (2.2). |

### 5.5 Reduced motion and moving content

- Global rule plus per-loop rest frames: good. The marquee has a Pause button; auto-advancing tabs stop on focus, on choice and under reduced motion. Pass.
- The typed placeholder loops for as long as the field is unfocused, with no control other than focusing the field (2.2.2 Pause, Stop, Hide: it is decorative and `aria-hidden`, so the risk is low). Stop after one pass through the ideas and rest on the first. **P3.**

### 5.6 Color-only signals

- Strong overall: pills carry an icon and a word; ratings a figure and a band word; deltas an arrow; "not measured" a dashed edge.
- Gaps: "Founder fit -" explains itself only in a `title` attribute (no touch, no keyboard): print "Not measured yet". The self-rating slider colors a 10 amber with the word "Average" beside it: acceptable; drop the ramp color on self-ratings (3.4) for tone, not for WCAG.

### 5.7 Headings and landmarks

- Sign-in has no `h1`: the frame's title is a `Panel` `h2` and the wordmark is an image. **1.3.1 / 2.4.6.** Fix in `BrandFrame`.
- `BrandFrame` puts its `header` and `footer` inside `main`, so they are not banner/contentinfo landmarks. Minor; move `main` to wrap the panel only.
- Everything else checked is sound: `StudioFrame` and `NeedsLargerWindow` have an `h1`; panels are `h2` with `aria-labelledby`; the shell has `header`, `nav`, `main#main`; `lang="en"`; page titles use a template.
- Landing phone: `h1` then the card's `h2`. Once sections are added, each needs an `h2`.

### 5.8 Form labels and errors

- `Field`: label, required mark (`aria-required` plus a decorative asterisk), hint, `role="alert"` error with an icon, `aria-describedby`, `aria-invalid`. Good. One gap: the error replaces the hint, so the instruction disappears exactly when it is needed; render both.
- Idea box: the label is `sr-only` and the visible "placeholder" is decorative and `aria-hidden` (3.3.2 Labels or Instructions is met only by the lede). Show the label.
- Sign-in: send and Google errors are `StatusPill role="alert"` outside the `Field`, so not tied to the input. Use `Field error`.
- 3.3.8 Accessible Authentication: magic link plus a pasteable one-time code with `autoComplete="one-time-code"`. Pass.
- Follow form: labelled email, labelled consent, error under the form with `role="alert"`. Pass; tie the error to the field that caused it (`field` is already in the state).

---

## 6. Prioritized list

Each item: the smallest change that fixes it, the files, and how to verify. "PW" = a Playwright assertion; "Story" = a Storybook story; "Unit" = a Vitest case. **[KARP]** governed the "smallest change" column.

### P0: stops the target user or breaks trust

**P0-1. The phone path ends in a wall, and the phone-ready Today cannot be reached from a phone.**
- This breaks a binding rule, not a taste: CLAUDE.md Never: "never leave a small screen at a dead end"; a desktop-only screen "says so kindly with a way to continue later". `packages/dugout/CLAUDE.md` repeats it. "The profile" is on the small-screen list, and "Before you start" is the profile.
- Evidence: `/onboarding` and `/new*` are absent from `SMALL_SCREEN_PREFIXES`; `CardKeptView` and `PersonHome` send a phone there; `/home` redirects to `/onboarding` when the profile is incomplete. Today and Needs you work at 390 px but a project cannot be created at 390 px.
- Smallest change, in two parts:
  1. "Before you start" stacks under `page-wide`: the rail hides, the form is one column, `StudioFrame smallScreen`, the trail collapses to "Step 1 of 5", and `/onboarding` joins `SMALL_SCREEN_PREFIXES`. Four questions; no new component is required for this part.
  2. `NeedsLargerWindow` becomes a hand-off: "This part needs a computer. Your idea and your answers are saved. Open foundmill.com on a laptop and sign in with the same email." + "Send myself the link" (`navigator.share`, `mailto:` fallback) + "Back to home". Remove "Current width".
- Files: `apps/web/components/onboarding/OnboardingScreen.tsx`, `apps/web/components/new/StudioFrame.tsx`, `apps/web/components/providers/DesktopOnly.tsx`, `packages/dugout/src/components/shell/NeedsLargerWindow.tsx` (+ story, test), `docs/DESIGN.md` §2, §6.
- Verify: PW at 390 x 844 with a new account: `/onboarding` shows the form and `getByTestId('needs-larger-window')` has count 0; answer four questions, submit, land on `/home`. Tap "Start something": the page shows a "Send myself the link" button and no text matching `/Current width/`. `document.documentElement.scrollWidth <= 390` on both.
- Follow-up (a founder decision, question 4): a phone "Start building" with the name only, so a phone-only person reaches Today. Creating a project is not on CLAUDE.md's small-screen list today.

**P0-2. The phone landing explains nothing, and it is what every width under 1280 px gets.**
- Smallest change: build out `PhoneLanding` to the nine blocks in 3.2 from parts that exist (`IdeaCard`, the house rules from `Control.tsx`, a vertical step list), center it in a 640 px column so 391-1279 px is served by the same page, restore the third assurance, show the field's label.
- Files: `apps/web/components/landing/LandingPage.tsx`, `Hero.tsx`, `Control.tsx`, `idea-box/IdeaBox.tsx`; tests in `components/landing/__tests__/LandingPage.test.tsx`.
- Verify: PW at 390 x 844 and at 1024 x 768: `[data-layout="phone"] main h2` count is at least 4; `getByTestId('landing-phone-note')` count 0; no horizontal scroll; every `a, button` inside `main` has a bounding box at least 44 px tall; the text "Nothing moves money or signs in your name without you" is visible.

**P0-3. Day one hands a novice 25-27 agents and 4-17 notes; 11 of 13 projects were not opened again.**
- I cannot prove the first screen causes the drop; it is the last thing those people saw, and it fails the peak-end test.
- Smallest change (presentation only, no orchestrator change): a day-one state of Today (3.8) with one lead `Note`, at most one Needs-you row, no empty health tiles, no tour; Team opens grouped "Working now / Waiting for work" with the second group collapsed; sidebar badges other than Needs you are hidden on day one.
- Files: `apps/web/components/today/TodayScreen.tsx`, `packages/dugout/src/components/today/NeedsYouList.tsx`, `packages/modules/src/team/SquadScreen.tsx`, `apps/web/components/home/HomeTour.tsx`, `packages/dugout/src/components/shell/Sidebar.tsx`.
- Verify: PW on a freshly committed business in mock mode: Today has no `[data-testid="today-health"]` on day one, at most one Needs-you row, and the lead note; Team shows at most 6 rows before "Waiting for work (n)" is opened. Product measure: share of new projects opened on day 2 (THESIS_REVIEW §15).

### P1: significant difficulty, or a WCAG AA failure

| ID | Problem | Smallest change | Files | Verify |
| --- | --- | --- | --- | --- |
| P1-1 | Ten analyst scores; three names inverted | Rename the ten `word`s; add the three-answer face with "See all ten scores" | `packages/dugout/src/components/journey/types.ts`, `public/IdeaCard.tsx`, new `public/IdeaAnswers.tsx` | Unit: no label matches `/Competition|Capital intensity|Regulatory load|executab/`. Story "Answers". PW: a landed card shows three answer rows and a button with `aria-expanded="false"` |
| P1-2 | 13 px body and inputs on phone surfaces; iOS zoom | `type-outer` utility on the five outer frames | `packages/dugout/src/dugout.css`, `BrandFrame.tsx`, `StudioFrame.tsx`, `LandingPage.tsx`, `public/ProjectPage.tsx`, `PersonPage.tsx`, `MilestoneCard.tsx`, `shell/AppShell.tsx` (phone) | PW at 390 on `/login`: computed `font-size` of `#login-email` and of body paragraphs is at least 16px. Unit in `tokens.test.ts`: the utility declares the seven sizes |
| P1-3 | No filled main action on outer pages | `variant="glass"` to `"primary"` on the top bar CTA, "Continue with email", "Send sign-in link", "Keep this card", the kept-card next step; `tinted` to `primary` on Follow. Argue the same for `idea-gen` (founder's Nov 13 override) | `LandingPage.tsx`, `idea-box/IdeaBox.tsx`, `app/login/LoginForm.tsx`, `components/new/card/*.tsx`, `public/ProjectFollowForm.tsx`, `idea-box.css` | Contrast check: fill vs canvas at least 3 : 1 (flat primary is 4.12). PW: exactly one `.btn-primary` in the first viewport of each outer page |
| P1-4 | Sign-in: no h1, disabled main button, errors in pills, link-first on phones | `h1`; button always enabled; `Field error`; code field first under `page-wide` | `LoginForm.tsx`, `SignInCode.tsx`, `components/shell/BrandFrame.tsx` | PW: `getByRole('heading', { level: 1, name: 'Sign in' })`; empty submit gives `getByRole('alert')`, `aria-invalid="true"` and focus on the field |
| P1-5 | "Before you start" is a desktop form; "three" vs "four" questions | After P0-1's stacking: one question per step with `Stepper`; one source for the count | `OnboardingScreen.tsx`, `profile-form.ts`, new `firstrun/Stepper.tsx`, `IdeaCard.tsx` (`founderFit`), `components/new/card/CardKeptView.tsx` | Unit: the three strings use the count derived from `PROFILE_SECTIONS`. PW at 390: four steps, Enter advances, Back returns with answers kept |
| P1-6 | Doors: three equal primaries, build-plan words | First-timer or kept card: one door with the field inline and two text links; otherwise one primary. Drop the kickers | `components/new/Doors.tsx` | PW with `experience: first_time`: one `[data-door]`; one primary button |
| P1-7 | 113 of 127 approvals unanswered; the decision is last | Recommendation block and options above the note body; "Not sure? Ask <name>" beside them; "Why" disclosure; say what expiry does | `apps/web/components/inbox/*` (reading pane), `packages/dugout/src/components/shell/DecisionBar.tsx` | PW at 390 and 1440: the recommended option is inside the first viewport and precedes the body in DOM order. Product measure: answered / asked |
| P1-8 | Skills: buried, three kinds, no suggestion, no preview, no effect; zero adds | One panel on Overview; the dialog of 3.12 with `SkillCard`, Suggested, category chips, preview, virtualized list | `agents/SkillPicker.tsx`, new `agents/SkillCard.tsx`, `packages/modules/src/team/skills.tsx`, `apps/web/components/agents/AddedSkillsPanel.tsx`, `CustomSkillsPanel.tsx`, `OverviewTab.tsx`, `TrainingTab.tsx` | Story with 120 fixture skills: search narrows, a chip filters, Suggested is first, the list scrolls smoothly. PW: from an agent's Overview a suggested skill is added in at most three presses |
| P1-9 | Landing at 1440: twelve sections, trust eleventh, far-end example, four motions | The seven sections of 3.1; the rest at `/tour`; deck still until pressed; ticker and per-section reveals removed | `LandingPage.tsx`, `Hero.tsx`, `CycleDeck.tsx`, `Control.tsx`, `HowItWorks.tsx`, `examples/*` | `LandingPage.test.tsx`: section order. PW: "You stay in charge" precedes "Your team"; at load `document.getAnimations()` in the hero has at most the caret and the typing |
| P1-10 | Phones paint the desktop landing until hydration | Decide the split in CSS: shared hero with responsive classes; desktop-only parts in a `hidden` container and mounted lazily at 1280+ | `LandingPage.tsx`, `Hero.tsx` | PW with `javaScriptEnabled: false` at 390: no element wider than the viewport; the h1's computed size is at most 40px |
| P1-11 | Zoom above about 112 % on a 1440 px window replaces the console with the wall (1.4.4, 1.4.10) | 640-1279 px: render at `min-width: 1280px` in a scrolling shell with a dismissible `Note` | `DesktopOnly.tsx`, `StudioFrame.tsx`, `BrandFrame.tsx`, `shell/AppShell.tsx`, DESIGN §2 | PW at 1152 x 800: `getByTestId('shell-content')` visible; `needs-larger-window` count 0; the page scrolls sideways |
| P1-12 | Single-key shortcuts cannot be turned off; Space starts paid work (2.1.4) | A Preferences switch, off while guidance is on | `shell/keyboard.ts`, `shell/ContinueButton.tsx`, `apps/web/components/settings/PreferencesTab.tsx`, the account preferences column and its migration | PW: guidance on, press Space on `body`: `data-continue-state` unchanged; switch on: it changes |
| P1-13 | Prose at 13 px in the console | Default `text_size` to comfortable when guidance is on; `t-reading` for any block of two or more sentences; reading 16/26 | where `account_preferences` defaults are set, `tokens.css`, `agents/OverviewTab.tsx`, `guidance/Explainer.tsx`, `settings/shared.tsx` | PW new account: `html[data-text="comfortable"]`. `tokens.test.ts`: reading is 16px / 26px |

### P2: annoyance with a workaround, or polish with real effect

| ID | Problem | Smallest change | Files | Verify |
| --- | --- | --- | --- | --- |
| P2-1 | Control boundaries at 1.39-1.44 : 1 (1.4.11) | `--line-control: rgba(255,255,255,.34)` on fields, checkbox, radio, switch; outer pages first | `tokens.css`, `controls.css` (`field-well`, `check-box`, `radio-dot`, `switch-track`) | `tokens.test.ts`: the flattened boundary is at least 3 : 1 on s1 and the canvas |
| P2-2 | bad/info pill words at 4.40 / 4.38 on menus and hover cards | Pill fill 12 % to 10 % (4.55 / 4.52 on s3). On pressed plates (s4) a filled pill still reads 4.0: draw pills there without a fill | `dugout.css` / `controls.css` (pill and chip tone rules), `tokens.test.ts` | Unit: each status color on its own fill over s1, s2, s3 is at least 4.5 |
| P2-3 | No skip link | "Skip to content" to `#main` | `shell/AppShell.tsx`, `StudioFrame.tsx` | PW: first Tab focuses it; Enter moves focus into `#main` |
| P2-4 | Field and card focus invisible in forced colors; 1 px ring | Transparent 2 px outline in `focus-ring` / `focus-within-ring`; `--ring` at 2 px | `dugout.css`, `tokens.css` | PW with `emulateMedia({ forcedColors: 'active' })`: a focused field's computed `outline-style` is not `none`. `node scripts/focus-visible.mjs` still passes |
| P2-5 | Chip remove target 14 px | 24 px hit area (44 on outer pages) | `foundation/Chip.tsx` | PW: clicking 8 px outside the glyph still removes the chip |
| P2-6 | Ratings hidden rather than legible; three scales | "n of 20 · band" everywhere; `RatingKey` once per screen; a source line; one scale on agents | `data/SkillGrid.tsx`, `data/RatingBar.tsx`, `shell/ProfileHeader.tsx`, `packages/modules/src/team/SquadScreen.tsx`, new `guidance/RatingKey.tsx` | Unit: every rendered rating's text includes "of 20" and a band word. Story |
| P2-7 | Ten Settings tabs | A "Basics" tab of five rows that link to the existing tabs; three renames | `apps/web/components/settings/SettingsScreen.tsx`, new `BasicsTab.tsx` | PW: a guided account's Settings opens on Basics with five rows |
| P2-8 | Reassurance is the dimmest text; hints vanish on error | `ReassuranceLine` to `text-secondary`; `Field` renders hint and error together | `guidance/ReassuranceLine.tsx`, `foundation/Label.tsx` | Story snapshots; Unit: both `-hint` and `-error` ids are in `aria-describedby` |
| P2-9 | Commit: three names for one step; the wage line first | "Start building" everywhere; the face order of 3.7; "4 working today" preview | `components/new/commit/CommitScreen.tsx`, `StudioFrame.tsx` (`STUDIO_STEPS`) | PW: the step label, the title and the button share the words "Start building" |
| P2-10 | Follow looks disabled; the milestone card is two-thirds empty and says "It was not typed in." | Follow as `primary`; card content and copy of 3.14 | `public/ProjectFollowForm.tsx`, `public/MilestoneCard.tsx` | Story at 390; contrast of the Follow fill vs the page at least 3 : 1 for the default kit |
| P2-11 | One text-size step | A third step "Large" (16/24). Needs a visual pass on dense tables before shipping | `tokens.css`, `PreferencesTab.tsx` | PW screenshots of Team and Money at Large: no clipped cell |
| P2-12 | DESIGN.md is stale in places | Correct §7 (Continue blocked is amber "Needs you", hard stops only), §9a ("under 1280 px it renders NeedsLargerWindow", "two large buttons") | `docs/DESIGN.md` | Review |

### P3: nice to fix

- `--rating-1` to #F36066 (4.19 to 4.52 on pressed rows). `tokens.css`; `tokens.test.ts`.
- Token leaks: `text-[17px]`, `max-w-[60rem]`, `max-w-[47.5rem]`, the `shadow-[...]` dot in `IdeaBox.tsx` / `Hero.tsx`; `max-w-[22.5rem]` and `primary="#3a87ff"` in `IdeaCard.tsx`. Add tokens or use `kit-aura`.
- Landing chrome: drop the eyebrow pill, the lit phrase, the violet side wash and the footer's "Desktop only · 1280 px and wider". **[FD][TASTE]**
- The typed placeholder stops after one pass.
- `BrandFrame`: `main` wraps the panel only, so the header and footer are landmarks.
- "Founder fit -" prints "Not measured yet".
- "Expires in 5 days" gains its consequence sentence.
- Streak strip: remove the loss framing (a founder decision; see 3.9).

---

## 7. DESIGN.md amendments this review asks for

| Section | Amendment | Argument |
| --- | --- | --- |
| §1 The feeling | Scope "a broadcast control room at night... Composed. Dense. Alive." to the console. Add an outer register for landing, sign-in, first run, public pages, Today and Needs you on a phone: "a well-lit desk: clear, calm, yours". Same palette, larger type, one surface, one filled action, no caps labels, no mono, no glows. | The brief's own person is an anxious first-timer on a phone. The public pages already prove the calmer register inside the same system; production data shows the dense register loses people on day one. |
| §2 Non-negotiables (and CLAUDE.md Never, Small screens) | (a) Between 640 and 1279 px the console scrolls sideways at its 1280 px layout instead of walling (P1-11); the wall under 640 px becomes the hand-off of P0-1. (b) AA includes 1.4.11 for control boundaries. (c) Outer pages: body text at least 16 px. | (a) fixes zoom (1.4.4/1.4.10) and 13-inch laptops; (b) and (c) are measured gaps. |
| §3 Surfaces | Add `line-control`; change `ring`; outer-page panels are a plain hairline panel. | 2.1, 2.5, 2.7. |
| §4 Typography | Reading 16/26; "Outer type" scale (`type-outer`); `display-phone` 34/38; comfortable as the default with guidance on; a "Large" step. | 2.2. |
| §5 Color | Pill fill 10 %; `rating-1` = `status-bad`. | 2.1. |
| §6 Small screens | Add `/onboarding` (then a phone "Start building"); inputs 16 px. | P0-1, P1-2. |
| §7 Motion | Correct the Continue paragraph; landing motion budget: one autonomous loop in the first viewport. | Stale text; 2.6. |
| §8 Components | Buttons: the flat primary is the main action on outer pages, glass is secondary there. Add `Stepper`, `Note`, `Sheet`, `SkillCard`, `IdeaAnswers`, `RatingKey`; `NeedsLargerWindow` as a hand-off. `ReassuranceLine` in `text-2`. | Sections 3 and 4. This reverses the founder's Oct 10 "glass is the marketing call to action" for the main action only: at 1.6 : 1 against the page, and disabled on arrival at sign-in, it does not read as the way in. |
| §9a Landing | One reader (the first-timer); the seven-section order; the phone page as a full page for every width under 1280; investors get `/tour`. | 3.1, 3.2. |
| §9e Idea box | Visible label; three-answer card face; renamed attributes; a filled "Shape my idea". | 3.6, P1-3. |
| §9b, §9f | Follow as primary; milestone card content and copy. | 3.14. |

---

## 8. What I did not recommend, and why

Applying `karpathy-guidelines` ("nothing speculative", "touch only what you must"):

- **A light theme.** I think a dark-only marketing page read outdoors on a phone is a risk, but nothing in the evidence isolates it, every line token is white-alpha, and the public pages show dark can be calm. Test the rebuilt phone page with five target users before spending here.
- **New typefaces or the `ui-ux-pro-max` palette.** Barlow + Inter is distinctive and pinned; the problem is size, not face.
- **A phone console.** CLAUDE.md keeps the dense console on desktop. Everything proposed for phones is in the outer product list, plus the two first-run steps that gate it.
- **Removing ratings out of 20.** The founder's decision stands; section 3.11 makes them legible instead.
- **A new example business.** Re-date the existing example to its first week if its stories allow; I did not verify they do.
- **Photography or illustration.** `taste-skill` wants photographs on non-tech pages; for software its own rule is "its own UI as live HTML", which the page already follows.
- **Radius, elevation, easing and duration tokens.** Coherent; untouched.
- **`taste-skill` rules that fight product rules:** "no caption under any visual" (the product requires "Example" labels on every example part: the product wins) and "every section exactly one or two screens" for app screens (it is a marketing-page rule).
- **Fewer agents created on day one, batched approvals.** Both would help more than any pixel here, and both are orchestrator and product decisions. Flagged, not designed.
- **Replacing the coach-mark tours.** They exist and are well built; start them on the second visit.

## 9. Questions for the founder

1. Is the landing page for the first-timer alone, with the investor's material moved to a linked tour? Most of 3.1 follows from the answer.
2. May the main action on outer pages be the flat filled primary, including "Shape my idea", reversing the Oct 10 and Nov 13 glass and dark-outline decisions for that one role?
3. May the console scroll sideways between 640 and 1279 px instead of showing the wall? It fixes zoom for low-vision users and 13-inch laptops at once.
4. How far should a phone-only person get: profile and "Start building" with a name, so that Today (which already works on a phone) is reachable?
