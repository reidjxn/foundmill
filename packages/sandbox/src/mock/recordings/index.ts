/**
 * Bundled recordings for the mock sandbox (BUILD §13.3). Seven sessions over the two demo businesses
 * (BUILD §17.2): a backend task that fails its tests and then fixes them, a research task, a finance task
 * that meets an auto-resolving approval hold and then a hard gate, a code task that loops and fails, a
 * frontend task with Playwright and a founder Shout, and a backend task that waits on the founder's approval
 * for a schema change. `recordings.test.ts` validates every event against the `@foundmill/events`
 * schemas and replays each recording end to end.
 *
 * Events are `SessionEventDraft`s (no `at`; replay fills it in; see ./helpers.ts). Progress follows BUILD
 * §11.6: 0.2·plan + 0.5·acceptance + 0.2·review + 0.1·merged — never token-based.
 */
import { parseRecording, type Recording, type RecordingInput } from "../recording";
import { call, ev, note, phase, progress } from "./helpers";
import { ledgerlyUsageIndex } from "./ledgerly-usage-index";
import { northwindBundlePicker } from "./northwind-bundle-picker";

const FAILING_TEST_OUTPUT = [
  "FAIL src/webhooks/stripe.test.ts",
  "  ✓ accepts a signed event",
  "  ✗ retries a failed delivery with backoff",
  "  ✗ gives up after five attempts",
  "",
  "Tests  1 passed, 2 failed",
].join("\n");

const PASSING_TEST_OUTPUT = ["PASS src/webhooks/stripe.test.ts", "  ✓ accepts a signed event", "  ✓ retries a failed delivery with backoff", "  ✓ gives up after five attempts", "", "Tests  3 passed"].join("\n");

