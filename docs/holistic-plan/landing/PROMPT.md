# Prompt for the landing page session

Start a cloud session on the "Foundmill build" environment with the model set to Fable 5.2. Paste everything inside the block. The session must start from a checkout that has this folder and the skills in `.claude/skills/`: `main` once the plan's pull requests have merged, or the branch `claude/landing-overhaul-session` until then.

```
You are redesigning and rewriting Foundmill's landing page, the signed-out page at "/", end to end: research, direction, copy, visual design, build, checks. Nobody else is working on it. The main plan's other sessions have been told not to touch it.

## Who the page is for, and what it has to do

Foundmill is where one person with a team of AI agents builds something of their own. The reader of this page is a young first-time founder with little money and no business experience, most likely on a phone, who has never heard of Foundmill. The page has one job: get that person to type one sentence into the idea box, see their idea come back as a card, and want to keep it. Everything on the page either moves them toward that, answers the fear that stops them ("will this cost me money, do something behind my back, or make me look stupid?"), or goes.

Many founders will want to build with someone. CLAUDE.md says finding people is the product's growth loop and must be one step away at every point, always as an offer. Today's page says nothing about it. The new page must show the people side plainly and truthfully, without ever making a person on their own feel behind.

Measured on Nov 15, 2026: 19 accounts, 1 new in 14 days; the page is "noindex"; under 1280 px it shows a cut-down page and a note about wide screens; twelve sections written for a first-timer and an investor at once; no filled main button; claims a new free project cannot meet. The current page is in apps/web/components/landing/.

## Read first, in this order

1. CLAUDE.md, in full. It wins over every skill and over this prompt. Pay special attention to: "What Foundmill is for", "Solo is complete", "Finding people is seamless and optional", "Subtext, never text", the vocabulary tables, US English and US dates, "Small screens", and the "Always" rule on labeling non-real numbers.
2. .claude/skills/karpathy-guidelines/SKILL.md. It governs every change.
3. docs/DESIGN.md in full, especially section 9a (the landing page) and the tokens. You will rewrite 9a.
4. docs/holistic-plan/landing/WP-03-T5-draft.md: the rewrite the main plan held before the founder moved it here. Use its claims audit, its switch table and its true example week as research. You are free to replace its structure, copy and design. Its people section is too thin: do better.
5. The audits in docs/holistic-plan/audits/:
   - s1-design-critique.md sections 1, 2 and 3.1 to 3.3: the design verdict, the token audit and the landing critique with a seven-section direction.
   - s2-activation-growth.md: the activation model, the landing copy review and its proposed hero.
   - s3-seo-ai-visibility.md: the live-site findings and the home page's metadata, structured data and text file for AI readers.
   - a1-first-run.md FR-01, FR-02, FR-03, FR-06 and FR-14: the door, the false claims and the idea box.
   - a9-people-network-mobile.md sections 1.2 and 2: what the people side has built and what is switched on.
   - s6-market-last30days.md: what people say about the products this one will be compared with.
   - e0-production-evidence.md: the live numbers.
6. docs/NETWORK.md sections 2, 3, 4, 5, 10, 14 and 15: who the people side is for, the solo guard feature by feature, the founder's answers, and what not to build.
7. docs/THESIS_REVIEW.md section 13, and docs/foundmill-plan/foundmill-plan.md as the product-marketing context the marketing skills look for.
8. Recorded decisions: run `node scripts/decisions-index.mjs <words>` for "landing", "idea box", "glass", "Built on Foundmill", "person profile" and "NETWORK", then read the printed line ranges of docs/DECISIONS.md. The ones that bind you most: the idea box (2026-11-13, two entries), the founder's answers on NETWORK.md (2026-11-12), the person profile (2026-11-12), the "Built on Foundmill" mark (2026-11-12), the landing page entries of Oct 8 to 10. Do not re-decide any of them. Where your design needs one changed, build the recorded version behind a constant, propose the change and say why in the pull request.
9. The CLAUDE.md of apps/web, packages/dugout, packages/shared and packages/config before you touch each.

## Skills: use all of these, each where it fits

They are in .claude/skills/ and load by plain name. Where a skill disagrees with CLAUDE.md, docs/DESIGN.md or docs/DECISIONS.md, the repo's documents win. Skip any step in any skill that signs up for a service, downloads and runs a binary, or touches production.

- Every change: karpathy-guidelines. State assumptions; the simplest page that does the job; touch only what the task needs; a check that proves each claim.
- Positioning and copy: product-marketing first (to write the context down), then copywriting, then copy-editing, then humanizer on every line a visitor reads. marketing-psychology only for honest framing: no fake scarcity, no fake social proof, no countdowns. launch for the moment the page announces open sign-up later. referrals and social for the share loop and the share image.
- Conversion: cro for the page, signup for the step after the idea box, onboarding for the first minute, analytics to name the events the page fires, ab-testing to write hypotheses only (there is no traffic to test with yet).
- Design: impeccable is the main design workflow (critique the current page, then shape a direction, build, polish, audit). Run its scripts only inside this sandbox and skip its live-browser launcher if it needs a download. design-taste-frontend and frontend-design for the bar the page has to clear and the tells to avoid. ui-ux-pro-max, design-system, design and brand for type pairing, color, spacing scales and component specs, always translated into Dugout tokens.
- Search and AI readers: seo-page, seo-technical, seo-content, seo-images, seo-schema and schema, ai-seo, seo-geo, seo-agentic, seo-sitemap.
- Build quality: react-best-practices (server rendering, bundle weight, no layout shift), webapp-testing (drive the page in Playwright and take screenshots), test-driven-development, systematic-debugging when something fails.
- Every pull request: plan-change before code, verify-done before you say it is finished, requesting-code-review, then ship-change.

## The truth rule, applied to a marketing page

Every sentence on the page must be true for a stranger who signs up today on the free plan. For each claim, name the code that makes it true in the pull request (a component, a procedure, a test). If it is true only once a switch is on (open sign-up, platform mail, the people layer, Stripe), render it only when that switch is on and list it in a switch table: string, switch, file. Examples are labeled "Example" and use only things that work today. Any number that is not real is labeled "Estimate". No testimonials, logos, user counts or "trusted by" lines: there are none yet, and public counts are ruled out (NETWORK answers, Nov 12). No line says or implies "do this instead of a job"; say ownership and capability, and offer company.

## The people side: what to show

What works today, and may be said plainly:
- A project can have as many cofounders and collaborators as the founder likes, free on every plan, and cofounders' included credits pool on a shared project.
- An invitation link brings someone into a project.
- Every person can publish a public page of their own at /u/<handle>, saying what they are good at and whether they are open to people, looking for a cofounder or looking to join a project.
- Every project gets a public page at a Foundmill address that anyone can follow, and the founder can share it in one tap.

What is not switched on in production: browsing and finding people and projects (/network and the rest of the people layer are behind `FLAGS.liveMode`, closed unless LIVE_MODE=1). So:
- Show the people side early on the page, not near the bottom, as an offer: "on your own, or with people" in spirit. Say what works today in concrete terms.
- Build the "find people to build with" part as a block that renders only when the people layer is on, reading the existing flag. When it is off the page shows the true parts only. Do not write "coming soon" unless docs/DECISIONS.md records a date or the founder says so.
- Follow the solo guard: solo is complete. Never say or imply a person needs a cofounder, never present one person as a smaller version, and never rank anything by team size.
- Make the step to people one tap from the top of the page when it works (a top-bar link that appears with the flag).

## Design brief

- One responsive page for every width from 390 px. No separate phone page and no wide-screen note: the server's HTML is the page a phone keeps. No horizontal scroll at 390, 768, 1024, 1280 and 1440 px.
- Built from packages/dugout tokens and components. New components go into packages/dugout with a Storybook story each. No ad-hoc styling outside tokens. If the design needs a new token, add it to tokens.css with the reason. Do not change tokens the console uses without checking every screen that reads them: prefer new landing-scoped tokens.
- The page wears Foundmill's own look, not an example business's brand colors.
- One filled main action per screen, and the idea box is the main action. The current recorded choice is a dark button with a white outline (2026-11-13); s1 recommends a flat filled primary. Build the recorded one behind a constant, show both in screenshots in the direction pull request, and list it for the founder.
- Show the real product: the visitor's own card when it lands, a real example card before that, real screens rather than illustrations. Motion: one entrance in the hero and at most one or two moments further down, all switched off under prefers-reduced-motion. No auto-advancing carousels or marquees.
- Accessibility: WCAG 2.2 AA. Visible labels on every field, focus visible, contrast measured from the tokens, every control reachable by keyboard, axe clean (claude/blissful-fermat-q03yq1 adds axe checks to CI; rebase on it if it has merged).
- Performance, on a mid-range phone on 4G (Estimates to measure against): Largest Contentful Paint under 2.5 s, layout shift under 0.1, interaction under 200 ms, first-load JavaScript for "/" well under today's. The page stays prerendered (`force-static`).
- Search and AI readers: one h1; title and description written for the first-timer; canonical; Open Graph and a share image; one JSON-LD block (Organization, WebSite, SoftwareApplication with a free offer; no FAQPage markup); the "What Foundmill is" paragraph written so an answer engine can quote it. Indexing stays behind `HOME_INDEXED = false` until the founder says yes. robots.ts, sitemap.ts, /llms.txt and the 404 rule belong to WP-03 T6 in the main plan: if T6 has merged, use its `JsonLd` component and `indexable()`; if not, build only the page's own metadata and leave those files alone.
- The investor, the experienced founder and the press have a second page: today's page can move to /tour, unlinked on phones, if the founder agrees. Build it that way behind a constant and list it.

## What not to touch

- The idea box's contract and limits: `IdeaBoxDraftRequest`, `IDEA_BOX_INTERESTS`, the per-browser, per-address and daily limits, the bot check, and `IDEA_BOX_ERRORS`. WP-03 T7 in the main plan owns the limits and refusal lines. You may restyle the idea box and rewrite its visible label, placeholder, button and "Surprise me" lines.
- The sign-in, invitation, waitlist and onboarding screens (WP-03 and WP-04 in the main plan). The page links to them as they are.
- Anything outside apps/web/components/landing/**, apps/web/app/page.tsx, apps/web/app/examples/**, apps/web/app/tour/**, new files in packages/dugout, landing words in packages/shared, the store-links reader if it exists, and docs/DESIGN.md section 9a. If you need a change elsewhere, say so in a pull request instead of making it.
- Production, secrets and anything outside the gateway.

## How the work goes

Use executing-plans to work through these as separate pull requests, each small enough to review in one sitting. Branch names start with claude/landing-. Commits are authored as 40631036+reidjxn@users.noreply.github.com or Vercel blocks the deployment. Never push to main and never merge: the founder merges. Stack a pull request on an unmerged one only when it depends on it, say "Stacked on #<n>" in its first line, and keep stacks at most three deep.

1. Critique and direction (documents and screenshots, no product code). Render today's page in Playwright at 390 and 1440 px and screenshot it. Run impeccable's critique and the s1 audit's checklist against it. Write docs/holistic-plan/landing/DIRECTION.md: the reader, the one job, the section list with one idea each, the copy for every section, the people section, the claims table, the switch table, the design direction (type, color, spacing, layout, motion, imagery) in Dugout terms, and the measures. Build a static mock of the hero and two sections in Storybook so the direction can be seen, and attach screenshots at 390 and 1440 px. Rewrite docs/DESIGN.md section 9a to match. This pull request is the founder's chance to change course: carry on with the next steps while it waits, but keep them easy to change.
2. Design system pieces: the new tokens and components in packages/dugout, each with a story and a test.
3. The page: the new structure and copy at every width, the people section with its switch, the idea box restyled, today's page moved to /tour behind its constant. Tests first: a unit test per section's content, a test that fails if a string from the removed-claims list appears, and a test that the people "find" block renders only when `FLAGS.liveMode` is on.
4. Search and share: metadata, the JSON-LD block, the share image, and the "What Foundmill is" paragraph.
5. Proof: Playwright specs at 390, 768, 1280 and 1440 px (no horizontal scroll, one h1, the idea box reachable and labeled, a card lands with the mock model, the people block hidden and shown by the flag, reduced motion respected); axe; a performance measurement recorded in the pull request; screenshots of every width.

For every pull request run verify-done: typecheck, lint, unit tests, Playwright for the screens touched, Storybook for new components, and the three copy linters (node scripts/us-english.mjs, banned-terms.mjs, plain-language.mjs). Record progress and judgment calls the way the repo does at that moment (docs/PROGRESS.md and docs/DECISIONS.md, or per-change files under docs/log/ if WP-01 T6 has landed).

## Done when

- At 390 px and 1440 px the page renders the same sections, with no horizontal scroll, one h1 and one filled main action per screen.
- A stranger on a phone can type an idea, get a card and keep it without leaving the page.
- The people side appears in the first half of the page, every sentence in it is true today, and the "find people" part appears only with the people layer on.
- Every claim on the page maps to code in the claims table, and every switch-dependent string is in the switch table.
- Lighthouse on a mobile profile shows no accessibility failures, and the measured performance meets the Estimates above or the pull request says by how much it misses and why.
- docs/DESIGN.md section 9a describes the page as built.
- All linters and tests pass.

## Decisions for the founder (build the default, list it, keep going)

1. Is the page for the first-timer alone, with today's page kept at /tour for other readers? Default: yes.
2. The idea box button: the recorded dark button with a white outline, or a flat filled primary? Default: recorded, both shown.
3. Index the home page once the new page merges? Default: no until the founder says yes (`HOME_INDEXED`).
4. Open the people layer (`LIVE_MODE`)? The main plan recommends keeping it closed until reporting exists (WP-12 D2). It decides whether the page can offer finding people. Default: closed; the block stays hidden.
5. Keep /tour after a month if nobody opens it? Default: keep, decide later.

## Reporting

After each pull request, and at the end, report in plain prose: what changed for a visitor, with screenshots at 390 and 1440 px; the claims and switch tables; checks and their results, and what they do not cover; measured performance; the decisions waiting on the founder with your recommendation.

Begin with the reading list, then pull request 1.
```
