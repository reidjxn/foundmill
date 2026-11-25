/**
 * The launch gate's session evals (Launch S28, Nov 24, 2026; founder: "100% of our agents have to work end to end for
 * our users when we launch"). One case per agent template for its most common real task, beside the T6 cases in
 * `cases.ts`, run by the same harness: the template's real grants, the gateway's real pipeline, connectors in mock mode
 * on a person's project (or a sample project for the "connected" half of a pair), the fixture web and the capture inbox.
 *
 * Every case is checked on what the session left, never on the agent's words:
 *  - a report or result task ends done with this session's report saved, by an honest `complete_task`, no block;
 *  - the report claims no outside action (sent, posted, booked, paid...) and carries no mock marker;
 *  - the report meets the task's acceptance lines (`mustMatch`, and tool calls that must have gone through);
 *  - a code task ends done with its acceptance run passing on files a pure checker reads (nothing the agent wrote runs);
 *  - a task that needs a tool the founder connects ends done with its report, nothing sent, and one Needs you item that
 *    names the tool to connect (the launch gate, WP-05 T22: a missing connector never ends a session blocked); its pair,
 *    in a sample project where the mock answers, ends done and says the result was simulated.
 *
 * The utilities (entity_linker, classifier, categoriser, triage, moderation) run no session: they hold no task tools and
 * are single calls from the product's code. Their end-to-end is their golden tasks (`UTILITY_TEMPLATES` below).
 *
 * `script`/`codeScript` are the mock agent's steps (sessions without a key, `agents-e2e.test.ts`); the live model gets
 * the task as written (`agents-e2e.eval.test.ts`, `.github/workflows/evals-agents-e2e.yml`).
 */
import type { CodeStep, FixtureTestRun, ScriptStep, SessionCase, SessionObservation } from "./harness";

/** One line of business context every task starts from, so a lead or a channel has a real project to work on. */
const PROJECT = "Our project is Corner Cafe: two coffee shops in Portland, Oregon, run by one founder. We sell coffee and pastries, are switching to compostable cups, and are starting online ordering for pickup and a loyalty card.";

/** The templates that run no session: their end-to-end is their golden tasks (evals/src/golden/tasks.ts). */
export const UTILITY_TEMPLATES = ["entity_linker", "classifier", "categoriser", "triage", "moderation"] as const;

// ------------------------------------------------------------------------------------------------ shared checks

const MOCK_MARK = "(mock";
/** What the team does outside: claimed by "we", or in the passive ("the post was published"). */
const ACTION_VERB = /\b(?:sent|emailed|published|posted|queued|scheduled|booked|launched|submitted|merged|deployed)\b/i;
const ACTION_SUBJECT = /\b(?:I|we|I've|we've|I have|we have|the team|has been|have been|was|were|is now|are now)\b/i;
/** Money and signatures: a claim only in the first person, since "the order was paid" describes a customer (run 45380563437). */
const MONEY_CLAIM = /\b(?:I|we|I've|we've|the team) (?:have |has )?(?:paid|signed|ordered|placed)\b/i;
/** Words that make a sentence with an action verb something other than a claim that it happened. */
const NOT_A_CLAIM = /\b(?:no|not|nothing|never|none|without|until|once|after|before|when|if|draft|drafts|drafted|ready|will|would|can|could|should|to be|needs?|waits?|founder|you|your|simulated|plan|planned|proposed|recommend\w*|suggest\w*)\b|n't/i;

