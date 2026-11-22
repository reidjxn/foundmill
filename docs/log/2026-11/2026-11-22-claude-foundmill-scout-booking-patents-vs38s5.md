---
date: 2026-11-22
branch: claude/foundmill-scout-booking-patents-vs38s5
pr: 359
title: The tool scout (Part A, #359) and booking of our own, free on every plan (Part B)
areas: [shared, connectors, agents, db, gateway, api, orchestrator, ingest, evals, events, dugout, modules, web, sites, config]
supersedes: []
---
## What changed
Founder, Nov 22, 2026: "the most important skill the agents can have is finding the right tool or connector for the founder at the right time." This is Part A of three (booking and patents follow, each its own pull request).

- **Vocabulary** (`packages/shared/src/tool-needs.ts`): 15 tool categories, 4 stages (`take_charge`, `page_drafted`, `first_customers`, `first_payment`), the note's key and options, and `regulatedAreasOf(text)`.
- **Catalog as data** (`packages/connectors/src/tool-catalog.ts`): each entry has regions, route (Foundmill's own, remote MCP, API key, link), test mode, a price band (always an Estimate) and `checkedOn`. Booking lists Foundmill's own only. Lightbringer is the patents entry.
- **`tool_need` task kind** and **`tool_needs` table** (migration 0154, RLS read-only for members, services write, cross-tenant spec in `rls/tables.ts`). One row per project per category is the dedupe and the memory: reason, pick, alternatives, sources, the answer, and `ask_again_at` for "Not now".
- **Three platform tools**: `raise_tool_need` (every agent, `tools.need`), `read_tool_need` and `recommend_tool` (Chief of Staff and leads, `tools.scout`). `recommend_tool` writes one decision note; `apps/api/src/services/tool-needs.ts` answers it in-process (Yes or Not now), with a one-press answer on Today.
- **Needs by stage**: `needsByStage` on every archetype seed, `toolNeedsAt`, and `raiseStageToolNeeds` called at take charge, the page's first draft (api and orchestrator runners), distribution start, and the first real payment (never a test-mode one).
- **Regulated money products**: `regulatedAreasOf` on the idea's title and pitch at take charge hires `financial_regulatory` into Legal, adds the Legal Lead's license question, and plants KYC and AML as `planned` rows raised at `first_customers`.
- **`tool_scout` skill** (default for the Chief of Staff and the six leads, `default_since: 2`, a new optional front matter key).
- Tests: `tool-needs.test.ts` (shared, db repo), `tool-catalog.test.ts`, gateway and api `tool-scout.test.ts`, evals `tool-scout.test.ts` (offline) and `tool-scout.eval.test.ts` (live, five cases).

## Decisions
### The founder's steps are written by the platform, never by the agent
The agent supplies the pick, the reasons, the cost and the sources. `toolRecommendationNote` writes what the founder must do from the route alone, and a catalog entry's route wins over the agent's. So text from a vendor's page cannot move sign-up, terms or payment to the team, whatever the model does with it. The cost is labeled Estimate by the same code.

### A regulated flag, not a `fintech` archetype
A new archetype touches about 130 files (labels, journey profiles, seeds, demo data). The flag is read once at take charge and leaves no column: its effect is the specialist, the Legal task and two planned rows. The specialist prepares and explains; it never files.

### `regulatedAreasOf` is keyword patterns (a shortcut)
It reads the idea's title and pitch. An unusual wording is missed, and the Legal Lead's first task still covers the rules. A project that only takes payments for its own product does not match. Upgrade to a classified field on the specification when a real project is missed.

### Memory is a table, not a file
The brief says the pick and reasons go "in the project's files". Agents read them through `read_tool_need` and through `raise_tool_need`'s answer, which says what is already decided. A table gives the per-category dedupe as a unique key and is in the account export (`portability.ts`).

### Two stages from the brief are not wired
"First hire of a person" and "first user data held" name no tool category yet, so they are not stages. Add a stage when a category needs one.

### "Not now" asks again after 30 days
`TOOL_NEED_ASK_AGAIN_DAYS`. Nothing re-raises by itself on that day: the next stage trigger or the next agent that misses the tool does.

### Catalog entries were written from what the session knew
No pricing page was read on Nov 22, 2026. The bands are coarse on purpose and the scout checks the current price before recommending. Re-check an entry and move its `checkedOn` when you touch it.

### `areas.test.ts` was red on main
#354 added the First ten tab; #348's test expected Customers to hold only `crm`. The expectation now includes `distribution/first-ten`. No product code changed.

## Not done
- The live eval (`tool-scout.eval.test.ts`) was not run: this session had no model key. The offline twin passes.
- No screen lists a project's tool needs; the note and Today's one press are the whole founder surface, so no Playwright spec or story was added.
- The Commit screen's team preview (`squadPreview`) does not show the financial regulation specialist: the preview takes an archetype, and the flag is read from the idea at commit.
- "Build it in" for software projects is instructions in the skill and the follow-up task; no new engineering tool was added.
- Part B (Foundmill's own booking) and Part C (Lightbringer, founder-executed tools) are separate pull requests. Tell Session 1 for STATUS.md.

## Part B: what changed (booking)
Founder, Nov 22, 2026: Foundmill builds booking itself, a native feature given free to every project that needs it, on every plan. There is no booking vendor. FOUNDMILL.md has the rule under "Always"; WP-08 T6's help text and BUILD.md's connector list no longer name one (a founder's own pasted link is still accepted).

- **Slots** (`packages/shared/src/booking.ts`, pure): weekly hours are wall-clock minutes in the founder's IANA zone, turned into UTC instants one calendar day at a time. A wall time a spring change skips offers no slot; one a fall change repeats offers one. `booking.test.ts` covers both changes in the US and Europe.
- **Tables** (migration 0157): `booking_settings`, `booking_services`, `bookings`. A held slot is a `bookings` row in status `held`. Members read, only services write. `public_booking_pages` is the public read (a live setup on a published page).
- **No double booking**: `bookings_no_overlap`, an exclusion constraint over the busy range (the appointment with its buffers) of held and confirmed rows of one project. `hold` and `reschedule` attempt the write and answer "taken" when Postgres refuses it.
- **The race**: `rls/booking-race.test.ts` sends 8 visitors at one slot 15 times. It sits with the tenancy suites so CI's real-Postgres job runs it on real connections.
- **Public api** (`publicBooking.*`): get, slots, hold (Turnstile, fail closed), confirm, and manage, cancel, reschedule from a signed link. **Founder api** (`booking.*`): get, save, setLive, list, slots, cancel, move, noShow.
- **Pages**: `/p/<slug>/book` and `/p/<slug>/book/manage` (390 px), and a booking block on the project page (`publicBooking.block`). Console: a Booking panel on Product › Public page, a Bookings view in Customers, upcoming bookings on Today.
- **Email**: the gateway's `POST /v1/platform-mail/booking` sends the confirmation, the reminder (24 hours before, a pass every 15 minutes) and the cancel and move notices, from the project's address, on its own day counter (`BOOKING_MAIL` in packages/config: 200 a project a day), never the outreach cap.
- **Agents**: `booking_setup` drafts the services and hours and writes one note; nothing is public until the founder turns it on. `list_bookings` gives names and times, never emails or answers.
- **Outcome**: `booking.confirmed` from the public route is a real outcome (`isRealOutcome`, `REAL_OUTCOME_PREDICATE`). A booking by a member of the project, or where results are simulated, carries `simulated: true` and never counts.
- **Calendar**: with the founder's switch on and Google Calendar connected, busy times are read (fail closed: an unreadable calendar offers no times) and a confirmed booking is added as an event.
- Tests: shared 12, db repo 16 and RLS 11 and race 2, api 18, gateway 10, orchestrator 2, dugout 20, web unit tests, `apps/web/e2e/booking.spec.ts` (a Berlin visitor at 390 px books with a Chicago founder, moves the booking, the founder cancels), evals `booking-setup` (three cases, offline twin).

## Part B: decisions
### An exclusion constraint, not a holds table
The brief lists holds as a table. One table with a `held` status lets one constraint cover holds and bookings together, so there is no window between "the hold ended" and "the booking exists". It needs `btree_gist` (created by the migration; trusted since Postgres 13; loaded into PGlite in `bootPglite`).

### The manage link stores nothing
The token is an HMAC of the booking id under SESSION_TOKEN_SECRET with its own label (`fm-booking-manage`). The gateway writes it into emails and the api verifies it. Whether the booking can still be changed is the booking's own state (confirmed, before its start), checked on every use.

### A first booking is an Update note titled "Customer Update: your first booking"
A `customer_won` item carries the thank-you decision and counts as a win in Today, which is the payment flow's. A fixed-words note without that machinery behaves correctly today. Making bookings first-class Customer Updates is a follow-up.

### A new contact from a booking has no lawful basis
Like a follower before they confirm. Setting `contract` could open agent outreach to the customer. Booking emails are transactional and go out on their own route.

### Calendar: no Meet link, and a moved or canceled booking leaves its event
`add_event` has no Meet option; `create_event` has one but invites attendees and asks the founder first, as do `update_event` and `delete_event`. So an online booking gets no Meet link yet, and the founder's note says "Your calendar still shows the earlier event". The busy read skips events the project's own bookings created, so a stale event never blocks the freed time.

### Booking stays open where platform mail is off
Follow closes without its email because the email is the confirmation. A booking stands without one; the gateway answers "not sent" and the founder still sees it.

### What the security review changed before merge
A read-only review of the uncommitted change found nothing exploitable outright and five things to fix, all fixed here:
- Reads and writes have separate per-caller windows, and the project page's block is its own route that never counts against the "closed" ceiling. Before, ordinary page views could use up the shared allowance and shut booking for every project.
- At most 10 holds run on one page at once, at most 40 bookings are made on one page a day, and one booking's link changes it at most 5 times a day.
- A slot list's calendar read is kept for a minute per project; a hold still reads fresh.
- The manage link is signed with a key derived from the shared secret, never the raw secret.
- `/_fm/book` on a project's site was removed: a site's address is not its page's address, so the redirect could send one project's visitors to another project's booking page.
Left as known limits: a booking's email address is not proven before the slot is taken (a confirm-by-email step would do it), and a booking canceled a minute later still counted as an outcome when it was made.

## Part B: not done
- **A booking link on a project's site** (`apps/sites`): it needs a lookup from the site to its project's page address. Today a site links to the booking page by its full address.
- **Deposits** (the brief's option through the founder's Stripe): not built. Prices are shown, never charged.
- **Calendar reads go through the Chief of Staff's gateway session.** If the founder has stopped the team, the read is refused and, failing closed, no times are offered while the calendar switch is on. A service route for the busy read would remove that coupling.
- The live eval (`booking-setup.eval.test.ts`) was not run: no model key in the session.
- Outlook and iCloud calendars, several people, group classes, recurring sessions and packages: later, as the brief says.
- The Today strip was not looked at in a real browser at 390 px with a booking in it.
