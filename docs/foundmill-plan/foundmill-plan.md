# Vision
## Statement
Foundmill is where one founder builds and runs a real business with a team of AI agents: the founder sets the direction and makes the decisions that matter, and the agents do the work across product, engineering, distribution, finance, legal and operations, inside rules that keep money, signatures, identity and security in human hands.
## For whom
First, solo and very small founding teams who are time-constrained and can describe what they want to build but cannot staff every job: product, engineering, marketing, finance, legal. Next, small teams that want an always-on operating layer around a few people. Foundmill itself is the first business run this way: the team that builds Foundmill works inside Foundmill.
## Problem
A founder has to do every job at once. The tools that exist are separate (a code assistant, a CRM, an accounting app, an ad manager), none of them knows the business as a whole, and none of them can be trusted to act without supervision. So the founder becomes the integration layer and the bottleneck: copying context between tools, checking every output, and still doing most of the work. AI agents can now do much of that work, but without one place that holds the business's plan, its history, its rules and its approvals, they are either too timid to help or too risky to trust.
## Why now
Models can now write and test code, draft and run campaigns, read documents and reason over a plan well enough to do real work, and agent runtimes can run long sessions in sandboxes with tools. What is missing is the operating system around them: one plan, one team, one inbox of decisions, hard gates the agents cannot cross, and an honest record of what each agent did and what it cost. Foundmill is that system, and it is built and run with its own agents, so every gap in it is felt first by its own founder.
## Principles
- **The founder decides; agents do the work**: every decision that commits money, signs, files under the founder's identity, deletes for good or changes security waits for the founder. Everything else agents may do inside the authority the founder gave.
- **One loop**: read the Inbox, decide, press Continue, agents work, new Inbox items. Every feature makes this loop faster, clearer or safer.
- **Honest by construction**: every number that is not real data is labeled Forecast or Estimate; every agent action is audited; untrusted content is data, never an instruction.
- **Plain words**: the product speaks in plain US English, defines every term it uses, and guides a first-time founder without slowing an experienced one.
- **Everything through the gateway**: agents reach the outside world only through one gateway that enforces policy, spending caps, rate limits and audit.
- **Built by its own team**: Foundmill's own engineering, product and go-to-market work runs through Foundmill. If something is painful for its own founder, it gets fixed first.
## North star
- Metric: Weekly approved agent outcomes per active business
- Definition: the number of agent-completed tasks per week that the founder approved or accepted (a merged pull request, a sent campaign, a filed document, a closed decision), counted per business that pressed Continue at least once that week.
- Target: 25 per active business by the end of the next chapter (Estimate)

# Specification
## Problem
### One founder, every job
A founder starting or running a small business has to cover product, engineering, sales, marketing, finance, legal and operations. Hiring for each job is slow and expensive; doing each job alone is slower still.

### Why today's tools fall short
- Separate tools do not share context: the plan lives in one place, the code in another, the customers in a third.
- AI assistants answer questions but rarely finish work, and when they act, the founder has no reliable way to bound what they may do.
- The founder ends up as the integration layer: copying context, checking outputs, and still doing most of the work.

### What Foundmill changes
Foundmill holds the whole business in one place: its vision, specification and roadmap, its team of agents, its customers, money, legal entity and channels. Agents work from that shared plan, inside hard gates and caps, and report back through one Inbox where the founder decides.

## Customers
### First: time-constrained solo founders
Founders who can describe what they want to build, have a little budget, and cannot hire a full team yet. They want to see real progress every week without supervising every step.

### Next: small founding teams
Two to ten people who want an operating layer that keeps a plan, a team of agents and the decisions in one place, with seats for staff.

### Founder zero: Foundmill itself
Foundmill's own founder runs Foundmill in Foundmill. The engineering agents develop the platform from the reidjxn/foundmill repository, the go-to-market agents run its launch, and every rough edge is felt here first.

### Who it is not for (yet)
Teams that need mobile-first tools, regulated industries that need on-premises deployment, and enterprises with existing procurement and security reviews.

## Value proposition
### An agent team that does the work, a founder who decides
Foundmill gives a founder a full team of AI agents organized in departments (Product, Development, Distribution, Finance, Legal, Team), a Chief of Staff that plans each cycle, and one Inbox where every decision that matters arrives with a recommendation, the options and their consequences.

