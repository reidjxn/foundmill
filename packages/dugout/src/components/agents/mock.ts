/**
 * Deterministic mock data for the agents group: stories, tests and the dev-only Simulate panel. Seeded, so the same
 * seed always produces the same squad, sessions and boards. Nothing here reaches production code paths.
 */
import { CHANNEL_KEYS, CHANNEL_META, type ChannelKey, type DeptColourToken, type ModelKey, type TaskStatus } from "@foundmill/shared";
import { createRng, type Rng } from "../../lib/seed";
import type {
  AgentInstructions,
  AgentSessionEvent,
  ChannelTokenData,
  FormCell,
  HierarchyNode,
  InstructionVersion,
  ModelOption,
  PlanStep,
  PositionRole,
  SkillHistorySeries,
  SpecialistData,
  SquadRow,
  TaskGraphNode,
  TileAgent,
  TileTask,
  Trait,
  TrainingSessionMark,
  TrainingSkillResult,
} from "./types";
import type { SessionSeed } from "./progress";
import { computeProgress } from "./progress";

const NAMES = ["Juno", "Pike", "Marlow", "Isolde", "Teodor", "Wren", "Cassian", "Ottilie", "Rafe", "Sunniva", "Bram", "Linnea", "Osric", "Ferne", "Lucan", "Mireille", "Tobiah", "Elin", "Quill", "Saskia", "Dmitri", "Noor", "Halvard", "Perpetua"];
const ROLES: Array<{ role: string; dept: DeptColourToken; kind: TileTask["kind"]; model: ModelKey }> = [
  { role: "Frontend engineer", dept: "dept-2", kind: "code", model: "sonnet" },
  { role: "Backend engineer", dept: "dept-2", kind: "code", model: "sonnet" },
  { role: "QA engineer", dept: "dept-2", kind: "code", model: "sonnet" },
  { role: "Data engineer", dept: "dept-2", kind: "code", model: "opus" },
  { role: "Researcher", dept: "dept-1", kind: "research", model: "sonnet" },
  { role: "Email engine", dept: "dept-3", kind: "channel", model: "sonnet" },
  { role: "SEO engine", dept: "dept-3", kind: "channel", model: "sonnet" },
  { role: "Docs writer", dept: "dept-2", kind: "code", model: "haiku" },
];
const TASKS = [
  "Add a bundle picker to the product page",
  "Usage index for the Ledgerly dashboard",
  "Dunning e-mail sequence, three steps",
  "Playwright coverage for checkout",
  "Rate-limit the public API",
  "Supplier brief for the serum pump",
  "Keyword briefs for the retinol guide",
  "Migrate orders to the new schema",
  "Weekly investor update draft",
  "Pricing page copy A/B variant",
  "Webhook retries with dead letters",
  "Onboarding checklist component",
  "Competitor teardown: three incumbents",
  "Cohort retention query",
  "Image pipeline for product photos",
  "Accessibility sweep of the storefront",
  "Shopify order sync reconciliation",
  "Lifecycle: activation nudge",
  "Sitemap and canonical fixes",
  "Refund policy page",
  "CSV import for leads",
  "Audit log viewer",
  "Search index refresh job",
  "Postcard campaign for Stockholm pilots",
];

export function mockAgent(i: number): TileAgent {
  const r = ROLES[i % ROLES.length]!;
  return { id: `agent-${i + 1}`, name: NAMES[i % NAMES.length]!, seed: `agent-${i + 1}`, dept: r.dept, status: "healthy", model: r.model, role: r.role };
}

export function mockTask(i: number): TileTask {
  const r = ROLES[i % ROLES.length]!;
  return { id: `task-${i + 1}`, title: TASKS[i % TASKS.length]!, href: `#task-${i + 1}`, kind: r.kind, branch: `agent/task-${i + 1}` };
}

const PLAN_TEMPLATES = [
  ["Read the task and acceptance tests", "Sketch the component API", "Implement the component", "Wire it into the page", "Write Playwright tests", "Run the full suite", "Open the pull request"],
  ["Inspect the existing schema", "Write the migration", "Update the repository functions", "Add unit tests", "Run RLS tests", "Open the pull request"],
  ["Collect sources", "Extract typed facts through the quarantined reader", "Score and rank", "Write the brief", "Link entities"],
];

export function mockPlan(i: number): PlanStep[] {
  const t = PLAN_TEMPLATES[i % PLAN_TEMPLATES.length]!;
  return t.map((text, k) => ({ id: `step-${k + 1}`, text, state: "todo" as const }));
}

