# WP-14: The behavior brief of Nov 17, 2026

**Goal:** The parts of the founder's behavior brief of Nov 17, 2026 that are still true of the product on main are built, each by the session that already owns its area, and where the brief disagreed with a recorded decision, the founder's answers of Nov 17, 2026 below are followed.

**Why:** On Nov 17, 2026 the founder handed over a change brief ("Foundmill: behavioral-science change brief") written from an outside report. It was written against an older copy of the repository. Checked against main at `5b6541d6` the same day, about a third of it is already true, a third still applies, and a third disagrees with a founder decision or a FOUNDMILL.md rule, several of them from the same day. The founder answered eleven of the twelve disagreements the same afternoon. This file is the brief as it stands against the code and those answers: what to build, who builds it, and the little that still waits.

**Done when:** every task below is merged or recorded as waiting, 

## Rules for this package

- FOUNDMILL.md wins, then docs/log, then this file, then the brief. The brief's own "how to work" list is replaced by docs/holistic-plan/README.md. In particular: never edit docs/DECISIONS.md or docs/PROGRESS.md (the brief asks for both); write a docs/log entry.
- "Honest by construction" is not relaxed. Every example stays labeled Example, every number that was not measured stays an Estimate or a Forecast, and no line promises a time or a result the product does not reliably deliver.
- The vocabulary rule of 2026-10-08, US English and plain language apply to every string here. The away mode is "vacation".
- The wording given below is the proposal. If a line fails a check or is untrue of the product as built, fix the line and say so in the pull request.
- A task marked **amends** changes a task of another package. The session that holds that task takes the amendment with it; nobody else starts it.

## Already true on main (build nothing)

