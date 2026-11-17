---
date: 2026-11-17
branch: claude/wp14-t6-named-agents
title: Named agents on by default for first-time founders, with two guard tests (WP-14 T6)
areas: [api, web, shared, agents, gateway, e2e, docs]
supersedes: []
---
## What changed
- `apps/api/src/routers/founder.ts`: `namedAgentsOnByDefault(experience)`. The save that creates a profile turns the
  account's "Anthropomorphic agents" switch on when the profile reads as a first-time founder's
  (`founderExperienceFrom`: the answer "first_time", or no answer). Exited, Operator and Domain expert start with it
  off, as before. A later save never touches the switch, and no existing account is changed.
- `apps/web/components/providers/guidance-context.ts`: the signed-out and not-yet-loaded default stays off, and its
  comment says why.
- Guard test 1, a named agent is labeled as an agent wherever it appears: `packages/shared/src/personas.test.ts`
  checks every character of every style (960 in all). Named alone, an agent reads "Name (Position)"; with no role, its
  own title stands in for the position; stored text carries the stored name.
- Guard test 2, a named agent never writes to a third party as though it were a person, in three parts.
  `apps/web/lib/__tests__/named-agents-outward.test.ts` scans the code that acts outward (gateway, connectors, agents,
  orchestrator, composer, sandbox) and fails if a file outside a listed three reads the display rules, and checks the
  one listed file that sends mail uses "Name (Position)". `apps/gateway/src/__tests__/named-agents-outward.test.ts`
  checks the project's mail goes out as "<Project> via Foundmill" and that the mail tool refuses any sender field.
  `packages/agents/src/__tests__/named-agents.test.ts` checks that every agent template's system prompt opens with
  "You are an AI agent working for <business>" and house rule 3.
- Tests: `founder-profile-guidance.test.ts` (the default by experience; the person's own choice after; an account from
  before), `anthropomorphic-agents.test.ts` (the Launch step's three cases start from on for a first-time founder),
  `quick-fit.spec.ts` (a new account's Inbox names the sender with its position). `completeProfile` in the Playwright
  helpers turns the switch back off for the shared developer account, whose specs read agents by role.

## Decisions
### The default is decided once, on the save that creates the profile
That is how guidance, Builder view, the single-key shortcuts and the text size are defaulted, and the switch has no
record of who set it. Deciding again on a later save would turn off a switch the person turned on, or the reverse.
### Everyone who signs up through the product starts as a first-time founder
The first profile does not ask experience (WP-04 T1), and a profile with no answer reads as first-time everywhere
(`DEFAULT_FOUNDER_EXPERIENCE`). So in practice every new account gets named agents on; "an experienced one does not"
holds for a profile created with an experience answer (the api, the app, a test). A person who later says Exited or
Operator in the long profile keeps the switch as it is and can turn it off in Settings › Preferences. Flagged in the
pull request.
### Domain expert counts as experienced here
The task says "when the profile says first-time founder; leave it for everyone else". Domain experts keep guidance on
(2026-10-20) but do not get named agents by default.
### No migration, no backfill
The column default stays off (0067) and existing accounts keep what they had: "leave it for everyone else".
### The founder's name
"Use the name from what should your team call you wherever the product addresses the founder" was checked and needed
no change: the welcome note, the notification and people emails, the morning line and the founder context given to the
Chief of Staff all read the profile's display name. The email's local part is used only when a profile is created with
no name, which the first profile never does.
### Guard test 2 reads source files
Whether a name can leave the product is a property of which code can read it, so the test lists that code. A new file
that reads the display rules under those roots fails the test until it is listed with the reason it is not outward.
### The source scan lives in apps/web
It first sat in the gateway's tests, and CI's `ci-affected` self-test refused it: a test that reads other packages by
a relative path must be declared, and declaring it for the gateway would widen what runs. The web package's tests
already run on any change under apps/ and packages/, so the scan moved there and nothing in CI changed.
### Plan gating is not here
WP-14 T14 lists named agents under the Founder plan from the day sign-up opens. Nothing in this change checks a plan.

## Not done
- The switch's label in the product is still "Anthropomorphic agents"; the brief calls it named agents. Renaming it is
  copy on Settings and Commit, outside this task.
- A first-time founder is not told on first sight that the names are a setting; the label always shows the position,
  and Settings › Preferences and Commit's More options explain it.
- The full Playwright suite and the full api suite were not run here.
