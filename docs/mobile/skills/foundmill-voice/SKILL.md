---
name: foundmill-voice
description: Use whenever you write any text a founder can read in the Foundmill mobile app: labels, buttons, empty states, toasts, errors, onboarding, notifications, App Store copy. Carries the product vocabulary, the banned words, the US English rule and the tone of voice. Run every string you write against this file before you ship it.
---

# Foundmill voice and vocabulary

## 1. The product's words (always)

- The product is **Foundmill**. What a person runs is a **project** until its first sale and a **business** after (in the app's own sentences; text the API writes is left as it comes). The person who runs it is the **founder**; one person is complete (never a line that says or implies they need someone else), and where several people run it they are its founders.
- The AI agents are the **team**. The humans of a business are its **People**: **cofounders** (equal standing, any number) and **collaborators** (limited access). Never "staff", never "seat", never a limit on people (founder, Nov 11, 2026).
- **Subtext, never text.** Nothing a person reads says or implies "do this instead of getting a job". Say ownership ("something that is yours"), capability ("what you can do now") and, as an offer, company ("people to build it with, if you want them"). Never jobs, employment, unemployment, careers, "9 to 5", "laid off" or AI taking work as the reason to be here. An agent's job, a job title on a contact and hiring an agent are ordinary words and stay.
- A round of agent work is a **round of work** in everything a founder reads; "cycle" is the engine's word and stays in code (founder, 2026-11-17: the product says "round of work" everywhere); round of work numbers stay in the web's Builder view.
- The agent that plans each round of work and talks for the team is the **Chief of Staff**.
- A press of **Continue** starts rounds of work that go on until nothing is left to do.
- Notes from the team land in the **Inbox**. A note that needs the founder is either a **decision** ("Needs your answer", "Your decision") or a **go-ahead** ("Needs your go-ahead", "Waiting for your go-ahead"). Those are the only two families of "needs you" words.
- The business's mark is its **logo**. Its colors are its **brand colors**.
- Three months of the business's life is a **chapter**.
- A converted customer is a **win**. The replay of how it happened is a **Customer Update**, at one of three levels: **Brief / Standard / Featured**. Its stages are **Who was involved → First touch → the touches → Win moment → Debrief**. The best contributor is the **Standout agent**; the channel that mattered most is the **Lead channel**.
- The eight celebrated firsts are **Milestones** (First customer, 10th customer, 100th customer, 1,000th customer, First $1K MRR, First $10K MRR, First $100K MRR, First enterprise contract; the currency follows the business).
- Where channels run is the **Channel Board** (tab name **Board**). Channels are **on the board** or **off the board**; you **put a channel on the board**. The four channel families are **Acquisition / Engagement / Organic / Offline**.
- Watching agents work is **Live sessions**. The plan's dependency view is the **Task graph**.
- A short message pushed to a working agent is a **Nudge**.
- An agent that cannot work because a credential lapsed or errors repeated is **Down**, always with an "expected back" time. **Paused** is a choice, never a fault.
- The founder's away mode is **Vacation** ("On vacation until Oct 21"; the button to end it is **Come back**).
- Agent pay is **Payroll** (Finance tab). AI cost is "AI usage (USD)".
- The founder's one-sentence target is the **goal**. Tests are **quality checks**. "PR" means public relations, never a pull request (say "merged change").
- The Team department's tab of agents is **Agents** (never "Team › Team"). The founder's areas are **Plan, Customers, Money, Product, Team**; the legal module's tabs are the **Company** section of Money and its first tab is **Company**. Development's tabs read **Working now**, **Work list**, **What changed**, **Live product**; Finance's P&L tab **Profit and loss**; Distribution's board **Board**.
- The help control on every screen is **Ask <Chief of Staff's name>** with the three questions **What's happening?**, **What's blocking us?**, **Why am I seeing this?** and the row **Ask something else…**.
- A seeded business is a **Sample business** (its caption); "Demo" is not shown to a founder.
- The first-run screens are **Before you start** (the founder profile) and **Welcome aboard** (the confirmation).
- Training, coach, form, recruitment and wage are fine: they are ordinary words for a team of agents.

## 2. Banned words (never in anything a founder reads)

| Never | Use instead |
| --- | --- |
| squad | team |
| club, club rules | business, house rules |
| crest | logo |
| shout | nudge |
| formation, formation board, bench, "walk onto the board" | Channel Board / Board; task graph; off the board; put on the board |
| training ground | Live sessions |
| captain | Lead channel, Standout agent |
| assistant manager | Chief of Staff |
| scouting report | Import report |
| form guide | Channel performance |
| league, league table, league position, leaderboard | nothing: the leaderboards feature was removed on Nov 11, 2026 and is never shown |
| match, match day, match commentator, cup tie | Customer Update, win, narrate |
| kick-off, team sheet, goal (as a sports event), full time, player of the match, whistle, half-time, line-up | First touch, Who was involved, Win moment, Debrief, Standout agent |
| friendly / league / cup (update levels) | Brief / Standard / Featured |
| pitch (the board) | Board |
| attack / midfield / defence / wings | Acquisition / Engagement / Organic / Offline |
| kit, kit colours, kit mode | brand colors; offline tracking |
| trophies, trophy cabinet | Milestones |
| player card, player attributes | profile card, attribute ratings |
| injured | down (with "expected back") |
| season | chapter |
| holiday (the away mode), "on holiday" | vacation, "on vacation" |
| wage bill | Payroll |
| dugout | the design system (never shown) |
| manager, game, play, score a goal, win the match | founder, business, run, win a customer |
| staff, seat, seats | People; cofounders and collaborators; never a count of seats |
| round of work N, "cycle" (to a founder), tokens, PR #N, "N tests passed" | round of work, some AI usage, a finished change, the quality checks passed |
| job, jobs, employment, unemployment, career, "9 to 5", laid off, "AI taking work" (as the reason to be here) | something that is yours; what you can do now; people to build it with |
| demo (as a chip or caption) | Sample business |
| "Keep my day job for now" | "Fits around what I already do" |

Allowed in their ordinary sense: "full-time" employment, "holiday season" / "tax season", "elevator pitch" / "pitch deck", "company formation", a "book club" in CRM data. Code identifiers may keep old names (`matchday_level`, `holiday`, `injured`, `squad` slugs); display text never does.

Also never say to a founder: policy, caps, engine, hard gate, RLS, Cedar, webhook, OAuth, BYOK, CAC, ICP, COGS, unit economics, hunk, triage, exhibit, named query, concurrency, counterparty, time box. Say the plain thing ("the team asks before spending over £50", "a change the team proposed", "the cost to win a customer").

## 3. US English, US dates

American spelling in everything a founder reads: color, organization, judgment, center, behavior, labeled, canceled, catalog, program, license (noun), defense, gray, enroll, fulfill, analyze, favorite, while (not whilst), among (not amongst), learned, toward. "Postal code", "percent", "every two weeks" (not fortnightly), "public holiday".

Dates: `Oct 7, 2026` · `Oct 7` when the year is implied · `Wed, Oct 7` · `Oct 2026` · ranges `Oct 7 – 21`. Times: `3:45 PM`. Numbers: en-US grouping (`1,240.50`). Money keeps the business's own currency with its narrow symbol: a GBP business shows `£1,240.00`, a SEK business `kr 1,240.00`. A business's real-world facts keep their form (GBP, VAT, "Ltd"). Relative times are fine ("2 hr ago", "in 5 days").

## 4. Tone of voice

Plain, specific, short. Sentence case everywhere: buttons, tabs, titles, labels. No exclamation marks, no "Oops", no "Awesome", no emoji, no sparkles. Numbers carry units; non-measured numbers carry **Estimate** or **Forecast** spelled in full. Empty states say what will appear and how to make it happen.

Nine rules:

1. **The business thing, then the system thing.** "Approve batch 002 before the Ireland launch?" before "This holds Continue."
2. **Define on first use, in the sentence.** "Runway, how many months your cash lasts, is about 8 months (Estimate)."
3. **Plain verbs, no plumbing.** Never "policy", "caps", "engine".
4. **Say why the recommendation is recommended.** "Recommended because it is free and reversible."
5. **Short enough to skim.** Agents write under 180 words. The app's own lines are one sentence.
6. **Reassure only where true.** "Nothing runs until you say go." "Nothing is deleted." Never "Don't worry".
7. **Agents are colleagues, not dashboards.** First person, specific, warm, never claiming to be human, never apologizing twice. An agent's name always has its role beside it the first time it appears: "Juno (Chief of Staff)".
8. **Every number carries a word.** "16.5 Excellent", "4 of 10", "3.5 of 5 stars", "Last 5 tasks: 4 went well".
9. **"Needs you" has two families.** Answer (decision) or go-ahead (approval). Never "action required", never "pending".

## 5. House rules the founder should see in words

Whenever the app explains what the team can and cannot do, use this exact block: "Moving money, signing, filing in your name, accepting terms, deleting for good and changing security settings always come to you. Nothing on this page changes that."

The "what the team can do" chip reads, in the business's own currency: "Asks before spending over £50" (short "Asks over £50"), "Asks before any spending", "Asks before acting" (short "Asks first"), "Decides alone, asks over £1,000". Never a mode name (augmented, assisted, automated) in the UI.

## 6. Strings the app must use verbatim

- Continue tooltip (idle): "Let the team work until nothing is left to do. Their notes land in the Inbox."
- Continue (blocked): "Respond · N" and "N notes need your answer before the team can carry on."
- Continue (processing): "The team is working · round 3"
- Stop all agents: "Stop all agents (pauses everything, nothing is lost)". Its confirmation starts with "Nothing is deleted."
- Inbox empty: "Notes from your team land here after each round of work. Press Continue to start one."
- Needs you empty: "Nothing needs you right now. The team keeps working."
- Goal empty: "Your Chief of Staff proposes a goal after the first round of work."
- Goal pace: "4 of 10 so far, 38 days left: on pace (Forecast)."
- Runway without a figure: "Not known yet · connect a bank". Cash-flow positive: "No limit".
- Agent down: "Down · expected back in 2 hr". Without a time: "Reconnect the integration to see an expected return".
- Background helpers: "5 background helpers also run, linking names, sorting what comes in and checking drafts. They never take tasks or write to you."
- Team caption: "Chief of Staff · 6 leads · 23 specialists · 2 need you"
- Channel Board caption: "Fit 1–20: how well a channel suits this business, scored by the Distribution Strategist. Closer to the center means a better fit."
- Attribution: "Early touches get 40 %, the last touch 40 %, the middle 20 %."
- Finance opener shape: "You have £72K in the bank and spend £9K more than you earn each month, so cash lasts about 8 months (Estimate)."
- Example business: "Walk around a running business before you start yours. Nothing you do there is saved."
- Viewer: "As a viewer you can follow this business, but not change it."
- Offline: "You're offline. Showing what you last saw." / "You're offline. Decisions need a connection."
- Not invited: "Not on the list yet. Foundmill is opening up in waves. Ask the person who invited you, or sign in with the address they used."
- Credits: "The team has stopped: credits are used up."
- Magic code screen: "Check your email. Enter the six-digit code, or tap the link in the message."
- Continue, within a second of a press: "Starting the next round of work…"; then the server's `plainHeadline` as it comes ("The next round of work started: 3 tasks ready to build", "The next round of work started: nothing is ready to build yet", "The team cannot run right now: the orchestrator is not reachable", "The round of work resumed", "The round of work is already running").
- Continue's cost line: "Last round cost $0.52 · Estimate".
- Orchestrator down (idle sheet): "The team cannot run right now: the service that runs the team's work is not reachable. A press writes one note; no agent works."
- Round paused: "The round of work is paused. Press Continue to pick up where the team stopped."
- Pause sheet: "Pause the round?" with Pause and Keep going.
- Sample business caption: "Sample business" · "Its figures are made up for the example: nothing here is real money or real customers." · for an example viewer add "Nothing you do here is saved."
- Example door: "Walk around a running business before you start yours. Nothing you do there is saved. It is a business two years in: its spend and customer figures are its own, not a forecast of yours."
- Approval without content: Reject labeled "Ask for the details"; Approve labeled "Approve anyway". No GitHub: "Connect GitHub first".
- Model account out of credit (a credits business; the note's own words): "This round's plan could not run: the model account that runs Foundmill refused its key. Our team has been alerted, and nothing was charged to your credits. Try again later." Show it as the note says it; it is Foundmill's problem, not the founder's.
- Chief of Staff with nothing to say: "Nothing is blocking the team." / "There is nothing to report yet: the team has not started, and no goal is set." / "Nothing needs you right now."
- First week: title "Your first week"; states Done / Now / Next; "Done Oct 8"; "Oct 10 – 13 (Estimate)"; stopped line "The team is stopped, so nothing moves on until you resume it."
- Area skeleton: "Reading the numbers".
- Since you were last here: "Since you were last here" · "Nothing happened while you were away."
- Live product: "No release recorded yet" · "Updated Nov 7" · "No artifact yet" · "Nothing exists outside these screens yet".
- Public page: "Your project's public page is ready to check" · "Not published yet" · "Live since Oct 7, 2026" · "Live, with changes not yet published" · "A sample business has no public page." · stages "Idea" / "Being built" / "Live".
- Streak (only from the server's count): "Back 5 days in a row". Never a flame, an emoji or "streak" as a badge.
- Revenue milestones: "First $1K MRR" only when revenue recurs; otherwise "First $1K monthly revenue".
- Idea cards: "Use my idea as written" · "Choose this idea" · "Your words" · "Sample" · "Written by you" · "Edit it in your words first".

### Empty screens (what will appear and when; verbatim)

- Needs you (first days): "Nothing needs you yet. Your first notes, the specification and the roadmap to sign off, arrive once the team finishes drafting them, usually on day 1."
- Leads, before selling: "No leads yet" · "Leads appear here once the team starts selling, after you answer “Ready to start selling?”. Each arrives with its lawful basis." After: "Qualified leads arrive here with their lawful basis as soon as Lead generation finds someone who fits."
- Campaigns, before selling: "No campaigns yet" · "Campaigns appear here once the team starts selling, after you answer “Ready to start selling?”. Each asks for your approval before it launches." After: "Each channel on the board plans its first campaign here and asks for your approval before launch."
- Contacts: "Nothing here yet. People and organizations arrive as imports run and as the team works, starting with the first leads once you answer “Ready to start selling?” Add one by hand or connect an importer to fill it sooner."
- Milestones: "Nothing here yet. Releases, decisions, incorporation, funding and launches appear as they happen; the first usually come with the first changes going live, from day 2."
- Roadmap: "Nothing on the roadmap yet" · "The Product lead turns the specification into Now, Next and Later in the team's first round of work, usually on day 1, and asks for your sign-off. You can add an item yourself any time."
- Specification: "No spec yet" · "The team drafts the specification in its first round of work, usually on day 1, and asks for your sign-off before building starts."
- Specification versions: "Nothing published yet. A version appears when you sign off the specification, when a change proposal is accepted or when you publish the current spec."
- Cash history: "Cash history appears after you connect a bank account in Settings › Integrations, and grows as transactions sync."
- Cash flow: "Monthly inflows and outflows appear after you connect a bank account, once its transactions sync."
- Bank: "No bank or revenue data yet" · "Connect a bank account (Tink or Plaid) or Stripe and the tiles fill with cash, burn, runway and revenue as soon as the first transactions sync."
- Company (entity): "No legal entity yet" · "Import an existing company on the web, or start an incorporation there; the entity's facts appear here as soon as either is done."
- Officers: "Nothing here yet. Officers appear once a company is imported or formed; each becomes a contact with the officer role."
- Compliance: "No deadlines yet" · "The calendar fills when you import a company, from its registry, or when an incorporation adds its first filings. Deadlines the legal lead records appear here too."
- Recruitment (hired): "Nothing hired yet. An agent you hire from the catalog appears here as soon as you confirm."

## 7. Push notification copy (title · body)

- "Needs your answer" · "<Agent> (<Role>): <subject>"
- "Needs your go-ahead" · "<summary>"
- "New customer" · "<Customer> just became a paying customer · £96.00"
- "Goal reached" · "<goal sentence>"
- "The team finished a round" · "N notes in your Inbox"
- "<Agent> is down" · "Expected back <time>"
- "Runway" · "<the Today sentence>"

Never put money amounts in a notification when the device is locked and the founder has turned on "Hide amounts on the lock screen" in Preferences.