/** Engineer agent on Ledgerly: a code task that gets its acceptance tests green and merges. */
const ledgerlyWebhookRetry: RecordingInput = {
  key: "ledgerly-webhook-retry",
  title: "Retry failed Stripe payment notifications with backoff",
  summary:
    "An engineer agent adds exponential backoff to the handler for Ledgerly's Stripe payment notifications: it reads the handler and its tests, moves retries behind the queue so acknowledgments stay fast, gets the three acceptance tests green, opens a pull request and merges after review.",
  taskKind: "code",
  agentTemplate: "engineer",
  modelKey: "sonnet",
  business: "Ledgerly",
  repo: { url: "https://github.com/foundmill-demo/ledgerly.git", branch: "agent/task-stripe-retry" },
  files: {
    "package.json": '{\n  "name": "ledgerly",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n',
    "src/webhooks/stripe.ts": [
      "import { verifySignature } from \"./signature\";",
      "import { enqueue } from \"../queue\";",
      "",
      "export async function handleStripeWebhook(req: Request): Promise<Response> {",
      "  const event = await verifySignature(req);",
      "  await enqueue(\"stripe\", event);",
      "  return new Response(null, { status: 202 });",
      "}",
      "",
    ].join("\n"),
    "src/webhooks/stripe.test.ts": [
      "import { describe, expect, it } from \"vitest\";",
      "import { handleStripeWebhook } from \"./stripe\";",
      "",
      "describe(\"stripe events\", () => {",
      "  it(\"accepts a signed event\", async () => {",
      "    expect((await handleStripeWebhook(signed())).status).toBe(202);",
      "  });",
      "});",
      "",
    ].join("\n"),
  },
  commands: [
    {
      match: "^pnpm test",
      results: [
        { code: 1, stdout: FAILING_TEST_OUTPUT, durationMs: 4200 },
        { code: 0, stdout: PASSING_TEST_OUTPUT, durationMs: 3900 },
      ],
    },
    { match: "^git status", results: [{ code: 0, stdout: "On branch agent/task-stripe-retry\nnothing to commit, working tree clean\n" }] },
  ],
  planSteps: 4,
  acceptanceTests: 3,
  outcome: "done",
  events: [
    ev(0, phase(null, "planning", "Task picked up from the sprint board")),
    ev(400, note("Reading the Stripe notification handler and its tests before changing anything.")),
    ev(1200, call("c1", "github", "read_file", "started", { argsSummary: "src/webhooks/stripe.ts" })),
    ev(1900, call("c1", "github", "read_file", "succeeded", { argsSummary: "src/webhooks/stripe.ts", resultSummary: "182 lines; deliveries are acknowledged before processing and there is no retry logic", durationMs: 700, policyOutcome: "allow" })),
    ev(2600, progress(1, 4, 0, 3)),
    ev(3000, phase("planning", "implementing", "Plan agreed: retry schedule, backoff helper, handler change, tests")),
    ev(4500, {
      kind: "file_changed",
      path: "src/webhooks/backoff.ts",
      change: "created",
      additions: 41,
      deletions: 0,
      diff: "--- /dev/null\n+++ b/src/webhooks/backoff.ts\n@@ -0,0 +1,41 @@\n+export const SCHEDULE_MS = [1_000, 5_000, 30_000, 120_000, 600_000];\n+export function nextAttemptAt(attempt: number, now: number): number | null {\n+  const delay = SCHEDULE_MS[attempt];\n+  return delay === undefined ? null : now + delay;\n+}\n",
    }),
    ev(6200, { kind: "file_changed", path: "src/webhooks/stripe.ts", change: "modified", additions: 23, deletions: 6, diff: "--- a/src/webhooks/stripe.ts\n+++ b/src/webhooks/stripe.ts\n@@ -1,8 +1,25 @@\n import { verifySignature } from \"./signature\";\n-import { enqueue } from \"../queue\";\n+import { enqueue, scheduleRetry } from \"../queue\";\n+import { nextAttemptAt } from \"./backoff\";\n" }),
    ev(7000, progress(2, 4, 0, 3)),
    ev(7600, { kind: "stdout", command: "pnpm test", text: FAILING_TEST_OUTPUT }),
    ev(8400, { kind: "test_result", suite: "src/webhooks/stripe.test.ts", command: "pnpm test", passed: 1, failed: 2, acceptance: true, failures: ["retries a failed delivery with backoff", "gives up after five attempts"], durationMs: 4200 }),
    ev(8600, progress(2, 4, 1, 3)),
    ev(9000, note("The retry schedule runs in the request path, so the acknowledgment waits on it. Moving the retry behind the queue.")),
    ev(10500, { kind: "file_changed", path: "src/webhooks/stripe.ts", change: "modified", additions: 12, deletions: 9 }),
    ev(11200, { kind: "file_changed", path: "src/webhooks/stripe.test.ts", change: "modified", additions: 18, deletions: 2 }),
    ev(12000, phase("implementing", "testing")),
    ev(12800, { kind: "stdout", command: "pnpm test", text: PASSING_TEST_OUTPUT }),
    ev(13500, { kind: "test_result", suite: "src/webhooks/stripe.test.ts", command: "pnpm test", passed: 3, failed: 0, acceptance: true, durationMs: 3900 }),
    ev(13700, progress(3, 4, 3, 3)),
    ev(14200, phase("testing", "review", "Opening the pull request")),
    ev(15000, call("c2", "github", "open_pull_request", "started", { argsSummary: "agent/task-stripe-retry → main: Retry failed Stripe payment notifications" })),
    ev(15900, call("c2", "github", "open_pull_request", "succeeded", { argsSummary: "agent/task-stripe-retry → main", resultSummary: "Pull request 41 opened; CI started", durationMs: 900, policyOutcome: "allow" })),
    ev(16400, note("Backoff is capped at five attempts and the acknowledgment path is unchanged. Approved.", "reviewer")),
    ev(16800, progress(4, 4, 3, 3, true)),
    ev(17200, phase("review", "merge")),
    ev(18000, call("c3", "github", "merge_pull_request", "started", { argsSummary: "pull request 41 (squash)" })),
    ev(18700, call("c3", "github", "merge_pull_request", "succeeded", { argsSummary: "pull request 41 (squash)", resultSummary: "Merged as 9f3c2d1", durationMs: 700, policyOutcome: "allow" })),
    ev(18900, progress(4, 4, 3, 3, true, true)),
    ev(19000, phase("merge", "done", "Merged; the deploy follows the usual pipeline")),
  ],
};