### Why a founder chooses Foundmill
- One plan the whole team works from: the vision, the specification and the roadmap, with changes proposed as diffs the founder accepts.
- Real work, not chat: agents write and test code in sandboxes and open pull requests, run channels, keep the books, prepare filings.
- Safe by design: hard gates the agents cannot cross, spend ceilings, a business mode that sets how much they may do alone, and an audit trail of every action.
- Plain and guided: a first-time founder is taught by doing, with defined terms, examples and tours; an experienced founder can switch the guidance off.

### What makes it hard to copy
The combination: one shared plan, a governed agent runtime with a policy gateway, connectors with real and mock versions, and a decision loop designed around the founder's time.

## Features
### The core loop
- **Inbox**: notes written by agents with a recommendation, options, consequences and linked entities; decisions by button or free text; red items hold Continue until answered.
- **Continue**: runs one cycle; the Chief of Staff plans the work, agents run their tasks, and the results come back to the Inbox.
- **Home**: department cards, the status strip, what changed since the last visit, the first-week checklist and the next step.

### Departments (labels over modules; a business can rename, merge or split them)
- **Product**: the vision, the living specification (blocks with versions and diffed change proposals), the roadmap (Now, Next, Later), research and sources, and the two sign-offs that start the build.
- **Development**: the task plan and task graph, code sessions running live in sandboxes, pull requests and checks, environments, and specialists for physical products.
- **Distribution**: the Channel Board with channel engines (acquisition, engagement, organic, offline), campaigns, creative, leads, attribution, and Customer Updates when a customer wins.
- **Finance**: cash from open banking, profit and loss, burn and runway (forecasts labeled), the cap table and payroll.
- **Legal**: the jurisdiction recommender, incorporation routes that stop at the founder's own submission, company import from registries, contracts, policies and the compliance calendar.
- **Team**: every agent and staff member, profiles with attribute ratings, skills with tests, training and promotion of new versions, health, the hierarchy and Team › Responsibilities.

### Agents
- Agent templates for every role (Chief of Staff, leads, engineers, QA, researchers, channel engines, finance and legal workers), each with instructions, skills, tools by capability and a model chosen in one routing table.
- Skills can be added by the founder from the library or from a skill file, checked against the house rules before they are added.
- Training runs practice tests in sandboxes against mock tools before a new version is promoted.

### Social layer (LIVE businesses)
Public profiles, connections, messages, communities with moderation, leaderboards and B2B negotiation, for businesses that choose LIVE at commit. Personal businesses stay private.

### Guidance
The guided layer: plain-language definitions on every term, explainers, examples to try, first-visit tours, a Simple view of every dense table, a text-size setting, and an example business to walk around before starting.

## Onboarding and activation
### Three doors to a business
1. **Ideation**: describe an idea, compare candidates, and commit one.
2. **Import**: connect what already exists (a GitHub repository, a website, documents) and let Foundmill read it and draft the plan from it.
3. **Example**: walk around a running example business, read-only, before starting.

### From commit to first approved outcome
After commit, the foundations are drafted (vision, specification sections, roadmap) and two sign-off notes arrive in the Inbox: the specification and the roadmap. Approving both starts the build: the Planner turns the first Now items into tasks for the team.

### Activation
A business is activated when its founder approves the first agent outcome (a merged pull request, an accepted research artifact, a sent campaign). The target is the same session as the commit for imported businesses and within the first day for ideation businesses (Estimate).

### For an existing plan
A founder who already has a written plan imports it in one step (Product › Vision › Import a plan): the vision, the specification sections and the roadmap are written as the founder's own, and Continue turns the Now items into tasks.

## Retention loops
### Weekly
- The Inbox always has the next decision; Refresh always yields one new note.
- A weekly round-up of what the team shipped, what it cost and what is waiting.
- The roadmap moves visibly: Now items close, Next items move up.

### Monthly
- Skills improve through training and are re-scored; promotions are visible on agent profiles.
- Channel performance and runway update with real data as connectors come online.

### When the founder is away
Vacation mode lets the Chief of Staff decide within the authority the founder gave, holds every hard gate for the founder, and writes a report of what happened while away.

## Non-functional requirements
### Safety
- Hard gates no setting can lift: moving money, signing, accepting terms, filing under the founder's identity, deleting permanently and changing security settings always wait for the founder. A merge into a business's default branch is the founder's decision whoever is delegated.
- Every outside call goes through the gateway: policy, caps, rate limits, untrusted-content tracking and audit.
- Untrusted content is read by a quarantined reader with no tools; recipients found in it cannot be contacted without the founder.
- Business data is isolated by row-level security, with a cross-tenant test for every business-scoped table.

