/** Blueprints for engineering, research, review, integration and planning craft skills. */
import { bp, type BlueprintSet, CHECK, TOOLS } from "./_types";

const REPO = (name: string) => ({ repo: `fixtures/repos/${name}` });

export const ENGINEERING_BLUEPRINTS: BlueprintSet = {
  api_design: [
    bp(
      "Design a procedure for {business}",
      "Design the tRPC procedure for {business} that lets a member mark a {customer} lead as replied. Give input schema (Zod), output type, membership and permission checks, the event emitted, error cases and the audit entry. Do not write the UI.",
      [
        "Input validated with Zod including businessId and leadId; output typed.",
        "Membership and permission checks are explicit; audit and event are included.",
        "Error cases (not found, already replied, forbidden) are enumerated.",
      ],
      { fixtures: REPO("tanstack-hono"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Version a breaking change at {business}",
      "{business}'s public webhook payload for {integration} must add a required field and rename another. Propose how to ship it without breaking existing consumers: versioning approach, deprecation window, docs, tests.",
      [
        "Proposes additive change or explicit versioning with a deprecation window.",
        "Covers tests for both versions and documentation.",
        "Avoids silent breaking changes.",
      ],
    ),
    bp(
      "Idempotent endpoint for {business}",
      "{business} receives duplicate '{integration} order created' webhooks. Design the handler so retries are safe: idempotency key, storage, response codes, what happens on a replay with changed payload.",
      [
        "Uses a stored idempotency key scoped by business and source id.",
        "Defines responses for duplicate and conflicting replays.",
        "Keeps the handler transactional with the outbox write.",
      ],
      { fixtures: REPO("tanstack-hono"), mockTools: TOOLS.sandbox },
    ),
  ],
  data_modelling: [
    bp(
      "Model a business-scoped table for {business}",
      "Model the table for {business}'s {customer} interactions (email, meeting, call, note) with tenancy: columns, constraints, indexes for 'latest per entity' and 'search by date range', the RLS policy, and the cross-tenant test outline.",
      [
        "business_id not null, RLS policy and cross-tenant test are present.",
        "Indexes match the named access patterns.",
        "Constraints encode the enum and referential integrity.",
      ],
      { fixtures: REPO("drizzle-pglite"), mockTools: TOOLS.sandbox, checks: [CHECK.all("business_id")] },
    ),
    bp(
      "Migration safety at {business}",
      "{business} must split a 'name' column into first and last names on a table with 400k rows. Write the migration plan: steps, backfill strategy, dual-write period, rollback, and the test on fixtures.",
      [
        "Uses an expand-migrate-contract sequence with backfill and rollback.",
        "Addresses locking and batching for 400k rows.",
        "Includes a fixture test for the backfill.",
      ],
    ),
    bp(
      "Model money correctly for {business}",
      "{business} stores prices and invoices in {currency} and needs multi-currency later. Specify the column types, rounding rules, how totals are computed, and the tests that prove minor-unit correctness.",
      [
        "Uses integer minor units with a currency column; no floats.",
        "Rounding and total rules are explicit.",
        "Tests cover minor-unit edge cases.",
      ],
    ),
  ],
  testing: [
    bp(
      "Test-first fix for {business}",
      "In the fixture repo for {business}, invoices for cancelled {customer} show a negative total. Write the failing test first, then the smallest fix, then run the suite. Report the test name, the diff summary and the results.",
      [
        "A failing test is written before the fix and passes after.",
        "The fix is minimal and the suite passes.",
        "Report names the test and files.",
      ],
      { fixtures: REPO("invoice-bug"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Edge-case coverage for {business}",
      "Write the test list for {business}'s discount function (percentage or fixed, caps, currency {currency}, stacking rules in fixture): name each test and the behaviour it asserts, including boundaries and invalid input.",
      [
        "Covers boundaries (0%, 100%, cap equal to total), stacking and invalid input.",
        "Each test name states the behaviour.",
        "No redundant tests.",
      ],
      { fixtures: REPO("discounts") },
    ),
    bp(
      "Replace a brittle test at {business}",
      "A test in {business}'s repo asserts on an exact HTML string and breaks on every copy change. Rewrite it to assert behaviour (roles, text content, state) and explain the principle in two lines.",
      [
        "New test asserts behaviour via accessible roles and content.",
        "Explanation is correct and concise.",
        "Test remains deterministic.",
      ],
      { fixtures: REPO("brittle-ui-test"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
  ],
  debugging: [
    bp(
      "Reproduce before fixing at {business}",
      "Bug report at {business}: '{customer} export sometimes misses the last row.' Fixture repo and logs provided. Describe how you reproduce it deterministically, the root cause you find, the fix and the regression test.",
      [
        "Reproduces with a deterministic test before changing code.",
        "Root cause is identified from evidence (off-by-one / pagination).",
        "Regression test added and suite passes.",
      ],
      { fixtures: REPO("export-off-by-one"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Read the logs at {business}",
      "{business}'s nightly job failed with the attached log fixture (stack trace, timestamps, a 429 from {integration}). Explain the failure chain, what is a symptom vs cause, and the two changes you would make.",
      [
        "Correctly separates the rate-limit cause from downstream symptoms.",
        "Proposes backoff and a guard, not a blanket retry.",
        "Cites log lines.",
      ],
      { fixtures: { log: "fixtures/logs/nightly_429.log" } },
    ),
    bp(
      "Heisenbug discipline at {business}",
      "A Playwright test for {business}'s checkout fails 1 in 10 runs. Describe your approach: gather evidence (traces), form hypotheses, bisect, and what you refuse to do (retry until green). Propose the likely fix given the fixture trace.",
      [
        "Evidence-first approach with traces and bisection.",
        "Identifies a race or wait condition from the fixture.",
        "Explicitly rejects retry-until-green.",
      ],
      { fixtures: { trace: "fixtures/playwright/flaky_checkout_trace.json" } },
    ),
  ],
  security_awareness: [
    bp(
      "Find the security issues for {business}",
      "Review the fixture diff for {business}: a new endpoint that reads {customer} data by id, logs the request body, and builds a SQL string. List every security or tenancy issue with line references and the fix.",
      [
        "Finds missing authorisation/tenancy check, logging of sensitive data and SQL injection.",
        "Each issue cites a line and a concrete fix.",
        "No false positives on benign lines.",
      ],
      { fixtures: { diff: "fixtures/diffs/insecure_endpoint.diff" } },
    ),
    bp(
      "Secrets handling for {business}",
      "{business}'s coding agent needs to call {integration} from the sandbox. Explain why the sandbox must not hold the API key, how the call should flow (gateway, session token, scope), and what you check in the diff to be sure no secret leaks.",
      [
        "Describes the gateway/session-token flow and short-lived scoping.",
        "Lists diff checks (env reads, logs, fixtures) for leaks.",
        "No long-lived credentials in the sandbox.",
      ],
    ),
    bp(
      "Untrusted content in code at {business}",
      "A feature for {business} renders {customer}-submitted markdown and lets an agent summarise it. List the risks (XSS, prompt injection into the agent, data exfiltration) and the mitigations at each layer.",
      [
        "Covers rendering sanitisation and prompt-injection handling via the quarantined reader.",
        "Mitigations are layered and concrete.",
        "Mentions tenancy of stored content.",
      ],
    ),
  ],
  performance: [
    bp(
      "Measure before optimising at {business}",
      "{business}'s {customer} list page takes 3.8 s. Using the fixture profile, identify the real bottleneck, propose the fix, estimate the gain (labelled Estimate), and say how you verify it.",
      [
        "Identifies the bottleneck from the profile (N+1 query / missing index), not a guess.",
        "Fix is targeted; gain is labelled Estimate; verification is a measurement.",
        "Does not propose unrelated micro-optimisations.",
      ],
      { fixtures: { profile: "fixtures/perf/list_page_profile.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Set a budget for {business}",
      "Define performance budgets for {business}'s dashboard (first render, interaction latency, payload size) and how CI enforces them. Explain how you keep the Ribbon at 60 fps with two years of data.",
      [
        "Budgets are numeric and enforced in CI with a method.",
        "Rendering strategy for large data is credible (virtualisation, canvas layer).",
        "Budgets are realistic.",
      ],
    ),
    bp(
      "Query tuning for {business}",
      "A reporting query for {business} scans the whole events table for one {customer}. Given the schema fixture, rewrite the query, propose the index, and show the before/after plan summary.",
      [
        "Adds the right composite index and rewrites the query to use it.",
        "Shows plan evidence.",
        "Keeps tenancy filters.",
      ],
      { fixtures: REPO("drizzle-pglite"), mockTools: TOOLS.sandbox },
    ),
  ],
  component_craft: [
    bp(
      "Build a reusable component for {business}",
      "Build a StatusPill component for {business}'s squad table in the design system: props (status, size), states (healthy, degraded, failing, injured, paused, idle), tokens only, a Storybook story with every state, and a DOM test.",
      [
        "Props are typed; all states covered; uses tokens only.",
        "Story and test exist and pass.",
        "No ad-hoc colours or sizes.",
      ],
      { fixtures: REPO("dugout-storybook"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Refactor duplication at {business}",
      "Three screens in {business}'s app each hand-roll a metric tile. Extract a MetricTile component: API design, how variants map, what stays screen-specific, and the migration order.",
      [
        "API covers the three usages without over-generalising.",
        "Migration order is safe and incremental.",
        "Explains what remains screen-specific.",
      ],
      { fixtures: REPO("dugout-storybook") },
    ),
    bp(
      "Compose, do not fork, at {business}",
      "A product request for {business} needs a dropdown with a search box. The design system has Select and Input. Explain how you compose them (or extend Select) rather than copying code, and the accessibility behaviour you must keep.",
      [
        "Chooses composition/extension with clear reasoning.",
        "Keeps keyboard and ARIA behaviour of the base components.",
        "Adds a story for the new composition.",
      ],
    ),
  ],
  design_fidelity: [
    bp(
      "Match a reference for {business}",
      "Implement {business}'s department card header from the reference (fixture figma_header) with the design system. List the deltas between the reference and existing components, decide each (design system wins), and provide the comparison notes.",
      [
        "Deltas are listed and decided with the design-system-wins rule.",
        "Implementation uses tokens and existing components.",
        "Comparison notes are specific (px, tokens).",
      ],
      { fixtures: { figma_header: "fixtures/design/department_card_header.json" }, mockTools: TOOLS.sandbox },
    ),
    bp(
      "Spot fidelity drift at {business}",
      "Compare the rendered screenshot and the reference for {business}'s inbox row (fixture). List every visible difference (spacing, type, colour, alignment) with the token or value to change.",
      [
        "Finds the planted differences and no imaginary ones.",
        "Each difference names a token or value.",
        "Ordered by visual impact.",
      ],
      { fixtures: { reference: "fixtures/design/inbox_row_reference.png", rendered: "fixtures/design/inbox_row_rendered.png" } },
    ),
    bp(
      "Fidelity vs design system at {business}",
      "The reference for {business} uses a 10 px radius and a non-system blue. Explain what you implement, how you flag the difference, and when a design-system change request is the right move.",
      [
        "Implements with system tokens and flags the delta.",
        "Explains the escalation path for a genuine system change.",
        "No ad-hoc overrides.",
      ],
    ),
  ],
  accessibility: [
    bp(
      "Make a dialog accessible for {business}",
      "{business}'s HolidayDialog (fixture) traps focus incorrectly and has no labels. Fix: focus management, labelled controls, keyboard close, screen-reader announcements. Provide the test that proves it.",
      [
        "Focus trap, labels, Escape handling and announcements are implemented.",
        "A test asserts the keyboard path.",
        "Uses design-system dialog primitives.",
      ],
      { fixtures: REPO("dugout-storybook"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Audit a screen for {business}",
      "Audit {business}'s squad table (fixture DOM) for accessibility: roles, names, contrast against tokens, keyboard order, status conveyed by colour only. List findings with severity and fix.",
      [
        "Finds colour-only status, missing names and keyboard order issues.",
        "Fixes are concrete (text alternatives, aria attributes, order).",
        "Severity is sensible.",
      ],
      { fixtures: { dom: "fixtures/a11y/squad_table.html" } },
    ),
    bp(
      "Reduced motion for {business}",
      "The Journey Ribbon for {business} animates in over 1.2 s. Specify the reduced-motion behaviour, how it is detected, what remains identical in information, and the test.",
      [
        "Static rendering under prefers-reduced-motion with identical information.",
        "Detection and test are specified.",
        "No information lost.",
      ],
    ),
  ],
  state_management: [
    bp(
      "One source of truth at {business}",
      "{business}'s inbox keeps unread counts in three places (sidebar badge, list header, tab title) and they drift. Design the state: where the count lives, how it updates from the stream, and how components subscribe.",
      [
        "Single derived source with subscriptions; no duplicated counters.",
        "Handles stream updates and invalidation.",
        "Keeps server state in the query layer.",
      ],
    ),
    bp(
      "Optimistic update at {business}",
      "Implement optimistic 'mark as read' for {business}'s inbox items: the update, rollback on error, and avoiding a flash when the server response differs. Describe with the query layer in use.",
      [
        "Optimistic update with rollback and reconciliation.",
        "Avoids flashes via cache updates rather than refetch loops.",
        "Error path is explicit.",
      ],
    ),
    bp(
      "Local vs shared state at {business}",
      "Classify these states in {business}'s app as local, store or server: selected Training Ground tile, inbox items, edit-mode flag for Home, draft free-text reply, business mode. Justify each in one line.",
      [
        "Classification is correct and justified.",
        "Draft reply handled as local with persistence consideration.",
        "Business mode is server state.",
      ],
    ),
  ],
  layout_precision: [
    bp(
      "Lay out the shell for {business}",
      "Implement {business}'s shell at 1440 px: 232 px sidebar, 32 px items, 16 px icons, panel radius 4 px, 28/34 px rows. Verify at 1280 px. Provide the measurements you check and the screenshot diff summary.",
      [
        "Measurements match the spec at both widths.",
        "No horizontal overflow at 1280 px.",
        "Uses tokens for every value.",
      ],
      { fixtures: REPO("dugout-storybook"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Fix alignment drift at {business}",
      "Rows in {business}'s squad table misalign by 1-2 px between columns (fixture). Find the cause (padding vs line-height vs borders) and the fix that keeps rows at 28 px.",
      [
        "Correct cause identified from the fixture.",
        "Fix keeps row height exact.",
        "Uses tokens.",
      ],
      { fixtures: { dom: "fixtures/a11y/squad_table.html" } },
    ),
    bp(
      "Type scale discipline for {business}",
      "A new panel for {business} uses 13.5 px and 15 px text. Map to the design system scale, explain the rule, and show the before/after.",
      [
        "Maps to the nearest scale steps with reasoning.",
        "States the rule clearly.",
        "Before/after is concrete.",
      ],
    ),
  ],
  data_pipelines: [
    bp(
      "Idempotent ingestion for {business}",
      "Design the pipeline that turns {integration} webhook events for {business} into journey touches: dedupe by source id, handle late events, reprocess safely, and record what was skipped. Provide the test cases.",
      [
        "Dedupe and late-event handling are explicit; reprocessing is safe.",
        "Skipped events are recorded with reasons.",
        "Test cases cover duplicates and out-of-order arrival.",
      ],
      { fixtures: REPO("pipelines"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Backfill plan at {business}",
      "{business} changed its attribution model and must recompute two years of journeys. Plan the backfill: batching, checkpoints, verification against a sample, and how the UI shows progress without showing wrong numbers.",
      [
        "Batching with checkpoints and verification sample.",
        "Avoids serving partially recomputed data.",
        "Progress is visible.",
      ],
    ),
    bp(
      "Daily materialised view for {business}",
      "Define journey_daily for {business}: grain, columns (agent_hours, tasks_done, spend, revenue, signups, activations, payments, decisions), refresh strategy, and the fixture test with hand-computed values.",
      [
        "Grain and columns correct; refresh strategy stated.",
        "Fixture test with expected values.",
        "Tenancy preserved.",
      ],
      { fixtures: REPO("pipelines"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
  ],
  data_quality: [
    bp(
      "Add quality checks for {business}",
      "{business}'s revenue chart showed a 40% spike that was a duplicated {integration} payout. Add data-quality checks to the pipeline: duplicate detection, range checks, reconciliation against source totals, alerting. Provide the test.",
      [
        "Checks are specific and would have caught the duplicate.",
        "Reconciliation against source totals is included.",
        "Alert path is defined; test exists.",
      ],
      { fixtures: REPO("pipelines"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Label uncertain data at {business}",
      "Some of {business}'s {customer} journeys lack consent and show first-party events only. Specify how the data model and UI mark them ('partial journey'), how aggregates treat them, and the test.",
      [
        "Partial journeys are labelled and handled in aggregates explicitly.",
        "No mixing of partial and full without labels.",
        "Test specified.",
      ],
    ),
    bp(
      "Fixture-driven metric test at {business}",
      "Write the fixture and the test for {business}'s net burn: 3 months of transactions including a financing inflow and an internal transfer. Give the hand-computed expected value and the assertion.",
      [
        "Fixture includes the exclusions; expected value is correct.",
        "Assertion is to the minor unit.",
        "Definition documented beside the test.",
      ],
      { fixtures: REPO("pipelines"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
  ],
  sql_analytics: [
    bp(
      "Named query for {business}",
      "Write the read-only named query for {business}: weekly signups by acquisition channel for the last 12 weeks, business-scoped, with the definition text for hover. Explain how non-SELECT is rejected.",
      [
        "Correct grouping and date bucketing; business_id filter present.",
        "Definition text is accurate; non-SELECT rejection explained.",
        "Handles weeks with zero signups.",
      ],
      { fixtures: REPO("drizzle-pglite"), mockTools: TOOLS.sandbox, checks: [CHECK.all("business_id")] },
    ),
    bp(
      "Cohort retention for {business}",
      "Write the SQL for monthly cohort retention of {customer} at {business} (signup month × months since signup), business-scoped, and describe two pitfalls you avoided.",
      [
        "Cohort SQL is correct and tenant-scoped.",
        "Pitfalls (partial current month, timezone) are real.",
        "Output shape is usable by a chart.",
      ],
    ),
    bp(
      "Debug a wrong number at {business}",
      "{business}'s MRR query (fixture) returns 12% higher than Stripe. Find the bug (duplicated join / cancelled subscriptions included), fix it, and add the fixture test.",
      [
        "Finds the actual bug in the fixture query.",
        "Fix is minimal; test added and passing.",
        "Explains the discrepancy.",
      ],
      { fixtures: REPO("mrr-bug"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
  ],
  infrastructure_as_code: [
    bp(
      "Declare an environment for {business}",
      "Declare the staging environment for {business}'s {stack}: services, ports (read PORT first, listen on ::), env schema, health checks, and how a new service is added. As code, with the review checklist.",
      [
        "Services, ports and health checks declared as code.",
        "Env schema single-sourced; PORT and :: handled.",
        "Checklist is concrete.",
      ],
      { fixtures: REPO("railway-services") },
    ),
    bp(
      "Preview deployments for {business}",
      "Set up preview deployments per branch for {business}'s web app: trigger, env vars (public only), URL exposure to the review flow, teardown. Provide the config and the test.",
      [
        "Per-branch previews with public-only env vars.",
        "URL reaches the review step; teardown defined.",
        "Config is reviewable.",
      ],
    ),
    bp(
      "Drift detection at {business}",
      "A manual change was made to {business}'s staging config. Explain how you detect drift from the declared state, reconcile it, and prevent repeats; which step requires a founder decision (security settings).",
      [
        "Drift detection and reconciliation approach is concrete.",
        "Security-setting changes are routed to the founder.",
        "Prevention step defined.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  ci_cd: [
    bp(
      "Pipeline for {business}",
      "Define {business}'s CI pipeline: typecheck, lint, unit, RLS suite, Playwright on mock mode, with caching and a 10-minute budget. Provide the config and say what blocks a merge.",
      [
        "All stages present with sensible caching and parallelism.",
        "Merge-blocking conditions are explicit.",
        "Budget realistic.",
      ],
      { fixtures: REPO("monorepo-ci") },
    ),
    bp(
      "Flaky pipeline at {business}",
      "{business}'s CI fails 15% of runs on a Playwright timeout. Decide: quarantine, fix, or retry policy. Explain and implement the change you choose with the follow-up task.",
      [
        "Quarantines with a task rather than blanket retries.",
        "Implementation is concrete.",
        "Follow-up defined.",
      ],
    ),
    bp(
      "Release path for {business}",
      "Describe the path from merged PR to staging deploy for {business}: build image once, APP build arg, migrations, smoke test, rollback. Which steps are automatic in which business mode?",
      [
        "Steps are correct and ordered; rollback exists.",
        "Business-mode gating for merges is correctly described.",
        "Smoke test defined.",
      ],
    ),
  ],
  observability: [
    bp(
      "Instrument a service for {business}",
      "Add observability to {business}'s gateway: structured logs (no secrets), request metrics by connector, error-rate alert at 10% over 5 minutes, and a health endpoint. Provide the code outline and the alert test.",
      [
        "Logs are structured and redacted; metrics by connector.",
        "Alert threshold and window correct; test on fixtures.",
        "Health endpoint defined.",
      ],
      { fixtures: REPO("gateway-service"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Explain an incident at {business}",
      "Using the fixture logs and metrics, write the incident note for {business}'s 6-hour {integration} outage: timeline, detection gap, impact, root cause, two actions. Facts only.",
      [
        "Timeline from the fixtures; detection gap identified.",
        "Root cause supported by evidence.",
        "Actions are specific.",
      ],
      { fixtures: { logs: "fixtures/logs/outage.log", metrics: "fixtures/logs/outage_metrics.json" } },
    ),
    bp(
      "Agent health signals for {business}",
      "Define how {business} computes agent health every minute: heartbeat, error rate, loop detection, credential status, rate-limit hits, budget. Give thresholds and the event emitted on change.",
      [
        "All signals and thresholds match the health spec.",
        "Event emitted only on change.",
        "Injured state tied to credentials with expected return.",
      ],
    ),
  ],
  secrets_hygiene: [
    bp(
      "Find the leak at {business}",
      "Scan the fixture diff for {business}: a debug log prints the config object, a test fixture contains a real-looking key, and a Dockerfile copies .env. Identify each leak and the fix.",
      [
        "Finds all three leaks with lines.",
        "Fixes are correct (redaction, placeholder, dockerignore).",
        "No false positives.",
      ],
      { fixtures: { diff: "fixtures/diffs/secret_leaks.diff" } },
    ),
    bp(
      "BYOK handling for {business}",
      "Explain how {business} stores a founder's Anthropic key: encryption, who decrypts, where it must never appear, rotation and revoke behaviour. Point out two common mistakes.",
      [
        "Envelope encryption, gateway/orchestrator-only decryption, never in logs/sandboxes/bundles.",
        "Rotation/revoke behaviour correct (pause agents, Inbox note).",
        "Mistakes are realistic.",
      ],
    ),
    bp(
      "Sandbox credential review for {business}",
      "Review the sandbox setup for {business}'s coding agents (fixture): list every credential or token present, decide which should be removed, and how tool access works without them.",
      [
        "Identifies long-lived credentials and removes them.",
        "Describes session-token scoped access via the gateway.",
        "Keeps necessary ephemeral tokens only.",
      ],
      { fixtures: { sandbox: "fixtures/sandbox/setup.json" } },
    ),
  ],
  test_design: [
    bp(
      "Criteria to tests for {business}",
      "Map these acceptance criteria for {business} to tests: 'Continue is disabled while any blocking item is unanswered; the button reads Respond · N'; 'Refresh yields exactly one new item'. Name each test, its setup, assertion and negative case.",
      [
        "Each criterion has at least one positive and one negative test.",
        "Names carry the criterion id; assertions are specific.",
        "Setup uses mock mode and seeded data.",
      ],
    ),
    bp(
      "Boundary analysis for {business}",
      "Design tests for {business}'s Match Day volume rule: every conversion gets a Match Day until the 100th of its kind; after that only above the 75th percentile of value. List the boundary cases and expected outcomes.",
      [
        "Covers the 99th, 100th, 101st and percentile boundaries.",
        "Expected outcomes are correct.",
        "Includes the round-up behaviour.",
      ],
    ),
    bp(
      "Risk-based test plan for {business}",
      "{business} ships a change to payment webhooks and a copy change on the About page in one release. Allocate testing effort, list the tests for each, and justify the imbalance.",
      [
        "Effort weighted to the payment path with specific tests.",
        "About page gets a minimal check.",
        "Justification references risk.",
      ],
    ),
  ],
  exploratory_testing: [
    bp(
      "Charter a session for {business}",
      "Write a 45-minute exploratory charter for {business}'s inbox: areas, heuristics (boundaries, interruptions, concurrency), what you log, and the defect template. Then report the three most likely defects from the fixture notes.",
      [
        "Charter is focused with named heuristics.",
        "Defect template includes severity, steps, evidence.",
        "Defects drawn from the fixture notes are plausible and specific.",
      ],
      { fixtures: { notes: "fixtures/qa/inbox_session_notes.md" } },
    ),
    bp(
      "Find what tests missed at {business}",
      "All automated tests pass for {business}'s campaign pause feature. Explore it: what sequences, timings and states would you try that tests likely do not cover? Report findings with steps.",
      [
        "Covers rapid toggles, concurrent edits, expired sessions, partial failures.",
        "Findings are reproducible steps.",
        "Prioritised by severity.",
      ],
    ),
    bp(
      "Report a defect well at {business}",
      "Convert this note into a defect report for {business}: 'pressing R twice fast gives two items sometimes'. Include title, severity, environment, steps, expected vs actual, evidence, and the failing test name you would write.",
      [
        "Report is complete and reproducible.",
        "Severity justified; expected behaviour cites the rule.",
        "Failing test name carries the criterion.",
      ],
    ),
  ],
  test_automation: [
    bp(
      "Deterministic Playwright test for {business}",
      "Write the Playwright test for {business}: 'AC-11.3.3 Continue is disabled while a blocking item is unanswered'. Use seeded mock data, wait on conditions (no sleeps), and make it independent of other tests.",
      [
        "Test is deterministic, waits on conditions, independent.",
        "Asserts both disabled state and the Respond · N label.",
        "Named with the AC id.",
      ],
      { fixtures: REPO("web-e2e"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Remove sleeps at {business}",
      "A test suite for {business} uses 14 fixed sleeps. Replace them with condition waits; explain the pattern once and show two examples from the fixture.",
      [
        "Pattern explained correctly.",
        "Examples replace sleeps with waits on observable conditions.",
        "Tests remain green.",
      ],
      { fixtures: REPO("sleepy-tests"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Test data strategy for {business}",
      "Define how {business}'s e2e tests get data: seeds, per-test isolation, resetting between runs, and how renamed departments are tested without hard-coding names.",
      [
        "Seeded, isolated, resettable data; department names not hard-coded.",
        "Handles parallel runs.",
        "Mentions mock mode.",
      ],
    ),
  ],
  technical_writing: [
    bp(
      "Document a feature for {business}",
      "Write the in-product help for {business}'s Refresh button: what it does, what it never does, what happens when nothing changed. Verify against the fixture tests. Under 120 words, plain language.",
      [
        "Accurate to the behaviour in the fixture tests.",
        "Plain, short sentences; under 120 words.",
        "States what it never does (invent events).",
      ],
      { fixtures: REPO("web-e2e"), checks: [CHECK.words(40, 130)] },
    ),
    bp(
      "Runbook for {business}",
      "Write the runbook for '{integration} credential expired' at {business}: detection, who is notified, steps (founder reconnects), verification, and what agents do meanwhile (injured state).",
      [
        "Steps are correct and ordered; founder action identified.",
        "Verification step present.",
        "Injured-state behaviour accurate.",
      ],
    ),
    bp(
      "Release notes for {business}",
      "Write release notes for {business} from the fixture changelog: user-facing changes only, plain words, links to record ids, no internal jargon. Under 200 words.",
      [
        "Includes only user-facing changes from the fixture.",
        "Plain language; links to ids.",
        "Under 200 words.",
      ],
      { fixtures: { changelog: "fixtures/docs/changelog.md" }, checks: [CHECK.words(60, 220)] },
    ),
  ],
  information_architecture: [
    bp(
      "Organise docs for {business}",
      "{business}'s docs have 38 pages with duplicates. Propose the structure: top-level sections, one home per topic, redirects for duplicates, and a rule for where new pages go.",
      [
        "Structure gives each topic one home.",
        "Duplicates handled with redirects.",
        "Placement rule is clear.",
      ],
      { fixtures: { pages: "fixtures/docs/pages.json" } },
    ),
    bp(
      "Navigation for a guide at {business}",
      "Design the navigation for {business}'s onboarding guide: task-based sections, reading order, prerequisites, and how a reader finds 'connect {integration}' in two clicks.",
      [
        "Task-based, ordered sections with prerequisites.",
        "Two-click path demonstrated.",
        "No orphan pages.",
      ],
    ),
    bp(
      "Naming consistency at {business}",
      "The docs for {business} use 'agent', 'bot', 'assistant' and 'worker' interchangeably. Define the glossary entries, which term to use where, and the find/replace plan.",
      [
        "Glossary matches the product vocabulary.",
        "Usage rules are clear.",
        "Replacement plan is safe.",
      ],
    ),
  ],
  example_quality: [
    bp(
      "Runnable example for {business}",
      "Write the example for calling {business}'s {integration} webhook receiver locally: command, sample payload, expected response, how to verify the event was written. Run it in the sandbox and include the output.",
      [
        "Example runs and the output is included.",
        "No secrets or internal hostnames.",
        "Verification step included.",
      ],
      { fixtures: REPO("gateway-service"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Fix a broken example at {business}",
      "The fixture README for {business} has an example with a renamed flag and a missing import. Find and fix both, run it, and add the test that keeps examples honest.",
      [
        "Both errors fixed; example runs.",
        "Test added for example execution.",
        "Diff minimal.",
      ],
      { fixtures: REPO("broken-readme"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Minimal example at {business}",
      "Reduce the 80-line example for {business}'s model client (fixture) to the smallest complete example that still shows mock mode, a schema and error handling.",
      [
        "Minimal yet complete.",
        "Shows mock mode, schema, error path.",
        "Correct against the fixture API.",
      ],
      { fixtures: { example: "fixtures/docs/model_client_example.ts" } },
    ),
  ],
  source_evaluation: [
    bp(
      "Rank sources for {business}",
      "You found five sources on {market} market size for {business} (fixture): a government statistics page, a vendor blog, a 2019 report, a Wikipedia article, a competitor's investor deck. Rank them, state bias and recency, and which you would cite.",
      [
        "Ranks primary and recent sources highest with reasons.",
        "Identifies bias in vendor and competitor material.",
        "Cites only the credible ones.",
      ],
      { fixtures: { sources: "fixtures/research/market_sources.json" } },
    ),
    bp(
      "Detect an unreliable claim at {business}",
      "A fixture page claims '{competitor} has 70% market share in {market}'. Evaluate the claim: who says it, on what basis, how you would verify it, and how you report it meanwhile.",
      [
        "Questions the basis and traces the claim's origin.",
        "Proposes verification against primary data.",
        "Reports it as unverified with attribution.",
      ],
      { mockTools: TOOLS.web },
    ),
    bp(
      "Robots and terms at {business}",
      "A useful source for {business}'s research disallows crawling in robots.txt. Say what you do, what alternatives you try, and how you record the gap.",
      [
        "Respects robots.txt; does not scrape.",
        "Finds lawful alternatives (official API, other sources).",
        "Records the gap transparently.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  synthesis: [
    bp(
      "Synthesise research for {business}",
      "From the fixture notes (12 sources) write the findings for {business} on {keyword}: up to 5 findings with confidence, the citations supporting each, and what remains unknown. Under 300 words.",
      [
        "Findings are supported by multiple citations where possible.",
        "Confidence stated; unknowns listed.",
        "Under 300 words.",
      ],
      { fixtures: { notes: "fixtures/research/notes_{business}.json" }, checks: [CHECK.cites(), CHECK.words(100, 320)] },
    ),
    bp(
      "Resolve disagreement in sources at {business}",
      "Two credible sources give different prices for {competitor} ({currency} 29 vs {currency} 39). Explain how you reconcile (date, region, tier), what you report, and how you label uncertainty.",
      [
        "Finds plausible reconciliation dimensions.",
        "Reports both with context rather than picking silently.",
        "Labels uncertainty.",
      ],
    ),
    bp(
      "Executive summary for {business}",
      "Summarise the fixture research pack on {market} for {founder} in 5 bullets, each with one citation id, and one sentence on what to do next.",
      [
        "Five bullets, each cited.",
        "Next step is concrete.",
        "No claims beyond the pack.",
      ],
      { fixtures: { pack: "fixtures/research/pack_{market}.json" }, checks: [CHECK.cites()] },
    ),
  ],
  citation_discipline: [
    bp(
      "Cite every number for {business}",
      "Write a 150-word competitor note on {competitor} for {business} using the mock web fixtures. Every number and claim must carry a citation id; include the citation list with URL, title, access date and a quote under 25 words.",
      [
        "No uncited numbers or claims.",
        "Citation list complete and formatted.",
        "Quotes under 25 words.",
      ],
      { mockTools: TOOLS.web, checks: [CHECK.cites(), CHECK.words(100, 200)] },
    ),
    bp(
      "Remove unsupported claims at {business}",
      "Edit the fixture draft for {business}: remove or qualify every statement without a source, and list what was removed and why.",
      [
        "All unsupported statements identified.",
        "Removed or qualified correctly.",
        "List is complete.",
      ],
      { fixtures: { draft: "fixtures/research/uncited_draft.md" } },
    ),
    bp(
      "Primary over secondary at {business}",
      "For {business}'s research on {regulator} rules, a blog summarises a regulation. Explain why you cite the regulation text, how you find it, and how you handle a summary you cannot verify.",
      [
        "Prefers primary text with a method to find it.",
        "Handles unverifiable summaries honestly.",
        "Notes the date of the regulation version.",
      ],
    ),
  ],
  market_sizing: [
    bp(
      "Bottom-up sizing for {business}",
      "Size the market for {business} ({product}, {customer}, {market}) bottom-up: segments, counts from fixture sources, penetration assumptions, {price}. Show the arithmetic, label Estimate, cite sources, give a range.",
      [
        "Arithmetic is transparent and correct.",
        "Every input cited; result labelled Estimate with a range.",
        "Assumptions stated.",
      ],
      { mockTools: TOOLS.web, checks: [CHECK.cites(), CHECK.all("Estimate")] },
    ),
    bp(
      "Top-down sanity check at {business}",
      "A bottom-up estimate for {business} is {currency} 420m. The fixture industry report gives a top-down total. Compare, explain discrepancies, and decide what to report.",
      [
        "Compares the two methods and explains differences.",
        "Reports a reconciled range with labels.",
        "Does not hide the discrepancy.",
      ],
      { fixtures: { report: "fixtures/research/industry_report.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Serviceable market for {business}",
      "From the total market for {business}, derive the serviceable and obtainable market given {market}, {price} and the distribution plan. State each filter and label the outputs.",
      [
        "Filters are explicit and reasonable.",
        "Outputs labelled Estimate.",
        "Tied to the distribution plan.",
      ],
      { checks: [CHECK.all("Estimate")] },
    ),
  ],
  code_review: [
    bp(
      "Review a diff for {business}",
      "Review the fixture diff for {business} against the task: acceptance criteria (fixture), tests, tenancy, secrets, file scope, design system. Return verdict and findings with severity, file, line, detail and smallest fix.",
      [
        "Findings cite file and line; severity drives the verdict correctly.",
        "Finds the planted tenancy and test gaps.",
        "Does not rewrite the code.",
      ],
      { fixtures: { diff: "fixtures/diffs/review_task_a.diff", task: "fixtures/diffs/review_task_a.task.json" }, mockTools: TOOLS.sandbox },
    ),
    bp(
      "Approve with evidence at {business}",
      "The fixture diff for {business} is clean. Write the approval: evidence per acceptance criterion, tests run, any nits (non-blocking). Keep it short.",
      [
        "Every criterion has evidence.",
        "Nits are marked non-blocking.",
        "Concise.",
      ],
      { fixtures: { diff: "fixtures/diffs/review_task_clean.diff" }, mockTools: TOOLS.sandbox },
    ),
    bp(
      "Block a hard-gate path at {business}",
      "The fixture diff for {business} adds a function that calls a payout API from a scheduled job. Review it and explain the block with the rule it breaks and the compliant alternative.",
      [
        "Blocks with the hard-gate rule cited.",
        "Proposes request_human_action flow as the alternative.",
        "Finding cites file and line.",
      ],
      { fixtures: { diff: "fixtures/diffs/review_payout.diff" }, checks: [CHECK.policy()] },
    ),
  ],
  change_risk_assessment: [
    bp(
      "Assess blast radius at {business}",
      "Classify these diffs for {business} by risk (low/medium/high) with reasons: adds an index; changes auth middleware; renames a UI label; alters the money rounding helper; adds a migration dropping a column.",
      [
        "Auth, money and destructive migration rated high with reasons.",
        "Index and label low.",
        "Reasons mention blast radius and reversibility.",
      ],
    ),
    bp(
      "Decide the verdict from risk at {business}",
      "A diff for {business} has one medium finding (missing negative test) and touches the payments module. Decide approve vs request changes and justify with the risk of the module.",
      [
        "Requests changes given the module risk.",
        "Justification references module criticality.",
        "Proposes the smallest addition.",
      ],
    ),
    bp(
      "Extra checks for risky diffs at {business}",
      "List the additional checks you run for a {business} diff touching RLS policies: cross-tenant tests, policy simulation, migration order, rollback. Explain each in one line.",
      [
        "All relevant checks listed with one-line reasons.",
        "Cross-tenant test is mandatory.",
        "Rollback considered.",
      ],
    ),
  ],
  conflict_resolution: [
    bp(
      "Resolve trivial conflicts for {business}",
      "Rebase the fixture branch for {business} onto main: conflicts in an import block, lockfile ordering and a changelog. Resolve, run tests, and report what you resolved and how.",
      [
        "All three trivial conflicts resolved correctly.",
        "Tests pass after rebase.",
        "Report is precise.",
      ],
      { fixtures: REPO("rebase-trivial"), mockTools: TOOLS.sandbox, checks: [CHECK.testsPass()] },
    ),
    bp(
      "Return a semantic conflict at {business}",
      "The fixture rebase for {business} conflicts in a function both branches changed logically. Explain why you do not resolve it, and write the message to the author with the hunks.",
      [
        "Recognises the semantic conflict and declines to guess.",
        "Message includes hunks and a clear ask.",
        "Branch left in a safe state.",
      ],
      { fixtures: REPO("rebase-semantic"), mockTools: TOOLS.sandbox },
    ),
    bp(
      "Preserve history at {business}",
      "Explain your rebase rules for {business}: no force-push over others' commits, keep author commits, when to squash, and how you verify nothing was lost.",
      [
        "Rules are correct and specific.",
        "Verification step included (diff against pre-rebase).",
        "Squash policy sensible.",
      ],
    ),
  ],
  release_hygiene: [
    bp(
      "PR completeness for {business}",
      "Open the PR for fixture branch agent/T-21 at {business}: title, task link, acceptance tests passed, review verdict, screenshots if UI, merge mode per business mode (assisted). Write the PR body and the merge log entry.",
      [
        "PR body complete and accurate.",
        "Merge behaviour matches assisted mode.",
        "Log entry traceable.",
      ],
      { fixtures: REPO("rebase-trivial") },
    ),
    bp(
      "Keep main green at {business}",
      "A check turned red after a rebase for {business}. Decide whether to merge, retry, or return; explain, and say how you prevent the red state from reaching main.",
      [
        "Does not merge red; returns or re-runs with reason.",
        "Prevention is concrete.",
        "Communicates to the author.",
      ],
    ),
    bp(
      "Augmented-mode merge at {business}",
      "{business} is in augmented mode. The branch is green and reviewed. Write the Inbox decision for the merge (options, recommendation, attachments) and what happens on approve/reject.",
      [
        "Decision includes PR, tests, review; one recommended option.",
        "Approve/reject paths correct.",
        "No merge before approval.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  task_decomposition: [
    bp(
      "Decompose a roadmap item for {business}",
      "Decompose for {business}: '{customer} can invite teammates with roles'. Tasks under 4 hours each with goal, file scope, worker type; dependencies; hard flags with reasons.",
      [
        "Tasks are small and have file scopes and worker types.",
        "Dependencies include shared file scopes.",
        "Hard flags justified (auth/permissions).",
      ],
      { fixtures: REPO("tanstack-hono") },
    ),
    bp(
      "Split an oversized task at {business}",
      "A task for {business} estimated at 14 hours: 'build the attribution pipeline'. Split it into tasks under 4 hours with a visible intermediate deliverable and the order.",
      [
        "Split is logical with intermediate deliverable.",
        "Each piece under 4 hours.",
        "Order respects dependencies.",
      ],
    ),
    bp(
      "Scope hints for parallel work at {business}",
      "Three engineers will work in parallel on {business}'s billing feature. Define file scopes so they never overlap, and the integration task at the end.",
      [
        "Scopes are disjoint and realistic.",
        "Integration task defined.",
        "Edges prevent concurrent overlap.",
      ],
      { fixtures: REPO("tanstack-hono") },
    ),
  ],
  acceptance_criteria: [
    bp(
      "Write criteria for {business}",
      "Write acceptance criteria for {business}: 'Refresh always yields exactly one new inbox item'. Include positive, negative and adversarial (empty state) cases, each with the test that checks it.",
      [
        "Criteria cover one-item guarantee, empty state and non-fabrication.",
        "Each criterion names its test.",
        "Testable wording.",
      ],
    ),
    bp(
      "Fix untestable criteria at {business}",
      "Rewrite: 'The export should work well for big customers' for {business} into testable criteria with numbers and conditions.",
      [
        "Numeric limits and conditions defined.",
        "Edge cases included.",
        "Intent preserved.",
      ],
    ),
    bp(
      "Criteria for a physical task at {business}",
      "Write acceptance criteria for a sourcing task at {business}: 'Get quotes for {product} packaging'. Make them checkable (count, fields, source ids, timing).",
      [
        "Criteria are countable and typed (number of quotes, fields present, ids).",
        "Includes timing and no-PO rule.",
        "Checkable without judgement.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  dependency_mapping: [
    bp(
      "Build the graph for {business}",
      "Given the fixture task list for {business} (ids, file scopes, needs), produce the dependency edges including shared-file-scope edges, verify it is acyclic, and list tasks that can start immediately.",
      [
        "Edges correct including file-scope overlaps.",
        "Acyclicity verified.",
        "Start set correct.",
      ],
      { fixtures: { tasks: "fixtures/planning/tasks_{business}.json" } },
    ),
    bp(
      "Find the cycle at {business}",
      "The fixture graph for {business} has a cycle. Find it, explain the cause, and propose the smallest change that removes it.",
      [
        "Cycle correctly identified.",
        "Minimal fix proposed.",
        "Explanation clear.",
      ],
      { fixtures: { graph: "fixtures/planning/graph_cycle.json" } },
    ),
    bp(
      "External dependencies at {business}",
      "A task for {business} depends on a founder action ({integration} credential) and a specialist deliverable. Model these in the graph and describe how the scheduler treats them.",
      [
        "External and human dependencies modelled explicitly.",
        "Scheduler behaviour (blocked state) described.",
        "No workaround that bypasses the founder action.",
      ],
      { checks: [CHECK.policy()] },
    ),
  ],
  estimation: [
    bp(
      "Estimate from history for {business}",
      "Estimate these tasks for {business} using the fixture of completed tasks (durations by type): add an index; new tRPC mutation with tests; new screen with Playwright. Show the method (median of similar) and label Estimate.",
      [
        "Uses medians of similar completed tasks with the method shown.",
        "Labels Estimate.",
        "Flags where history is thin.",
      ],
      { fixtures: { history: "fixtures/planning/completed_tasks.json" }, checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "No history yet at {business}",
      "{business} has no completed tasks. Estimate the first three tasks using archetype priors, label them, and say when you would switch to the business's own data.",
      [
        "Uses priors and labels them.",
        "Switch condition is defined (count of similar tasks).",
        "Estimates are plausible.",
      ],
      { checks: [CHECK.all("Estimate")] },
    ),
    bp(
      "Re-estimate after a miss at {business}",
      "A task for {business} estimated at 2 hours took 7. Explain how you update the estimate for the remaining similar tasks, what you do not change, and what you tell the lead.",
      [
        "Updates similar tasks proportionately with reasoning.",
        "Does not over-correct unrelated estimates.",
        "Communicates the ETA change factually.",
      ],
    ),
  ],
};