/** Sourcing specialist on Northwind Skincare: a research task that reads quarantined web content and delivers a brief. */
const northwindSupplierShortlist: RecordingInput = {
  key: "northwind-supplier-shortlist",
  title: "Shortlist three EU suppliers for a fragrance-free emulsifier",
  summary:
    "A sourcing specialist checks the company register, reads three supplier catalogs as quarantined content and writes a comparison brief covering minimum order, certification, lead time and price basis. The Formulation Lab lead reviews it and the shortlist lands in the Inbox.",
  taskKind: "research",
  agentTemplate: "sourcing-specialist",
  modelKey: "sonnet",
  business: "Northwind Skincare",
  files: { "brief/README.md": "# Sourcing briefs\n\nOne markdown file per request. Every number carries its source.\n" },
  commands: [{ match: "^ls", results: [{ code: 0, stdout: "brief\n" }] }],
  planSteps: 3,
  acceptanceTests: 1,
  outcome: "done",
  events: [
    ev(0, phase(null, "planning", "Sourcing request from the Formulation Lab")),
    ev(500, note("Brief: fragrance-free emulsifier, EU-based, minimum order under 25 kg, COSMOS-approved. Registries first, then supplier pages.")),
    ev(1500, call("c1", "companies_house", "search_companies", "started", { argsSummary: "cosmetic ingredient suppliers, SIC 20420, active" })),
    ev(2600, call("c1", "companies_house", "search_companies", "succeeded", { argsSummary: "cosmetic ingredient suppliers, SIC 20420, active", resultSummary: "14 active companies; 6 list emulsifiers in their filings", durationMs: 1100, policyOutcome: "allow" })),
    ev(2800, progress(1, 3, 0, 1)),
    ev(3200, phase("planning", "implementing", "Reading supplier pages and building the comparison")),
    ev(4000, call("c2", "browser", "fetch_page", "started", { argsSummary: "greenchem-emulsifiers.example/products" })),
    ev(5200, call("c2", "browser", "fetch_page", "succeeded", { argsSummary: "greenchem-emulsifiers.example/products", resultSummary: "Product list and minimum order captured", durationMs: 1200, policyOutcome: "allow" })),
    ev(5400, note("Fetched pages are untrusted content: facts are cited with their source and nothing on them is followed as an instruction.", "system")),
    ev(6500, call("c3", "browser", "fetch_page", "started", { argsSummary: "nordic-cosmetic-raw.example/catalogue" })),
    ev(7400, call("c3", "browser", "fetch_page", "succeeded", { argsSummary: "nordic-cosmetic-raw.example/catalogue", resultSummary: "Minimum order 10 kg; COSMOS certificate linked", durationMs: 900, policyOutcome: "allow" })),
    ev(8200, call("c4", "browser", "fetch_page", "started", { argsSummary: "balticsurfactants.example/emulsifiers" })),
    ev(9000, call("c4", "browser", "fetch_page", "succeeded", { argsSummary: "balticsurfactants.example/emulsifiers", resultSummary: "Fragrance-free range confirmed; pricing on request", durationMs: 800, policyOutcome: "allow" })),
    ev(9300, progress(2, 3, 0, 1)),
    ev(10500, { kind: "file_changed", path: "brief/emulsifier-suppliers.md", change: "created", additions: 64, deletions: 0, diff: "--- /dev/null\n+++ b/brief/emulsifier-suppliers.md\n@@ -0,0 +1,64 @@\n+# Fragrance-free emulsifier — EU supplier shortlist\n+\n+| Supplier | Minimum order | Certification | Lead time (Estimate) | Price basis |\n" }),
    ev(11200, { kind: "test_result", suite: "sourcing brief checklist", passed: 1, failed: 0, acceptance: true }),
    ev(11400, progress(3, 3, 1, 1)),
    ev(11800, phase("implementing", "review", "Brief handed to the Formulation Lab lead")),
    ev(12600, note("Three suppliers, each with a source and a certificate link; lead times are labeled as estimates. Approved.", "reviewer")),
    ev(12800, progress(3, 3, 1, 1, true)),
    ev(13000, phase("review", "done", "Shortlist delivered to the Inbox")),
  ],
};