const STDOUT_LINES = [
  "$ pnpm install --frozen-lockfile",
  "Lockfile is up to date, resolution step is skipped",
  "Progress: resolved 412, reused 412, downloaded 0, added 0",
  "$ pnpm vitest run src/components/BundlePicker.test.tsx",
  " RUN  v5.0.3 /workspace/northwind-storefront",
  " ✓ src/components/BundlePicker.test.tsx (4 tests) 212ms",
  " Test Files  1 passed (1)",
  "      Tests  4 passed (4)",
  "$ pnpm playwright test e2e/product-bundle.spec.ts",
  "Running 3 tests using 1 worker",
  "  ✓  1 e2e/product-bundle.spec.ts:8:5 › shows the three bundle sizes (1.9s)",
  "  ✘  2 e2e/product-bundle.spec.ts:19:5 › selecting a bundle updates the price (2.4s)",
  "  2 passed, 1 failed (6.2s)",
  "$ git add -A && git commit -m \"feat(product): bundle picker with keyboard support\"",
  "[agent/task-1 4f2c9a1] feat(product): bundle picker with keyboard support",
  " 3 files changed, 184 insertions(+), 12 deletions(-)",
  "$ pnpm tsc --noEmit",
  "$ pnpm eslint src",
  "$ pnpm playwright test e2e/product-bundle.spec.ts",
  "  3 passed (5.6s)",
  "$ gh pr create --fill --base main",
  "https://github.com/foundmill-demo/northwind-storefront/pull/41",
];

const FILE_DIFF = [
  "diff --git a/src/components/bundle-picker.tsx b/src/components/bundle-picker.tsx",
  "--- a/src/components/bundle-picker.tsx",
  "+++ b/src/components/bundle-picker.tsx",
  "@@ -1,8 +1,22 @@",
  ' import { useState } from "react";',
  "+import { formatPrice } from \"@/lib/format\";",
  " ",
  "-export function BundlePicker() {",
  "-  return <div>TODO</div>;",
  "+export type Bundle = { id: string; label: string; priceMinor: number };",
  "+",
  "+export function BundlePicker({ bundles, onChange }: { bundles: Bundle[]; onChange: (b: Bundle) => void }) {",
  "+  const [selected, setSelected] = useState(bundles[0]?.id);",
  "+  return (",
  '+    <div role="radiogroup" aria-label="Bundle size" className="bundle-picker">',
  "+      {bundles.map((b) => (",
  '+        <button key={b.id} role="radio" aria-checked={selected === b.id} onClick={() => { setSelected(b.id); onChange(b); }}>',
  "+          {b.label} · {formatPrice(b.priceMinor)}",
  "+        </button>",
  "+      ))}",
  "+    </div>",
  "+  );",
  " }",
].join("\n");

const CSS_DIFF = [
  "--- a/src/styles/product.css",
  "+++ b/src/styles/product.css",
  "@@ -4,6 +4,13 @@",
  " .product {",
  "   display: grid;",
  "-  gap: 13px;",
  "+  gap: var(--space-3);",
  " }",
  "+",
  "+.bundle-picker {",
  "+  display: flex;",
  "+  gap: var(--space-2);",
  "+  border-radius: var(--radius-md);",
  "+}",
].join("\n");

const NOTES = [
  "Reading the acceptance tests before touching the page.",
  "Price recalculation moves into a pure helper so the test can call it directly.",
  "Keyboard selection uses roving tabindex, matching the other radio groups on the site.",
  "Playwright failed on price formatting; the locale was en-US in the test runner.",
  "Review: one finding about focus order, fixed.",
];

export interface MockSessionOptions {
  /** Seconds the whole script spans. Default 540. */
  durationSec?: number;
  /** Outcome of the script. */
  outcome?: "done" | "blocked" | "failed" | "running";
  /** Include a founder Shout mid-session. */
  shout?: boolean;
}

/**
 * A plausible session script: phases, stdout, tool calls, file diffs, test runs, progress and notes, all with
 * `at` timestamps spread over `durationSec` from `startedAt`. Progress values are computed with the §11.6 formula.
 */