### Cost
Every model call is booked to the business's usage ledger; credits and per-business ceilings refuse calls before they are made when the month's credits are used up.

### Performance
Desktop web at 1280 px and wider, tuned for 1440 px. Screens load from a warm cache; long work streams progress. The deploys run in one region close to the database.

### Reliability
Every service exposes a health check; a service whose database pool stops answering exits so the platform restarts it. Connectors have a mock mode in which the whole golden path runs, so CI never depends on a vendor.

### Language
US English and US dates everywhere a person reads; plain-language definitions for every term; the vocabulary rules are enforced in CI.

## Data
### What Foundmill stores
The business's plan (vision, specification blocks with versions, roadmap), its team (agents, versions, skills, sessions, audit), its work (tasks, workspaces, pull requests), its customers (CRM entities, journeys), its money (transactions, forecasts labeled as such), its legal records and its Inbox.

### Principles
- Provenance first: every agent write records which agent, session and source it came from.
- Minimal personal data: only what a feature needs; secrets are encrypted and never shown again; credentials never appear in logs, prompts or the repository.
- Portability: the founder can export the business's data, and the export lists every business-scoped table.

## Integrations
### Through the gateway only
Every connector has a real implementation and a mock one, declares its tools by capability, and is held to the gateway's policy. A connector runs live when the platform's mode is live or when its key is listed in LIVE_CONNECTORS.

### Live today
- GitHub (App installation per business): read the repository, create agent branches, commit files, open pull requests, run the CI checks on an agent branch and read their results, and merge only after the founder approves.
- Anthropic on platform credits or the founder's own key; E2B sandboxes for agent sessions.

### Next
- A deploy connector so agents can deploy production directly, only from the default branch and only after the checks pass for that exact commit.
- Email sending, analytics and the first acquisition channels for Foundmill's own launch.
- Banking (Tink, Plaid), Stripe for revenue, and the company registries, already built with mock versions, switched live business by business.

## Pricing
### Tiers
- **Free**: bring your own Anthropic key, one business, a small team running at once.
- **Pro** and **Scale**: platform credits included, more businesses, more agents at once, seats for staff.

Prices for Pro and Scale and the size of included credits are still open and shown as "Price to be announced" until set.

### Principle
The subscription is priced above the platform's inference cost per active business, measured from the usage ledger before prices are set. Third-party spend (ads, email sending, registry fees) is billed by each provider to the founder's own accounts and never resold.

## Metrics
### North star
Weekly approved agent outcomes per active business.

### Supporting metrics
- Activation: share of new businesses whose founder approves a first outcome in the first session.
- Loop speed: median time from an Inbox decision to the resulting agent outcome.
- Quality: share of agent pull requests merged without a change request; share of tasks completed on the first session.
- Cost: inference cost per active business per week (from the usage ledger), against its tier's price.
- Reliability: CI green rate on agent branches; production error rate; deploy success rate.
- Retention: weekly active founders, four-week retention.

## Risks
1. **Agent quality**: agents that write code that does not pass review waste the founder's time. Mitigation: skills, training runs, CI on every agent branch, the founder's approval on every merge.
2. **Cost**: inference cost per business can exceed what it pays. Mitigation: per-business ceilings, model routing, measuring cost per outcome before setting prices.
3. **Safety and trust**: one bad action (an unwanted message, a leaked secret) costs trust. Mitigation: hard gates, the gateway, the quarantined reader, audit, and mock mode by default.
4. **Platform dependence**: the product depends on model providers and on hosting (Railway, Vercel, Supabase). Mitigation: one routing table for models, health checks, runbooks.
5. **Scope**: the product covers every department; depth suffers if everything moves at once. Mitigation: ramp one department at a time, engineering first, using Foundmill itself as the proof.

## Architecture
### Services
- **apps/web**: the Next.js app on Vercel (foundmill.com).
- **apps/api**: Hono and tRPC on Railway; owns the product's procedures and runs migrations at boot.
- **apps/gateway**: the only service that calls vendors; policy, caps, rate limits, audit, and the GitHub App keys.
- **apps/orchestrator**: agent sessions (Claude Agent SDK in E2B sandboxes) and Temporal workflows (cycles, vacation, training).
- **apps/composer**: writes Inbox notes; **apps/ingest**: verifies vendor webhooks; **apps/stream**: live updates to open tabs; **apps/social** and **apps/collab**: the LIVE layer and the specification's live editing.

