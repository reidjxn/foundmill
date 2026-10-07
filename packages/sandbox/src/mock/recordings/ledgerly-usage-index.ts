/**
 * Backend session (Ledgerly API) that blocks on an approval the founder has to answer: the agent adds a
 * usage-report endpoint, finds the query needs a composite index, and — because the business runs with
 * "Ask before schema changes" — asks before applying the migration. The hold has no auto-resolve, so under
 * `holds: "as_recorded"` the replay waits for `decide()` exactly like a live session waits for the Inbox.
 */
import type { RecordingInput } from "../recording";
import { call, ev, note, phase, progress } from "./helpers";

const TEST_PASS = ["PASS src/reports/usage.test.ts", "  ✓ sums metered events per customer for the period", "  ✓ rejects a period longer than 92 days", "  ✓ returns 404 for a customer outside the business", "", "Tests  3 passed"].join("\n");

const EXPLAIN_SLOW = [
  "Seq Scan on usage_events  (cost=0.00..48213.00 rows=1842 width=72) (actual time=0.031..412.884 rows=1790 loops=1)",
  "  Filter: ((business_id = $1) AND (customer_id = $2) AND (occurred_at >= $3) AND (occurred_at < $4))",
  "  Rows Removed by Filter: 1998210",
  "Planning Time: 0.214 ms",
  "Execution Time: 413.102 ms",
].join("\n");

const EXPLAIN_FAST = [
  "Index Scan using usage_events_customer_period_idx on usage_events  (cost=0.56..61.20 rows=1842 width=72) (actual time=0.044..1.912 rows=1790 loops=1)",
  "  Index Cond: ((business_id = $1) AND (customer_id = $2) AND (occurred_at >= $3) AND (occurred_at < $4))",
  "Planning Time: 0.231 ms",
  "Execution Time: 2.108 ms",
].join("\n");

