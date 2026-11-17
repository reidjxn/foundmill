# WP-14: The behavior brief of Nov 17, 2026

**Goal:** The parts of the founder's behavior brief of Nov 17, 2026 that are still true of the product on main are built, each by the session that already owns its area, and the parts that disagree with a recorded decision wait for the founder.

**Why:** On Nov 17, 2026 the founder handed over a change brief ("Foundmill: behavioral-science change brief") written from an outside report. It was written against an older copy of the repository. Checked against main at `5b6541d6` the same day, about a third of it is already true, a third still applies, and a third disagrees with a founder decision or a CLAUDE.md rule, several of them from the same day. This file is the brief as it stands against the code: what to build, who builds it, and what waits.

**Done when:** every task below is merged or recorded as waiting, and every item under "Decisions for the founder" has an answer in docs/log.

## Rules for this package

- CLAUDE.md wins, then docs/log, then this file, then the brief. The brief's own "how to work" list is replaced by docs/holistic-plan/README.md. In particular: never edit docs/DECISIONS.md or docs/PROGRESS.md (the brief asks for both); write a docs/log entry.
- "Honest by construction" is not relaxed. Every example stays labeled Example, every number that was not measured stays an Estimate or a Forecast, and no line promises a time or a result the product does not reliably deliver.
- The vocabulary rule of 2026-10-08, US English and plain language apply to every string here. The away mode is "vacation".
- The wording given below is the proposal. If a line fails a check or is untrue of the product as built, fix the line and say so in the pull request.
- A task marked **amends** changes a task of another package. The session that holds that task takes the amendment with it; nobody else starts it.
- Nothing under "Decisions for the founder" is built on a guess.

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

## Decisions for the founder

Each item names what the brief asks, what it disagrees with, and what waits on the answer. Nothing below is built until the answer is in docs/log.

