# Agents end to end: the launch gate inventory

Launch Session 28, Nov 24, 2026. The founder's launch rule (Nov 24, 2026): "100% of our agents have to work end to end for our users when we launch, otherwise we're not launching."

## The count

Update, Nov 25, 2026: `security_engineer` (Head of Security work, #428–#436) makes **49** templates, with its own code case `security_engineer.key_from_the_environment`; the gate's coverage test (`agents-e2e.test.ts`) fails on any template without a case.

`ALL_TEMPLATES` in `packages/agents/src/templates/index.ts` holds **48** templates, not the 49 the brief named: the Chief of Staff, 6 leads, 12 workers, 15 channel agents, 9 specialists and 5 utilities.

- **Before this change:** 4 of 48 had a live end-to-end session eval (`researcher`, `sourcing_manufacturing`, `channel_email_automation` and `backend_engineer`, in `evals/src/sessions/cases.ts`, run nightly by `evals-outcomes.yml`). The golden suite (`evals-models-live.yml`) grades one answer per task with no tools, so it does not show that a session finishes.
- **After:** 43 of 43 session templates have at least one session case. The 5 utilities run no session: they hold no task tools (no `complete_task`, no `save_report`) and the product calls each one once from its own code (the entity linker sweep, the Source Watcher's classifier, the categorizer, triage, moderation). The gate runs their golden tasks. That covers 48 of 48.

## How a case is checked

Each case runs one session through the orchestrator's live runner (`prepareSession` → `runAgentSession` → `finishSession`) with the template's real grants. It goes against an in-process gateway (the real pipeline and the real platform tools), with connectors in mock mode on a person's project. The web is a fixture and mail goes to a capture inbox (`evals/src/sessions/harness.ts`). The checks read the database and the session's events, never the agent's words:

- **Result tasks:** the task ends done, the session's own report is saved, `complete_task` went through (one the platform refused does not count), and no block was set. The report claims no outside action ("we sent", "was posted") and carries no mock marker. It meets the task's acceptance lines (`mustMatch`, list items, and tool calls that must have gone through).
- **Code tasks:** the task ends done (or in review) with the acceptance run passing. A pure checker reads the files, so nothing the agent wrote is executed. The tests are unchanged. A review leaves the code unchanged and names the file and the finding.
- **Needs a tool the founder connects:** on a person's project with nothing connected, the task ends blocked, the founder reads that the tool is not connected and its name, and nothing is sent. Its pair runs in a sample project, where the mock answers: the task ends done and the report says the result was simulated. A social post through Buffer still asks the founder (Nov 23, 2026: social posts are first contact, waiting on the founder's decision), so its pair ends waiting on that one approval with nothing posted.

Run it: `.github/workflows/evals-agents-e2e.yml`, by hand only, two consecutive passes, $10 a pass (Estimate). `AGENTS_E2E_ONLY` reruns a subset. Mock, no key: `pnpm --filter @foundmill/evals exec vitest run src/__tests__/agents-e2e.test.ts`.

## Inventory

Tools: the number of platform tools the grants resolve to, then the outside connectors (MCP servers of the gateway), then the SDK's file tools for a code agent. "Live session eval before" is the state on main before Launch S28.

| Template | Family | Role | Task kinds | Tools and grants | Typical task (the case) | Live session eval before | Gate cases |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `chief_of_staff` | assistant | Chief of Staff | ops, research, tool_need | 32 platform | Plan this week's work | no | `chief_of_staff.plans_the_week` |
| `product_lead` | lead | Head of Product | research, ops | 29 platform; web, notion, cli_libreoffice | Spec the loyalty card | no | `product_lead.writes_the_spec` |
| `engineering_lead` | lead | Head of Engineering | code, ops | 25 platform; github, vercel | Break down online ordering | no | `engineering_lead.breaks_down_the_feature` |
| `distribution_strategist` | lead | Head of Distribution | channel, research | 28 platform; web, posthog, cli_libreoffice | Pick the first channels | no | `distribution_strategist.picks_channels` |
| `finance_lead` | lead | Head of Finance | finance, research | 24 platform; stripe, shopify, tink, plaid, ecb_rates | Last month's card revenue | no | `finance_lead.stripe_not_connected`, `finance_lead.stripe_connected`, `finance_lead.first_budget` |
| `legal_lead` | lead | Head of Legal | legal, research | 26 platform; web, companies_house, bolagsverket, opencorporates, dropbox_sign, lightbringer_mcp | What online ordering needs legally | no | `legal_lead.terms_checklist` |
| `operations_lead` | lead | Head of Operations and Specialists | specialist, ops | 26 platform; google_drive, gmail | Pickup shelf routine | no | `operations_lead.opening_checklist` |
| `backend_engineer` | worker | Backend engineer | code | 17 platform; github; files (Read, Glob, Grep, Edit, Write) | Fix the failing sales tax test | yes: `backend_engineer.fixes_failing_test` | - |
| `frontend_engineer` | worker | Frontend engineer | code | 18 platform; github; files (Read, Glob, Grep, Edit, Write) | Make the order button say Order ahead | no | `frontend_engineer.fixes_the_button` |
| `data_engineer` | worker | Data engineer | code | 17 platform; github, posthog; files (Read, Glob, Grep, Edit, Write) | Daily sales totals | no | `data_engineer.daily_totals` |
| `infra_engineer` | worker | Infrastructure engineer | code, ops | 17 platform; vercel, github; files (Read, Glob, Grep, Edit, Write) | Build on Node 22 | no | `infra_engineer.node_22` |
| `qa_engineer` | worker | Quality engineer | code | 17 platform; github; files (Read, Glob, Grep, Edit, Write) | Test the pricing settings | no | `qa_engineer.writes_the_test` |
| `design_to_code` | worker | Design-to-code engineer | code | 17 platform; github, cli_inkscape, cli_gimp; files (Read, Glob, Grep, Edit, Write) | Build the menu item card | no | `design_to_code.menu_card` |
| `docs_writer` | worker | Technical writer | code, research | 18 platform; github, notion, google_drive; files (Read, Glob, Grep, Edit, Write) | Write Getting started | no | `docs_writer.getting_started` |
| `researcher` | worker | Research analyst | research | 18 platform; web, google_drive | Compare compostable cup suppliers | yes: `researcher.report_saved`, `researcher.real_citations`, `researcher.unmet_line_is_not_done`, `isolation.refused_tools` | - |
| `product_researcher` | worker | Product research analyst | research | 20 platform; web, google_drive | Customer interview plan for online ordering | no | `product_researcher.interview_plan` |
| `review_agent` | worker | Code reviewer | code | 17 platform; github; files (Read, Glob, Grep, Edit, Write) | Review the orders change | no | `review_agent.finds_the_tenancy_bug` |
| `integration_agent` | worker | Merge queue operator | code | 18 platform; github; files (Read, Glob, Grep, Edit, Write) | Resolve the merge conflict in pricing.json | no | `integration_agent.resolves_the_conflict` |
| `planner` | worker | Engineering planner | code, research | 18 platform; github; files (Read, Glob, Grep, Edit, Write) | Plan the order history page | no | `planner.task_graph` |
| `channel_lead_generation` | channel | Lead generation specialist | channel | 21 platform; apollo | Find offices near the shops | no | `channel_lead_generation.apollo_not_connected`, `channel_lead_generation.apollo_connected` |
| `channel_email_automation` | channel | Email and lifecycle specialist | channel | 22 platform; sendgrid, platform_mail, resend | Draft the loyalty welcome sequence | yes: `channel_email_automation.not_connected_is_not_sent` | `channel_email_automation.welcome_sequence` |
| `channel_seo` | channel | SEO specialist | channel | 21 platform; github, serpapi, firecrawl, indexnow | SEO brief for the ordering page | no | `channel_seo.page_brief` |
| `channel_geo` | channel | Generative engine optimization specialist | channel | 21 platform; anthropic, openai, gemini, perplexity, serpapi, firecrawl, indexnow, github | Make the cafe answerable by AI assistants | no | `channel_geo.answer_page` |
| `channel_content` | channel | Content marketing specialist | channel | 21 platform; google_drive, notion, github, cli_inkscape | Write the online ordering blog post | no | `channel_content.launch_post` |
| `channel_social` | channel | Social media specialist | channel | 21 platform; runway, elevenlabs_voice, buffer, cli_gimp | Queue Monday's post | no | `channel_social.buffer_not_connected`, `channel_social.buffer_connected_queues_post` |
| `channel_paid_ads` | channel | Paid media specialist | channel | 21 platform | Plan a first ads test | no | `channel_paid_ads.test_plan` |
| `channel_influencer` | channel | Creator partnerships specialist | channel | 21 platform; dropbox_sign, shopify, gmail | Brief for local food creators | no | `channel_influencer.creator_brief` |
| `channel_affiliate` | channel | Affiliate program manager | channel | 21 platform; stripe | Design a referral reward | no | `channel_affiliate.referral_program` |
| `channel_direct_mail` | channel | Direct mail specialist | channel | 21 platform | Postcard to nearby homes | no | `channel_direct_mail.postcard` |
| `channel_print` | channel | Print media specialist | channel | 21 platform; gmail, google_drive | Counter flyer | no | `channel_print.flyer` |
| `channel_broadcast` | channel | Audio and CTV specialist | channel | 21 platform; google_drive | Local radio spot script | no | `channel_broadcast.radio_spot` |
| `channel_outdoor` | channel | Out-of-home specialist | channel | 21 platform; google_drive | Sidewalk board | no | `channel_outdoor.sandwich_board` |
| `channel_pr` | channel | Public relations specialist | channel | 21 platform; gmail | Pitch a Portland food writer | no | `channel_pr.pitch` |
| `channel_events` | channel | Events specialist | channel | 21 platform; gmail, google_calendar | Put the tasting on the calendar | no | `channel_events.calendar_not_connected`, `channel_events.calendar_connected` |
| `sourcing_manufacturing` | specialist | Sourcing and manufacturing specialist | specialist | 19 platform; web, gmail, google_drive | Supplier long list for compostable cups | yes: `sourcing_manufacturing.records_suppliers` | - |
| `formulation_chemist` | specialist | Formulation chemist | specialist | 19 platform; web, gmail, google_drive | House vanilla syrup formula | no | `formulation_chemist.syrup_formula` |
| `pharmacology_regulatory` | specialist | Pharmacology and regulatory specialist | specialist | 19 platform; web, gmail, google_drive | Caffeine on the cold brew label | no | `pharmacology_regulatory.caffeine_label` |
| `financial_regulatory` | specialist | Financial regulation specialist | specialist | 19 platform; web, gmail, google_drive | Rules for selling gift cards | no | `financial_regulatory.gift_cards` |
| `certification` | specialist | Certification specialist | specialist | 19 platform; web, gmail, google_drive | Can we call our cups compostable? | no | `certification.compostable_claim` |
| `packaging_design` | specialist | Packaging and industrial design specialist | specialist | 19 platform; web, gmail, google_drive, cli_inkscape, cli_gimp | Cup sleeve brief | no | `packaging_design.cup_sleeve` |
| `quality` | specialist | Quality specialist | specialist | 19 platform; web, gmail, google_drive | Incoming check for cup deliveries | no | `quality.incoming_check` |
| `logistics` | specialist | Logistics specialist | specialist | 19 platform; web, gmail, google_drive | Cup reorder plan | no | `logistics.reorder_plan` |
| `costing` | specialist | Costing specialist | specialist | 19 platform; web, gmail, google_drive, ecb_rates | Cost of a pickup latte | no | `costing.cost_per_latte` |
| `entity_linker` | utility | Entity linking utility | ops | 1 platform | one call from the product (no session) | no session; golden `entity_linker.sweep` | golden tasks in the gate |
| `classifier` | utility | Classification utility | ops | 0 platform | one call from the product (no session) | no session; golden `classifier.severity` | golden tasks in the gate |
| `categoriser` | utility | Transaction categorization utility | finance | 1 platform | one call from the product (no session) | no session; golden `categoriser.transactions` | golden tasks in the gate |
| `triage` | utility | Inbound sorting utility | ops | 0 platform | one call from the product (no session) | no session; golden `triage.route` | golden tasks in the gate |
| `moderation` | utility | Moderation utility | ops | 0 platform | one call from the product (no session) | no session; golden `moderation.outbound` | golden tasks in the gate |
| `security_engineer` | worker | Security engineer | code, ops | 17 platform; github, sentry_mcp; files (Read, Glob, Grep, Edit, Write) | Read the error-report key from the environment | no (new Nov 25, 2026) | `security_engineer.key_from_the_environment` |

## Findings while building the gate (mock runs, before any live run)

1. **Channel, SEO, GEO, content and planner sessions never started on a new project** (`session.ts`, WP-05 T12). A `research` or `channel` task whose agent's outside connectors were all unconnected was blocked before the SDK, as "hopeless". That premise holds for a researcher with no web. It does not hold for a channel agent, whose common work is drafting, or for a planner on GitHub. On a new project with nothing connected, content, SEO and GEO could not draft and the planner could not plan. Now only a research task without a usable web is blocked early. Every other task starts, is told what is not connected, and blocks itself when the task needs it.
2. **A `complete_task` the platform refused still completed the task.** The gateway answered `ok: false` (a claim citing a heading the report lacks), but the recorder took the call's own claims and ended the task done. It now counts only a call that went through without an error.
3. **Gmail drafts are off without `gmail.compose`** (restricted at Google, Nov 23, 2026), so no session can draft in Gmail at launch. The PR agent's common task is the pitch in its report.
4. **A social post through Buffer waits on the founder in Assisted mode.** This is by design today (Nov 23 kept social posts as first contact). It is listed for the founder: the Nov 23 rule says founders "should never have to approve individual steps", and a browser step that posts already runs.