### Packages
`packages/dugout` (the design system), packages/modules and packages/widgets (screens), packages/db (Drizzle schema, migrations, repositories, seeds), packages/agents (templates, skills, prompts), packages/connectors (real and mock connectors and their grants), packages/models (routing; model ids live only in routing.ts), packages/events (Zod event schemas and the outbox), packages/policy, packages/sandbox, packages/shared.

### Data and infrastructure
Postgres on Supabase (with row-level security), Redis for rate limits and streams, Temporal for workflows, Railway for the Node services, Vercel for the web app, GitHub Actions as the verification machine.

## Agent team and governance
### Who does what
- **Chief of Staff and Planner**: plan each cycle from the roadmap's Now items and the Inbox.
- **Product Lead and Product Researcher**: keep the specification and roadmap true; propose changes as diffs.
- **Engineering Lead**: breaks Now items into tasks, assigns them, reviews the team's branches, starts the checks.
- **Backend, Frontend, Infrastructure, Data and Design-to-Code Engineers**: write the code on their own agent/ branches and open pull requests.
- **QA Engineer**: writes and runs tests, starts the checks, reads the results and reports what fails.
- **Review Agent**: reviews pull requests before they reach the founder.
- **Distribution Strategist and the channel engines**: the go-to-market work, after the engineering loop is proven.
- **Finance Lead and Legal Lead**: the books, the runway, the entity and the filings.

### The rules every agent follows
CLAUDE.md in the repository is the authority: the vocabulary, the never-list, the architecture rules and the definition of done. Merges into main, payments, signatures, filings under the founder's identity, permanent deletions and security changes are always the founder's.

## Engineering workflow
### How a change reaches production
1. The Engineering Lead turns a Now roadmap item into tasks with acceptance criteria and assigns them.
2. An engineer reads the relevant code through the GitHub tools, writes the change in its session, and the session's files are committed to the task's own branch (agent/<task>) with commit_files.
3. The QA Engineer or the Engineering Lead starts the CI checks on that branch with run_checks and reads the result with get_checks: typecheck, lint, unit tests, three Playwright shards and the golden path, Storybook, the Docker image boot, and the vocabulary, US English and plain-language checks.
4. When the checks pass, the engineer opens a pull request with what changed, how it was tested and what was not verified.
5. The founder approves the merge in the Inbox (or on GitHub). Merging to main deploys the web app on Vercel and the services on Railway; the api applies migrations at boot.

### Definition of done
Typecheck, lint, unit tests, a Playwright spec for any screen touched, a Storybook story for any new component, an eval for any new agent behavior, and a line in docs/PROGRESS.md; judgment calls in docs/DECISIONS.md.

### Where to read first
CLAUDE.md, docs/ARCHITECTURE.md, docs/DESIGN.md, docs/DECISIONS.md, docs/PROGRESS.md, docs/DEPLOY.md, docs/BUILD.md, and docs/agent-pack/00-handover.md.

## Go-to-market
### Launch with Foundmill's own team
Foundmill launches using its own Distribution department: the Distribution Strategist picks the first channels on the Channel Board, and the channel engines run them under the founder's approval for anything that contacts people or spends money.

### Order
1. The engineering loop proven on Foundmill itself (the first merged agent pull request).
2. A public build log: what the agents shipped each week, written by the content and social engines and approved by the founder.
3. A waitlist and onboarding for the first founders, with the example business as the front door.
4. Paid acquisition only after activation and cost per active business are measured.

### Channels to switch live first
Email (transactional and a waitlist sequence), the website and SEO, social posting for the build log, and analytics. Each needs its own accounts, approvals and keys; each runs in mock mode until it is switched live.

## Current state and known gaps
### Live in production (Oct 2026)
foundmill.com on Vercel; api, gateway, orchestrator and the other services on Railway; Postgres on Supabase; migrations through 0066; the guided layer, the plain-language sweep and the example business; GitHub live with run_checks and get_checks, and founder-only merges.