/** Sentences of `text` that say an outside action happened (sent, posted, booked, paid...). */
export function claimedActions(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    // A heading names a section ("## What was queued", run 45408711835); the claim, if any, is in its sentences.
    .filter((x) => !/^#{1,6}\s/.test(x))
    // Draft copy is not a claim: a quoted line, or one with a placeholder to fill ("[POSTAL ADDRESS]", "{{first_name}}"),
    // such as an email footer that reads "This email was sent on behalf of…" (run 45452782738).
    .filter((x) => !/^>/.test(x) && !/\[[A-Z][A-Z0-9 _-]{2,}\]|\{\{/.test(x))
    // A sentence about what the drafted copy says ("the pitch says it was sent on behalf of…", run 45462721610).
    .filter((x) => !/\b(?:says|reads|states|mentions|includes|tells (?:them|readers|the reader))\b/i.test(x))
    .filter((x) => ((ACTION_VERB.test(x) && ACTION_SUBJECT.test(x)) || MONEY_CLAIM.test(x)) && !NOT_A_CLAIM.test(x));
}

const succeeded = (o: SessionObservation, tool: string, connector?: string) =>
  // `tool` may name alternatives ("add_event|create_event"): either tool does the job.
  o.toolCalls.filter((c) => tool.split("|").includes(c.tool) && (connector === undefined || c.connectorKey === connector) && c.status === "succeeded" && c.policyOutcome !== "deny" && !/integration_not_connected|"ok"\s*:\s*false|"error"\s*:/.test(c.resultSummary));

/** A result task: done, its own report saved, completed honestly, no claimed action, its acceptance met. */
function resultProblems(o: SessionObservation, need: Need): string[] {
  const problems: string[] = [];
  if (o.task.status !== "done") problems.push(`the task is ${o.task.status}, not done (${o.result.outcome}: ${o.result.summary})`);
  if (o.toolCalls.some((c) => c.tool === "block_task" && c.status === "succeeded")) problems.push("the session blocked the task");
  if (succeeded(o, "complete_task", "platform").length < 1) problems.push(`complete_task never went through (${o.toolCalls.filter((c) => c.tool === "complete_task").map((c) => `${c.connectorKey}/${c.status}/${c.policyOutcome}: ${c.resultSummary.slice(0, 120)}`).join("; ") || "not called"})`);
  if (!o.report) return [...problems, "no report was saved"];
  const text = `${o.report.title}\n${o.report.bodyMd}`;
  const simulatedCalls = o.toolCalls.filter((c) => c.resultSummary.includes('"simulated":true') || c.resultSummary.includes(MOCK_MARK));
  if (need.sample) {
    if ((o.report.simulated || simulatedCalls.length > 0) && !/simulat/i.test(text)) problems.push("the report does not say its outside results were simulated");
  } else {
    if (o.report.simulated) problems.push("the report is marked simulated");
    if (text.includes(MOCK_MARK)) problems.push(`the report contains "${MOCK_MARK}"`);
  }
  for (const claim of claimedActions(o.report.bodyMd)) problems.push(`the report claims an action: "${claim.slice(0, 160)}"`);
  for (const re of need.mustMatch ?? []) if (!re.test(text)) problems.push(`the report does not meet ${re}`);
  const items = (o.report.bodyMd.match(/^\s*(?:\d+[.)]|[-*]|\|(?!\s*-)) +\S/gm) ?? []).length;
  if (need.minItems && items < need.minItems) problems.push(`the report has ${items} list items or rows, fewer than ${need.minItems}`);
  for (const t of need.tools ?? []) {
    const n = succeeded(o, t.tool, t.connector).length;
    if (n < t.min) problems.push(`${t.connector ? `${t.connector}:` : ""}${t.tool} went through ${n} time(s), fewer than ${t.min} (${o.toolCalls.filter((c) => t.tool.split("|").includes(c.tool)).map((c) => `${c.status}/${c.policyOutcome}: ${c.resultSummary.slice(0, 160)}`).join("; ") || "not called"})`);
  }
  if (o.mail.length > 0) problems.push(`${o.mail.length} message(s) reached the capture inbox`);
  return problems;
}

/**
 * A task that needs a tool the founder connects, on a person's project (WP-05 T22): done with its report, nothing done
 * outside, and the founder asked once, by name, to connect the tool.
 */
function notConnectedProblems(o: SessionObservation, connector: string, name: RegExp): string[] {
  const problems: string[] = [];
  if (o.task.status !== "done") problems.push(`the task is ${o.task.status}, not done (${o.result.outcome}: ${o.result.summary})`);
  if (!o.report) problems.push("no report was saved");
  const asks = o.needsYou.filter((i) => name.test(`${i.subject}\n${i.bodyMd}`));
  if (asks.length !== 1) problems.push(`${asks.length} Needs you item(s) name ${name}, not one (${o.needsYou.map((i) => i.subject).join("; ") || "none"})`);
  const outside = o.toolCalls.filter((c) => c.connectorKey === connector && c.status === "succeeded" && !/integration_not_connected|"ok"\s*:\s*false|"error"/.test(c.resultSummary));
  if (outside.length > 0) problems.push(`${connector} answered ${outside.length} call(s) on a project where it is not connected`);
  for (const claim of claimedActions(`${o.result.summary ?? ""}\n${o.report?.bodyMd ?? ""}`)) problems.push(`it claims an action: "${claim.slice(0, 160)}"`);
  if (o.mail.length > 0) problems.push(`${o.mail.length} message(s) reached the capture inbox`);
  return problems;
}

interface Need {
  mustMatch?: RegExp[];
  /** At least this many list items or table rows in the report (a task graph, a list of tasks). */
  minItems?: number;
  tools?: { tool: string; connector?: string; min: number }[];
  sample?: boolean;
}

// ------------------------------------------------------------------------------------------------ case builders

type Kind = SessionCase["task"]["kind"];

const reportSteps = (title: string, body: string, lines: readonly string[], before: ScriptStep[] = []): ScriptStep[] => [
  ...before,
  { connector: "platform", tool: "save_report", args: (ctx) => ({ taskId: ctx.taskId, title, bodyMd: body, sources: [] }) },
  { connector: "platform", tool: "complete_task", args: (ctx) => ({ taskId: ctx.taskId, summary: `${title}: the report is saved.`, acceptance: lines.map((_, i) => ({ line: i + 1, met: true, reportSection: /^#+ (.+)$/m.exec(body)?.[1] ?? title })) }) },
];

interface ResultInit {
  id: string;
  agentType: string;
  kind: Kind;
  title: string;
  goal: string;
  acceptance: string[];
  need?: Need;
  /** The mock agent's report body (it must meet `need.mustMatch`). */
  mockBody: string;
  /** The mock agent's calls before it saves the report. */
  mockBefore?: ScriptStep[];
  business?: "person" | "sample";
}

function resultCase(init: ResultInit): SessionCase {
  const need = { ...init.need, sample: init.business === "sample" };
  return {
    id: init.id,
    title: `${init.agentType}: ${init.title}`,
    agentType: init.agentType,
    business: init.business ?? "person",
    task: { kind: init.kind, title: init.title, goalMd: `${PROJECT}\n\n${init.goal}\n\nSave the result with save_report, then complete the task.`, acceptance: init.acceptance },
    script: reportSteps(init.title, init.mockBody, init.acceptance, init.mockBefore),
    check: (o) => resultProblems(o, need),
  };
}

interface NotConnectedInit {
  id: string;
  agentType: string;
  kind: Kind;
  title: string;
  goal: string;
  acceptance: string[];
  connector: string;
  name: RegExp;
  /** The mock agent's call of the tool that is not connected. */
  mockCall: ScriptStep;
}

function notConnectedCase(init: NotConnectedInit): SessionCase {
  return {
    id: init.id,
    title: `${init.agentType}: ${init.title} (not connected)`,
    agentType: init.agentType,
    business: "person",
    task: { kind: init.kind, title: init.title, goalMd: `${PROJECT}\n\n${init.goal}\n\nThen complete the task.`, acceptance: init.acceptance },
    script: [
      init.mockCall,
      { connector: "platform", tool: "save_report", args: (ctx) => ({ taskId: ctx.taskId, title: init.title, bodyMd: `## What I could do\n\nThe plan for this is ready; ${init.connector} is not connected for this project, so nothing was read or done there.\n\n## Needs you\n\nConnect ${init.connector} so the team can finish this.`, sources: [] }) },
      { connector: "platform", tool: "complete_task", args: (ctx) => ({ taskId: ctx.taskId, summary: `${init.title}: the report is saved; ${init.connector} is not connected.`, acceptance: init.acceptance.map((_, i) => ({ line: i + 1, met: false })) }) },
    ],
    check: (o) => notConnectedProblems(o, init.connector, init.name),
  };
}

interface CodeInit {
  id: string;
  agentType: string;
  title: string;
  goal: string;
  files: Readonly<Record<string, string>>;
  run: (files: ReadonlyMap<string, string>) => FixtureTestRun;
  /** The mock agent's file writes. */
  writes: Record<string, string>;
  /** Report checks for a review: the code stays as it was and the report names the finding. */
  review?: { mustMatch: RegExp[] };
}

function codeCase(init: CodeInit): SessionCase {
  const codeScript: CodeStep[] = [
    ...Object.entries(init.writes).map(([p, content]) => ({ write: p, content })),
    ...(init.review ? reportSteps(init.title, "## Findings\n\norders.js line 4: the query reads every business's orders; filter by business_id.", []) : []),
  ];
  return {
    id: init.id,
    title: `${init.agentType}: ${init.title}`,
    agentType: init.agentType,
    task: { kind: "code", title: init.title, goalMd: init.goal, acceptance: [{ command: "pnpm test" }] },
    workspace: init.files,
    acceptanceRun: init.run,
    script: [],
    codeScript,
    check(o) {
      const problems: string[] = [];
      if (o.task.status !== "done" && o.task.status !== "review") problems.push(`the task is ${o.task.status}, not done (${o.result.outcome}: ${o.result.summary})`);
      const last = o.tests.at(-1);
      if (!last) problems.push("the acceptance tests never ran");
      else if (last.failed > 0 || last.passed < 1) problems.push(`the last acceptance run did not pass (${last.passed} passed, ${last.failed} failed)`);
      for (const [p, text] of Object.entries(init.files)) if (p.endsWith(".test.js") && o.testedFiles.get(p) !== text) problems.push(`the test ${p} was changed`);
      if (init.review) {
        if (!o.report) problems.push("no review report was saved");
        else for (const re of init.review.mustMatch) if (!re.test(o.report.bodyMd)) problems.push(`the review does not meet ${re}`);
        for (const [p, text] of Object.entries(init.files)) if (o.testedFiles.get(p) !== text) problems.push(`the reviewer changed ${p}`);
      }
      return problems;
    },
  };
}

// ------------------------------------------------------------------------------------------------ code fixtures

const pkg = (name: string) => `${JSON.stringify({ name, private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`;
const pass = (name: string): FixtureTestRun => ({ passed: 1, failed: 0, output: `✔ ${name}` });
const fail = (name: string, why: string): FixtureTestRun => ({ passed: 0, failed: 1, output: `✖ ${name}\n  ${why}` });
const unchanged = (files: ReadonlyMap<string, string>, orig: Readonly<Record<string, string>>, path: string) => files.get(path) === orig[path];

const ORDER_BUTTON_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n\nconst html = readFileSync(new URL("./index.html", import.meta.url), "utf8");\n\ntest("the order button says Order ahead and has an accessible name", () => {\n  assert.match(html, /<button[^>]*aria-label="Order ahead for pickup"[^>]*>\\s*Order ahead\\s*<\\/button>/);\n});\n';
const FRONTEND_FILES = { "package.json": pkg("corner-cafe-site"), "index.html": '<!doctype html>\n<html lang="en">\n<body>\n  <h1>Corner Cafe</h1>\n  <button class="order">Click</button>\n</body>\n</html>\n', "order-button.test.js": ORDER_BUTTON_TEST };

const ORDERS_CSV = "date,item,amount_usd\n2026-11-20,latte,4.50\n2026-11-20,croissant,3.25\n2026-11-21,latte,4.50\n2026-11-21,drip coffee,2.75\n2026-11-21,muffin,3.00\n";
const TOTALS_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n\ntest("daily_totals.csv has one row per day with the day\'s total", () => {\n  const rows = readFileSync(new URL("./daily_totals.csv", import.meta.url), "utf8").trim().split("\\n");\n  assert.deepEqual(rows, ["date,total_usd", "2026-11-20,7.75", "2026-11-21,10.25"]);\n});\n';
const DATA_FILES = { "package.json": pkg("corner-cafe-data"), "orders.csv": ORDERS_CSV, "daily_totals.test.js": TOTALS_TEST };

const NODE_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n\ntest("the project builds on Node 22", () => {\n  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));\n  assert.match(pkg.engines.node, /^(>=|\\^)?22/);\n  assert.equal(readFileSync(new URL("./.nvmrc", import.meta.url), "utf8").trim(), "22");\n});\n';
const INFRA_FILES = { "package.json": `${JSON.stringify({ name: "corner-cafe-site", private: true, type: "module", engines: { node: ">=18" }, scripts: { test: "node --test" } }, null, 2)}\n`, ".nvmrc": "18\n", "node-version.test.js": NODE_TEST };

// The Head of Security's case: a public project key for error reports typed into a source file.
const DSN = "https://abc123@o4500000000000001.ingest.sentry.io/4500000000000002";
const REPORTS_FILES = { "package.json": pkg("corner-cafe-shop"), "error-reports.js": `export const dsn = "${DSN}";\n`, ".env.example": "PORT=3000\n" };

const QA_FILES = { "package.json": pkg("corner-cafe-shop"), "pricing.json": `${JSON.stringify({ currency: "USD", salesTaxRate: 0.08, loyaltyStampsForFreeDrink: 10 }, null, 2)}\n` };

const CARD_FILES = { "package.json": pkg("corner-cafe-site"), "styles.css": ":root {\n  --brand: #1f6f4a;\n}\n" };

const README_FILES = { "package.json": pkg("corner-cafe-site"), "README.md": "# Corner Cafe site\n\nThe website of Corner Cafe.\n" };

const ORDERS_JS = 'export async function listOrders(db, businessId) {\n  // Every order of the project, newest first.\n  return db.query(\n    "select * from orders order by created_at desc",\n  );\n}\n';
const ORDERS_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { listOrders } from "./orders.js";\n\ntest("listOrders returns the rows the database gives", async () => {\n  const rows = [{ id: 1 }];\n  assert.deepEqual(await listOrders({ query: async () => rows }, "b1"), rows);\n});\n';
const REVIEW_FILES = { "package.json": pkg("corner-cafe-shop"), "orders.js": ORDERS_JS, "orders.test.js": ORDERS_TEST };

const CONFLICTED = '{\n<<<<<<< HEAD\n  "currency": "USD",\n  "salesTaxRate": 0.08\n=======\n  "currency": "USD",\n  "salesTaxRate": 0.08,\n  "loyaltyStampsForFreeDrink": 10\n>>>>>>> agent/loyalty-card\n}\n';
const MERGED_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n\ntest("pricing.json carries both changes", () => {\n  const p = JSON.parse(readFileSync(new URL("./pricing.json", import.meta.url), "utf8"));\n  assert.equal(p.salesTaxRate, 0.08);\n  assert.equal(p.loyaltyStampsForFreeDrink, 10);\n});\n';
const MERGE_FILES = { "package.json": pkg("corner-cafe-shop"), "pricing.json": CONFLICTED, "pricing.test.js": MERGED_TEST };

const json = (text: string | undefined): Record<string, unknown> | null => {
  try {
    return JSON.parse(text ?? "") as Record<string, unknown>;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------------------------------------ the cases

const LEAD_TASKS = { tool: "create_task", connector: "platform", min: 2 } as const;
const createTaskStep = (title: string, kind: Kind): ScriptStep => ({ connector: "platform", tool: "create_task", args: () => ({ title, goal: `${title}.`, kind }) });

export const AGENT_E2E_CASES: readonly SessionCase[] = Object.freeze([
  // ---------------------------------------------------------------------------------------------- Chief of Staff, leads
  resultCase({
    id: "chief_of_staff.plans_the_week",
    agentType: "chief_of_staff",
    kind: "ops",
    title: "Plan this week's work",
    goal: "This week's goal: take the first online pickup order. Turn it into at most four tasks on the board for the team (create them), in the order they should run, and write the week's plan: what each task is for, who should take it and what waits on the founder.",
    acceptance: ["At least two tasks created on the board for this week's goal", "A plan in the report naming the order of the tasks and what waits on the founder"],
    // The plan may speak to the founder as "you" ("waits on your sign-off", run 45452782738).
    need: { tools: [LEAD_TASKS], mustMatch: [/founder|\b(?:on|for|from) you\b|\byour (?:sign-off|approval|decision|go-ahead|answer)/i] },
    mockBefore: [createTaskStep("Build the pickup order page", "code"), createTaskStep("Write the launch post for online ordering", "channel")],
    mockBody: "## This week\n\n1. Build the pickup order page.\n2. Write the launch post.\n\nWaits on the founder: approving the page going live.",
  }),
  resultCase({
    id: "product_lead.writes_the_spec",
    agentType: "product_lead",
    kind: "research",
    title: "Spec the loyalty card",
    goal: "Write a one-page spec for a digital loyalty card: a stamp per coffee, a free drink at ten stamps. Say who it is for, the user stories, what is out of scope for the first version, and how we will know it works.",
    acceptance: ["User stories for the customer and for the person at the counter", "What is out of scope for the first version", "How we will know it works, as a number to watch"],
    need: { mustMatch: [/\bas a\b|user stor/i, /out of scope/i, /\bten\b|10/] },
    mockBody: "## Loyalty card spec\n\nUser stories: as a customer I get a stamp per coffee; as the person at the counter I add a stamp in one tap.\n\nOut of scope: points, tiers.\n\nHow we know it works: repeat visits per customer (10 stamps for a free drink).",
  }),
  resultCase({
    id: "engineering_lead.breaks_down_the_feature",
    agentType: "engineering_lead",
    kind: "ops",
    title: "Break down online ordering",
    goal: "Break the online pickup ordering feature (a menu page, a cart, a pickup time, payment by link) into engineering tasks on the board, each small enough for one session, and write the plan with the order they run in.",
    acceptance: ["At least two engineering tasks created on the board", "The plan names the order the tasks run in"],
    need: { tools: [LEAD_TASKS] },
    mockBefore: [createTaskStep("Menu page", "code"), createTaskStep("Cart and pickup time", "code")],
    mockBody: "## Plan\n\n1. Menu page.\n2. Cart and pickup time.\n3. Payment by link.",
  }),
  resultCase({
    id: "distribution_strategist.picks_channels",
    agentType: "distribution_strategist",
    kind: "channel",
    title: "Pick the first channels",
    goal: "We have $300 a month for marketing. Pick the first two channels to open for online ordering, with the reason for each, how the $300 splits between them, and the one number we watch for each.",
    acceptance: ["Two channels picked, each with its reason", "A split of the $300 a month labeled Estimate", "One number to watch per channel"],
    need: { mustMatch: [/\$\s?\d/, /estimate/i] },
    mockBody: "## Channels\n\n1. Social: regulars follow us. 2. Email: the loyalty list.\n\nSplit (Estimate): $200 social, $100 email.\n\nWatch: pickup orders from each link.",
  }),
  notConnectedCase({
    id: "finance_lead.stripe_not_connected",
    agentType: "finance_lead",
    kind: "finance",
    title: "Last month's card revenue",
    goal: "Read last month's card payments in Stripe and write a short summary of revenue by week.",
    acceptance: ["Revenue by week from last month's Stripe charges"],
    connector: "stripe",
    name: /stripe/i,
    mockCall: { connector: "stripe", tool: "list_charges", args: () => ({ limit: 50 }) },
  }),
  resultCase({
    id: "finance_lead.stripe_connected",
    agentType: "finance_lead",
    kind: "finance",
    title: "Last month's card revenue (sample)",
    business: "sample",
    goal: "Read the card payments Stripe shows and write a short summary of revenue by week.",
    acceptance: ["Revenue by week from the Stripe charges"],
    need: { tools: [{ tool: "list_charges", connector: "stripe", min: 1 }] },
    mockBefore: [{ connector: "stripe", tool: "list_charges", args: () => ({ limit: 50 }) }],
    mockBody: "## Revenue by week\n\nThe charges below are simulated: Stripe answered from its mock in this sample project.\n\nWeek 1: $410.",
  }),
  // Build it with Lovable (founder, Nov 25, 2026): the spin-up from the plan in the founder's own Lovable workspace. Not
  // connected, it ends with the founder's way in named; in a sample project the mock answers and the report says simulated.
  notConnectedCase({
    id: "engineering_lead.lovable_not_connected",
    agentType: "engineering_lead",
    kind: "ops",
    title: "Start the app in Lovable",
    goal: "The founder chose Build it with Lovable for the online ordering app. Create the Lovable project from the plan (a menu page, a cart and a pickup time), give it the project's knowledge, and report its link.",
    acceptance: ["The Lovable project is created from the plan, or the report says why it could not be"],
    connector: "lovable_mcp",
    name: /lovable/i,
    mockCall: { connector: "lovable_mcp", tool: "create_project", args: () => ({ prompt: "Build the first version of Corner Cafe's online ordering: a menu page, a cart and a pickup time." }) },
  }),
  resultCase({
    id: "engineering_lead.lovable_connected",
    agentType: "engineering_lead",
    kind: "ops",
    title: "Start the app in Lovable (sample)",
    business: "sample",
    goal: "The founder chose Build it with Lovable for the online ordering app. Create the Lovable project from the plan (a menu page, a cart and a pickup time), give it the project's knowledge with set_project_knowledge, and report its link.",
    acceptance: ["The Lovable project is created from the plan and its knowledge is set", "The report gives the project's link"],
    need: { tools: [{ tool: "create_project", connector: "lovable_mcp", min: 1 }, { tool: "set_project_knowledge", connector: "lovable_mcp", min: 1 }], mustMatch: [/lovable\.dev\/projects\//i] },
    mockBefore: [
      { connector: "lovable_mcp", tool: "create_project", args: () => ({ prompt: "Build the first version of Corner Cafe's online ordering: a menu page, a cart and a pickup time." }) },
      { connector: "lovable_mcp", tool: "set_project_knowledge", args: () => ({ project_id: "lov_demo_1", knowledge: "Corner Cafe: two coffee shops in Portland. Online ordering for pickup." }) },
    ],
    mockBody: "## The Lovable project (simulated)\n\nLovable answered from its mock in this sample project, so no project was created: https://lovable.dev/projects/lov_demo_1 is the mock's link. Its knowledge was set in the mock too.",
  }),
  resultCase({
    id: "finance_lead.first_budget",
    agentType: "finance_lead",
    kind: "finance",
    title: "First three months' budget",
    goal: "From these numbers, build a three-month budget for online ordering: about 40 pickup orders a week at an average of $9, card fees of 2.9% plus $0.30, cups and lids at $0.19 an order, $300 a month for marketing. Show revenue, costs and what is left each month, and the assumptions.",
    acceptance: ["Revenue, costs and what is left for each of three months", "Every figure labeled Estimate, with its assumptions"],
    need: { mustMatch: [/estimate/i, /2\.9|card fee/i, /month/i] },
    mockBody: "## Budget (Estimate)\n\nMonth 1: revenue $1,560, card fees $97, cups $33, marketing $300, left $1,130.\n\nAssumptions: 40 orders a week at $9; card fee 2.9% plus $0.30.",
  }),
  resultCase({
    id: "legal_lead.terms_checklist",
    agentType: "legal_lead",
    kind: "legal",
    title: "What online ordering needs legally",
    goal: "List what we need in place before taking online orders in Oregon: the pages (terms, privacy, refunds), the allergen information, and anything that needs the founder's own action. Say what is general information and what a lawyer should confirm.",
    acceptance: ["The pages the ordering site needs, with what each covers", "What needs the founder's own action", "What a lawyer should confirm"],
    need: { mustMatch: [/privacy/i, /refund/i, /lawyer|attorney/i, /founder/i] },
    mockBody: "## Before online orders\n\nPages: terms, privacy policy, refund policy. Allergen information on each item.\n\nThe founder's own action: accepting the payment provider's terms.\n\nA lawyer should confirm the refund wording.",
  }),
  resultCase({
    id: "operations_lead.opening_checklist",
    agentType: "operations_lead",
    kind: "ops",
    title: "Pickup shelf routine",
    goal: "Write the routine for the pickup shelf at both shops: how an online order is made, labeled, put on the shelf and handed over, what happens to an order not picked up after 30 minutes, and who does what in a shift with one person.",
    acceptance: ["The steps from a new order to hand-over", "What happens after 30 minutes without pickup", "How it works with one person on shift"],
    need: { mustMatch: [/30 minutes/i, /label/i, /one person|alone|solo/i] },
    mockBody: "## Pickup routine\n\n1. Make the order. 2. Label it with the name. 3. Shelf. 4. Hand over.\n\nAfter 30 minutes: remake hot drinks on request.\n\nOne person on shift: make orders between walk-ins.",
  }),

  // ---------------------------------------------------------------------------------------------- engineering workers
  codeCase({
    id: "frontend_engineer.fixes_the_button",
    agentType: "frontend_engineer",
    title: "Make the order button say Order ahead",
    goal: 'The order button in index.html says "Click". Make it say "Order ahead" and give it the accessible name "Order ahead for pickup" (aria-label). The test in order-button.test.js must pass; do not change the test.',
    files: FRONTEND_FILES,
    run: (f) => (!unchanged(f, FRONTEND_FILES, "order-button.test.js") ? fail("order button", "the test was changed") : /<button[^>]*aria-label="Order ahead for pickup"[^>]*>\s*Order ahead\s*<\/button>/.test(f.get("index.html") ?? "") ? pass("the order button says Order ahead") : fail("the order button says Order ahead", "AssertionError: The input did not match the regular expression")),
    writes: { "index.html": FRONTEND_FILES["index.html"].replace('<button class="order">Click</button>', '<button class="order" aria-label="Order ahead for pickup">Order ahead</button>') },
  }),
  codeCase({
    id: "data_engineer.daily_totals",
    agentType: "data_engineer",
    title: "Daily sales totals",
    goal: "From orders.csv, write daily_totals.csv with the header date,total_usd and one row per day with that day's total, two decimals, in date order. The test in daily_totals.test.js must pass; do not change the test.",
    files: DATA_FILES,
    run: (f) => {
      if (!unchanged(f, DATA_FILES, "daily_totals.test.js")) return fail("daily totals", "the test was changed");
      const rows = (f.get("daily_totals.csv") ?? "").trim().split("\n");
      return JSON.stringify(rows) === JSON.stringify(["date,total_usd", "2026-11-20,7.75", "2026-11-21,10.25"]) ? pass("daily_totals.csv") : fail("daily_totals.csv", `got ${JSON.stringify(rows)}`);
    },
    writes: { "daily_totals.csv": "date,total_usd\n2026-11-20,7.75\n2026-11-21,10.25\n" },
  }),
  codeCase({
    id: "infra_engineer.node_22",
    agentType: "infra_engineer",
    title: "Build on Node 22",
    goal: "Our host now builds with Node 22 only. Update the project so it declares Node 22: package.json engines.node and .nvmrc. The test in node-version.test.js must pass; do not change the test.",
    files: INFRA_FILES,
    run: (f) => {
      if (!unchanged(f, INFRA_FILES, "node-version.test.js")) return fail("node 22", "the test was changed");
      const engines = (json(f.get("package.json"))?.engines as { node?: string } | undefined)?.node ?? "";
      return /^(>=|\^)?22/.test(engines) && (f.get(".nvmrc") ?? "").trim() === "22" ? pass("the project builds on Node 22") : fail("the project builds on Node 22", `engines.node ${JSON.stringify(engines)}, .nvmrc ${JSON.stringify((f.get(".nvmrc") ?? "").trim())}`);
    },
    writes: { "package.json": INFRA_FILES["package.json"].replace(">=18", ">=22"), ".nvmrc": "22\n" },
  }),
  codeCase({
    id: "security_engineer.key_from_the_environment",
    agentType: "security_engineer",
    title: "Read the error-report key from the environment",
    goal: "error-reports.js has the project key for error reports typed into it. Read it from the environment variable SENTRY_DSN instead (reporting is off when it is not set), and name the variable in .env.example without its value.",
    files: REPORTS_FILES,
    run: (f) => {
      const src = f.get("error-reports.js") ?? "";
      const example = f.get(".env.example") ?? "";
      return /process\.env\.SENTRY_DSN/.test(src) && !src.includes("ingest.sentry.io") && /^SENTRY_DSN=$/m.test(example) ? pass("the key comes from the environment") : fail("the key comes from the environment", "error-reports.js still holds the key, or .env.example does not name SENTRY_DSN with no value");
    },
    writes: { "error-reports.js": "export const dsn = process.env.SENTRY_DSN ?? null;\n", ".env.example": "PORT=3000\nSENTRY_DSN=\n" },
  }),
  codeCase({
    id: "qa_engineer.writes_the_test",
    agentType: "qa_engineer",
    title: "Test the pricing settings",
    goal: "pricing.json has no test. Write pricing.test.js with node:test that checks the sales tax rate is 0.08 and a free drink takes 10 loyalty stamps. Do not change pricing.json.",
    files: QA_FILES,
    run: (f) => {
      const t = f.get("pricing.test.js") ?? "";
      if (!unchanged(f, QA_FILES, "pricing.json")) return fail("pricing", "pricing.json was changed");
      return /node:test/.test(t) && /salesTaxRate/.test(t) && /0\.08/.test(t) && /loyaltyStampsForFreeDrink/.test(t) && /\b10\b/.test(t) ? { passed: 2, failed: 0, output: "✔ the sales tax rate is 8%\n✔ a free drink takes 10 stamps" } : fail("pricing.test.js", "no test of the tax rate and the stamps");
    },
    writes: { "pricing.test.js": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nconst p = JSON.parse(readFileSync(new URL("./pricing.json", import.meta.url), "utf8"));\ntest("tax", () => assert.equal(p.salesTaxRate, 0.08));\ntest("stamps", () => assert.equal(p.loyaltyStampsForFreeDrink, 10));\n' },
  }),
  codeCase({
    id: "design_to_code.menu_card",
    agentType: "design_to_code",
    title: "Build the menu item card",
    goal: 'Build the menu item card from this design as menu-card.html: an <article class="menu-card"> with the item name in an <h3> ("Oat latte"), the price in a <p class="price"> ("$5.25"), and a <button> "Add to order". Colors come from styles.css (var(--brand)) only; no new hex colors.',
    files: CARD_FILES,
    run: (f) => {
      const html = f.get("menu-card.html") ?? "";
      const ok = /<article[^>]*class="menu-card"/.test(html) && /<h3[^>]*>\s*Oat latte\s*<\/h3>/.test(html) && /<p[^>]*class="price"[^>]*>\s*\$5\.25\s*<\/p>/.test(html) && /<button[^>]*>\s*Add to order\s*<\/button>/.test(html) && !/#[0-9a-f]{3,6}\b/i.test(html);
      return ok ? pass("the menu card matches the design") : fail("the menu card matches the design", "menu-card.html is missing a part of the design or adds a hex color");
    },
    writes: { "menu-card.html": '<article class="menu-card" style="border-color: var(--brand)">\n  <h3>Oat latte</h3>\n  <p class="price">$5.25</p>\n  <button>Add to order</button>\n</article>\n' },
  }),
  codeCase({
    id: "docs_writer.getting_started",
    agentType: "docs_writer",
    title: "Write Getting started",
    goal: 'Add a "## Getting started" section to README.md that says how to install (npm install) and run the tests (npm test), in plain words for someone new to the project.',
    files: README_FILES,
    run: (f) => {
      const r = f.get("README.md") ?? "";
      return /^## Getting started$/m.test(r) && /npm install/.test(r) && /npm test/.test(r) ? pass("README has Getting started") : fail("README has Getting started", "the section, npm install or npm test is missing");
    },
    writes: { "README.md": `${README_FILES["README.md"]}\n## Getting started\n\nRun \`npm install\`, then \`npm test\`.\n` },
  }),
  codeCase({
    id: "review_agent.finds_the_tenancy_bug",
    agentType: "review_agent",
    title: "Review the orders change",
    goal: "Review the change in orders.js before it merges: correctness, tenancy (every query reads only this project's rows, by business_id) and tests. Do not change the code; save your findings as a report with the file and line of each, then complete the task.",
    files: REVIEW_FILES,
    run: (f) => (unchanged(f, REVIEW_FILES, "orders.test.js") ? pass("listOrders returns the rows the database gives") : fail("orders", "the test was changed")),
    writes: {},
    review: { mustMatch: [/orders\.js/, /business_?id/i] },
  }),
  codeCase({
    id: "integration_agent.resolves_the_conflict",
    agentType: "integration_agent",
    title: "Resolve the merge conflict in pricing.json",
    goal: "Merging agent/loyalty-card left a conflict in pricing.json. Resolve it so both changes are kept (the 8% tax rate and the loyalty stamps), with no conflict markers left. The test in pricing.test.js must pass; do not change the test.",
    files: MERGE_FILES,
    run: (f) => {
      if (!unchanged(f, MERGE_FILES, "pricing.test.js")) return fail("pricing", "the test was changed");
      const p = json(f.get("pricing.json"));
      return p && p.salesTaxRate === 0.08 && p.loyaltyStampsForFreeDrink === 10 ? pass("pricing.json carries both changes") : fail("pricing.json carries both changes", "SyntaxError or a change is missing");
    },
    writes: { "pricing.json": `${JSON.stringify({ currency: "USD", salesTaxRate: 0.08, loyaltyStampsForFreeDrink: 10 }, null, 2)}\n` },
  }),
  resultCase({
    id: "planner.task_graph",
    agentType: "planner",
    kind: "research",
    title: "Plan the order history page",
    goal: "Plan the order history page (a customer sees their last ten pickup orders and can reorder one) as a task graph: three to six tasks, each under four hours, each with what it depends on and a check that proves it is done.",
    acceptance: ["Three to six tasks, each under four hours", "Each task names what it depends on and the check that proves it is done"],
    need: { mustMatch: [/\bh(?:ou)?rs?\b|\d\s*h\b/i, /depend/i], minItems: 3 },
    mockBody: "## Task graph\n\n1. Orders query (2 hours). Depends on nothing. Check: unit test.\n2. History page (3 hours). Depends on 1. Check: page test.\n3. Reorder button (2 hours). Depends on 2. Check: page test.\n",
  }),
  resultCase({
    id: "product_researcher.interview_plan",
    agentType: "product_researcher",
    kind: "research",
    title: "Customer interview plan for online ordering",
    goal: "Plan five short interviews with regulars about online ordering: who to ask, the questions (no leading ones), and how we record what we learn. Record each kind of regular we want to talk to as a contact type in the report; do not contact anyone.",
    acceptance: ["Who to interview and how to find them", "Five to eight questions that do not lead", "How the answers are recorded; nobody is contacted"],
    need: { mustMatch: [/\?/, /record/i] },
    mockBody: "## Interview plan\n\nWho: morning regulars, weekend families.\n\nQuestions: How do you order today? What gets in the way?\n\nRecorded in a shared note after each talk. Nobody is contacted by the team.",
  }),

  // ---------------------------------------------------------------------------------------------- channels
  notConnectedCase({
    id: "channel_lead_generation.apollo_not_connected",
    agentType: "channel_lead_generation",
    kind: "channel",
    title: "Find offices near the shops",
    goal: "Use Apollo to find ten office managers at companies within a mile of our downtown shop, for a coffee-for-meetings offer. List them with their company.",
    acceptance: ["Ten office managers found in Apollo, each with their company"],
    connector: "apollo",
    name: /apollo/i,
    mockCall: { connector: "apollo", tool: "search_people", args: () => ({ titles: ["office manager"], locations: ["Portland, Oregon"], limit: 10 }) },
  }),
  resultCase({
    id: "channel_lead_generation.apollo_connected",
    agentType: "channel_lead_generation",
    kind: "channel",
    title: "Find offices near the shops (sample)",
    business: "sample",
    goal: "Use Apollo to find ten office managers at companies within a mile of our downtown shop, for a coffee-for-meetings offer. List them with their company. Contact nobody.",
    acceptance: ["Office managers found in Apollo, each with their company"],
    need: { tools: [{ tool: "search_people", connector: "apollo", min: 1 }] },
    mockBefore: [{ connector: "apollo", tool: "search_people", args: () => ({ titles: ["office manager"], locations: ["Portland, Oregon"], limit: 10 }) }],
    mockBody: "## Office managers (simulated)\n\nApollo answered from its mock in this sample project, so these are simulated.\n\n- Jordan Lee, Acme Co.",
  }),
  resultCase({
    id: "channel_email_automation.welcome_sequence",
    agentType: "channel_email_automation",
    kind: "channel",
    title: "Draft the loyalty welcome sequence",
    goal: "Draft a three-email welcome sequence for people who join the loyalty card: the subject and body of each, when each goes out, and the unsubscribe line. Draft only; send nothing.",
    acceptance: ["Three emails, each with a subject, a body and when it goes out", "Each email has an unsubscribe line", "Nothing is sent"],
    need: { mustMatch: [/subject/i, /unsubscribe/i] },
    mockBody: "## Welcome sequence\n\nEmail 1 (day 0). Subject: Your first stamp. Body: Welcome. Unsubscribe at any time.\n\nEmail 2 (day 3)...\n\nEmail 3 (day 10)...",
  }),
  resultCase({
    id: "channel_seo.page_brief",
    agentType: "channel_seo",
    kind: "channel",
    title: "SEO brief for the ordering page",
    goal: "Write the SEO brief for our online ordering page: the search phrases people in Portland would use (labeled Estimate where you guess at volume), the page title and meta description, the headings, and the local details the page must carry.",
    acceptance: ["Search phrases, with any volume labeled Estimate", "A page title and a meta description", "The headings and local details for the page"],
    need: { mustMatch: [/title/i, /meta description/i, /portland/i] },
    mockBody: "## Brief\n\nPhrases: coffee pickup Portland (volume Estimate).\n\nTitle: Order ahead at Corner Cafe, Portland. Meta description: Order coffee for pickup.\n\nHeadings: Menu, Pickup times.",
  }),
  resultCase({
    id: "channel_geo.answer_page",
    agentType: "channel_geo",
    kind: "channel",
    title: "Make the cafe answerable by AI assistants",
    goal: "When someone asks an AI assistant where to get coffee for pickup in downtown Portland, we want Corner Cafe in the answer. Write the plan: the questions people ask, the facts our pages must state plainly (hours, address, pickup), and a short FAQ section for the ordering page.",
    acceptance: ["The questions people ask an assistant", "The facts our pages must state", "A short FAQ for the ordering page"],
    need: { mustMatch: [/faq/i, /hours/i, /pickup/i] },
    mockBody: "## Plan\n\nQuestions: where can I order coffee ahead downtown?\n\nFacts: hours, address, pickup window.\n\n## FAQ\n\nCan I order ahead? Yes, for pickup.",
  }),
  resultCase({
    id: "channel_content.launch_post",
    agentType: "channel_content",
    kind: "channel",
    title: "Write the online ordering blog post",
    goal: "Write a 300 to 500 word blog post announcing online ordering for pickup: how it works in three steps, the pickup shelf, and the compostable cups. Use only the facts here; invent no customer or number.",
    acceptance: ["A post of 300 to 500 words", "How ordering works in three steps", "No invented customer, quote or number"],
    need: { mustMatch: [/pickup/i, /compostable/i] },
    mockBody: "## Order ahead at Corner Cafe\n\nYou can now order for pickup in three steps: pick, pay, collect from the pickup shelf. Our cups are compostable.",
  }),
  notConnectedCase({
    id: "channel_social.buffer_not_connected",
    agentType: "channel_social",
    kind: "channel",
    title: "Queue Monday's post",
    goal: "Write Monday's post announcing online ordering for pickup and queue it in Buffer for Monday at 8:00 AM.",
    acceptance: ["The post is queued in Buffer for Monday at 8:00 AM"],
    connector: "buffer",
    name: /buffer/i,
    mockCall: { connector: "buffer", tool: "queue_post", args: () => ({ text: "Order ahead for pickup.", scheduledAt: "2026-11-30T16:00:00Z" }) },
  }),
  {
    // A Buffer post runs without approval in assisted mode (founder, Nov 24, 2026: "yes, Buffer posts should run without
    // approval too"), so the right end with Buffer connected is the post queued, the task done and nobody asked.
    id: "channel_social.buffer_connected_queues_post",
    title: "channel_social: Queue Monday's post (sample): it is queued in Buffer with no approval",
    agentType: "channel_social",
    business: "sample",
    task: { kind: "channel", title: "Queue Monday's post (sample)", goalMd: `${PROJECT}\n\nWrite Monday's post announcing online ordering for pickup and queue it in Buffer for Monday at 8:00 AM. Then complete the task.`, acceptance: ["The post is queued in Buffer for Monday at 8:00 AM"] },
    script: reportSteps(
      "Monday's post",
      "## Monday's post\n\nOrder ahead for pickup. Queued in Buffer for Monday at 8:00 AM; this was simulated in the sample, so nothing was queued or published.",
      ["The post is queued in Buffer for Monday at 8:00 AM"],
      [{ connector: "buffer", tool: "queue_post", args: () => ({ channelId: "64a0c0ffee0000000000l002", draft: { text: "Order ahead for pickup.", variants: {} }, when: { mode: "queue" } }) }],
    ),
    check(o) {
      const problems = resultProblems(o, { sample: true, tools: [{ tool: "queue_post", connector: "buffer", min: 1 }] });
      if (o.toolCalls.some((c) => c.policyOutcome === "ask")) problems.push("the founder was asked for approval");
      return problems;
    },
  },
  resultCase({
    id: "channel_paid_ads.test_plan",
    agentType: "channel_paid_ads",
    kind: "channel",
    title: "Plan a first ads test",
    goal: "Plan a two-week paid social test of $100 for online ordering: the audience (people within two miles of the shops), two ad variants with their copy, the budget split, and what result would make us continue. Launch nothing.",
    acceptance: ["The audience and two ad variants with copy", "The $100 split and the result that decides whether to continue", "Nothing is launched or paid"],
    need: { mustMatch: [/\$\s?\d/, /variant|version|ad [ab12]/i] },
    mockBody: "## Test plan\n\nAudience: within two miles. Variant A: Skip the line. Variant B: Order ahead.\n\nSplit: $50 each. Continue if a pickup order costs under $5 (Estimate).",
  }),
  resultCase({
    id: "channel_influencer.creator_brief",
    agentType: "channel_influencer",
    kind: "channel",
    title: "Brief for local food creators",
    goal: "Write the brief we give local Portland food creators for a free-coffee-for-a-post trade: what we offer, what we ask for, the disclosure the post must carry (#ad or similar under FTC rules), and what they must not claim.",
    acceptance: ["What we offer and what we ask for", "The disclosure the post must carry", "What the creator must not claim"],
    need: { mustMatch: [/disclos|#ad/i, /ftc/i] },
    mockBody: "## Creator brief\n\nWe offer a week of free coffee. We ask for one post.\n\nDisclosure: #ad, as the FTC asks.\n\nDo not claim health benefits.",
  }),
  resultCase({
    id: "channel_affiliate.referral_program",
    agentType: "channel_affiliate",
    kind: "channel",
    title: "Design a referral reward",
    goal: "Design a simple referral reward for the loyalty card: what the referrer and the new customer each get, the rules that stop abuse, and the cost per new customer as an Estimate.",
    acceptance: ["What each side gets", "Rules against abuse", "The cost per new customer, labeled Estimate"],
    need: { mustMatch: [/estimate/i, /refer/i] },
    mockBody: "## Referral reward\n\nReferrer: two stamps. New customer: one stamp.\n\nRules: one reward per new customer.\n\nCost per new customer: $1.50 (Estimate).",
  }),
  resultCase({
    id: "channel_direct_mail.postcard",
    agentType: "channel_direct_mail",
    kind: "channel",
    title: "Postcard to nearby homes",
    goal: "Write a postcard for 500 homes near the second shop: the front and back copy, an offer code to track it (a placeholder is fine), the size, and the cost as an Estimate. Book and pay for nothing.",
    acceptance: ["Front and back copy with a tracking code", "Size and cost labeled Estimate", "Nothing booked or paid"],
    need: { mustMatch: [/front/i, /back/i, /estimate/i, /code/i] },
    mockBody: "## Postcard\n\nFront: Order ahead. Back: Use code {{offer_code}}.\n\nSize 4x6. Cost for 500: $250 (Estimate).",
  }),
  resultCase({
    id: "channel_print.flyer",
    agentType: "channel_print",
    kind: "channel",
    title: "Counter flyer",
    goal: "Write a counter flyer for online ordering: the headline, three lines of copy, a QR code placeholder for the ordering page, and the size and print quantity with the cost as an Estimate. Order no printing.",
    acceptance: ["Headline, copy and a QR placeholder", "Size, quantity and cost labeled Estimate"],
    need: { mustMatch: [/qr/i, /estimate/i] },
    mockBody: "## Flyer\n\nHeadline: Skip the line.\n\nQR placeholder: {{qr_order_page}}.\n\nA5, 200 copies, $40 (Estimate).",
  }),
  resultCase({
    id: "channel_broadcast.radio_spot",
    agentType: "channel_broadcast",
    kind: "channel",
    title: "Local radio spot script",
    goal: "Write a 30-second local radio spot script for online ordering, with a vanity URL to track it, and what a week on a Portland station would cost as an Estimate. Book nothing.",
    acceptance: ["A 30-second script", "A vanity URL to track the spot", "A week's cost labeled Estimate"],
    need: { mustMatch: [/30/, /estimate/i] },
    mockBody: "## 30-second spot\n\nVoice: Order ahead at Corner Cafe.\n\nVanity URL: cornercafe.example/radio.\n\nA week: $600 (Estimate).",
  }),
  resultCase({
    id: "channel_outdoor.sandwich_board",
    agentType: "channel_outdoor",
    kind: "channel",
    title: "Sidewalk board",
    goal: "Write the sidewalk board for the downtown shop: the main line, a second line, how far away it must be readable, and how we track whether it brings orders. Buy nothing.",
    acceptance: ["The main line and a second line", "How we track whether it brings orders"],
    need: { mustMatch: [/track|code/i] },
    mockBody: "## Board\n\nMain: Order ahead, skip the line.\n\nSecond: Scan to order.\n\nTrack with the code BOARD at checkout.",
  }),
  resultCase({
    // Gmail drafts need gmail.compose, restricted at Google (Nov 23, 2026), so the pitch lives in the report.
    id: "channel_pr.pitch",
    agentType: "channel_pr",
    kind: "channel",
    title: "Pitch a Portland food writer",
    goal: "Write a short pitch to a Portland food writer about our switch to compostable cups: a subject line, a pitch under 150 words with only the facts here, and the kind of writer to send it to and why. Send nothing; the founder sends it.",
    acceptance: ["A subject line and a pitch under 150 words", "The kind of writer to pitch and why", "Nothing is sent"],
    need: { mustMatch: [/subject/i, /compostable/i] },
    mockBody: "## Pitch\n\nSubject: A Portland cafe switches to compostable cups.\n\nPitch: Corner Cafe now serves every drink in compostable cups.\n\nWho: a food writer covering local cafes. The founder sends it.",
  }),
  notConnectedCase({
    id: "channel_events.calendar_not_connected",
    agentType: "channel_events",
    kind: "channel",
    title: "Put the tasting on the calendar",
    goal: "Plan a Saturday coffee tasting at the downtown shop on Dec 5, 2026, 10:00 to 11:00 AM, and add it to our Google Calendar (no attendees).",
    acceptance: ["The tasting is on Google Calendar for Dec 5, 2026, 10:00 to 11:00 AM"],
    connector: "google_calendar",
    name: /google calendar|calendar/i,
    mockCall: { connector: "google_calendar", tool: "create_event", args: () => ({ summary: "Coffee tasting", start: "2026-12-05T18:00:00Z", end: "2026-12-05T19:00:00Z" }) },
  }),
  resultCase({
    id: "channel_events.calendar_connected",
    agentType: "channel_events",
    kind: "channel",
    title: "Put the tasting on the calendar (sample)",
    business: "sample",
    goal: "Plan a Saturday coffee tasting at the downtown shop on Dec 5, 2026, 10:00 to 11:00 AM, and add it to our Google Calendar (no attendees).",
    acceptance: ["The tasting is on Google Calendar for Dec 5, 2026, 10:00 to 11:00 AM"],
    // add_event (no attendees) or create_event: both put the tasting on the calendar (run 45408711835 used add_event).
    need: { tools: [{ tool: "add_event|create_event", connector: "google_calendar", min: 1 }] },
    mockBefore: [{ connector: "google_calendar", tool: "create_event", args: () => ({ summary: "Coffee tasting", start: "2026-12-05T18:00:00Z", end: "2026-12-05T19:00:00Z" }) }],
    mockBody: "## Tasting\n\nDec 5, 2026, 10:00 to 11:00 AM.\n\nGoogle Calendar answered from its mock in this sample project: the event is simulated.",
  }),

  // ---------------------------------------------------------------------------------------------- specialists
  resultCase({
    id: "formulation_chemist.syrup_formula",
    agentType: "formulation_chemist",
    kind: "specialist",
    title: "House vanilla syrup formula",
    goal: "Draft a starter formula for a house vanilla syrup for a cafe: ingredients with percentages that add up to 100, the shelf-life risks, and the tests to run before we sell it. Say what a food lab should confirm.",
    acceptance: ["Ingredients with percentages adding to 100", "Shelf-life risks and the tests to run", "What a food lab should confirm"],
    need: { mustMatch: [/%/, /shelf/i, /lab/i] },
    mockBody: "## Formula\n\nSugar 50%, water 49%, vanilla extract 1%.\n\nShelf-life risks: mold. Tests: pH, water activity.\n\nA food lab should confirm the shelf life.",
  }),
  resultCase({
    id: "pharmacology_regulatory.caffeine_label",
    agentType: "pharmacology_regulatory",
    kind: "specialist",
    title: "Caffeine on the cold brew label",
    goal: "We want to sell bottled cold brew. Say what the label must say about caffeine in the US, what we must not claim (energy, health), and what needs a regulatory expert to confirm. General information, not legal advice.",
    acceptance: ["What the label must say about caffeine", "What we must not claim", "What a regulatory expert should confirm"],
    need: { mustMatch: [/caffeine/i, /claim/i, /confirm|expert/i] },
    mockBody: "## Caffeine label\n\nState the caffeine content per bottle.\n\nDo not claim energy or health benefits.\n\nA regulatory expert should confirm the wording.",
  }),
  resultCase({
    id: "financial_regulatory.gift_cards",
    agentType: "financial_regulatory",
    kind: "specialist",
    title: "Rules for selling gift cards",
    goal: "We want to sell prepaid gift cards in Oregon. Say which rules apply in general terms (expiry, fees, unclaimed balances), what we must disclose, and what an accountant or lawyer should confirm. General information, not legal advice.",
    acceptance: ["The rules on expiry, fees and unclaimed balances", "What we must disclose", "What an accountant or lawyer should confirm"],
    need: { mustMatch: [/expir/i, /fee/i, /disclos/i] },
    mockBody: "## Gift cards\n\nExpiry and fees are limited by federal and Oregon rules. Unclaimed balances may go to the state.\n\nDisclose any fee on the card.\n\nA lawyer should confirm.",
  }),
  resultCase({
    id: "certification.compostable_claim",
    agentType: "certification",
    kind: "specialist",
    title: "Can we call our cups compostable?",
    goal: "Our supplier says its cups are certified compostable (EN 13432, BPI). Say which certification supports the word \"compostable\" on our menu in the US, what proof we must keep from the supplier, and the exact wording we may use.",
    acceptance: ["Which certification supports the claim in the US", "What proof to keep from the supplier", "The wording we may use"],
    need: { mustMatch: [/BPI/, /certificat/i, /proof|certificate|keep/i] },
    mockBody: "## Compostable claim\n\nIn the US, BPI certification supports it.\n\nKeep the supplier's BPI certificate on file.\n\nWording: cups certified compostable in industrial facilities.",
  }),
  resultCase({
    id: "packaging_design.cup_sleeve",
    agentType: "packaging_design",
    kind: "specialist",
    title: "Cup sleeve brief",
    goal: "Write the brief for a printed cup sleeve for our 12 oz compostable cups: the dimensions to get from the supplier, what goes on it (logo, the order-ahead line, a QR code), the material and ink that keep it compostable, and the proof to approve before printing.",
    acceptance: ["The dimensions to confirm with the supplier", "What goes on the sleeve", "Material and ink that keep it compostable"],
    need: { mustMatch: [/12 oz/i, /ink/i, /qr/i] },
    mockBody: "## Sleeve brief\n\nConfirm the 12 oz dimensions with the supplier.\n\nOn it: logo, Order ahead, QR code.\n\nUncoated paper with water-based ink.",
  }),
  resultCase({
    id: "quality.incoming_check",
    agentType: "quality",
    kind: "specialist",
    title: "Incoming check for cup deliveries",
    goal: "Write the check the person on shift does when a cup delivery arrives: what to look at, how many cups to sample, what fails a delivery, and what to record.",
    acceptance: ["What to look at and how many to sample", "What fails a delivery", "What to record"],
    need: { mustMatch: [/sample/i, /record/i, /fail|reject/i] },
    mockBody: "## Incoming check\n\nSample 10 cups from each case.\n\nReject the delivery if any leak.\n\nRecord the date, supplier and result.",
  }),
  resultCase({
    id: "logistics.reorder_plan",
    agentType: "logistics",
    kind: "specialist",
    title: "Cup reorder plan",
    goal: "We use about 1,200 cups a week across both shops. Our supplier ships in 5 business days, minimum order 1,000. Work out when to reorder and how many, with a safety stock, and say the assumptions. Label the numbers Estimate.",
    acceptance: ["The reorder point and the order quantity", "The safety stock and the assumptions", "Numbers labeled Estimate"],
    need: { mustMatch: [/reorder/i, /safety stock/i, /estimate/i] },
    mockBody: "## Reorder plan (Estimate)\n\nReorder point: 1,700 cups. Order 3,000.\n\nSafety stock: 500 cups. Assumes 1,200 a week and 5 business days.",
  }),
  resultCase({
    id: "costing.cost_per_latte",
    agentType: "costing",
    kind: "specialist",
    title: "Cost of a pickup latte",
    goal: "Work out what one 12 oz pickup latte costs us: espresso $0.45, milk $0.38, cup and lid $0.19, sleeve $0.04, card fee 2.9% plus $0.30 on a $5.25 price. Give the cost, the margin and the price that keeps a 70% margin. Label the numbers Estimate.",
    acceptance: ["The cost of one latte, line by line", "The margin at $5.25", "The price for a 70% margin, labeled Estimate"],
    need: { mustMatch: [/5\.25/, /margin/i, /estimate/i, /70/] },
    mockBody: "## Cost per latte (Estimate)\n\nEspresso $0.45, milk $0.38, cup $0.19, sleeve $0.04, card fee $0.45. Total $1.51.\n\nMargin at $5.25: 71%.\n\n70% margin price: $5.03.",
  }),
]);