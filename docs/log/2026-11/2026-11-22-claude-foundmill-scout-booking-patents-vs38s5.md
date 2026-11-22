---
date: 2026-11-22
branch: claude/foundmill-scout-booking-patents-vs38s5
pr: 359
title: The tool scout (#359), booking of our own (#363), and patents through Lightbringer with founder-executed tools (Part C)
areas: [shared, connectors, agents, db, gateway, api, orchestrator, ingest, evals, events, dugout, modules, web, sites, config, policy]
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
- **Tables** (migration 0161): `booking_settings`, `booking_services`, `bookings`. A held slot is a `bookings` row in status `held`. Members read, only services write. `public_booking_pages` is the public read (a live setup on a published page).
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

## Part C: what changed (patents through Lightbringer, founder-executed tools)
Founder, Nov 22, 2026: connect the Lightbringer MCP so a founder links their own Lightbringer account and the team prepares patents with it; a hard-gated action may run from the founder's one explicit press on the exact payload, through a founder-executed tool, and never from an agent. FOUNDMILL.md has both: Lightbringer in the line of approved OAuth clients, and the founder-executed rule.

- **The real tool list was read before building** (server `lightbringer-mcp-server` 4.27.0, 51 tools, Nov 22, 2026; `tools/list` answers without sign-in). `lightbringer_mcp` is a `RemoteServer` with Foundmill's own policy for each listed tool, a recorded mock, scopes `mcp:read mcp:write` (never `mcp:trade-secrets`), and `live: false` until `LIGHTBRINGER_MCP_CLIENT_ID` is set.
- **Policy**: reading the portfolio and drafting or checking a disclosure run; anything that reaches Lightbringer's people or changes what others see asks first in every mode (a new `askAlways` hint and policy, because the existing hints did not force an ask in automated mode); permanent deletes and inviting members are hard gates; `request_patent_preparation` is founder-executed.
- **Founder-executed tools**: a `founderExecuted` hint. Such a tool is in no agent's tool list, and every session-token call to it is refused before scope. The gateway runs it only at `POST /v1/founder-actions/execute`, from a press token minted by the api for one call, valid for at most five minutes, bound to a hash of the exact payload the founder saw.
- **`founder_actions`** (migration 0163): the prepared request, its payload and hash, what the note showed, who pressed and when, and the result.
- **The press**: an agent prepares (`prepare_founder_action`, typed facts only) and one Needs you note shows exactly what the press does. Only a founder of the project can press it, in the console. Vacation auto-decide, the email one-click answer, Today's one tap and delegation can never answer it. If the invention changed after the note was shown, the request is voided and a new note is written.
- **When it is offered**: hardware already needs `patents_ip` before its first public showing; any project whose idea describes an invention (`describesInvention`) gets the same need planned at take charge.
- **Skill** `patent_preparation` for the Legal Lead (defaults release 4; release 3 is the CLI-Anything skills). **Evals**: a patent offer before the launch post, no agent reaching the request tool even when a document says to, and injections inside portfolio documents; each with an offline twin.

## Part C: decisions
### Lightbringer's MCP cannot file or pay, so the one press asks Lightbringer to prepare the filing
The brief describes one press, "File this patent for $X", that submits and pays. The real tool list has no tool that files a patent and none that pays or quotes a fee; the server says payments and paid terms need a human handoff on its side, and that `request_patent_preparation` "does not itself complete preparation, file a patent or pay for services".

So the founder-executed tool is `request_patent_preparation`: the press tells Lightbringer, in the founder's name and from the founder's own account, to prepare this invention for filing. The note says what the press does and does not do, and shows no dollar figure because none exists to show. Filing and payment then happen between the founder and Lightbringer.

This is the founder's to confirm; the pull request is a draft until then.

### Inviting members is a hard gate, not ask-first
Its name matches a hard-gate stem and it changes who can see the founder's inventions. The rule was kept rather than excepted.

### The Legal Lead is granted reads, drafting and the preparer only
The ask-first tools exist and can be granted; adding them all pushed the Legal Lead past the tool budget the orchestrator's test enforces.

### Preparing is a platform tool with an allow-list of one pair
`prepare_founder_action` accepts only (connector, tool) pairs that are founder-executed. It reads the invention through the gateway as the calling agent and keeps only typed facts: the id, the title as a quoted label, the reference and a content hash.

### What the security review changed before the draft was opened
An independent read-only review found no way for an agent alone to run the request, and two requirements that failed. Fixed here:
- A custom MCP server pointed at Lightbringer could reach the request behind an ordinary ask. Now any connector's unlisted-tool call is refused when its name, folded to letters and digits, is a founder-executed tool's, and a host that has a Foundmill list cannot be connected as a custom server.
- An admin could press and a cofounder could not. Now only an owner or a cofounder can, checked in the api and again in the gateway.
- A request that may have reached Lightbringer is never reported as "Nothing was sent": a third result, `unknown`, answers the note with "check in your Lightbringer account before you ask again".
- Every refusal of a press is audited, never with the token.
- Also: a voided request writes its replacement only when it really was voided; a session token naming a founder-executed tool is refused at mint; the re-read compares every typed fact; a sign-in that grants a scope outside the two requested is refused.
Known limits, left for a later change: the press has no fresh sign-in window; an agent can still edit the invention's draft in Lightbringer between the founder's press and Lightbringer's team reading it; the press's policy check sees only that the tool is founder-executed, not its other hints.

## Part C: not done
- The fee, card on file and "filed and paid" result of the brief: not possible through this MCP today (see the first decision).
- `apps/web/e2e/founder-action.spec.ts` passes against a recorder standing in for the gateway (it does not start in the default e2e stack, where the spec skips). The failed and unknown results are covered by the gateway tests only.
- Live Lightbringer sign-in and tools were never exercised: only the recorded mock and an in-process fake server. The live evals were not run (no model key).