### Known gaps, in priority order
1. The first live engineering loop on this business (branch, checks, pull request, founder merge).
2. Code sessions start from an empty workspace or the task's last saved files, not from the repository: agents read the code through the GitHub tools and write only the files they change.
3. No deploy connector yet: agents cannot deploy production directly.
4. The production api reports env "staging" and integrations "mock": confirm the intended values before switching connectors live.
5. A hydration mismatch in the Example chip on the example business's shell.
6. Team › Responsibilities copy may still describe delegating merges, which are now the founder's only.
7. No load baseline: measure before ramping departments.

# Roadmap
## Now
### First live engineering loop on Foundmill
Prove that Foundmill's engineering agents can change Foundmill's own code end to end on this business: a small, real documentation fix made on an agent branch, the checks run and read, a pull request opened, and the founder approving the merge in the Inbox.
Acceptance:
- An agent branch named agent/<task> exists in reidjxn/foundmill with the change
- run_checks started the CI workflow on that branch and get_checks reported success
- A pull request from that branch to main describes what changed, how it was tested and what was not verified
- The merge appears in the founder's Inbox as a decision and nothing merges without it
- docs/PROGRESS.md records the loop

### Engineering onboarding pack for every engineering agent
Give the Engineering Lead, QA Engineer, Review Agent and the five engineers the context they need: the handover, the repository and branch rules, the checks skill and the product rules, as business skills and as a source, so every session starts from the same understanding.
Acceptance:
- Each engineering agent lists the three skills from docs/agent-pack on its profile
- The handover is a source of the business
- Asked what Foundmill is and how a change reaches production, the Engineering Lead answers in line with the handover

### Repository context for code sessions
Let a code session start with the parts of the repository it needs: the files the task names and their neighbors, read through the gateway's GitHub tools within the existing workspace limits, so an agent edits real files instead of writing from memory.
Acceptance:
- A code task can name paths, and its session starts with those files and their tests in the workspace
- The read goes through the gateway (read_tree and read_file), within the 300-file and 10 MB limits
- A session without named paths behaves as today
- Unit tests and an eval cover the seeding

### Railway deploy connector
Let agents deploy production directly, as the founder decided: a deploy connector served through the gateway, real and mock, that deploys only the production services, only at the current main commit, and only after the CI checks passed for that exact commit; every deploy audited and announced in the Inbox.
Acceptance:
- deploy_service and get_deploy_status tools with real (Railway API, RAILWAY_TOKEN on the gateway only) and mock implementations
- The gateway refuses any commit other than main's head, and any commit whose CI run did not succeed
- Granted to the Engineering Lead and the Infrastructure Engineer only
- Each deploy writes an audit entry and an Inbox notice; contract tests and a security review pass

### Responsibilities copy for founder-only merges
Update Team › Responsibilities so it never offers or describes delegating merges into the default branch: merges are always the founder's.
Acceptance:
- The Responsibilities screen shows merges as the founder's, with no handler choice
- The API refuses a handler other than the founder for merges, with a clear message
- Playwright and unit tests updated

### Fix the Example chip hydration mismatch
The example business's shell logs a React hydration mismatch in the Example chip. Make the server and the client render the same markup.
Acceptance:
- No hydration warning on the example business's Home in the browser console
- The example-business Playwright spec asserts no hydration error is logged

### Production environment labels
The production api reports env "staging" and integrations "mock". Confirm the intended values with the founder, then set them consistently across the services, without switching any connector live by accident.
Acceptance:
- APP_ENV and INTEGRATIONS_MODE values on every service are recorded in docs/DEPLOY.md
- LIVE_CONNECTORS lists exactly the connectors meant to be live
- Boot logs show the recorded values

### Load baseline from Railway metrics
Measure the api, gateway and orchestrator under today's traffic (response times, error rates, CPU and memory), so the departments can be ramped one at a time with a reference.
Acceptance:
- A baseline table in docs/PROGRESS.md with the date and the source of each figure
- Alert thresholds proposed for error rate and response time

## Next
### Agent pull request reviews by the Review Agent
Have the Review Agent review every agent pull request before it reaches the founder: correctness against the task's acceptance criteria, tests added, CLAUDE.md rules, and a short summary for the founder.
Acceptance:
- Every agent pull request gets a review note from the Review Agent
- The founder's merge decision shows the review summary
- An eval covers a pull request that breaks a rule