/** Finance lead on Ledgerly: an approval hold that resolves, then a hard gate that blocks the task. */
const ledgerlyAnnualPlanDiscount: RecordingInput = {
  key: "ledgerly-annual-plan-discount",
  title: "Launch the annual-plan discount in Stripe",
  summary:
    "A finance lead prepares a 90-day discount on annual plans. Creating the coupon needs the founder's approval (the replay holds there); enabling Stripe Tax needs the founder to accept Stripe's terms, which agents never do, so the session ends blocked with a founder task.",
  taskKind: "finance",
  agentTemplate: "finance-lead",
  modelKey: "opus",
  business: "Ledgerly",
  planSteps: 3,
  acceptanceTests: 1,
  outcome: "blocked",
  events: [
    ev(0, phase(null, "planning", "Pricing experiment agreed in Monday's cycle")),
    ev(600, note("Plan: check the current annual prices, create a 90-day 20% coupon in test mode, then wire it to the pricing page.")),
    ev(1500, call("c1", "stripe", "list_prices", "started", { argsSummary: "active recurring prices" })),
    ev(2300, call("c1", "stripe", "list_prices", "succeeded", { argsSummary: "active recurring prices", resultSummary: "4 prices; annual plans at 290 and 990 EUR", durationMs: 800, policyOutcome: "allow" })),
    ev(2500, progress(1, 3, 0, 1)),
    ev(3000, phase("planning", "implementing")),
    ev(
      4200,
      call("c2", "stripe", "create_coupon", "awaiting_approval", { argsSummary: "ANNUAL20: 20% off annual plans for 90 days (test mode)", policyOutcome: "ask", approvalId: "apr-7f21" }),
      { kind: "approval", approvalId: "apr-7f21", autoResolveAfterMs: 1500, autoResolveOutcome: "approved" },
    ),
    ev(4300, call("c2", "stripe", "create_coupon", "succeeded", { argsSummary: "ANNUAL20: 20% off annual plans for 90 days (test mode)", resultSummary: "Coupon ANNUAL20 created (test mode)", durationMs: 600, policyOutcome: "allow", approvalId: "apr-7f21" })),
    ev(4500, progress(2, 3, 0, 1)),
    ev(5400, call("c3", "stripe", "accept_terms", "denied", { argsSummary: "Stripe Tax terms of service", policyOutcome: "deny", error: "hard_gate: agents never accept terms; a founder task was created" })),
    ev(5600, note("Stripe Tax must be enabled by the founder before the discount can go live. A founder task was created; this session is blocked until it is done.", "system", "warn")),
  ],
};

/** Finance lead on Ledgerly: the first runway forecast, built from read-only data, delivered to the Inbox. */
const ledgerlyRunwayForecast: RecordingInput = {
  key: "ledgerly-runway-forecast",
  title: "Build the first runway forecast",
  summary:
    "A finance lead reads the connected balances and recurring prices (read only), builds a twelve-month runway Forecast with the assumptions written beside every number, and hands it to the Inbox. Nothing is spent and nothing moves; every figure is labeled Forecast or Estimate.",
  taskKind: "finance",
  agentTemplate: "finance-lead",
  modelKey: "opus",
  business: "Ledgerly",
  files: { "forecast/README.md": "# Forecasts\n\nOne markdown file per forecast. Every number is labeled Forecast or Estimate and carries its assumption.\n" },
  commands: [{ match: "^ls", results: [{ code: 0, stdout: "forecast\n" }] }],
  planSteps: 3,
  acceptanceTests: 1,
  outcome: "done",
  events: [
    ev(0, phase(null, "planning", "First runway forecast requested at Commit")),
    ev(500, note("Plan: read the balances and the recurring prices, model twelve months with three scenarios, write every assumption next to its number.")),
    ev(1400, call("c1", "stripe", "list_prices", "started", { argsSummary: "active recurring prices" })),
    ev(2200, call("c1", "stripe", "list_prices", "succeeded", { argsSummary: "active recurring prices", resultSummary: "4 recurring prices read", durationMs: 800, policyOutcome: "allow" })),
    ev(2400, progress(1, 3, 0, 1)),
    ev(2900, phase("planning", "implementing", "Building the scenarios")),
    ev(3800, call("c2", "finance", "read_balances", "started", { argsSummary: "connected accounts, read only" })),
    ev(4600, call("c2", "finance", "read_balances", "succeeded", { argsSummary: "connected accounts, read only", resultSummary: "Balances read; no connected account is a demo balance", durationMs: 800, policyOutcome: "allow" })),
    ev(4800, progress(2, 3, 0, 1)),
    ev(6000, { kind: "file_changed", path: "forecast/runway.md", change: "created", additions: 38, deletions: 0, diff: "--- /dev/null\n+++ b/forecast/runway.md\n@@ -0,0 +1,38 @@\n+# Runway Forecast (12 months)\n+\n+Every figure below is a Forecast, built from the assumptions beside it.\n" }),
    ev(6800, { kind: "test_result", suite: "forecast checklist", passed: 1, failed: 0, acceptance: true }),
    ev(7000, progress(3, 3, 1, 1)),
    ev(7400, phase("implementing", "review", "Forecast handed to the Chief of Staff")),
    ev(7800, note("Every number is labeled Forecast or Estimate and lists its assumption. Approved.", "reviewer")),
    ev(8000, progress(3, 3, 1, 1, true)),
    ev(8200, phase("review", "done", "Forecast delivered to the Inbox")),
  ],
};