- **D1. Plans and prices.** The brief: plans named Try, Founder, Studio and Partner; Founder at $5 or $20 a month and Studio at $50 or $100, shown as two paired sets; Partner at $250 by application; a free Try plan that stays after sign-up opens; people who join while sign-up is invite-only never pay a subscription; the first price paid is locked; the label "Free while in early access". Main, same day (`wp09-paid-entry-plan` and `wp09-entry-plan-answers`, #273 and #274, merged 9:32 AM and 9:41 AM UTC): sign-up does not open with a free plan; at opening the plan is $5 a month with $5.00 of credits on Haiku 5.5 and GLM-5.3 Flash; Opus and Sonnet unlock with a credit pack of $20 or more; test users convert to the $5 plan on the day of the switch; nothing a user reads may promise the product stays free. The two agree on one point: no subscription is charged until sign-up opens. Waits: brief A7 (label, promise, names, price lock, billing tests), B2, B6.3, and the included budgets for `pro` and `scale`. Owner once answered: WP-09 T14 and T16.
- **D2. What a plan includes.** The brief puts Vacation mode, card sharing, named agents and the phone Inbox on the Founder plan, and several businesses, seats and the founder's own key on Studio. CLAUDE.md: plans differ by agent work only, with the "Built on Foundmill" mark as the one exception; people are free on every plan and "seat" leaves default copy. Only "more agents at once" is agent work. Waits: the tier lists in B2.
- **D3. The founder's own key at zero.** The brief: never offer the founder's own Anthropic key to a first-time founder who has run out, and move it under "Advanced". Main: the own key is the free plan's one route to Anthropic models (`stage3-founder-decisions-2`, Nov 16) and one of the ways on at zero in WP-09 T13 and in `wp09-paid-entry-plan`. Waits: that sentence in T1's note, `credits-notice.ts`, the Settings › Keys heading, WP-13 T7's prompt.
- **D4. Defaults at Commit.** The brief: a spend cap per action of 5.00 and Autopilot off. Main: the spend line starts at $0 for a founder with no budget (WP-04 D4, Nov 16) and the overnight shift is on by default (2026-11-11, 2026-11-12, WP-09 D7).
- **D5. What is asked before the first ideas.** The brief: time and where you live are required before the first ideas. Main: "Three quick things about you" (WP-04 T1, #233) leaves both out on purpose, after "profile after the first idea" (2026-11-11). T2 below builds the quick fit on what is asked today.
- **D6. "Built for a big screen".** The brief's hero line and wall line. CLAUDE.md, small screens (2026-11-11): the outer product works from 390 px and no small screen is left at a dead end. `removed-claims.test.tsx` holds "Desktop only" and "We will email you" as removed claims.
- **D7. Batches, places and invitations.** The brief: "Foundmill opens in batches. Batch N opens <day>. <n> places", three named invitations for each active founder, no reward for inviting, and an indexable waitlist page now. Main: no admission in cohorts and no public counts (2026-11-12, answers 4 and 7); no invite passes, with the inviter rules of 2026-11-13; both sides of an invitation get credits (docs/NETWORK.md); indexing follows `SIGNUP_OPEN` (`wp03-founder-decisions`). Waits: brief A6's wording, B3.2, B3.6, B6.2, B6.4, B6.5.
- **D8. Leaderboards.** The brief's B4 describes them "when opened". They were removed on 2026-11-11 and CLAUDE.md says not to rebuild them.
- **D9. The phone.** The brief: a light mobile web view on foundmill.app, and edits to docs/mobile. Main: the native app is the phone's home; `*.foundmill.app` is the Sites domain; docs/mobile belongs to the mobile session until WP-12 T7 merges it.
- **D10. Who the first user is.** The brief narrows "First" to the evenings-and-weekends founder with a day job. CLAUDE.md: a young first-time founder with little money, and the subtext rule keeps employment out of anything a user reads. The narrowing to one goal, a first paying customer, with Development and Distribution deepest, has no such clash and is in T13.
- **D11. "Customer #1" on a shared card.** DESIGN §9f: no counts anywhere, and a customer milestone is public only once tied to a real payment. T9 builds the card without the number until this is answered.
- **D12. The never-list.** The brief's five additions to CLAUDE.md's Never section need the founder's approval there. Two depend on D1 and D3. "Never stop a team mid-task because a balance ran out" and "Never turn the cycle into a continuous stream" clash with nothing.

## Tasks

### T1: Resting, and the last task always finishes            [M] [amends WP-09 T13; ships with it]
Brief: A3. Why: today `session-credits.ts` passes `maxBudgetUsd` and a session stops part-way (`CREDITS_USED_UP_SUMMARY`, "…so the session stopped"); Billing says "Used up: team paused".
Supersedes: "the charge that empties a balance pauses the team" (2026-10-12), by the founder's word in the brief.
Files: those of WP-09 T13, plus `packages/shared/src/terms.ts` and the voice skill.
Steps:
1. A new state word, **Resting**: a team that has used the month's budget. Add to `terms.ts` and the voice skill: "Paused is a choice. Resting is a team out of budget until the date shown." It replaces "Used up: team paused" and "Used up: conversations and Refresh paused". verify: the Billing spec reads the new word.
2. Before a session is dispatched, compare what is left with a reserve for it: the larger of a config minimum and the recent average cost of that agent type's sessions times a safety factor. Below the reserve the session does not start and the team rests; what is left stays in the balance. verify: a test with a balance just under the reserve starts nothing and books nothing.
3. A backstop: a session already running that outgrows its reserve still finishes, up to a small hard ceiling in config, booked to the usage ledger, and logged each time so the reserve can be tuned. verify: a test drives a session past its reserve and sees it finish and the log line.
4. The note comes from the Chief of Staff: "We've used this month's team budget. Here's what we finished, and here's what we'd do next. You can top up, change plan, or let us rest until <date>, when your budget resets." It lists finished and next items from real records, and names the plan by its config value, never "free". The own-key sentence stays as WP-09 T13 has it until D3 is answered.
Two numbers are the session's to propose and flag in the pull request: the safety factor (the brief suggests 1.5) and the backstop ceiling.
Collides with: WP-13 T4 (a free session waits while the cap is held) and T6 (the $600 cap). A team at the platform cap is waiting, not Resting: keep the two states apart.
Done when: a founder at zero sees the last task finished, a small amount left, the word Resting with a date, and one note with a way on.

### T2: Quick fit before the ideas, sharpen after            [M] [ships alone]
Brief: A5. Why: fit is "–" on ideas drafted before the profile, and re-rating after the profile was left out of WP-04 T1.
Files: `apps/web/components/onboarding/FirstProfile.tsx`, `profile-form.ts`, `OnboardingScreen.tsx` (the long form, now editing only), the Ideation agent's fit input, config for the two ratings.
Steps:
1. The skill tags `FirstProfile` already asks for set the five skill ratings: a picked tag a strong starting rating, an unpicked one a modest one (two config constants; the brief suggests 14 and 7 of 20; flag them in the pull request). Skipping uses neutral ratings and says so. Stored as the founder's stated answers at lower precision, never as measured or inferred data. Keep today's tags unless the brief's five ("Building software", "Finding and winning customers", "Product and brand", "Money and pricing", "I know my market") map more cleanly to the five skills; say which you chose and why.
2. Each idea's fit says what it rests on: "Fit: 15 (quick profile)" until the sharpen step is saved.
3. Once the first ideas show, offer the long form once as "Help your team help you": "Fit is based on your quick answers. Two minutes to sharpen it?" Saving re-rates fit on every idea in place, reorders them, and offers to redraft.
4. In the long form, "Every concept, forecast and decision is shaped by this." becomes "Your team will suggest ideas that fit your skills, your time and your budget." Keep "Be honest: the team hires to cover what you don't have."
5. An eval: Ideation drafts sensibly from the short profile and from none.
Not here: time, residence or a budget question before the first ideas (D5).
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
Brief: A9. Why: the default is off for everyone (`guidance-context.ts`, migration 0067).
Steps: default the per-person switch on when the profile says first-time founder; leave it for everyone else. In code and in tests: a named agent is labeled an AI agent wherever it appears (already true; add the test), and a named agent never writes to a third party as though it were a person. Use the name from "what should your team call you" wherever the product addresses the founder.
Done when: a new first-time profile sees named agents, an experienced one does not, and the third-party test passes.

### T7: One style for estimates, one legend            [M] [amends WP-10 T9 and T12; needs docs/DESIGN.md §10 changed in the same pull request]
Brief: A8. Supersedes DESIGN §10's "in a dashed chip next to them", by the founder's word in the brief.
Steps: estimates render in one distinct numeric style, and each screen that shows any carries a single legend line: "Numbers in this style are your team's estimates. Everything else is measured." The word Estimate or Forecast stays on hover and for screen readers, and stays spelled out wherever a figure stands alone (email, exports, Inbox prose). Update DESIGN §10 and the provenance tests. WP-10 T9's new Estimate chips follow this instead.
Done when: the provenance tests pass on the new rule and the accessibility check reads the word for every estimate.

### T8: The chapter report            [M] [ships alone]
Brief: A13. Why: `apps/composer/src/chapter.ts` writes chapter titles only.
Steps: at the end of each chapter the Chief of Staff writes one page to the Inbox: what we set out to do, what we did, the best moment, what we learned, what's next. Real records only; every item is an entity link. An eval covers a chapter with little in it: the report says so and invents nothing.
Done when: closing a chapter on a seeded project writes one note whose every claim links to a record.

### T9: Share a Customer Update as a card            [M] [ships alone; after #244]
Brief: A12. Why: milestone cards can be shared; a Customer Update cannot.
Steps: export a Customer Update the way a milestone card is exported today (image and a public read-only page): project name and logo, date, Lead channel, Standout agent, and the "Built on Foundmill" mark by the existing plan rule. Sharing is the founder's own action each time; nothing is public by default; the customer's name and any personal data are left out unless the founder adds them; not on example businesses; DESIGN §9f holds (no counts, and public only when tied to a real payment). No "Customer #1" until D11. Run the `security-reviewer` checklist for the new public route.
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
Not here: "Free to start · no card" (D1: from opening the first run needs the plan), any "big screen" line (D6), the pill "First company? The team comes with it." on `/` (a removed claim).
Done when: `LandingPage.test.tsx`, `TourPage.test.tsx`, `removed-claims.test.tsx` and `e2e/landing.spec.ts` pass with the new strings.

### T11: Commit's last two lines            [S] [ships alone]
Brief: A4. `includedCreditsLine()` reads "Starts with $5.00 of included credits this month. No card." Take the dollar figure out of Commit and let the line come from the plan's config, so it is true before and after sign-up opens. The lede and "what happens next" stay as WP-04 T2 and T7 wrote them. Not here: the spend cap and Autopilot defaults (D4).

### T12: Four measures            [S] [amends WP-02 T10's nightly numbers]
Brief: B7, B6.9. Add to `platform_metric_days`: minutes from commit to the first plan and to the first approved outcome, for every new project; the share of new founders whose first Continue press succeeds; the share of projects that reach Resting and what they do next (top up, change plan, wait, leave), after T1; shares for each Customer Update, after T9. If the median time to the first plan passes ten minutes, raise a note to the operator to change T10's "within minutes" line.

### T13: The plan document            [S] [docs only; one pull request]
Brief: B1, B4, B7. `docs/foundmill-plan/foundmill-plan.md` is the seed for Foundmill's own project, not the roadmap sessions execute; edit it so the seed agrees with this package.
- Vision › Principles, add: "The cycle is a rhythm, not a stream. Read, decide, press, wait, read. Do not optimize it into continuous activity." and "The gates are the premium. What the team will never do without you is a selling point, stated with pride."
- Value proposition leads with what the founder is getting: being a founder without doing every part alone, fewer ways to get it badly wrong (the house rules), a team for company, and visible progress. Add "The team you could never afford"; never "replace a team" or "no need to hire".
- Customers › First: one goal, a first paying customer; Development and Distribution get depth first, Finance and Legal stay competent and quiet. Put the same sentence in Risks item 6 (Scope) as its mitigation. The description of the person waits for D10.
- Retention loops: add the chapter report (T8) and the "Working now" strip (T5); Vacation mode becomes a named headline feature.
- Supporting metrics: T12's measures.
Not here: Pricing (D1, D2), the go-to-market order's batches and invitations (D7), leaderboards (D8), the phone (D9).

## Amendments to other packages' tasks

- **WP-09 T16** (the plan checkout): canceling, and pausing a project, are each one action from Settings, with a test that canceling takes no more steps than subscribing (brief A7). Subscription charging stays off until sign-up opens: the brief and `wp09-paid-entry-plan` agree.
- **WP-09 T13**: takes T1 above.
- **WP-09 T14**: its numbers wait for D1 as well as its own D1 and D8.
- **WP-10 T9, T12**: take T7 above.
- **WP-13 T7**: its upgrade prompt keeps the own-key offer until D3 is answered.
- **WP-02 T10**: takes T12 above.

## Starting prompt

```
You are taking tasks from docs/holistic-plan/WP-14-behavior-brief.md in reidjxn/foundmill. Read CLAUDE.md, docs/holistic-plan/README.md, STATUS.md and the whole of WP-14 first. Take only the tasks STATUS.md gives to you or leaves unowned; a task marked "amends" belongs to the session holding the task it amends. Build nothing under "Decisions for the founder". One task, one pull request, pushed once when ready. Re-find every file and string in the code as it is now: if a step no longer applies, say what changed and make the smallest change that meets "Done when".
```