### Cost per outcome on Home
Show, per business, what each approved outcome cost in credits this week, from the usage ledger, so the founder sees value against spend.
Acceptance:
- Home shows weekly approved outcomes and cost per outcome
- Figures come from the usage ledger and are labeled where estimated

### Measure activation and the north star
Instrument activation (first approved outcome) and the north star (weekly approved agent outcomes per active business), with a weekly report in the Inbox.
Acceptance:
- Events for approved outcomes exist in packages/events with Zod
- A weekly Inbox note reports the north star per business

### Plan import polish
Extend Import a plan with a downloadable template, a diff preview against the current specification, and a history entry per import.
Acceptance:
- A template file can be downloaded from the dialog
- The preview shows which sections change
- Each import appears in the specification's version history

### Weekly round-up of shipped work
A weekly note from the Chief of Staff: what the team shipped, what it cost, what is waiting for the founder, and the next week's Now items.
Acceptance:
- One note per week per active business
- Every item links to its pull request, task or decision

### Public build log for Foundmill
The content and social engines draft a weekly build log from merged pull requests and shipped roadmap items; the founder approves each post before it goes out.
Acceptance:
- A draft post per week in the Inbox for approval
- Nothing is published without the founder's approval

### Waitlist and first-founder onboarding
A waitlist on foundmill.com with a confirmation email and a sequence that invites founders in batches, with the example business as the front door.
Acceptance:
- Waitlist form with consent recorded
- Transactional email sent through the gateway's email connector, live
- Invitations in batches the founder approves

### Analytics connector live
Switch the analytics connector live for foundmill.com so activation, retention and channel performance use real data.
Acceptance:
- Real events from foundmill.com reach the business's metrics
- Figures that are still estimated stay labeled

### Email connector live for Foundmill
Switch the email connector live for Foundmill's own business, with sender domain verified and suppression lists respected.
Acceptance:
- Sending domain verified; bounces and unsubscribes handled
- Every send to a person outside the business waits for the founder unless the founder delegated it

### Scale the engineering team safely
Run up to eight engineering agents at once on Foundmill with no shared-state conflicts, measured against the load baseline.
Acceptance:
- Eight concurrent code sessions complete without errors
- Response times stay within the alert thresholds

### Stripe revenue for Foundmill
Connect Foundmill's own Stripe account so revenue, signups and payments flow into Finance and the Customer Updates.
Acceptance:
- Stripe connected live for the Foundmill business only
- A test payment produces a Customer Update

### Set Pro and Scale prices from measured cost
Use the usage ledger's cost per active business to propose prices and included credits for Pro and Scale, for the founder to decide.
Acceptance:
- A pricing proposal in the Inbox with the measured cost and the margin
- Prices are set in config only after the founder approves

## Later
### Paid acquisition for Foundmill
Run the first paid channel for Foundmill once activation and cost per active business are measured, with spend ceilings the founder sets.
Acceptance:
- Spend ceilings set by the founder and enforced by the gateway
- Every campaign launch waits for the founder

### Up to 64 agents at once
Scale a business to 64 concurrent agents, as the Scale tier promises, with the load and cost measured.
Acceptance:
- 64 concurrent sessions stable for one hour in a load test
- Cost per hour recorded

### Penetration test and security review
An external penetration test of the web app, api and gateway, with every high or critical finding fixed before launch.
Acceptance:
- Report received and findings tracked
- No open high or critical findings

### Runbooks and status page
Write runbooks for the common incidents (a stuck deploy queue, a wedged database pool, a vendor outage) and publish a status page.
Acceptance:
- Runbooks in docs for each incident type
- A public status page linked from foundmill.com

### LIVE layer opened to the first founders
Open profiles, connections, communities and leaderboards to the first founders, with moderation response under 24 hours.
Acceptance:
- Moderation queue staffed and measured
- Leaderboards verified against real data

### Legal routes live
Switch the incorporation routes and company registries live for the jurisdictions already built, always stopping at the founder's own submission.
Acceptance:
- Each route's dry run passes
- No submission is made without the founder

### Open banking live
Switch Tink and Plaid live for businesses that connect a bank, with consent renewal handled.
Acceptance:
- Consent and renewal flows work against the providers' production environments
- Cash and runway use real data and say so

### Physical-product specialists
Bring the physical-product specialists (manufacturing, packaging, logistics) to the same standard as the software team.
Acceptance:
- Each specialist has skills with tests and training runs
- A physical-product example business runs end to end in mock mode