/** Engineer agent on Ledgerly: the same acceptance test fails three times and loop detection stops the session. */
const ledgerlyFlakyImportTest: RecordingInput = {
  key: "ledgerly-flaky-import-test",
  title: "Fix the flaky CSV import test",
  summary:
    "An engineer agent tries three different fixes for a CSV import test that depends on row ordering. Each attempt fails the same acceptance test, loop detection pauses the session and the task goes back to its lead with the diff attached.",
  taskKind: "code",
  agentTemplate: "engineer",
  modelKey: "sonnet",
  business: "Ledgerly",
  repo: { url: "https://github.com/foundmill-demo/ledgerly.git", branch: "agent/task-flaky-import" },
  files: { "src/import/csv.ts": "export function importRows(text: string): string[][] {\n  return text.split(\"\\n\").map((l) => l.split(\",\"));\n}\n" },
  commands: [{ match: "^pnpm test", results: [{ code: 1, stdout: "FAIL src/import/csv.test.ts\n  ✗ imports rows in file order\n\nTests  0 passed, 1 failed", durationMs: 2100 }] }],
  planSteps: 2,
  acceptanceTests: 1,
  outcome: "failed",
  events: [
    ev(0, phase(null, "planning", "Flaky test flagged by CI three times this week")),
    ev(700, note("The CSV import test depends on wall-clock ordering. Trying a deterministic clock first.")),
    ev(1500, phase("planning", "implementing")),
    ev(2800, { kind: "file_changed", path: "src/import/csv.test.ts", change: "modified", additions: 6, deletions: 2 }),
    ev(3600, { kind: "stdout", command: "pnpm test src/import", text: "FAIL src/import/csv.test.ts\n  ✗ imports rows in file order\n\nTests  0 passed, 1 failed" }),
    ev(4200, { kind: "test_result", suite: "src/import/csv.test.ts", command: "pnpm test src/import", passed: 0, failed: 1, acceptance: true, failures: ["imports rows in file order"], durationMs: 2100 }),
    ev(4400, progress(1, 2, 0, 1)),
    ev(5200, note("Same failure. The parser reorders rows when ids collide; patching the parser instead.")),
    ev(6500, { kind: "file_changed", path: "src/import/csv.ts", change: "modified", additions: 9, deletions: 4 }),
    ev(7300, { kind: "stdout", command: "pnpm test src/import", text: "FAIL src/import/csv.test.ts\n  ✗ imports rows in file order\n\nTests  0 passed, 1 failed" }),
    ev(7900, { kind: "test_result", suite: "src/import/csv.test.ts", command: "pnpm test src/import", passed: 0, failed: 1, acceptance: true, failures: ["imports rows in file order"], durationMs: 2000 }),
    ev(8600, note("Still failing. Reverting the parser change and sorting in the test instead.")),
    ev(9800, { kind: "file_changed", path: "src/import/csv.ts", change: "modified", additions: 4, deletions: 9 }),
    ev(10400, { kind: "test_result", suite: "src/import/csv.test.ts", command: "pnpm test src/import", passed: 0, failed: 1, acceptance: true, failures: ["imports rows in file order"], durationMs: 2200 }),
    ev(10600, note("Loop detected: the same acceptance test has failed three times with similar changes. Pausing the session and returning the task to its lead with the diff attached.", "system", "warn")),
  ],
};

/** Every bundled recording, validated at module load so a malformed fixture fails fast. */
export const RECORDINGS: readonly Recording[] = [ledgerlyWebhookRetry, northwindSupplierShortlist, ledgerlyAnnualPlanDiscount, ledgerlyRunwayForecast, ledgerlyFlakyImportTest, northwindBundlePicker, ledgerlyUsageIndex].map(parseRecording);

export const RECORDING_KEYS: readonly string[] = RECORDINGS.map((r) => r.key);

export function findRecording(key: string): Recording | undefined {
  return RECORDINGS.find((r) => r.key === key);
}