export function generateMockSessionEvents(seedKey: string | number, startedAt: string, opts: MockSessionOptions = {}): AgentSessionEvent[] {
  const rng = createRng(`session:${seedKey}`);
  const start = Date.parse(startedAt);
  const duration = (opts.durationSec ?? 540) * 1000;
  const outcome = opts.outcome ?? "done";
  const planSteps = 5 + rng.int(0, 2);
  const acceptanceTests = 3;
  const events: AgentSessionEvent[] = [];
  let t = 0;
  const at = () => new Date(start + Math.min(duration, t)).toISOString();
  const tick = (ms: number) => {
    t += ms;
  };
  let counts = { planStepsDone: 0, planSteps, acceptanceTestsPassing: 0, acceptanceTests, reviewPassed: false, merged: false };
  const progress = () => {
    const eta = new Date(start + duration).toISOString();
    events.push({ kind: "progress", at: at(), progress: computeProgress(counts), ...counts, etaAt: eta });
  };
  const out = (text: string, channel: "stdout" | "stderr" = "stdout") => events.push({ kind: "stdout", at: at(), channel, text: `${text}\r\n`, command: null });

  events.push({ kind: "phase_changed", at: at(), from: null, to: "planning", reason: null });
  events.push({ kind: "note", at: at(), level: "info", source: "agent", text: NOTES[0]! });
  tick(duration * 0.04);
  events.push({ kind: "tool_call", at: at(), callId: `c-${seedKey}-1`, connectorKey: "github", tool: "get_file", status: "succeeded", argsSummary: "src/app/products/[slug]/page.tsx", durationMs: 420, costMinor: 0 });
  counts = { ...counts, planStepsDone: 1 };
  progress();
  tick(duration * 0.04);
  events.push({ kind: "phase_changed", at: at(), from: "planning", to: "implementing", reason: null });
  out(STDOUT_LINES[0]!);
  out(STDOUT_LINES[1]!);
  out(STDOUT_LINES[2]!);
  tick(duration * 0.08);
  events.push({ kind: "file_changed", at: at(), path: "src/components/bundle-picker.tsx", change: "created", additions: 18, deletions: 2, diff: FILE_DIFF });
  counts = { ...counts, planStepsDone: 2 };
  progress();
  events.push({ kind: "note", at: at(), level: "info", source: "agent", text: NOTES[1]! });
  tick(duration * 0.08);
  for (const line of STDOUT_LINES.slice(3, 8)) out(line);
  events.push({ kind: "test_result", at: at(), suite: "unit", command: "pnpm vitest run", passed: 4, failed: 0, acceptance: false });
  counts = { ...counts, planStepsDone: 3 };
  progress();
  if (opts.shout) {
    tick(duration * 0.04);
    events.push({ kind: "note", at: at(), level: "info", source: "shout", text: "Match the design system" });
    tick(duration * 0.02);
    events.push({ kind: "note", at: at(), level: "info", source: "agent", text: "Swapping ad-hoc spacing for tokens before the next build." });
    events.push({ kind: "file_changed", at: at(), path: "src/styles/product.css", change: "modified", additions: 8, deletions: 1, diff: CSS_DIFF });
  }
  tick(duration * 0.1);
  events.push({ kind: "phase_changed", at: at(), from: "implementing", to: "testing", reason: null });
  for (const line of STDOUT_LINES.slice(8, 13)) out(line, line.includes("✘") ? "stderr" : "stdout");
  events.push({ kind: "test_result", at: at(), suite: "e2e", command: "pnpm playwright test", passed: 2, failed: 1, acceptance: true, failures: ["selecting a bundle updates the price"] });
  counts = { ...counts, planStepsDone: 4, acceptanceTestsPassing: 2 };
  progress();
  events.push({ kind: "note", at: at(), level: "warn", source: "agent", text: NOTES[3]! });

  if (outcome === "blocked") {
    tick(duration * 0.05);
    events.push({ kind: "tool_call", at: at(), callId: `c-${seedKey}-9`, connectorKey: "github", tool: "merge_pull_request", status: "awaiting_approval", argsSummary: "schema change in migrations/0013.sql", policyOutcome: "ask", approvalId: `appr-${seedKey}` });
    events.push({ kind: "note", at: at(), level: "warn", source: "system", text: "Waiting for a founder decision: schema change needs approval." });
    return events;
  }
  if (outcome === "failed") {
    tick(duration * 0.05);
    out("Error: price mismatch, expected €42.00 received €4,200.00", "stderr");
    out("Error: price mismatch, expected €42.00 received €4,200.00", "stderr");
    events.push({ kind: "note", at: at(), level: "error", source: "system", text: "Loop detected: the same failing command ran four times. Session stopped." });
    return events;
  }

  tick(duration * 0.12);
  for (const line of STDOUT_LINES.slice(13, 20)) out(line);
  events.push({ kind: "test_result", at: at(), suite: "e2e", command: "pnpm playwright test", passed: 3, failed: 0, acceptance: true, failures: [] });
  counts = { ...counts, planStepsDone: 5, acceptanceTestsPassing: 3 };
  progress();
  if (outcome === "running") return events;

  tick(duration * 0.12);
  events.push({ kind: "phase_changed", at: at(), from: "testing", to: "review", reason: null });
  events.push({ kind: "note", at: at(), level: "info", source: "reviewer", text: NOTES[4]! });
  tick(duration * 0.1);
  counts = { ...counts, planStepsDone: planSteps, reviewPassed: true };
  progress();
  events.push({ kind: "phase_changed", at: at(), from: "review", to: "merge", reason: null });
  out(STDOUT_LINES[20]!);
  out(STDOUT_LINES[21]!);
  events.push({ kind: "tool_call", at: at(), callId: `c-${seedKey}-7`, connectorKey: "github", tool: "create_pull_request", status: "succeeded", argsSummary: "agent/task → main", durationMs: 1800, costMinor: 0 });
  tick(duration * 0.1);
  counts = { ...counts, merged: true };
  progress();
  events.push({ kind: "phase_changed", at: at(), from: "merge", to: "done", reason: "Merged after green CI" });
  events.push({ kind: "note", at: at(), level: "info", source: "system", text: "Done. Pull request #41 merged." });
  return events;
}

