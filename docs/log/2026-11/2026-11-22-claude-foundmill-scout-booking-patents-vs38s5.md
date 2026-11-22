---
date: 2026-11-22
branch: claude/foundmill-scout-booking-patents-vs38s5
title: The tool scout (Part A): a catalog, a tool_need task, needs by stage, one recommendation the founder answers in one press
areas: [shared, connectors, agents, db, gateway, api, orchestrator, ingest, evals]
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