| Brief | What main already does |
| --- | --- |
| A2: the first Continue press succeeds; the button is red only while something holds the work | Only a hard stop holds Continue (2026-11-07); one plan note replaced the two sign-offs (WP-04 D3, T5, #239). The label "Respond · N" is retired; the blocked label is "Needs you · N". Do not bring in "2 questions for you": it would describe a state that no longer exists. |
| A4: Commit asks for the name only | WP-04 T2 (#277): "More options", closed for everyone. |
| A1: the nav's "Desktop only" line, "A desktop app, built for focus", "See how it works", the pull-request sentence in pillar 2 | Gone from `/`. `/` was rebuilt on `apps/web/components/landing/words.ts` and `LandingHero.tsx`; the old `Hero`, `Thesis`, `HowItWorks`, `Control` and `CycleDeck` render only on `/tour`. |
| A1: no dollar figure in the hero | `/` has no dollar figure in its hero. The leftovers are in T10. |
| A6: a waitlist join on the not-invited page | "Save my place" (WP-03 T2, T3, T10). |
| A9: a named agent is always labeled as an AI agent | `ANTHROPOMORPHIC_EXPLAINER` and the position beside the name. |
| A12: milestone cards with a public page | `/m/<id>`, the share image, opt-in, none on sample businesses (DESIGN §9f). |
| B5: decisions from a phone | The one-click answer page `/a/<token>` (WP-04 T14, #222) and the day's digest (WP-04 T8, #220). |
| B3.1, B3.8 | Already the first and last steps of the plan's go-to-market order. |
| B3.7: a public gallery | In docs/NETWORK.md; the network session owns it. |

## Founder's answers of Nov 17, 2026 (afternoon, in the Desktop session that wrote this package)

These are later than #273 and #274 of the same morning and win where they differ. The log entry `2026-11-17-claude-wp14-behavior-brief` records each with what it supersedes.

- **A1. Plans and prices.** The entry plan is named **Try**. Try is free today; on the day sign-up opens to the public, Try becomes $5 a month. This agrees with #273 and #274: sign-up does not open with a free plan. The plans are Try, **Founder**, **Studio** and **Partner** (keys `free`, `pro`, `scale` unchanged). The Founder price is tested between **$15 and $25** a month (the brief's $5 against $20 is replaced). Partner is $250 a month, by application, with a waitlist and no checkout. No subscription is charged until sign-up opens. Built in T14.
- **A2. What a plan includes.** "Plans differ by agent work only" is dropped from FOUNDMILL.md. Plans differ as the brief lists: Founder adds Vacation mode, card sharing, named agents and the phone Inbox; Studio adds more agents at once; the number of companies is in A14. Built in T14. Companies and seats: A14.
- **A3. The founder's own Anthropic key.** A founder can always bring their own Anthropic key, on every plan. The brief's lines that hid it are deleted. Every note and prompt that offers a way on keeps offering the key (WP-09 T13, WP-13 T7 and T11, `credits-notice.ts`).
- **A4. Defaults at Commit.** As the brief says: a spend cap for each action of 5.00 in the project's currency and Autopilot off are what is selected when the page opens, and the founder can change both there and later. This replaces the spend line starting at $0 (WP-04 D4, Nov 16) and the default-on overnight shift (2026-11-11, 2026-11-12, WP-09 D7) as defaults. Built in T11.
- **A5. Time and where you live.** As the brief says, both are asked with the first profile. They must be known before a person takes charge of a project: a person who reached ideas without answering is asked at that step and cannot take charge without them. This adds two questions to "Three quick things about you" (WP-04 T1). Built in T2.
- **A6. "Built for a big screen."** The brief's lines are used: the hero assurance "Built for a big screen and your full attention" and the wall line "Foundmill is built for a big screen." The outer product still works from 390 px and no small screen is left at a dead end: the answer changes the words, not the small-screen build. Built in T10.
- **A7. Batches, places and invitations.** The brief is followed and the older decisions are changed: the waitlist opens in batches with a real count of places (replaces "no admission in weekly cohorts" and "no public counts" for the waitlist, 2026-11-12 answers 4 and 7); each active founder has three named invitations to send (replaces "no invite passes"); inviting earns no reward (replaces the credits for both sides in docs/NETWORK.md); the waitlist page is public and indexable now (an exception to "indexing follows `SIGNUP_OPEN`", `wp03-founder-decisions`, for that page only). Built in T15.
- **A8. Leaderboards** stay removed. Deleted from the brief.
- **A9. The phone.** The brief's mobile web view is dropped. The native app is the phone's home; docs/mobile is untouched.
- **A10. The first user** stays the young first-time solo founder. The day-job description is deleted from the brief.
- **A11. "Customer #1"** is deleted. DESIGN §9f's "no counts" holds on shared cards.

- **A12. People invited while sign-up is invite-only** never pay the Founder plan's monthly fee, for as long as they keep their account; credit packages are bought as normal (evening of Nov 17). This replaces #274's answer 4 ("users will have to convert to the paid $5 monthly plan on the day of the switch").
- **A13. Studio's test prices** are confirmed: $50 with Founder at $15, $100 with Founder at $25.
- **A14. Companies, not seats.** Plans differ by the number of companies an owner has: Try 1, Founder up to 5, Studio any number. A deleted company does not count toward the limit. There are no seats and no limit on people on any plan. This replaces "businesses are unlimited on every plan" (2026-10-16).
- **A15. Budgets and models.** Founder carries $10.00 of team budget a month whether the test shows $15 or $25; Studio $50.00; Try $5.00. Founder and Studio reach Opus and Sonnet without a credit pack. Try is the limited plan: Haiku 5.5 and GLM-5.3 Flash on Foundmill's keys, and Opus and Sonnet on the founder's own Anthropic key.

- **A16. A credit pack on Try.** On Try a founder can also buy credit packs on top of the month's allowance, as #274 has it: a pack of $20 or more adds credits and unlocks Opus and Sonnet. The own key is the other route.
- **A17. The never-list.** Four lines are added to FOUNDMILL.md's Never section in this pull request: never stop a team mid-task because a balance ran out; never make canceling harder than subscribing; never put a dollar figure for included credits in the hero; never turn the cycle into a continuous stream.

## Still open

Nothing from the founder. The numbers left to the sessions to propose and flag are named in T1 and T2.

## Tasks

### [x] T1: Resting, and the last task always finishes            [M] [amends WP-09 T13; ships with it]
Brief: A3. Why: today `session-credits.ts` passes `maxBudgetUsd` and a session stops part-way (`CREDITS_USED_UP_SUMMARY`, "…so the session stopped"); Billing says "Used up: team paused".
Supersedes: "the charge that empties a balance pauses the team" (2026-10-12), by the founder's word in the brief.
Files: those of WP-09 T13, plus `packages/shared/src/terms.ts` and the voice skill.
Steps:
1. A new state word, **Resting**: a team that has used the month's budget. Add to `terms.ts` and the voice skill: "Paused is a choice. Resting is a team out of budget until the date shown." It replaces "Used up: team paused" and "Used up: conversations and Refresh paused". verify: the Billing spec reads the new word.
2. Before a session is dispatched, compare what is left with a reserve for it: the larger of a config minimum and the recent average cost of that agent type's sessions times a safety factor. Below the reserve the session does not start and the team rests; what is left stays in the balance. verify: a test with a balance just under the reserve starts nothing and books nothing.
3. A backstop: a session already running that outgrows its reserve still finishes, up to a small hard ceiling in config, booked to the usage ledger, and logged each time so the reserve can be tuned. verify: a test drives a session past its reserve and sees it finish and the log line.
4. The note comes from the Chief of Staff: "We've used this month's team budget. Here's what we finished, and here's what we'd do next. You can top up, change plan, or let us rest until <date>, when your budget resets." It lists finished and next items from real records, and names the plan by its config value, never "free". The own-key sentence stays: a founder can always bring their own Anthropic key (A3), so the note offers topping up, changing plan and the key.
Two numbers are the session's to propose and flag in the pull request: the safety factor (the brief suggests 1.5) and the backstop ceiling.
Collides with: WP-13 T4 (a free session waits while the cap is held) and T6 (the $600 cap). A team at the platform cap is waiting, not Resting: keep the two states apart.
Done when: a founder at zero sees the last task finished, a small amount left, the word Resting with a date, and one note with a way on.

### T2: Quick fit before the ideas, sharpen after            [M] [ships alone]
Built on Nov 17, 2026 (`claude/vibrant-dirac-xkj04i`; log `2026-11-17-claude-vibrant-dirac-xkj04i`). What differs from the steps is in the log's Decisions.
Brief: A5. Why: fit is "–" on ideas drafted before the profile, and re-rating after the profile was left out of WP-04 T1.
Files: `apps/web/components/onboarding/FirstProfile.tsx`, `profile-form.ts`, `OnboardingScreen.tsx` (the long form, now editing only), the Ideation agent's fit input, config for the two ratings.
Steps:
1. The skill tags `FirstProfile` already asks for set the five skill ratings: a picked tag a strong starting rating, an unpicked one a modest one (two config constants; the brief suggests 14 and 7 of 20; flag them in the pull request). Skipping uses neutral ratings and says so. Stored as the founder's stated answers at lower precision, never as measured or inferred data. Keep today's tags unless the brief's five ("Building software", "Finding and winning customers", "Product and brand", "Money and pricing", "I know my market") map more cleanly to the five skills; say which you chose and why.
2. Each idea's fit says what it rests on: "Fit: 15 (quick profile)" until the sharpen step is saved.
3. Once the first ideas show, offer the long form once as "Help your team help you": "Fit is based on your quick answers. Two minutes to sharpen it?" Saving re-rates fit on every idea in place, reorders them, and offers to redraft.
4. In the long form, "Every concept, forecast and decision is shaped by this." becomes "Your team will suggest ideas that fit your skills, your time and your budget." Keep "Be honest: the team hires to cover what you don't have."
5. An eval: Ideation drafts sensibly from the short profile and from none.
6. Time and where you live (A5): add both to the first profile, with the title "Tell your team about you" ("What should your team call you?", "How much time can you give?", where you live). At take charge, a person without both is asked there and cannot take charge until they answer. verify: a spec takes an idea from the idea box to take charge with an empty profile and is stopped for exactly these two answers.
Supersedes: the two-required-inputs target of WP-04 T1, by A5.
Done when: a new person sees a fit number with its basis on the first ideas, and sharpening changes the numbers in place.

### T3: Team budget, outcomes first, on Billing            [M] [ships alone; after WP-09 T1 and T2 (#251)]
Brief: A7 (presentation only), A11 (Billing half). Why: Billing leads with the dollar balance.
Files: `apps/web/components/settings/BillingTab.tsx`, `packages/shared/src/terms.ts`, the usage ledger query.
Steps: Billing leads with "This month's team budget: enough for about N approved outcomes at your current pace", N from the usage ledger and marked as an Estimate; the dollar balance sits beneath in smaller type; cost per outcome shows on Billing as an Estimate, never on Today. Add "team budget" to `terms.ts`. Credits stay US dollars in the ledger. With no outcomes yet, show the dollar balance alone and no N.
Done when: the Billing spec reads the budget line first for a project with approved outcomes, and no invented N for one without.

### T4: Outcomes first on Today            [S] [ships alone]
Brief: A11. Files: the Today screen (`HomeScreen.tsx` and what WP-04 T7 left there).
Steps: the headline counts approved outcomes for the week from real records ("This week: 23 approved outcomes"). No cost figure on Today. A week with none says what the team is working toward and shows no zero as a score. Real outcomes only: a simulated result never counts.
Done when: the Today spec reads the count for a seeded project and no count line for an empty week.

### T5: Show the work            [M] [ships alone]
Brief: A10. Why: "Working now" exists as a Product tab only; the digest reports results, not effort.
Files: the Today screen, `DayDigest.tsx`, `packages/journey/src/roundup.ts`.
Steps:
1. While a run is in progress, Today shows a quiet "Working now" strip: one line for each active agent with what it is doing in founder words.
2. The day's digest and the weekly round-up report effort as well as results, from real counts only: "Your team ran 14 quality checks, set aside 3 drafts and shipped 1 page." A count of zero is left out.
3. A result that took minutes of real work shows the steps taken, not only the result.
Done when: the strip shows during a run and is absent otherwise, and the digest test asserts counts that match the records.

### T6: Named agents on by default for first-time founders            [S] [ships alone]
Built on Nov 17, 2026 (`claude/wp14-t6-named-agents`; log `2026-11-17-claude-wp14-t6-named-agents`). What differs from the steps is in the log's Decisions.
Brief: A9. Why: the default is off for everyone (`guidance-context.ts`, migration 0067).
Steps: default the per-person switch on when the profile says first-time founder; leave it for everyone else. In code and in tests: a named agent is labeled an AI agent wherever it appears (already true; add the test), and a named agent never writes to a third party as though it were a person. Use the name from "what should your team call you" wherever the product addresses the founder.
Done when: a new first-time profile sees named agents, an experienced one does not, and the third-party test passes.

### T7: One style for estimates, one legend            [M] [amends WP-10 T9 and T12; needs docs/DESIGN.md §10 changed in the same pull request]
Brief: A8. Supersedes DESIGN §10's "in a dashed chip next to them", by the founder's word in the brief.
Steps: estimates render in one distinct numeric style, and each screen that shows any carries a single legend line: "Numbers in this style are your team's estimates. Everything else is measured." The word Estimate or Forecast stays on hover and for screen readers, and stays spelled out wherever a figure stands alone (email, exports, Inbox prose). Update DESIGN §10 and the provenance tests. WP-10 T9's new Estimate chips follow this instead.
Done when: the provenance tests pass on the new rule and the accessibility check reads the word for every estimate.
Built (Nov 17, 2026, `claude/modest-mccarthy-4w9z5r`): `ProvenanceChip` takes the figure as its children and draws it in the estimate style; `EstimateLegend` is the line, and the console's shell shows it under any screen that holds an estimate. Screens outside the shell that still need the line or the figure form are listed in the log entry.

### T8: The chapter report            [M] [ships alone]
Brief: A13. Why: `apps/composer/src/chapter.ts` writes chapter titles only.
Steps: at the end of each chapter the Chief of Staff writes one page to the Inbox: what we set out to do, what we did, the best moment, what we learned, what's next. Real records only; every item is an entity link. An eval covers a chapter with little in it: the report says so and invents nothing.
Done when: closing a chapter on a seeded project writes one note whose every claim links to a record.

### T9: Share a Customer Update as a card            [M] [ships alone; after #244]
Brief: A12. Why: milestone cards can be shared; a Customer Update cannot.
Steps: export a Customer Update the way a milestone card is exported today (image and a public read-only page): project name and logo, date, Lead channel, Standout agent, and the "Built on Foundmill" mark by the existing plan rule. Sharing is the founder's own action each time; nothing is public by default; the customer's name and any personal data are left out unless the founder adds them; not on example businesses; DESIGN §9f holds (no counts, and public only when tied to a real payment), so there is no customer number on the card (A11). Run the `security-reviewer` checklist for the new public route.
Done when: the spec shares one update from a real seeded project, the public page shows no personal data, and an example business has no share action.

### T10: The tour and landing copy            [M] [the landing session; one pull request]
Brief: A1, A9 (landing). `/` runs on `words.ts`; the old sections are `/tour` only. Changing `APP_TAGLINE` changes no headline on `/`.
On `/tour`:
- Deck caption: "<Name> is an example business. Press Continue and see what your team would do this week."
- The deck's first Continue press ends in a win (work done, or a customer won) for all three examples (`cycle.ts`), and the deck drops the retired "Respond · 1" label.
- Thesis, appended: "Foundmill gives you that team without asking you to become a manager of software."
- Pillar 1 title: "A whole company, working while you work". Pillar 4 body: "Your team brings you the decision, the work behind it and its recommendation. Money, contracts, filings and anything irreversible wait for you."
- "You do not manage prompts. You run a business…" moves up to sit directly under the hero.
- Control list leads with "Never signs anything in your name"; under the list: "Not because it can't. Because you hired it not to."
- "Your first day": "Within minutes you'll have a product plan to sign off. Once you do, your team starts building." Only if it agrees with `FIRST_DAY_PROMISE` and the page-first first day (WP-04 T7); if not, keep the product's own sentence and say so.
- Remove the unrendered `INCLUDED_CREDITS_ASSURANCE` and its assertion in `TourPage.test.tsx`, and the "Desktop only" line in the tour's footer.
- One named, rated example agent, labeled Example, in the Team section.
On `/`:
- A vacation section: "Take a vacation." / "Vacation mode: your Chief of Staff keeps things moving within the limits you set, and writes you a report for when you come back."
- An honesty line by the control rules: "Every number we didn't measure says so." (After T7 merges, or reword to what is true today.)
- "You make the calls. Your team does the rest." and "The team you could never afford." as two more headline variants on the existing variant seam (`fm_lp`), not as a replacement H1. Measuring them waits for analytics.
- Hero assurance lines (A6, A1): "Built for a big screen and your full attention", "Nothing spends, signs or files without you", and "Free to start · no card" while sign-up is invite-only. The last one reads the stage from config and is replaced on the day Try becomes $5 a month; no dollar figure in the hero either way.
- The small-screen wall (`NeedsLargerWindow`): "Foundmill is built for a big screen." followed by the existing "Email me a link" action (`ContinueLater`). The page still works at 390 px; update `removed-claims.test.tsx` only where these exact lines need it, and say so.
- The not-invited page follows T15's wording once T15 lands; do not change it here.
Not here: the pill "First company? The team comes with it." on `/` unless `removed-claims.test.tsx` is changed with a reason; any sentence that promises the product stays free.
Done when: `LandingPage.test.tsx`, `TourPage.test.tsx`, `removed-claims.test.tsx` and `e2e/landing.spec.ts` pass with the new strings.

### T11: Commit's defaults and its credits line            [S] [ships alone]
Built on Nov 17, 2026 (`claude/wp14-t11-commit-defaults`; log `2026-11-17-claude-wp14-t11-commit-defaults`). What differs from the steps is in the log's Decisions.
Brief: A4. Founder's answer A4.
Steps:
1. What is selected when Commit opens, inside "More options": mode Assisted, Personal, a spend cap for each action of 5.00 in the project's currency ($5 for a USD project), Autopilot off, the first generated logo and its colors. Every one can be changed there and later in Settings. Above the form: "Name your business. We've set everything else to the careful option, and you can change any of it later." (use "project" where the stage rule asks for it). verify: the Commit spec reads each default and changes two of them.
2. Find what "Autopilot off" switches in today's code. If the overnight shift is a separate switch, say so in the pull request and set only what the Commit page shows; do not turn a running project's overnight shift off.
3. `includedCreditsLine()` loses its dollar figure and reads the plan from config, so it is true before and after sign-up opens.
Supersedes, as defaults only: the spend line starting at $0 (WP-04 D4) and the overnight shift on by default (WP-09 D7). "Commit with no budget starts no cycle" (WP-04 D1) is not changed: check that a 5.00 cap for each action does not by itself start spending a founder did not choose, and flag it if it does.
Done when: a new project commits with these defaults and a founder who changes them gets what they chose.

### T12: Four measures            [S] [amends WP-02 T10's nightly numbers]
Brief: B7, B6.9. Add to `platform_metric_days`: minutes from commit to the first plan and to the first approved outcome, for every new project; the share of new founders whose first Continue press succeeds; the share of projects that reach Resting and what they do next (top up, change plan, wait, leave), after T1; shares for each Customer Update, after T9. If the median time to the first plan passes ten minutes, raise a note to the operator to change T10's "within minutes" line.
Built (Nov 17, 2026, `claude/wp14-t12-four-measures`): the first three measures read real records; Resting and the shares read the events named in `PENDING_SOURCES` (`packages/db/src/repos/metrics.ts`) and are zero until T1, T14 and T9 write them. The log entry has the definitions.

### T13: The plan document            [S] [docs only; one pull request]
Brief: B1, B4, B7. `docs/foundmill-plan/foundmill-plan.md` is the seed for Foundmill's own project, not the roadmap sessions execute; edit it so the seed agrees with this package.
- Vision › Principles, add: "The cycle is a rhythm, not a stream. Read, decide, press, wait, read. Do not optimize it into continuous activity." and "The gates are the premium. What the team will never do without you is a selling point, stated with pride."
- Value proposition leads with what the founder is getting: being a founder without doing every part alone, fewer ways to get it badly wrong (the house rules), a team for company, and visible progress. Add "The team you could never afford"; never "replace a team" or "no need to hire".
- Customers › First: one goal, a first paying customer; Development and Distribution get depth first, Finance and Legal stay competent and quiet. Put the same sentence in Risks item 6 (Scope) as its mitigation. The description of the person stays as it is (A10).
- Retention loops: add the chapter report (T8) and the "Working now" strip (T5); Vacation mode becomes a named headline feature.
- Supporting metrics: T12's measures.
- Pricing: rewrite to T14 (Try free today and $5 a month at opening; Founder tested at $15 and $25; Studio; Partner at $250 by application; what each plan includes; credit packages carry most of the model revenue and the subscription price is set by what the plan is worth and tested; never "Price to be announced" in public). 
- Go-to-market order: the brief's eight steps, with batches, the places count, personal notes for the first hundred, Foundmill's own project in public, shared cards, three named invitations with no reward, the gallery, paid acquisition last.
- A section of experiments, each with a stop rule: the brief's B6.1 to B6.9, with the price test as in T14. Those that need analytics say so.
Not here: leaderboards (A8), the phone (A9).

### [x] T14: Plans, prices and what each plan includes            [L] [amends WP-09 T14 and T16; the session holding them takes it]
Brief: A7, B2, B6.3. Founder's answers A1 and A2. Why: `pricing.ts` has `free`, `pro`, `scale` with "TBD" and "Price to be announced".
Steps:
1. Display names (keys unchanged): **Try**, **Founder**, **Studio**, and a fourth, **Partner**, in `TIERS` display data as not purchasable.
2. One config value, `EARLY_ACCESS_STAGE` (`invite_only` now, `open` later); reconcile it with #273's proposed `ENTRY_PLAN` so there is one switch, not two. While `invite_only`: Try is free and nobody is charged a subscription. On `open`: Try is $5 a month with $5.00 of credits, as #273 and #274 describe, and the first press of Continue needs it.
3. `PRICE_TBA_LABEL` goes. While `invite_only` a plan shows "Free while in early access"; nothing says it stays free.
4. The Founder price test: two paired sets as config behind a switch that is off, Founder $15 with Studio $50 and Founder $25 with Studio $100 (A13), Partner $250 in both, credit packages the same in both. Shown only as figures marked "Indicative" on the waitlist page (T15), half of visitors seeing each; a visitor keeps the set first given, stored with the waitlist entry. Nobody is charged. When charging opens nobody pays more than the figures they were shown, and the first Founder or Studio price a person pays is stored for that owner and kept for as long as they stay subscribed. Tests now, with charging off: a stored price survives a price change in config.
5. Partner: "by application". The plan adds a monthly review of the project by "experienced venture-backed founders and venture capital investors" (this wording; name no person). The only action is "Join the Partner waitlist", which records the owner, the project and consent. The price shows, nothing is charged, and the copy says reviews begin once the plan opens and promises no date.
6. What each plan includes, as one table in config that the product reads: Try has the team and everything not listed here; Founder adds Vacation mode, card sharing (T9 and milestone cards), named agents (T6) and the phone Inbox; Studio adds more agents at once. Companies an owner may have (A14): Try 1, Founder up to 5, Studio any number, counted over companies that are not deleted, checked when a new one is committed; an owner over the limit keeps what they have and is told which plan allows another. No seats and no limit on people. The founder's own Anthropic key works on every plan (A3). Checks take effect on `open`; while `invite_only` everyone has everything, so no invited tester loses what they use today. Flag this reading in the pull request.
7. Included team budget as config: Try $5.00, Founder $10.00 in both price sets, Studio $50.00 (A15). "Monthly credits to be announced" goes. Founder and Studio may choose Opus and Sonnet without a credit pack; Try as in A15 and A16. `tierIsPaid` and WP-13 T7's server check follow this.
9. Invited people (A12): a marker on each owner who joined while `invite_only`, with the join date. When charging opens these owners are on Founder and are never billed its monthly fee; credit packages are bought as normal. Beneath the plans while `invite_only`: "Free while in early access. Founders invited now keep it free for good." Test now, with charging off: such an owner is never charged a subscription.
8. FOUNDMILL.md is already changed for A2 in this package's own pull request; `tierShowsBuiltOnMark` is untouched.
Not here: any limit on people; a live subscription checkout or live Stripe prices before sign-up opens.
Done when: Billing lists four plans by their new names with true labels for the stage, the config tests pass, and no checkout can charge a subscription while `invite_only`.

### T15: The waitlist in batches, and invitations to give            [L] [amends WP-03 T2 and T10 and WP-12's invitation tasks; coordinate with the network session]
Brief: A6, B3.2, B3.3, B3.6, B6.2, B6.4, B6.5. Founder's answer A7.
Steps:
1. A public waitlist page, separate from the app: "Foundmill opens in batches. Batch N opens <day>. <n> places." The numbers are live and real; with no batch set, the page says so and shows none. It is indexable now, with its own robots rule; the rest of the product still follows `SIGNUP_OPEN`. It shows T14's indicative prices.
2. Admission by batch on the existing waitlist (WP-03 T2, T10): the operator sets a batch's day and size; the order inside a batch stays as T10 built it unless the founder says otherwise.
3. The not-invited page: "<email> isn't on this batch's list yet. Join the waitlist, and we'll send your invitation when the next batch opens." Only while the waitlist email switch is on; otherwise keep today's sentence.
4. Each active founder gets three named invitations to send. No reward for either side: remove the invitation credits described in docs/NETWORK.md and say so there. Reconcile with the inviter rules of 2026-11-13 (`INVITATION_ADMISSIONS_PER_INVITER_PER_DAY`): three in total replaces three a day for this kind.
5. The founder's personal note to each of the first hundred, and a card by post for one batch, are the founder's own actions: build only what records that a note was sent.
6. Measures: activation by personal note against standard email; acceptance and activation of named invitations against waitlist batches; organic visits and sign-ups for the page. Each needs a stop rule; those that need analytics wait for it.
Done when: the page shows a real batch or none, an operator can admit a batch, an active founder can send three named invitations, and docs/NETWORK.md and the log record what was replaced.

## Amendments to other packages' tasks

- **WP-09 T14 and T16**: take T14 above. T16 also: canceling, and pausing a project, are each one action from Settings, with a test that canceling takes no more steps than subscribing. Subscription charging stays off until sign-up opens.
- **WP-09 T13**: takes T1 above, and keeps the own-key offer (A3).
- **WP-13 T7 and T11**: the own key is always offered, on every plan (A3). At opening, T7's copy uses the plan names of T14.
- **WP-10 T9, T12**: take T7 above.
- **WP-02 T10**: takes T12 above.
- **WP-03 T2, T10, T6 and WP-00 S7**: take T15's waitlist page, batches and the one indexable page.
- **WP-04 T1 and T2**: changed by T2 step 6 (time and where you live) and T11 (defaults).
- **WP-12 and the network session (#217, #208)**: three named invitations with no reward (T15 step 4).

## Starting prompt

```
You are taking tasks from docs/holistic-plan/WP-14-behavior-brief.md in reidjxn/foundmill. Read FOUNDMILL.md, docs/holistic-plan/README.md, STATUS.md and the whole of WP-14 first. Take only the tasks STATUS.md gives to you or leaves unowned; a task marked "amends" belongs to the session holding the task it amends.  One task, one pull request, pushed once when ready. Re-find every file and string in the code as it is now: if a step no longer applies, say what changed and make the smallest change that meets "Done when".
```