export const ledgerlyUsageIndex: RecordingInput = {
  key: "ledgerly-usage-index",
  title: "Usage report endpoint with a composite index",
  summary:
    "A backend agent adds GET /v1/customers/:id/usage to Ledgerly's API with three acceptance tests, measures the query with EXPLAIN ANALYZE, and drafts a migration for a composite index. The business asks before schema changes, so the migration waits for the founder; once approved it runs, the plan drops from 413 ms to 2 ms, and the pull request merges.",
  taskKind: "code",
  agentTemplate: "backend_engineer",
  modelKey: "sonnet",
  business: "Ledgerly",
  repo: { url: "https://github.com/foundmill-demo/ledgerly.git", branch: "agent/task-usage-report" },
  files: {
    "package.json": '{\n  "name": "ledgerly",\n  "private": true,\n  "scripts": { "test": "vitest run", "db:migrate": "drizzle-kit migrate" }\n}\n',
    "src/reports/usage.ts": "export async function usageForCustomer(customerId: string, from: Date, to: Date) {\n  throw new Error(\"not implemented\");\n}\n",
    "migrations/README.md": "# Migrations\n\nOne SQL file per change; never edit an applied file.\n",
  },
  commands: [
    { match: "^pnpm test", results: [{ code: 0, stdout: TEST_PASS, durationMs: 3100 }] },
    { match: "^pnpm db:migrate", results: [{ code: 0, stdout: "Applying 0019_usage_events_customer_period_idx.sql ... done (1 migration)\n", durationMs: 2600 }] },
    { match: "^psql", results: [{ code: 0, stdout: EXPLAIN_SLOW, durationMs: 900 }, { code: 0, stdout: EXPLAIN_FAST, durationMs: 300 }] },
  ],
  planSteps: 4,
  acceptanceTests: 3,
  outcome: "done",
  events: [
    ev(0, phase(null, "planning", "Customer success asked for per-customer usage in the API")),
    ev(600, note("Acceptance: sums per customer for a period, caps the period at 92 days, hides customers of other businesses. Checking the usage_events table and the existing report routes first.")),
    ev(1400, call("c1", "github", "read_file", "started", { argsSummary: "src/db/schema/usage-events.ts" })),
    ev(2000, call("c1", "github", "read_file", "succeeded", { argsSummary: "src/db/schema/usage-events.ts", resultSummary: "usage_events(business_id, customer_id, kind, quantity, occurred_at); only a primary key index", durationMs: 600, policyOutcome: "allow" })),
    ev(2300, progress(1, 4, 0, 3)),
    ev(2800, phase("planning", "implementing", "Plan: query function, route + validation, tests, then measure")),
    ev(4200, { kind: "file_changed", path: "src/reports/usage.ts", change: "modified", additions: 34, deletions: 3, diff: "--- a/src/reports/usage.ts\n+++ b/src/reports/usage.ts\n@@ -1,3 +1,20 @@\n-export async function usageForCustomer(customerId: string, from: Date, to: Date) {\n-  throw new Error(\"not implemented\");\n+export async function usageForCustomer(db: Db, businessId: string, customerId: string, from: Date, to: Date) {\n+  assertPeriod(from, to);\n+  return repos.usage.sumByKind(db, businessId, { customerId, from, to });\n }\n" }),
    ev(5300, { kind: "file_changed", path: "src/routes/customers/usage.ts", change: "created", additions: 41, deletions: 0 }),
    ev(6100, { kind: "file_changed", path: "src/reports/usage.test.ts", change: "created", additions: 58, deletions: 0 }),
    ev(6400, progress(2, 4, 0, 3)),
    ev(6900, phase("implementing", "testing")),
    ev(7600, { kind: "stdout", command: "pnpm test src/reports", text: TEST_PASS }),
    ev(8200, { kind: "test_result", suite: "src/reports/usage.test.ts", command: "pnpm test src/reports", passed: 3, failed: 0, acceptance: true, durationMs: 3100 }),
    ev(8400, progress(3, 4, 3, 3)),
    ev(9000, note("Tests are green; measuring the query against the staging-sized fixture before calling it done.")),
    ev(9800, { kind: "stdout", command: "psql -c 'explain analyze ...'", text: EXPLAIN_SLOW }),
    ev(10500, note("413 ms with a sequential scan over two million rows. A composite index on (business_id, customer_id, occurred_at) brings this to an index scan. Drafting the migration.")),
    ev(11600, {
      kind: "file_changed",
      path: "migrations/0019_usage_events_customer_period_idx.sql",
      change: "created",
      additions: 3,
      deletions: 0,
      diff: "--- /dev/null\n+++ b/migrations/0019_usage_events_customer_period_idx.sql\n@@ -0,0 +1,3 @@\n+-- Usage report: per-customer period queries (BUILD: ask before schema changes)\n+create index concurrently if not exists usage_events_customer_period_idx\n+  on usage_events (business_id, customer_id, occurred_at);\n",
    }),
    ev(
      12300,
      call("c2", "github", "run_migration", "awaiting_approval", {
        argsSummary: "0019_usage_events_customer_period_idx.sql: create index concurrently on usage_events (business_id, customer_id, occurred_at)",
        policyOutcome: "ask",
        approvalId: "apr-3c88",
      }),
      { kind: "approval", approvalId: "apr-3c88", autoResolveAfterMs: null },
    ),
    ev(12400, note("Schema changes need the founder's approval in this club. Waiting on approval apr-3c88; the endpoint and tests are complete in the meantime.", "system")),
    ev(13200, call("c2", "github", "run_migration", "succeeded", { argsSummary: "0019_usage_events_customer_period_idx.sql", resultSummary: "Migration applied (1 index, built concurrently)", durationMs: 2600, policyOutcome: "allow", approvalId: "apr-3c88" })),
    ev(13700, { kind: "stdout", command: "pnpm db:migrate", text: "Applying 0019_usage_events_customer_period_idx.sql ... done (1 migration)\n" }),
    ev(14600, { kind: "stdout", command: "psql -c 'explain analyze ...'", text: EXPLAIN_FAST }),
    ev(15000, note("Index scan, 2 ms. Query plan before and after attached to the pull request.")),
    ev(15300, progress(4, 4, 3, 3)),
    ev(15800, phase("testing", "review", "Opening the pull request")),
    ev(16600, call("c3", "github", "open_pull_request", "started", { argsSummary: "agent/task-usage-report → main: Customer usage report endpoint + composite index" })),
    ev(17500, call("c3", "github", "open_pull_request", "succeeded", { argsSummary: "agent/task-usage-report → main", resultSummary: "Pull request 57 opened; CI started", durationMs: 900, policyOutcome: "allow" })),
    ev(18400, note("Business scoping is enforced in the repository call, the period cap is tested, and the index is built concurrently. Approved.", "reviewer")),
    ev(18600, progress(4, 4, 3, 3, true)),
    ev(19000, phase("review", "merge")),
    ev(19700, call("c4", "github", "merge_pull_request", "started", { argsSummary: "pull request 57 (squash)" })),
    ev(20400, call("c4", "github", "merge_pull_request", "succeeded", { argsSummary: "pull request 57 (squash)", resultSummary: "Merged as c21d4e7", durationMs: 700, policyOutcome: "allow" })),
    ev(20600, progress(4, 4, 3, 3, true, true)),
    ev(20700, phase("merge", "done", "Merged; migration runs in the deploy step")),
  ],
};
