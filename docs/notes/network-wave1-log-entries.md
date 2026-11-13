# PR #93: this branch's docs/PROGRESS.md and docs/DECISIONS.md entries

Saved on Nov 13, 2026 before both files were restored to origin/main (`7ff7fa32`), per the coordinating session's rule that no PR merged today changes them. These are the lines this branch adds, in order: the diff of each file against `origin/claude/definer-grants` (#101, which is origin/main plus #101's own entries), so #101's two entries (PROGRESS "Client grants on Supabase (migration 0087) and the real-Postgres harness", DECISIONS "`revoke ... from public` is not enough on Supabase") are left to #101. Every line is an addition; nothing in main's entries is changed.

## docs/PROGRESS.md (added after main's last entry)


### 2026-11-12 — The network and community specification (document only, no product change)

The founder asked for a whole specification of the network side, written around one question: how does Foundmill go viral. `docs/NETWORK.md` (new):
- **The argument.** The product spreads through what founders make (every real outcome is a thing worth showing, and only Foundmill can prove it is real) and holds people through how others respond. The loops that bring people in are started by a solo founder for their own project's sake, so growth never depends on pushing anyone toward a cofounder.
- **The shape.** Two ways to be with people: alongside (follow, signal, answer an ask, a cohort, a build hour; everyone, no commitment) and with (a two-week trial, cofounders; always the founder's own step), as a ladder of small steps that can each be undone.
- **Eight loops** with attribution on every public address, **the hook** at four speeds (minutes, daily, weekly, chapter), **twenty-one features** in six groups (proof, reaching people outside, the room, alongside, with, the pulse), the surfaces and routes, what each agent does and never does, the solo guard feature by feature, the new objects and events, the measures, and a build order in four waves.
- **Fifteen questions for the founder** (its section 14), each with a recommendation. The first is the one the rest depend on: whether the alongside layer is open to a founder building on their own.
- A pointer at the top of `docs/THESIS_REVIEW.md` §13. Roadmap packages are unchanged.
- **Checked.** `node scripts/us-english.mjs docs/NETWORK.md` passes; no word from the vocabulary table or the subtext list in it. Nothing else was run: no code changed.
- **Found while reading.** The daily streak (founder, Nov 11) is decided and described in `docs/mobile`, and no code on this branch counts it yet; the specification says so and adds no second streak.

### 2026-11-12 — Network, wave 1 (first part): the "Built on Foundmill" mark

The founder answered the questions of `docs/NETWORK.md` §14 (DECISIONS, same date); the specification is revised to match and wave 1 started with the mark (F2, first half; the story page is next).
- **The rule.** `tierShowsBuiltOnMark` (packages/config): the free plan carries the mark, a paid plan removes every part of it. `builtOnWords` (packages/shared `project-page`) holds the words; the mark's text is "Built on Foundmill" in one place.
- **Made for the visitor, quiet for the member.** By placement, never by size:
  - The foot of `/p/<slug>` (`mark` on Dugout `ProjectPage`): for a signed-out visitor the page's one link, small, to the home page with `?via=p.<slug>`, coming up from dim as it scrolls into view (`mark-arrive`: opacity only; at full with reduced motion, without scroll timelines and on a page too short to scroll). For someone signed in: plain dim words, no link. On a paid plan: no foot.
  - After a visitor follows: one small line under "Check your email to confirm", "‹name› is built on Foundmill." with "Start your own".
  - The confirmation email ends with that sentence (words only), and the page after "Confirm" shows it small under the answer.
  - The share image: the words small in a corner.
  - The console: the phone preview shows the mark once with "The small line at the foot is removed on a paid plan." under the frame.
- **Api.** `publicPage.bySlug` and `page.get` answer `mark`. The plan behind a public page is read through the public view (`repos.pages.public.planTierBySlug`), on the service connection; the view itself is unchanged and still exposes no plan.
- **Attribution, the shared part.** `@foundmill/shared/via`: `p.<slug>` and `u.<handle>`, `parseVia`, `formatVia`, `withVia`, the parameter and cookie names. Recording it at sign-up is being built separately.
- **Verified.** Typecheck of the nine touched packages; eslint on the changed files; vitest: shared 682, config 19, dugout 1151, modules 601, web 1260, gateway 293, ingest 110, api `pages` and `page-follow` 29, db `rls/project-pages` 20; banned-terms, us-english, focus-visible, plain-language gate 2. **Playwright ran:** `public-page.spec.ts` (8 passed) against the PGlite stack: the visitor's link and its address at 390 and 1280 px, the line after a follow, the founder's own signed-in view (plain words, no link), the preview note. Screenshots 40 and 41 retaken.
- **Not done.** The story page the mark will link to (it goes to the home page until then). The person page (`/u/<handle>`) still ends with "Made with Foundmill": a person has no plan, so whether it carries a mark at all is a question for the founder. The full api and db suites were not run, only the files named above.

### 2026-11-12 — A person's page carries no mark; decisions recorded

- **`/u/<handle>` has no footer and no mark** (founder, Nov 12: the mark is only on what a person builds). Dugout `PersonPage` loses the "Made with Foundmill" footer and its `homeHref` prop; the share image loses the words; DESIGN §9c, the story text, the component test and `person-page.spec.ts` follow (no footer, no "Built on" or "Made with", every link still a 44 px target).
- **CLAUDE.md:** the mark is written in as the one exception to "plans differ by agent work only", scoped to the mark.
- **Recorded:** the founder's answers relayed by the alignment session (the wording "Built on", the exception, this session owning invitations and the waitlist), migration numbers 0085 and up for this branch, `docs/mobile` left to its owner, and the decision to build a private person-level event store before wave 2.
- **Verified.** Typecheck of dugout and web; vitest: dugout `public` 23, web 1260; eslint on the changed files; banned-terms and us-english. **Playwright ran:** `person-page.spec.ts` (8 passed); screenshots 42 and 43 retaken.
- **In flight.** Sign-up attribution (0085) and early milestones with the story page and cards (0086), each on its own working copy; not merged yet.

### 2026-11-12 — Network, wave 1: sign-up attribution

Who or what brought a new person is recorded once (docs/NETWORK.md §5).
- **Web.** The proxy keeps the first valid `?via=` a visitor arrives with in the httpOnly `fm_via` cookie (first touch wins, 30 days; no database write and no api call per visit). `/onboarding` reads it on the server for a person without a profile and hands it to the form; the save that creates the profile sends it; a Server Action then clears the cookie.
- **Api.** `founder.profile.update` takes an optional `via`. On the save that creates the profile, `services/attribution.ts` resolves it against the two public views only and records one row. Not a reference, nothing public behind it, a self-referral and a second time are all ignored silently with the same answer; the value is never logged; a failure never fails the save.
- **Database.** Migration `0088_attributions` (first numbered 0085, then 0086; renumbered when the merge order was set and again after #98 and #101): one row per account, service role only (row level security on, no policy, no grant to a client role: not even the person reads who brought them). For a project page the person credited is its longest-standing owner.
- **Event.** `signup.attributed` is declared; no row is written until the person-level event store exists (being built as its own change, migration 0085). Each row is checked against the event's schema, so the events can be written from the rows.
- **Verified** (by the build, on its own working copy): workspace typecheck 25 of 25; vitest: db 1976 (13 skipped), events 76, shared 680, stream 87, api 1061 (3 skipped), web 1276; Playwright `onboarding.spec.ts` and `attribution.spec.ts` (7 passed); banned-terms, us-english. **Again after merging onto this branch:** workspace typecheck 25 of 25; db `rls/attributions` and `migrations` 27; api `attribution` and `pages` 28; web 1276. Playwright was not rerun after the merge.
- **Known limits.** It only works when the person signs up in the browser they arrived in (the native app must pass `via` itself). A signed-in person without a profile who lands straight on `/onboarding?via=…` gets the cookie on that request but it is not handed over until the next one. The cookie's value reaches the onboarding page's script as a prop (the cookie itself stays httpOnly). `docs/ARCHITECTURE.md` does not describe the table or the cookie yet.
- **Seen in passing, not looked into.** In `next dev` with the api unreachable, `/new` and `/onboarding` answered 500 with `TypeError: frame.join is not a function`; `/new` is untouched by this change.

### 2026-11-12 — Network, wave 1: early milestones, the story page and milestone cards

docs/NETWORK.md F2 (second half) and F3; THESIS_REVIEW package 5.3.
- **Two early milestones**, recorded in the transaction of the real event: "Page live" when the page is first published, "First follower" when the first follower confirms. Listed before the customer and revenue ones. Existing projects are caught up with the original dates; never a sample business.
- **A founder chooses to show one.** Plan › Milestones: "Show on your page" under a reached milestone, then "On your page" with Hide and Copy card link. An owner or an admin only (`journey.showMilestone`, `journey.hideMilestone`), audited, with `milestone.shown` and `milestone.hidden` through the outbox. Showing needs a published page; hiding never does.
- **Only a milestone recorded from one real outside event can be shown** (`isShowableTrophyKey`: "Page live" and "First follower"). A customer or revenue milestone is counted or estimated, so the api, the console and the table's guard all refuse to make it public: "Verified by Foundmill" must be true of everything a page shows.
- **The story:** `/p/<slug>/story`, "How ‹name› was built": shown milestones oldest first, each a date, the words and "Verified by Foundmill", one sentence on what verified means, no counts. From 390 px, signed out, indexable only when it exists. The project page's mark and the line after a follow now go to the story when there is one ("See how it was made").
- **The card:** `/m/<id>` for one shown milestone, with a wide share image and a tall one for story posts (`/m/<id>/story-image`). `noindex, follow`. "Start your own" appears only on the free plan and only for a signed-out visitor.
- **Database.** Migration `0089_public_milestones`: the view `public_project_milestones` (service role only; rows only while the page is public, so taking the page down removes the story and every card at once; public words are built from the key, never from a stored label) and a guard on `milestones` so a client cannot write or change a platform-recorded milestone by hand, and only an owner or an admin shows or hides.
- **Verified on the merged branch.** Workspace typecheck 25 of 25; vitest: db 1993 (13 skipped), journey 133, shared 686, events 77, dugout 1165, widgets 243, web 1279, stream 87, ingest 111, api 1074 (3 skipped, the full suite); eslint on the changed files; banned-terms, us-english, focus-visible, plain-language gate 2. **Playwright ran:** `project-story.spec.ts`, `public-page.spec.ts`, `milestones.spec.ts` (14 passed).
- **Not done.** Nothing in the console links to the tall image, and there is no share control yet (tap-to-post is the next package). The card has no Follow button of its own; it links to the project page. On a business in the old "Live" mode, a shown milestone also gets the older Share button. Publishing a page now ends Today's "day one" view, because that view ends at the first milestone.
- **Open, found by the build:** the "Page live" date follows `project_pages.published_at`, and migration 0077's guard checks who writes that column, not its value, so an owner could backdate it with a direct write. Filed as a suggested task ("Make a page's published date server-set"); not fixed here.

### 2026-11-12 — Network, wave 1: tap-to-post sharing

The founder's default way for a project to post (DECISIONS, two entries of this date): one button per network opens that network's own share window with the text and link filled in, and the founder presses Post there. Foundmill posts nothing.
- **The share panel** (Dugout `SharePost`, DESIGN §9g) opens from Plan › Milestones ("Share" on a milestone that is on the page), Product › Public page ("Share your page") and Customers › Creative (on a post drafted for social). The text is drafted from facts already public and can be edited; it is refitted to each network as the founder types; every link carries `via`.
- **Where each network landed**, checked on Nov 12, 2026 against the networks' own pages or their live answers (no signed-in account was used, so no composer was seen filled in):
  - **Opens ready to post** (text and link): X, Threads, Bluesky.
  - **Opens with your link** (the words are not carried): LinkedIn and Facebook take only a link; Reddit takes a title and link but the founder still picks a community.
  - **Copy and post in the app:** Instagram, TikTok ("Copy text" and the image to download).
  - **Send to someone:** WhatsApp, Telegram, Copy link.
- **The social channel is available by tap** (reason `by_tap`, with no connector), from the three networks above. The team never runs it: no engine starts, a campaign on it cannot be scheduled, it is never a default start, and the Distribution Strategist is told the founder posts it. On the Board it reads "You post it".
- **One draft shape** for tap-to-post and the optional Buffer connector (`packages/shared/src/post-draft.ts`, agreed with the connectors session): https links with no credentials, networks append-only.
- **A press is recorded as a share** (`share.opened`), never as posted, at most 30 a minute per person, and nothing counts it as a real outcome.
- **Verified.** The merge was a fast-forward, so the build's own runs are of this exact tree: workspace typecheck 25 of 25; vitest: shared 733, events 79, connectors 787 (113 skipped), stream 87, dugout 1186, modules 619, widgets 243, web 1279, api 1087 (3 skipped), orchestrator 667; eslint; the four script gates. Rerun here: typecheck 25 of 25, and shared, connectors, events, dugout, modules, web, stream with the same counts. **Playwright ran here:** `tap-to-post`, `public-page`, `milestones`, `project-story` (15 passed). Screenshot `docs/ux-audit/53-share-panel.png`.
- **Seen once and not reproduced:** in the build's combined run, `first-days.spec.ts` (an element not found after 60 s) and `public-page.spec.ts` (a page crash) each failed once and passed on their own afterward. Not shown to predate this change.
- **Not done.**
  - **On a real project the social agent drafts nothing yet**, so the Share control on Creative has drafts only where simulated results are allowed. The panel's two other places work everywhere. Agent-written post drafts are the next piece of this.
  - The Share control on a drafted post is covered by unit tests only (the browser test stack has no drafted post).
  - Share buttons for visitors on the public story and card pages; counting a visit that comes back through a shared link.
  - Storybook was not built (stories are typechecked).
  - A milestone on a business in the old "Live" mode shows two controls both labeled "Share" (the older one copies a line of text).

### 2026-11-12 — Sign-up attribution writes its events to the person-level store; one step for a new person

- **Two account events, one per person** (replacing the business-scoped `signup.attributed` that was declared and never written). `signup.attributed` goes to the new person; `referral.arrived` goes to the person credited, when there is one. Both carry only what was in a public address: `sourceKind` and `sourceRef`. Neither names the other person in any way, and the idempotency keys come from the attribution row's own id.
- **Written with the row, never instead of it.** Both events go in a savepoint inside the transaction that inserts the `attributions` row: both with the row, or the row without them. The row is what credit is later paid from and is written once, so an event that cannot be written (a page address shaped like an id is one real case) never loses it.
- **The SQL list of account-scoped types** (`fm_account_event_types()`) is redefined inside `0088_attributions` with all four types; 0085, which is applied in production, is untouched. A test reads the latest definition across migrations and holds it equal to `ACCOUNT_EVENT_TYPES`.
- **`onPersonCreated`** (`apps/api/src/services/person-created.ts`): the one place for what runs once when a person's profile is first created. Each step in its own try, so one failing never stops another or fails the save. Today it has one step, attribution. `founder.profile.update` also accepts an optional `ideaDraftToken` and passes it through; no step reads it yet (the idea-box work adds its claim, if the founder chooses "questions first").
- **Verified on this branch after merging the change:** workspace typecheck 25 of 25; vitest: shared 784, events 129, stream 97, db 2106 (13 skipped). The build's own run of the api suite on its base: 1170 passed, 3 skipped; rerun here after this entry.
- **Open.**
  - A person can read their own account events, so a person credited can see that someone arrived through their page and when, with no screen for it yet. The spec said the store was "one that only the service reads"; what #86 built lets a person read their own rows. For the founder to confirm.
  - Nothing has run on real Postgres. A database that already applied an earlier 0088 from this branch needs the function redefined by hand.
  - The account relay is off on main, so these events are written and not relayed.

### 2026-11-13 — Network, wave 1: the social agent writes post drafts for tap-to-post

The founder's ask after tap-to-post ("a post the social channel agent wrote"). Drafting is separate from running the channel: nothing here launches, schedules, publishes or measures.
- **When a draft is written.** Only for a project whose social channel is available by tap and that the founder has put on the Channel Board, never a sample business, never while the team is stopped or out of credits. One draft per trigger: the page going live, a milestone shown on the page, the first follower. Putting social on the board with the page already live catches up the page's draft.
- **How it starts.** The writer of the event starts a `postDraft` workflow after its commit (the api for the page, a shown milestone and the board; ingest for the first follower). Nothing polls, and the api adds no loop, timer or background query on its database pool.
- **Caps.** At most 2 drafts in 24 hours and 5 in 7 days per project (`TEAM_POST_CAPS`), dropped attempts included; never a second waiting draft about the same thing.
- **What the agent is given.** The project's name, its published page (inside an untrusted-content block), the one fact that happened with its date, and the length it may use. Never a follower's or customer's name or email, never a count, never revenue.
- **The check on its answer** (`checkPostDraft`, pure code): refuses a link or bare domain, an email, an @mention, markup, a phone number, a figure or quantity not in the facts, a hashtag the page does not use, emoji, praise, a claim of customers or results, the phrases the product never writes, and a mention of AI or the product. One retry with the reason code, then the draft is dropped; only the code is logged. The code, not the model, attaches the link with `via` and the image, and fits the text to each network.
- **Where it shows.** Customers › Creative, as a post the team wrote, with Share (the tap-to-post panel) and "Not this one"; one quiet line on Today, "A post is ready to share", until it is shared or set aside. No Inbox note, no email, no push. Event `post.drafted` (ids and the kind of trigger, never the words). No migration.
- **Model and cost.** The `projectPage` route (Sonnet at low effort). Estimate: about 0.6 to 1.5 cents a call, up to about 3 cents a draft with the retry, at most about 15 cents per project per week at the cap; worked out from the built request and list prices, not measured.
- **Verified on the merged branch:** workspace typecheck 25 of 25; vitest: shared 796, models 297, agents 465, events 130, db 2125 (13 skipped), stream 97, ingest 114, modules 625, orchestrator 686, dugout 1237, web 1370, evals 105 (16 skipped: the live suites). The build's own runs on its base: api 1165 (3 skipped), Playwright `post-drafts`, `tap-to-post`, `public-page`, `milestones`, `project-story`, `money-legal-distribution`, `first-days` (37 passed) and the golden path (17). The api suite and the Playwright specs are rerun on the merged branch after this entry.
- **Not verified.** The eval was written and **not run**: there is no model key in this environment, so no real model has produced a draft yet. The social template's standing instructions pull against the post prompt in places ("specific numbers", "cite record ids"); the prompt overrides them, and only a live run shows whether that holds.
- **Known gaps.** In production a trigger that fires while the workflow service is down is lost, with no retry. A figure the founder states on their own page can be repeated in a post (the check refuses only what the facts do not contain). `screens-plain.spec.ts:77` (Milestones) times out on this branch and on its base alike.

### 2026-11-12 — A page's dates are recorded by the database (the open point above)

The "Published Oct 7, 2026" line on a public page and the date of the milestone "Page live" are now facts the platform recorded. Built on the network branch (`claude/bold-johnson-hjxopx`), which is not merged yet.
- **What was wrong.** The guard on `project_pages` (0077) checked who wrote the publish columns, not the dates. An owner or an admin could write any `published_at` straight at the table, on a live page or on a row that was never published. The public page showed it, the nightly catch-up recorded "Page live" from it, and a member could delete a private "Page live" so it was recorded again. Reproduced first: the new tests fail without the migration.
- **Database.** Migration `0090_page_dates_recorded`:
  - For a signed-in client the database writes `published_at` when a page goes live and `unpublished_at` when it is taken down, from its own clock, whatever the client sent. Neither moves otherwise, and a row that was never published holds no date. The service connection keeps the dates it writes (seeds, backfills).
  - No signed-in client deletes a milestone the platform recorded, shown or not. A founder hides or archives one. A note without a key is deleted as before. Deleting a business still removes its milestones.
  - Rows written earlier: a date on a page that never went live is cleared, and a date in the future becomes the moment of the migration (or of the take-down, when that is earlier). A date in the past stays (it cannot be told from a real one).
- **Repo.** `repos.pages.publish` and `unpublish` are unchanged in what they do; their `at` is for the service connection only and says so. The api reads the date back from the row, as before.
- **Tests.** db `rls/project-pages` (26) and `rls/public-milestones` (21): a client's date is replaced on every route (the repo, a direct insert, a direct update, with another change, on a draft, on a page taken down), for an owner and an admin; a member is still refused; another business's people reach nothing; the full route from the report (delete, backdate, re-insert, the catch-up) ends with the real date on the page, the milestone and the story; business deletion on the service connection. api `pages` and `milestones-show`: publish and take-down still work, "Page live" gets the page's date, and an owner writing around the api moves neither.
- **Verified.** Typecheck of db and api; eslint on the changed files; vitest: db 2003 (13 skipped), api 1076 (3 skipped) (the full suites); banned-terms, us-english. **Playwright ran:** `project-story.spec.ts` and `public-page.spec.ts` (10 passed) against the PGlite stack. A security review of the two trigger functions found no route around them; its one point (the earlier rows above) is in the migration.
- **Checked on a real Postgres** (16.15, a local cluster with the Supabase roles and the `auth` stub; not PGlite), after the pull request opened: every migration then on the branch, through the public milestones (now 0089), and then this one (now 0090) apply; 30 of 30 cases pass through `set local role authenticated` with JWT claims, as PostgREST connects. They cover the hole before 0090 and the repair of earlier rows, the dates on insert, update, upsert and take-down, "Page live" accepted only with the page's own date as the driver reads it back, the delete rule, another business's owner, and `fm_purge_business` as `service_role`. Not checked on the production database itself, where the migration role is `postgres` without superuser.
- **Not done.** `published_by` is still what an owner or an admin writes (not public; the audit row names who published). The migration number and its journal `when` are final only when the network branch is rebased for its merge. No screen changed, so no story and no new Playwright spec.

## docs/DECISIONS.md (added after main's last entry)


### 2026-11-12 — The network specification (docs/NETWORK.md): the calls made, all open to the founder

A proposal, not a decision record of the founder's: these are this session's judgment calls in writing it, and each is listed as a question in the document's section 14.

- **"Solo is complete" is read as a rule about partnering, not about other people.** The Nov 11 rule hides People and withholds suggestions of people from a founder building alone. The specification keeps that for everything that puts a person on a project (open roles, suggestions, the matcher) and gives every member the layer it calls alongside: a feed of what others shipped, four signals, asks, the weekly page, and a cohort offered once. Why: without it the main user has nothing to return to between outcomes and no response to their own work, and none of those surfaces says or implies that someone is missing. Considered: the whole network opt-in. Rejected for the recommendation because it leaves the solo founder, who is most of the product, outside the loop that holds people.
- **Growth is carried by loops a solo founder starts for their own project** (the page as storefront, feedback links, cards, the weekly page). Loops that need a second person (invitations, group links, open roles) are added on top. Why: the product has promised never to push a founder toward a partner, so its growth cannot depend on doing so.
- **A weekly "Shipped this week" page is proposed although leaderboards were removed.** It has no positions, no counts on tiles and a shuffled order; it lists every visible project with a real outcome that week. It is the north star shown as a place. If the founder reads it as a ranking, it goes.
- **No score of a person anywhere:** no ratings, stars, levels, points or follower count on a person; "Built with" is one positive line shown by consent. A project may show its followers.
- **The feed ends** ("You're caught up"). An endless feed would raise visits and pull against the north star.
- **Names avoid words already taken:** "build hours" (not "live sessions", which are the agents'), "starting points" (not "playbooks", which are standing rules), "the cohort's week" (not "board").
- **Money between members is out of scope** (paid help, bounties, tips), and so is advertising a share of ownership. Help is thanked with a small credit from Foundmill, capped, on the asker's word.
- **The daily streak stays the only streak.**

### 2026-11-12 — The founder's answers to docs/NETWORK.md §14

Fifteen of sixteen answered, from lettered options; they supersede the "all open" entry above where they differ. `docs/NETWORK.md` is revised to match and is now the plan for the network side.

1. **The network is open to everyone, a founder building on their own included.** The founder: "Nobody should be excluded from the network features, and solo founders should certainly have the opportunity to network on the platform in order to potentially find cofounders, or if not, then at least get great advice and find people going through similar challenges." Reading with "Solo is complete": the feed, signals, asks, communities, cohorts and Find people are there for every member; what stays the founder's own step is being suggested a person to partner with, and nothing counts or rates one person lower.
2. **The mark is "Built on Foundmill":** small and unobtrusive, more noticeable to a project's own visitors than to Foundmill members, removed completely on paid plans. **Judgment calls:** the answer was typed "Build on"; taken as "Built on" and kept in one constant. "More noticeable to visitors" is done by placement, not size: the mark lives on the visitor's path (a footer link that lights once at the end of the page for a signed-out visitor, a line after they follow, the foot of the confirmation email and page, the corner of the link preview) and stays off the founder's (plain dim text when signed in, shown once in the preview, never repeated in the console).
3. **No "Shipped this week" page:** it reads as a ranking.
4. **No public counts, on a person or a project.** Judgment call: read widely (no count on a post, no totals on the record, "started from this" told privately). A founder sees their own numbers.
5. **An answer on a feedback link is never a real outcome.**
6. **Credit for helping: yes,** capped per week, at most one credited answer per ask, amounts once cost is measured.
7. **The waitlist stays plain and ordered by referral.** No admission in weekly cohorts, no invite passes. Judgment call: cohorts themselves stay, as part of the layer opened in answer 1.
8. **The feed keeps scrolling.** This session had recommended a feed that ends; declined.
9. **Message requests from non-connections: yes,** attached to a role, an ask, a shared cohort or a suggestion, limited for new accounts.
10. **Built with: yes,** positive only, by consent, no ratings of people.
11. **Sharing: the founder taps Share each time.**
12. **Others teaming up appears in a solo founder's feed** as any milestone, never larger, no call to action beside it.
13. **A group call in build hours: open.** The founder asked what it means.
14. **Identity: proven links now;** an identity check only if scams appear.
15. **The names stand.**
16. **Build wave 1 first:** attribution and events, the mark and the story, cards, feedback links, invitations, credit for bringing people.

### 2026-11-12 — The "Built on Foundmill" mark: the calls made

- **Which plan decides.** The project's own plan (`businesses.plan_tier`), not the owner's highest plan across projects. A mark is about one page; the simpler rule is also the one a founder can predict.
- **The public view stays as it is.** `public_project_pages` exposes no plan and its test forbids `plan_tier`. The api reads the plan with a join through the view on the service connection (as it reads the logo) and gives out one boolean. A visitor can see the same fact by looking at the page.
- **"A member" means signed in to Foundmill, any account**, not only the project's own people. The founder asked that it be less noticeable to "our own Foundmill users"; a member already knows where the page was made.
- **The lift is opacity, never a glow.** DESIGN forbids glows on text. With reduced motion, without scroll timelines, or on a page that does not scroll, the mark rests at full, so it never stays below the contrast floor.
- **Words only in the confirmation email and page.** The email was security-reviewed around having one link in its body; a second one would compete with "Confirm". Ingest does not know the web's address either.
- **The link goes to the home page until the story exists** (`/p/<slug>/story`, the next package), carrying `?via=p.<slug>`.
- **The person page keeps "Made with Foundmill" for now.** Open question for the founder: a person has no plan to remove it by.

### 2026-11-12 — Working beside the other sessions; three answers relayed from the founder

The session the founder set up to keep the Foundmill sessions aligned wrote to this one. Recorded here as it was relayed; the founder gave these in that session, not in this one.

1. **The mark reads "Built on Foundmill"** (not "Build on"). Matches what was built.
2. **One exception to "Plans differ by agent work only": the mark alone.** The founder told this session directly that the mark is "completely removed for paid plans"; the alignment session relayed that it is to be written into the CLAUDE.md rule itself, scoped to the mark, so no later session reads it as a precedent. Done in this change.
3. **This session owns invitations (THESIS 3.1) and the referral-ordered waitlist (the waitlist half of 2.2).** The roadmap session keeps Google sign-in, small screens (2.1) and the home for a person with no project (2.4). The sign-up and access code (`apps/api/src/auth.ts`, `services/access.ts`, `/login`, `redirects.ts`) is not touched here until the Google sign-in change ([reidjxn/foundmill#82](https://github.com/reidjxn/foundmill/pull/82)) merges; invitations and the waitlist are built after a rebase onto it.

Consequences taken here:
- **Migration numbers.** 0082 (Team call) and 0083, 0084 (retention) are taken on branches that merge first. This branch uses 0085 (`attributions`) and 0086 (public milestones), with journal `when` values after 1796128080000, and renumbers in order at rebase.
- **`docs/mobile` is the mobile session's.** The one sentence this branch had added to its backend skill is taken out again; the new shapes (`mark` on `page.get` and `publicPage.bySlug`, and the story and card procedures when they merge) are sent to that session instead.
- **Email about people (NETWORK F20) rides the retention work:** new kinds on its one sender (`POST /v1/notify/email`, `EMAIL_NOTIFICATION_KINDS`) and its one preference map, inside the founder's limit of three emails a day per person. No second channel.
- **Build hours never reuse "Call" or `/calls`,** which are the founder's calls with agents (Team call). A call between people would need a real-time vendor of its own (NETWORK §14, question 13, still open).
- **Message requests from people you are not connected to (NETWORK F17) get their own security review before merge.**

### 2026-11-12 — Two more answers from the founder (in this session)

1. **A person's page carries no mark at all.** The founder: "Not on the person page it should not carry the mark at all, only on the product they build (unless they are a paid user of course)". Done: `/u/<handle>` loses its footer ("Made with Foundmill") and its share image loses the words; the mark stays on a project's page on the free plan only. The share image's alt text still says the profile is on Foundmill, which is a description for screen readers and not a mark.
2. **A private, person-level event store is built before wave 2.** Events today belong to a project and are read by its members (`events.business_id` is required), so facts about a person (a sign-up brought by a page, a follow, a signal, an ask) have no place to be written without showing the person to a project's people. Until it exists, attribution is a row and its declared event writes nothing. It takes migration 0087 and is built once the attribution change has merged into this branch, because it changes the same files.

### 2026-11-12 — Sign-up attribution: the calls made

- **Nobody reads an attribution row but the service**, the person it is about included. Who referred them and which project it was are not theirs to read (a page or profile can be taken down), and a client that could insert could credit anyone.
- **Recorded on the save that creates the profile**, not at account creation: that is the moment a visitor becomes a person, and it keeps this change out of the sign-up code another session is changing.
- **The credit for a project page goes to its longest-standing owner.** With several founders, sharing the credit is a question for the credit package (F6), not for this record.
- **The reference reaches the api through the page, not the cookie.** The save is a browser call to the api, which the web's cookie does not travel with. The server reads the httpOnly cookie and passes the parsed reference as a prop. Routing the whole save through the server was rejected: any signed-in client can send any `via` anyway, so it adds no integrity, and it would have changed the save's error handling.
- **No event row** until person-level events have a home (the founder's decision of the same day).

### 2026-11-12 — Merge order and migration numbers (from the alignment session)

Order into main: retention (0083, 0084), Google sign-in (no migration), then the person-level event store on its own branch `claude/account-events` (**0085_account_events**), then this network branch (**0088_attributions**, **0089_public_milestones**). Supersedes the numbers in the two entries above (attributions was first 0085, the event store first 0087). A number and its journal `when` are final only at the rebase just before a merge: the next free number after main's last migration, with a strictly later `when`, because the migrator skips an entry older than the last one applied. Whoever merges out of order renumbers and says so first.

### 2026-11-12 — Build hours: text and presence first (founder, NETWORK §14 question 13)

The founder: "text and presence first, voice and video later". Version one of build hours is who is there, a shared clock and text. Hearing and seeing each other comes later and needs a real-time calling vendor behind the gateway (not the speech connector Team call added, which is the founder talking with agents). With this every question of `docs/NETWORK.md` §14 is answered.

### 2026-11-12 — Tap-to-post sharing (relayed from the founder by the alignment session; to be confirmed here)

Relayed as the founder's decision, given in the alignment session and not in this one: tap-to-post is the default way a project posts to social networks, and this session builds it in wave 1 after attribution and the cards.

- **What.** For a drafted post (a milestone card, a real outcome, a page going live, a draft from the social channel agent): one button per network that opens that network's own share window with the text and link filled in; the founder presses Post there. Where a network takes no pre-filled web post (Instagram, TikTok): "Copy text", "Open the app" and the image to download. On a phone, the device's own share sheet where the browser offers it.
- **No API, key, developer app or cost.** Foundmill posts nothing, so the founder's own tap is the only approval.
- **Honesty.** A tap on Share is not a published post: it is recorded as a share, never reported as posted, and never a real outcome for the north star unless a visit comes back through the link. Every shared link carries the `via` reference.
- **One draft shape** in `packages/shared` (text, link, image, per-network variants), agreed with the connectors session before either adds it, so the same draft can be shared by tap or published through its optional connector.
- **Open point for the founder (this session's):** the relayed text says sharing makes the social channel "available" on the Channel Board with no connector. The Nov 11 rule is that the Board shows only channels that can really act. A channel the founder posts for by hand is a different state from one an agent can publish to; the Board should say which ("You post it" beside "The team posts it"), not show them as the same.

### 2026-11-12 — Tap-to-post: confirmed by the founder here, with the test for "available"

The founder, in this session: "the only by-hand part of the social post should be clicking the button to actually post it, nothing else should be required by the user. If that's the case, the social channel is available". This confirms the relayed decision above and settles its open point.

- **The test.** A network is available through tap-to-post only where the draft arrives filled in (text and link, with the image carried by the link's preview card) and the founder's one action is pressing Post in that network's own window. Then the social channel shows as available on the Channel Board with no connector.
- **What does not pass.** A network that takes no pre-filled post (Instagram and TikTok today), where the founder would have to copy text, open the app and attach an image. Those keep "Copy text" and the image as a help, and do not make the channel available by themselves. Judgment call: they are offered, never counted.
- **Consequences for the build.** Nothing the founder has to type, paste, pick or attach: the text, the link with its `via` reference and the preview image are all ready before the button is shown; a draft that is too long for a network is fitted to it beforehand, never left for the founder to trim. Each network's share address is checked against its current format before it ships, and a network whose share window stops taking pre-filled text loses "available" until it does again.
- **Honesty, unchanged.** Opening the share window is recorded as a share. It is never reported as posted (Foundmill cannot see the press), and it counts toward the north star only when a visit comes back through the link.

### 2026-11-12 — Milestones in public: the calls made

- **Only "Page live" and "First follower" can be shown for now.** This session's call, confirmed by the founder on Nov 12 ("Yes confirm the milestone rule"). The story says "Foundmill recorded each of these when it happened. None was typed in." That is true of a milestone recorded from one real outside event. It is not yet true of a customer milestone (counted from conversions, which on a deployment running mock integrations may not be real payments) or a revenue milestone (an Estimate: three months of revenue divided by three). Showing those as "Verified" would break the honesty rule and the rule that every non-real number is labeled. They become showable when each is tied to a real payment. Held in three places: the api, the console (no control is offered) and the table's guard trigger.
- **A guard trigger on `milestones`** (the build's call, kept): the table let any member write any row, which was harmless while nothing public read it. Now a client cannot insert or alter a platform-recorded milestone, and only an owner or an admin shows or hides one.
- **Public words come from the key, never from a stored label**, so a label that ever carried a customer's name cannot leave.
- **A shown milestone stays chosen while the page is down** and returns when the page is republished; the console says "Shown when your page is live". The stricter reading of "the founder taps each time" would reset it on take-down; say if that is wanted.
- **The card's `via` names the project page** (`p.<slug>`), not the card: one reference kind per public thing a person can be credited for.
- **The foot follows who is looking**, as on the project page: a signed-in member sees the sentence without the "Start your own" link.

### 2026-11-12 — The optional publishing connector is Buffer (founder, in this session)

The founder: "Yes so let's go with Buffer." Tap-to-post stays the default way a project posts and needs no connector; the connector is for founders who want scheduling. Buffer was recommended because its free plan includes the API (three channels, ten queued posts per channel, a personal key), which fits a connector that runs on the founder's own key. Those figures come from third-party comparisons, not from Buffer's own documentation: the connectors session, which builds it, confirms the current API, the free plan's limits and that a personal key is enough before building. Passed to that session. The post-draft type in `packages/shared` is still to be agreed with it before either side writes it.

### 2026-11-12 — The person-level event store is open as its own pull request

[reidjxn/foundmill#86](https://github.com/reidjxn/foundmill/pull/86), branch `claude/account-events`, migration `0085_account_events`. Security-reviewed before it opened; three findings fixed (account-scoped types could be written into `events` at the database; a handle containing an id could block taking a profile down; the account-id check caught one spelling only). It adds one check constraint to `events`. It merges after retention, then this branch rebases onto it and `signup.attributed` is written through it.

### 2026-11-12 — Tap-to-post: the calls made in building it

- **"Available" and "the team runs it" are two different facts.** By the founder's test the social channel is available. An agent still cannot publish, so the channel engine never starts for it, nothing is scheduled or measured, and no result can be invented. The Board says which: "You post it".
- **A network is classed down, never up.** LinkedIn has an undocumented address that fills in text "usually"; it is not used, so LinkedIn opens with the link only. Reddit fills a title and link but the founder must pick a community, so it is not one press and does not count. Three networks pass the founder's test today: X, Threads and Bluesky.
- **Social starts off the board** on a real project: available, and the founder puts it on. To confirm with the founder.
- **No drafts from the social agent on a real project yet.** Stopping the engine for a by-tap channel also stops its drafting. The share panel works from the deterministic drafts (a milestone, the live page). Agent-written drafts are the next piece, and they are what the founder described ("a post the social channel agent wrote").
- **The evidence for each network is its documentation and its signed-out answer.** No account was signed in to see a composer filled in. One check by a person on each of the three counted networks is worth doing before this is relied on.
- **A share is never an outcome.** `share.opened` is filed for measurement only; the test that pins this reads the catalogue's own words, because no code counts real outcomes yet.

### 2026-11-12 — Attribution on account events: the calls made

- **The event was split in two because the store refuses a payload that names another person by account id.** One fact for each person it belongs to, each saying only which public page or profile it was.
- **`referral.arrived` says when, and nothing else about who.** A person who gave their address to exactly one friend learns that this friend signed up. That is what being credited means and cannot be removed without not writing the event. No delay or rounding was added: the row's own time and live delivery say the same. If matching the time against something public matters, the answer is to write these late and in groups, with the credit work (NETWORK F6).
- **The attribution row outranks its events** (a savepoint, not all-or-nothing): credit is paid from the row, and it can only be written once.
- **One step for a new person**, agreed with the retention session for its idea box, so there is one moment after sign-up and not two hooks.

### 2026-11-12 — Correction: the pool wedge was not new with #86

This session recorded (in the hotfix's commit and its first description) that no pool warning was logged before [reidjxn/foundmill#86](https://github.com/reidjxn/foundmill/pull/86). That was wrong: the search matched the log's message text, and the count is in an attribute. One warning was logged at 15:49 UTC on Nov 12, before #84 and #86, and a 10-procedure request hung for 45 s at 15:56. The retention session's reading of the logs stands: single requests that open 8 to 10 transactions saturate the pool of 10, client aborts under saturation lose connections in the driver (the 2026-10-19 pattern), and the account relay made it worse without being the root. What stays true: no watchdog exit and no slow shutdown before #86; continuous warnings and two exits after it. The relay stays off until the pool fix (the retention session's) is on main, then returns folded into the business relay's tick, with a bound on how long a stopping relay waits for a tick.

### 2026-11-13 — The team's post drafts: the calls made

- **Putting social on the board is the founder's "write posts for me".** Off the board, nothing is drafted and nothing is spent.
- **A hard cap, counted against attempts.** Two a day and five a week per project, so a run of refused drafts cannot spend credits either.
- **"A first of a real outcome" is the first follower only**, for the same reason only two milestones can be shown: a customer or revenue first is counted or estimated, and a post about it would not be honest yet.
- **One stored text.** The share panel has one field, and a per-network copy would not follow the founder's edit; the model's shorter version is used only where the text is too long for a network that opens ready to post.
- **No migration:** a draft is a row of the existing kind the Creative screen lists, with the trigger in its reference.
- **Nothing polls.** After the pool problem of Nov 12 no new loop or timer was to be added on the api; drafting starts from the request that caused it.
- **The eval exists and has not run.** Until it has run with a key, the claim is "the check refuses a bad draft", not "the agent writes a good one".

### 2026-11-12 — A page's dates are the database's to record: the calls made

Migration `0090_page_dates_recorded` (the open point of the milestones entry above). All this session's calls.

- **A date a client sends is replaced, not refused.** For the client roles the guard writes `published_at` and `unpublished_at` from the database's clock and keeps them where nothing happened. Refusing a write whose date differs was rejected: the api's own write always carries a date (its own clock on a first publish, and on "publish changes" the value it read back, which a client holds to the millisecond only), so an honest publish would be refused. Who may publish is still checked first, on what the client sent: a member who sends a date is refused as before.
- **Kept to the millisecond.** `now()` truncated to milliseconds, so the date a client reads back is exactly the date stored. The milestone guard accepts a signed-in client's "Page live" only when its date equals the page's; with microseconds in the column that would depend on how each driver rounds.
- **A row that was never published holds no date for a client.** The nightly catch-up awards "Page live" to any business whose page row has a `published_at`, so a draft row written with a date would have earned the milestone without ever going live. Closed in the same trigger.
- **`at` stays on `repos.pages.publish` and `unpublish`, for the service connection only.** A seed or a backfill must be able to keep an original date, and the trigger does not limit that connection. For a signed-in client `at` is ignored by the database. Tests that need a known date publish on the service connection; tests of the client path send a date and assert it is not the one stored.
- **No client role deletes a recorded milestone** (`ref.trophyKey`), shown or not, owner included. After the date fix a delete could no longer bring back a typed-in date, but it could still move a real one (delete "Page live", take the page down, put it back up: the milestone returns with the later date), and a revenue milestone recorded under the earlier rule would be worked out again under the new one, against the entry of 2026-11-11 ("never rewritten"). Nothing in the product deletes a milestone; hiding and archiving remain. Business deletion is unaffected: `businesses` has no delete policy for a client role, and `fm_purge_business` is security definer, so its cascade reaches the trigger as the function's owner. A test covers both.
- **`fm_milestones_guard` is replaced in 0090, not edited in 0089**, although 0089 is not on main yet: a database that already ran 0089 would not get an edit.
- **Left as it is:** `published_by` is still what an owner or an admin writes (it is not public; the audit row names who published). A row written before 0090 with a date in the past keeps it: a backdated one cannot be told from a real one, and the public pages are days old.
- **Two kinds of earlier date cannot be real, and the migration puts them right** (found by the security review of this change): a row that was never published and never taken down but holds a `published_at` (the product never wrote one; the catch-up would have recorded "Page live" from it) loses the date, and a date in the future becomes the latest moment the page can have gone live (the migration, or its take-down when that is earlier). Milestones are not touched: 0089 is not on main, so no "Page live" was recorded from such a row outside a development database.
- **Number.** 0088, journal `when` 1796129280000, on top of the network branch (`claude/bold-johnson-hjxopx`, 0086 and 0087), which is not merged yet. It renumbers with that branch at the rebase before the merge (the merge-order entry above).

### 2026-11-13 — The network branch after main and #101: numbers, sections and the privacy rows

Main gained #94, #95, #97, #98 and #85 while this branch was open, and #101 merges ahead of it. Merged in (not rebased: the pull request is open).
- **Migration numbers, final for this merge.** `0086_idea_drafts` (#98, idx 74) and `0087_client_grants` (#101, idx 75) keep theirs. This branch's three follow: `0088_attributions` (idx 76, `when` 1796128560000), `0089_public_milestones` (idx 77, 1796128620000), `0090_page_dates_recorded` (idx 78, 1796128680000). Supersedes the numbers in the entries above; historical lines that say what a number was at the time are left as written.
- **The view follows 0087's rule.** `0089_public_milestones` revokes from `public, anon, authenticated, service_role` before granting SELECT to `service_role`, so on Supabase the service role holds SELECT only, as 0087 left `public_project_pages` and `public_person_profiles`. This branch adds no security-definer function a client role can call (its three functions are triggers or plain SQL), so the structural list of #101 is unchanged.
- **docs/DESIGN.md sections.** Main's §9d (the Terms and the Privacy Policy) and §9e (the idea box) keep their letters, since main's own text points at §9d. This branch's story and cards become §9f and its share panel §9g, with every reference moved.
- **The Privacy Policy's rows.** The policy (#97) lists the cookies the site sets; this branch sets `fm_via`. It is listed (30 days, until sign-up), the cookie sentence says what it is for, and "How you found us" says the one fact attribution keeps and that whoever's page it was may be told someone signed up through it, never who. `legal-content.test.ts` expects `VIA_COOKIE`. `PRIVACY_UPDATED` stays Nov 13, 2026 (the same day).
- **Logs.** PROGRESS and DECISIONS keep main's entries first, then #101's, then this branch's, each as written.

## Not written to PROGRESS (the rule came first): the merge of main and #101, Nov 13, 2026

- **Merged** origin/main (#94, #95, #97, #98, #99, #100, #85) and #101 (`claude/definer-grants`) into the branch; renumbered its migrations to 0088 to 0090 (idx 76 to 78); `public_project_milestones` holds SELECT only for the service role; the Privacy Policy lists `fm_via` and "How you found us"; DESIGN §9f and §9g for the story and the share panel; the e2e tap-target checks use `expectTapTarget`.
- **Verified.** Workspace typecheck 25 of 25; eslint on the changed files (0 errors; 4 warnings in `apps/api/src/services/plans.ts` line 23, as on main); vitest: db 2182 passed and 18 skipped, api 1236 passed and 3 skipped, shared 809, stream 97, web 1404, dugout 1245, agents 465, events 130; banned-terms and us-english pass. Playwright, this branch's seven specs on a fresh PGlite stack: 12 of 13, then `project-story.spec.ts` 2 of 2 alone.
- **Found, not this branch's:** with no Temporal the api drafts a project's foundations in process on the request's gated executor (#95), so a browser that leaves before the drafting ends cancels it ("The request was closed before this part of it started", then "foundations: could not record the failure"); the page-ready note then never reaches Needs you.