export function mockSessionSeed(i: number, startedAt: string): SessionSeed {
  const rng = createRng(`seed:${i}`);
  return {
    id: `session-${i + 1}`,
    agent: mockAgent(i),
    task: mockTask(i),
    startedAt,
    plan: mockPlan(i),
    tokens: 40_000 + rng.int(0, 180_000),
    cost: { amountMinor: 60 + rng.int(0, 900), currency: "EUR" },
    preview: i % 3 === 0 ? { screenshotUrl: null, url: null, capturedAt: null } : {},
  };
}

/** A whole squad of `n` sessions with staggered starts and mixed outcomes. */
export function mockSessions(n: number, now: Date = new Date("2026-10-07T09:30:00Z")): Array<{ seed: SessionSeed; events: AgentSessionEvent[] }> {
  return Array.from({ length: n }, (_, i) => {
    const startedAt = new Date(now.getTime() - (4 + (i * 37) % 11) * 60_000).toISOString();
    const outcome = i % 7 === 3 ? "blocked" : i % 11 === 5 ? "failed" : i % 5 === 4 ? "done" : "running";
    return { seed: mockSessionSeed(i, startedAt), events: generateMockSessionEvents(i, startedAt, { outcome, shout: i % 4 === 0, durationSec: 480 + (i % 5) * 60 }) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Task graph
// ---------------------------------------------------------------------------------------------------------------------

export function mockTaskGraph(seedKey = "graph"): TaskGraphNode[] {
  const rng = createRng(seedKey);
  const statuses: TaskStatus[] = ["done", "done", "done", "running", "running", "review", "ready", "planned", "planned", "blocked", "running", "merging"];
  const deps: Record<number, number[]> = { 1: [0], 2: [0], 3: [1], 4: [1, 2], 5: [3], 6: [4], 7: [5, 6], 8: [6], 9: [2], 10: [9], 11: [7, 8] };
  return statuses.map((status, i) => ({
    id: `task-${i + 1}`,
    title: TASKS[i]!,
    status,
    deps: (deps[i] ?? []).map((d) => `task-${d + 1}`),
    agent: status === "planned" || status === "ready" ? null : { id: `agent-${i + 1}`, name: NAMES[i]!, seed: `agent-${i + 1}`, dept: ROLES[i % ROLES.length]!.dept },
    progress: status === "done" ? 1 : status === "planned" || status === "ready" ? 0 : rng.range(0.2, 0.9),
    kind: ROLES[i % ROLES.length]!.kind,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Formation Board
// ---------------------------------------------------------------------------------------------------------------------

function formFor(rng: Rng, fit: number): FormCell[] {
  return Array.from({ length: 5 }, () => {
    const roll = rng.next();
    if (fit >= 14) return roll < 0.7 ? "good" : roll < 0.9 ? "warn" : "bad";
    if (fit >= 8) return roll < 0.4 ? "good" : roll < 0.8 ? "warn" : "bad";
    return roll < 0.2 ? "good" : roll < 0.5 ? "warn" : "bad";
  });
}

/** Fifteen channels scored for a DTC skincare business; the four highest are recommended and start on the pitch. */
export function mockChannels(seedKey = "northwind", opts: { enabledFromRecommendation?: boolean } = {}): ChannelTokenData[] {
  const rng = createRng(`channels:${seedKey}`);
  const fits: Record<ChannelKey, number> = {
    paid_ads: 17, social: 16, influencer: 15, email_automation: 14, content: 12, seo: 11, affiliate: 10, pr: 9, geo: 8, events: 7, direct_mail: 6, lead_generation: 4, print: 4, broadcast: 3, outdoor: 3,
  };
  const recommended = new Set<ChannelKey>(["paid_ads", "social", "influencer", "email_automation"]);
  return CHANNEL_KEYS.map((key) => {
    const fit = fits[key];
    const rec = recommended.has(key);
    const low = 800 + Math.round((20 - fit) * 160);
    return {
      key,
      fit,
      recommended: rec,
      enabled: opts.enabledFromRecommendation === false ? false : rec,
      form: formFor(rng, fit),
      potential: Math.min(5, Math.max(1, Math.round(fit / 4))),
      cpaRange: { low: { amountMinor: low, currency: "EUR" }, high: { amountMinor: low * 2 + 400, currency: "EUR" } },
      why: `${CHANNEL_META[key].label} fits a direct-to-consumer skincare brand at this price point. Time to first signal is short and the founder already has material for it. Expected cost per customer sits inside the runway budget.`,
      agents: rec ? [{ name: NAMES[(fit * 3) % NAMES.length]!, seed: `engine-${key}`, dept: "dept-3", status: "healthy" as const }] : [],
      budgetShare: rec ? [0.35, 0.25, 0.25, 0.15][[...recommended].indexOf(key)] : 0,
      results: rec ? [{ label: CHANNEL_META[key].coreMetric, value: `${12 + fit} this week` }] : [],
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Squad table
// ---------------------------------------------------------------------------------------------------------------------

const TOOLS = ["github", "e2b", "gmail", "sendgrid", "notion", "google_drive", "stripe", "shopify", "google_calendar", "anthropic"];

export function mockSquadRows(n = 14, seedKey = "squad"): SquadRow[] {
  const rng = createRng(seedKey);
  return Array.from({ length: n }, (_, i) => {
    const a = mockAgent(i);
    const statuses = ["healthy", "healthy", "healthy", "degraded", "paused", "idle", "injured", "failing"] as const;
    const status = statuses[(i * 5) % statuses.length]!;
    const form = Array.from({ length: 5 }, () => (rng.next() < 0.65 ? "success" : rng.next() < 0.6 ? "partial" : "failure") as SquadRow["form"][number]);
    return {
      id: a.id,
      name: a.name,
      seed: a.seed,
      dept: a.dept,
      role: a.role ?? "Agent",
      departments: a.dept === "dept-2" ? ["Development"] : a.dept === "dept-3" ? ["Distribution"] : ["Product"],
      status,
      currentTask: status === "idle" || status === "injured" ? null : { id: `task-${i + 1}`, title: TASKS[i % TASKS.length]! },
      form,
      rating: Math.round((5.5 + rng.range(-1.5, 4)) * 10) / 10,
      tools: rng.shuffle(TOOLS).slice(0, rng.int(2, 6)),
      model: a.model,
      wage: { amountMinor: (a.model === "opus" ? 18_000 : a.model === "sonnet" ? 7_500 : 1_200) + rng.int(0, 4_000), currency: "EUR" },
      latestUpdate: { at: new Date(Date.parse("2026-10-07T09:30:00Z") - rng.int(1, 600) * 60_000).toISOString(), text: NOTES[i % NOTES.length]! },
      expectedReturnAt: status === "injured" ? "2026-10-07T12:00:00Z" : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------------------------------------------------

export function mockInstructions(): AgentInstructions {
  return {
    role: "Frontend engineer for a direct-to-consumer skincare storefront built with Next.js.",
    goals: ["Ship accessible, tested UI that matches the design tokens.", "Keep bundle size flat; measure before adding a dependency.", "Leave the codebase easier to change than you found it."],
    rules: ["Write the Playwright test before the component.", "Never introduce a hex colour outside tokens.css.", "Ask before changing a shared component's props.", "Keep pull requests under 400 changed lines."],
    playbook: ["Read the task and its acceptance tests.", "Sketch the component API in a comment.", "Implement with tokens only.", "Run unit, type and e2e checks.", "Open a pull request with a screenshot."],
    tone: "Plain and specific. Short sentences. No exclamation marks.",
    examples: [
      { input: "Add a size selector to the product page.", output: "Radio group with roving tabindex, prices from formatPrice, Playwright test for keyboard selection, screenshot attached to the PR." },
    ],
  };
}

export function mockInstructionVersions(): InstructionVersion[] {
  const live = mockInstructions();
  const previous: AgentInstructions = {
    ...live,
    goals: live.goals.slice(0, 2),
    rules: ["Write tests after the component.", "Never introduce a hex colour outside tokens.css.", "Keep pull requests under 600 changed lines."],
    playbook: live.playbook.filter((p) => !p.startsWith("Sketch")),
    tone: "Plain and specific.",
    examples: [],
  };
  return [
    { version: 3, createdAt: "2026-09-12T10:00:00Z", author: "Coach", comment: "Initial template", state: "retired", instructions: previous },
    { version: 4, createdAt: "2026-10-01T15:20:00Z", author: "Founder", comment: "Tests first, smaller PRs, add an example", state: "live", instructions: live },
  ];
}

export function mockTrainingResults(): TrainingSkillResult[] {
  return [
    { id: "component_craft", name: "Component craft", group: "craft", before: 13, after: 15, tests: { run: 12, passed: 10 } },
    { id: "design_fidelity", name: "Design fidelity", group: "craft", before: 11, after: 14, tests: { run: 12, passed: 9 } },
    { id: "accessibility", name: "Accessibility", group: "craft", before: 12, after: 12, tests: { run: 12, passed: 8 } },
    { id: "state_management", name: "State management", group: "craft", before: 14, after: 12, tests: { run: 12, passed: 7 } },
    { id: "testing", name: "Testing", group: "craft", before: 10, after: 16, tests: { run: 12, passed: 11 } },
    { id: "planning", name: "Planning", group: "judgement", before: 12, after: 13, tests: { run: 12, passed: 9 } },
    { id: "scope_control", name: "Scope control", group: "judgement", before: 9, after: 12, tests: { run: 12, passed: 8 } },
    { id: "knowing_when_to_ask", name: "Knowing when to ask", group: "judgement", before: 15, after: 14, tests: { run: 12, passed: 9 } },
    { id: "speed", name: "Speed", group: "execution", before: 14, after: 11, tests: { run: 12, passed: 6 } },
    { id: "reliability", name: "Reliability", group: "execution", before: 13, after: 14, tests: { run: 12, passed: 10 } },
    { id: "cost_efficiency", name: "Cost efficiency", group: "execution", before: 12, after: 12, tests: { run: 12, passed: 8 } },
  ];
}

export const MOCK_COACH_EXPLANATION =
  "Writing the Playwright test first lifted Testing and Design fidelity, and the smaller pull-request cap improved Scope control. Speed dropped because the agent now runs the e2e suite twice per task; State management fell by two points on the three tests that involve shared stores, where the new rule about asking before changing shared props made it stop and ask instead of finishing. Promote if you value the test coverage over the two-minute median slowdown; a follow-up Focus session on State management would recover the drop.";

export function mockModelOptions(current: ModelKey = "sonnet", opts: { chiefOfStaff?: boolean; lockedToOpus?: boolean } = {}): ModelOption[] {
  const base: Record<ModelKey, Omit<ModelOption, "skillDelta" | "wageDelta">> = {
    opus: { key: "opus", label: "Opus", description: "Deepest judgement; best for planning, review and hard tasks." },
    sonnet: { key: "sonnet", label: "Sonnet", description: "The default for coding, channels and specialists." },
    haiku: { key: "haiku", label: "Haiku", description: "Fast and cheap; utilities and classification." },
  };
  const rank: Record<ModelKey, number> = { opus: 2, sonnet: 1, haiku: 0 };
  return (["opus", "sonnet", "haiku"] as const).map((key) => {
    const step = rank[key] - rank[current];
    const option: ModelOption = { ...base[key], skillDelta: step * 2.5, wageDelta: { amountMinor: step * 9_000, currency: "EUR" } };
    if (opts.lockedToOpus && key !== "opus") option.lockedReason = "The Inbox Composer is locked to Opus.";
    if (opts.chiefOfStaff && step < 0) option.warning = "Downgrading the Chief of Staff affects every cycle plan and every holiday decision.";
    return option;
  });
}

export function mockPositionRoles(): PositionRole[] {
  return [
    { id: "frontend", label: "Frontend engineer", level: "natural", rating: 17 },
    { id: "design_to_code", label: "Design-to-code", level: "natural", rating: 16 },
    { id: "qa", label: "QA engineer", level: "accomplished", rating: 13 },
    { id: "docs", label: "Docs writer", level: "accomplished", rating: 12 },
    { id: "backend", label: "Backend engineer", level: "competent", rating: 9 },
    { id: "data", label: "Data engineer", level: "unconvincing", rating: 5 },
    { id: "infra", label: "Infra engineer", level: "unconvincing", rating: 4 },
    { id: "researcher", label: "Researcher", level: "competent", rating: 8 },
  ];
}

export function mockTraits(): Trait[] {
  return [
    { id: "tests_first", label: "Writes tests first", derivedFrom: "Write the Playwright test before the component.", tone: "good" },
    { id: "asks_before_props", label: "Asks before changing shared props", derivedFrom: "Ask before changing a shared component's props.", tone: "good" },
    { id: "small_prs", label: "Small pull requests", derivedFrom: "Keep pull requests under 400 changed lines." },
    { id: "tokens_only", label: "Tokens only", derivedFrom: "Never introduce a hex colour outside tokens.css." },
    { id: "slow_on_e2e", label: "Slower on e2e-heavy tasks", derivedFrom: "Runs the e2e suite twice per task", tone: "warn" },
  ];
}

export function mockDevelopmentSeries(seedKey = "dev"): { series: SkillHistorySeries[]; sessions: TrainingSessionMark[] } {
  const rng = createRng(seedKey);
  const start = Date.parse("2026-07-01T00:00:00Z");
  const weeks = 14;
  const skills: Array<[string, string, number]> = [
    ["testing", "Testing", 8],
    ["component_craft", "Component craft", 11],
    ["design_fidelity", "Design fidelity", 10],
  ];
  const sessions: TrainingSessionMark[] = [
    { at: new Date(start + 3 * 7 * 86_400_000).toISOString(), label: "v2: tone and rules", promoted: true },
    { at: new Date(start + 7 * 7 * 86_400_000).toISOString(), label: "v3: Sonnet → Opus preview", promoted: false },
    { at: new Date(start + 11 * 7 * 86_400_000).toISOString(), label: "v4: tests first", promoted: true },
  ];
  const series = skills.map(([skillId, name, base]) => {
    let v = base;
    const points = Array.from({ length: weeks }, (_, w) => {
      const bump = sessions.some((s) => Math.abs(Date.parse(s.at) - (start + w * 7 * 86_400_000)) < 4 * 86_400_000 && s.promoted) ? 1.5 : 0;
      v = Math.min(20, Math.max(1, v + bump + rng.range(-0.4, 0.7)));
      return { at: new Date(start + w * 7 * 86_400_000).toISOString(), value: Math.round(v * 10) / 10 };
    });
    return { skillId, name, points };
  });
  return { series, sessions };
}

// ---------------------------------------------------------------------------------------------------------------------
// Specialists
// ---------------------------------------------------------------------------------------------------------------------

export function mockSpecialistData(seedKey = "sourcing"): SpecialistData {
  const rng = createRng(seedKey);
  const suppliers = ["Baltic Pack OÜ", "Hangzhou Lumi Co.", "Mediterranea Vetro S.r.l.", "Nordpak AB", "Shenzhen Pumpworks", "Rhein Kunststoff GmbH", "Porto Cosmética Lda", "Gdańsk Formulas"];
  return {
    rfq: [
      { id: "identified", label: "Identified", count: 64 },
      { id: "contacted", label: "RFQ sent", count: 41 },
      { id: "replied", label: "Replied", count: 19 },
      { id: "quoted", label: "Quoted", count: 11 },
      { id: "shortlisted", label: "Shortlisted", count: 4 },
    ],
    quotes: suppliers.map((supplier, i) => ({
      id: `q-${i}`,
      supplier,
      country: ["EE", "CN", "IT", "SE", "CN", "DE", "PT", "PL"][i],
      unitPrice: { amountMinor: 38 + rng.int(0, 40), currency: "EUR" },
      moq: [1000, 5000, 2500, 1000, 10000, 2000, 1500, 3000][i]!,
      leadTimeDays: 21 + rng.int(0, 60),
      score: 6 + rng.int(0, 13),
      status: (["shortlisted", "negotiating", "received", "shortlisted", "rejected", "received", "received", "accepted"] as const)[i]!,
    })),
    samples: [
      { id: "s-1", supplier: "Baltic Pack OÜ", stage: "received", note: "Pump dose 0.22 ml, within spec." },
      { id: "s-2", supplier: "Nordpak AB", stage: "testing", etaAt: "2026-10-09T00:00:00Z" },
      { id: "s-3", supplier: "Rhein Kunststoff GmbH", stage: "shipped", etaAt: "2026-10-12T00:00:00Z" },
      { id: "s-4", supplier: "Gdańsk Formulas", stage: "requested" },
    ],
    shipments: [
      { id: "sh-1", ref: "NWS-2026-017", carrier: "DSV", from: "Tallinn", to: "Stockholm", status: "in_transit", etaAt: "2026-10-10T00:00:00Z", cost: { amountMinor: 48_000, currency: "EUR" } },
      { id: "sh-2", ref: "NWS-2026-018", carrier: "Maersk", from: "Ningbo", to: "Gothenburg", status: "customs", etaAt: "2026-10-21T00:00:00Z", cost: { amountMinor: 312_000, currency: "EUR" } },
      { id: "sh-3", ref: "NWS-2026-019", carrier: "DHL Freight", from: "Düsseldorf", to: "Stockholm", status: "quoted", cost: { amountMinor: 61_500, currency: "EUR" } },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------------------------------------------------

export function mockHierarchy(): HierarchyNode[] {
  const nodes: HierarchyNode[] = [
    { id: "founder", name: "Reid Jackson", role: "Founder", kind: "founder", parentId: null },
    { id: "cos", name: "Marlow", role: "Chief of Staff", kind: "assistant", parentId: "founder", avatar: { seed: "cos", dept: "dept-5" }, status: "healthy", model: "opus" },
    { id: "lead-product", name: "Isolde", role: "Product lead", kind: "lead", parentId: "cos", avatar: { seed: "lead-product", dept: "dept-1" }, status: "healthy", model: "opus", department: "Product" },
    { id: "lead-eng", name: "Pike", role: "Engineering lead", kind: "lead", parentId: "cos", avatar: { seed: "lead-eng", dept: "dept-2" }, status: "healthy", model: "opus", department: "Development" },
    { id: "lead-dist", name: "Wren", role: "Distribution strategist", kind: "lead", parentId: "cos", avatar: { seed: "lead-dist", dept: "dept-3" }, status: "degraded", model: "opus", department: "Distribution" },
    { id: "lead-fin", name: "Teodor", role: "Finance lead", kind: "lead", parentId: "cos", avatar: { seed: "lead-fin", dept: "dept-4" }, status: "idle", model: "opus", department: "Finance" },
  ];
  const workers: Array<[string, string, DeptColourToken, string]> = [
    ["Juno", "Frontend engineer", "dept-2", "lead-eng"],
    ["Cassian", "Backend engineer", "dept-2", "lead-eng"],
    ["Ottilie", "QA engineer", "dept-2", "lead-eng"],
    ["Rafe", "Researcher", "dept-1", "lead-product"],
    ["Sunniva", "Email engine", "dept-3", "lead-dist"],
    ["Bram", "Paid ads engine", "dept-3", "lead-dist"],
    ["Linnea", "Social engine", "dept-3", "lead-dist"],
    ["Osric", "Bookkeeper", "dept-4", "lead-fin"],
  ];
  workers.forEach(([name, role, dept, parentId], i) => {
    nodes.push({ id: `w-${i}`, name, role, kind: "worker", parentId, avatar: { seed: `w-${i}` , dept }, status: i === 2 ? "paused" : "healthy", model: "sonnet" });
  });
  nodes.push({ id: "u-1", name: "Quill", role: "Entity linker", kind: "utility", parentId: "cos", avatar: { seed: "u-1", dept: "dept-6" }, status: "healthy", model: "haiku" });
  nodes.push({ id: "h-1", name: "Mira Lind", role: "Advisor", kind: "human", parentId: "founder" });
  return nodes;
}
