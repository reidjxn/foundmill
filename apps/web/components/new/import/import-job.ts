/**
 * Door B: import sources → import job → "Scouting report" (BUILD §11.1, AC-11.1.5). Pure.
 *
 * The API has no `import.*` procedures yet (apps/orchestrator has the `importBusiness` workflow; nothing starts it
 * from the web). Until it lands this module runs the job locally and deterministically from the chosen sources,
 * in the exact shape the workflow reports (`ImportSourceResult { sourceId, ok, summary }` + a Scouting report), so the
 * screen swaps to the real job without changing. Every figure the report shows is labelled an estimate.
 */
import { createRng, type Rng } from "@foundmill/dugout";
import type { Archetype } from "@foundmill/shared";

export type ImportSourceKey = "github" | "google_drive" | "notion" | "linear" | "jira" | "website" | "stripe" | "shopify" | "bank" | "registry";

export type SourceInputKind = "repo" | "url" | "regno" | "none";

export interface ImportSource {
  key: ImportSourceKey;
  label: string;
  group: "Code and documents" | "Work tracking" | "Revenue and money" | "Identity";
  description: string;
  /** Founder-typed value the source needs (repo, URL, registration number) or none (consent flow). */
  input: SourceInputKind;
  placeholder?: string;
  /** Which connector key the gateway will use (BUILD §13). */
  connectorKey: string;
  /** Read-only by design; write is a separate, later consent. */
  readOnly: true;
  /** Shown as the consent note. */
  consent: string;
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  { key: "github", label: "GitHub", group: "Code and documents", description: "Repo-scoped read through the GitHub App. Clone into the sandbox, read the top 200 files by importance, run tests if present. Never pushes.", input: "repo", placeholder: "owner/repository", connectorKey: "github", readOnly: true, consent: "Read access to one repository. Write is a separate consent later." },
  { key: "google_drive", label: "Google Drive", group: "Code and documents", description: "Decks, plans and spreadsheets in a folder you choose.", input: "none", connectorKey: "google_drive", readOnly: true, consent: "Read access to one folder." },
  { key: "notion", label: "Notion", group: "Work tracking", description: "Wiki pages and databases: specs, roadmaps, meeting notes.", input: "none", connectorKey: "notion", readOnly: true, consent: "Read access to the pages you share." },
  { key: "linear", label: "Linear", group: "Work tracking", description: "Issues, projects and cycles become roadmap seeds.", input: "none", connectorKey: "linear", readOnly: true, consent: "Read access to one workspace." },
  { key: "jira", label: "Jira", group: "Work tracking", description: "Epics and issues become roadmap seeds.", input: "none", connectorKey: "jira", readOnly: true, consent: "Read access to one project." },
  { key: "website", label: "Website", group: "Code and documents", description: "Crawls your public site within robots.txt: positioning, pricing, pages.", input: "url", placeholder: "https://example.com", connectorKey: "web", readOnly: true, consent: "Public pages only; robots.txt is respected." },
  { key: "stripe", label: "Stripe", group: "Revenue and money", description: "Customers, subscriptions, invoices: real revenue history.", input: "none", connectorKey: "stripe", readOnly: true, consent: "Read-only Stripe Connect. Payouts and transfers are never available to agents." },
  { key: "shopify", label: "Shopify", group: "Revenue and money", description: "Orders, products and customers from your store.", input: "none", connectorKey: "shopify", readOnly: true, consent: "Read access to orders, products, customers." },
  { key: "bank", label: "Bank (open banking)", group: "Revenue and money", description: "Balances and transactions for cash and runway. Read only.", input: "none", connectorKey: "tink", readOnly: true, consent: "Account information only; no payment initiation exists." },
  { key: "registry", label: "Company registry", group: "Identity", description: "Legal name, officers, filing deadlines from the public register.", input: "regno", placeholder: "Registration number", connectorKey: "companies_house", readOnly: true, consent: "Public record lookup." },
];

export const IMPORT_SOURCE_GROUPS = ["Code and documents", "Work tracking", "Revenue and money", "Identity"] as const;

export function sourceByKey(key: string): ImportSource | undefined {
  return IMPORT_SOURCES.find((s) => s.key === key);
}

export interface SourceConfig {
  key: ImportSourceKey;
  value: string;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Null when the typed value is acceptable for the source. */
export function validateSourceValue(source: ImportSource, value: string): string | null {
  const v = value.trim();
  switch (source.input) {
    case "repo":
      if (!v) return "Enter the repository as owner/name.";
      if (!REPO_RE.test(v.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""))) return "Use owner/name, for example acme/ledgerly.";
      return null;
    case "url": {
      if (!v) return "Enter the site address.";
      try {
        const u = new URL(v.includes("://") ? v : `https://${v}`);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return "Use a full address, like https://example.com.";
        return null;
      } catch {
        return "Use a full address, like https://example.com.";
      }
    }
    case "regno":
      if (!v) return "Enter the registration number.";
      if (v.length < 2 || v.length > 40) return "That does not look like a registration number.";
      return null;
    case "none":
      return null;
  }
}

export function normaliseSourceValue(source: ImportSource, value: string): string {
  const v = value.trim();
  if (source.input === "repo") return v.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (source.input === "url") return v.includes("://") ? v : `https://${v}`;
  return v;
}

export function validateConfigs(configs: readonly SourceConfig[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const c of configs) {
    const s = sourceByKey(c.key);
    if (!s) continue;
    const err = validateSourceValue(s, c.value);
    if (err) errors[c.key] = err;
  }
  return errors;
}

/* ---------- the job ---------- */

export type StepStatus = "queued" | "running" | "done" | "failed";

export interface SourceStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface SourceProgress {
  key: ImportSourceKey;
  value: string;
  status: StepStatus;
  steps: SourceStep[];
  /** Mirrors `ImportSourceResult.summary` from the orchestrator. */
  summary: string | null;
}

export interface ImportJob {
  id: string;
  status: "idle" | "running" | "done";
  sources: SourceProgress[];
  startedAt: string | null;
  finishedAt: string | null;
}

/** The steps each source runs. GitHub's are the ones BUILD §11.1 lists; the last is "never push". */
export function stepsFor(key: ImportSourceKey, value: string): string[] {
  switch (key) {
    case "github":
      return [`Clone ${value} into the sandbox (read only)`, "Summarise the file tree", "Read the top 200 files by importance", "Run the test suite if one exists", "Turn open issues into roadmap seeds", "Confirm nothing was pushed"];
    case "google_drive":
      return ["List the folder", "Read decks and plans", "Extract positioning and numbers"];
    case "notion":
      return ["List shared pages", "Read specs and notes", "Extract decisions and open questions"];
    case "linear":
    case "jira":
      return ["List projects", "Read open issues", "Turn issues into roadmap seeds"];
    case "website":
      return ["Fetch robots.txt", `Crawl ${value} within the rules`, "Extract positioning, pricing and pages"];
    case "stripe":
      return ["Read customers and subscriptions", "Read invoices and payments", "Build revenue history"];
    case "shopify":
      return ["Read orders", "Read products and customers", "Build revenue history"];
    case "bank":
      return ["Read account balances", "Read the last 24 months of transactions", "Estimate burn and runway"];
    case "registry":
      return [`Look up ${value}`, "Read officers and filings", "List upcoming deadlines"];
  }
}

export function planImportJob(configs: readonly SourceConfig[], id = "local"): ImportJob {
  return {
    id,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    sources: configs.map((c) => ({
      key: c.key,
      value: c.value,
      status: "queued",
      steps: stepsFor(c.key, c.value).map((label, i) => ({ id: `${c.key}:${i}`, label, status: "queued" })),
      summary: null,
    })),
  };
}

export function totalSteps(job: ImportJob): number {
  return job.sources.reduce((n, s) => n + s.steps.length, 0);
}

export function doneSteps(job: ImportJob): number {
  return job.sources.reduce((n, s) => n + s.steps.filter((st) => st.status === "done").length, 0);
}

/** Advance the job by one step (sources run in order; the workflow runs three at a time, the view is the same). */
export function advanceJob(job: ImportJob, now = new Date()): ImportJob {
  if (job.status === "done") return job;
  const sources = job.sources.map((s) => ({ ...s, steps: s.steps.map((st) => ({ ...st })) }));
  const startedAt = job.startedAt ?? now.toISOString();
  for (const source of sources) {
    const running = source.steps.find((st) => st.status === "running");
    if (running) {
      running.status = "done";
      const next = source.steps.find((st) => st.status === "queued");
      if (next) next.status = "running";
      else {
        source.status = "done";
        source.summary = summaryFor(source.key, source.value);
      }
      return finish({ ...job, status: "running", startedAt, sources }, now);
    }
    const queued = source.steps.find((st) => st.status === "queued");
    if (queued) {
      queued.status = "running";
      source.status = "running";
      return finish({ ...job, status: "running", startedAt, sources }, now);
    }
  }
  return finish({ ...job, status: "running", startedAt, sources }, now);
}

function finish(job: ImportJob, now: Date): ImportJob {
  const allDone = job.sources.every((s) => s.status === "done" || s.status === "failed");
  return allDone ? { ...job, status: "done", finishedAt: now.toISOString() } : job;
}

/** Run the whole job to completion (reduced motion, tests). */
export function completeJob(job: ImportJob, now = new Date()): ImportJob {
  let j = job;
  const limit = totalSteps(job) * 2 + 2;
  for (let i = 0; i < limit && j.status !== "done"; i++) j = advanceJob(j, now);
  return j;
}

function summaryFor(key: ImportSourceKey, value: string): string {
  const rng = createRng(`import:${key}:${value}`);
  switch (key) {
    case "github":
      return `${rng.int(80, 420)} files read, ${rng.int(6, 60)} tests ${rng.bool(0.8) ? "passing" : "with failures"}, ${rng.int(3, 24)} open issues, nothing pushed`;
    case "google_drive":
      return `${rng.int(4, 30)} documents read`;
    case "notion":
      return `${rng.int(6, 40)} pages read`;
    case "linear":
    case "jira":
      return `${rng.int(8, 60)} open issues read`;
    case "website":
      return `${rng.int(4, 40)} pages crawled within robots.txt`;
    case "stripe":
      return `${rng.int(5, 400)} customers, ${rng.int(1, 24)} months of revenue`;
    case "shopify":
      return `${rng.int(20, 3000)} orders, ${rng.int(3, 120)} products`;
    case "bank":
      return `${rng.int(1, 3)} accounts, 24 months of transactions`;
    case "registry":
      return `entity found, ${rng.int(1, 4)} officers, ${rng.int(1, 3)} upcoming deadlines`;
  }
}

/* ---------- the Scouting report ---------- */

export interface ScoutingDecision {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  reversible: boolean;
}

export interface RoadmapSeed {
  title: string;
  source: string;
}

export interface ScoutingReport {
  title: string;
  suggestedName: string;
  archetypeHint: Archetype;
  summary: string;
  whatExists: string[];
  whatIsMissing: string[];
  strengths: string[];
  weaknesses: string[];
  firstDecisions: ScoutingDecision[];
  roadmapSeeds: RoadmapSeed[];
  /** AC-11.1.5: a GitHub import never pushes. */
  neverPushed: boolean;
  provenance: "Estimate";
}

const CODE_SOURCES: ImportSourceKey[] = ["github"];
const REVENUE_SOURCES: ImportSourceKey[] = ["stripe", "shopify", "bank"];
const TRACKING_SOURCES: ImportSourceKey[] = ["linear", "jira", "notion"];

function nameFrom(configs: readonly SourceConfig[]): string {
  const repo = configs.find((c) => c.key === "github")?.value;
  if (repo) {
    const name = repo.split("/")[1] ?? repo;
    return titleCase(name.replace(/[-_.]+/g, " "));
  }
  const site = configs.find((c) => c.key === "website")?.value;
  if (site) {
    try {
      const host = new URL(site).hostname.replace(/^www\./, "");
      return titleCase(host.split(".")[0] ?? host);
    } catch {
      /* fall through */
    }
  }
  return "Imported business";
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function archetypeFromSources(configs: readonly SourceConfig[]): Archetype {
  const keys = new Set(configs.map((c) => c.key));
  if (keys.has("shopify")) return "dtc_physical";
  if (keys.has("github") && keys.has("stripe")) return "b2b_saas";
  if (keys.has("github")) return "b2b_saas";
  if (keys.has("website") && !keys.has("stripe")) return "services";
  if (keys.has("stripe")) return "consumer_app";
  return "services";
}

const ISSUE_TITLES = ["Onboarding drop-off after sign-up", "Export to CSV", "Billing page shows stale invoice totals", "Slow dashboard query for large accounts", "Mobile layout of the pricing page", "Webhook retries on timeout", "Team invitations by link", "Audit log for admin actions", "SSO for enterprise plan", "Localise dates and currencies", "Flaky integration test in checkout", "Rate limit public API"];

function seedsFor(configs: readonly SourceConfig[], rng: Rng): RoadmapSeed[] {
  const out: RoadmapSeed[] = [];
  const github = configs.find((c) => c.key === "github");
  if (github) {
    const n = rng.int(3, 6);
    const titles = rng.shuffle(ISSUE_TITLES).slice(0, n);
    titles.forEach((t) => out.push({ title: t, source: `${github.value} issue #${rng.int(4, 240)}` }));
  }
  for (const c of configs) {
    if (c.key === "linear" || c.key === "jira") {
      const n = rng.int(2, 4);
      rng.shuffle(ISSUE_TITLES).slice(0, n).forEach((t) => out.push({ title: t, source: `${sourceByKey(c.key)?.label ?? c.key} ${c.key === "jira" ? "ISS" : "LIN"}-${rng.int(10, 999)}` }));
    }
  }
  return out;
}

export function buildScoutingReport(configs: readonly SourceConfig[], job?: ImportJob): ScoutingReport {
  const rng = createRng(`scouting:${configs.map((c) => `${c.key}=${c.value}`).join("|")}`);
  const keys = new Set(configs.map((c) => c.key));
  const has = (k: ImportSourceKey) => keys.has(k);
  const any = (ks: ImportSourceKey[]) => ks.some(has);
  const name = nameFrom(configs);
  const archetypeHint = archetypeFromSources(configs);

  const whatExists: string[] = [];
  const whatIsMissing: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const summaries = new Map(job?.sources.map((s) => [s.key, s.summary]) ?? []);
  for (const c of configs) {
    const s = sourceByKey(c.key);
    if (!s) continue;
    const summary = summaries.get(c.key) ?? summaryFor(c.key, c.value);
    whatExists.push(`${s.label}${c.value ? ` (${c.value})` : ""}: ${summary}`);
  }
  if (any(CODE_SOURCES)) {
    strengths.push("A working codebase with a test suite: agents can start from real code, not a blank repo.");
    if (rng.bool(0.5)) weaknesses.push("No deployment pipeline was found; releases look manual.");
    else weaknesses.push("README is out of date with the code; the Specification should be rebuilt from the repository.");
  } else {
    whatIsMissing.push("No code source: the Development department starts from the Specification.");
  }
  if (any(REVENUE_SOURCES)) {
    strengths.push("Real revenue history: forecasts start from actuals rather than archetype priors.");
    if (has("bank")) strengths.push("Cash position is known, so runway is a measurement, not an estimate.");
    else whatIsMissing.push("No bank connection: runway stays an estimate until one is added.");
  } else {
    whatIsMissing.push("No revenue source: Finance starts with a management P&L and labelled estimates.");
  }
  if (any(TRACKING_SOURCES)) strengths.push("A backlog exists: the first roadmap is seeded from your open issues.");
  else whatIsMissing.push("No work tracking: the first roadmap comes from the Board's proposals.");
  if (has("website")) strengths.push("Public positioning and pricing exist and can be tested against competitors.");
  else whatIsMissing.push("No website: positioning will be drafted from the Specification.");
  if (has("registry")) strengths.push("The legal entity is on record; filing deadlines are known.");
  else whatIsMissing.push("No registry record: Legal will ask whether an entity exists.");
  if (!has("stripe") && !has("shopify") && has("github")) weaknesses.push("Code without customers: distribution clarity is the main risk.");
  if (weaknesses.length === 0) weaknesses.push("The sources agree with each other; the risk is pace, not knowledge.");

  const firstDecisions: ScoutingDecision[] = [
    { id: "spec", label: "Rebuild the Specification from the imported sources", recommended: true, consequence: "The Product lead drafts the spec from what exists; you review it before any task starts.", reversible: true },
    any(TRACKING_SOURCES) || has("github")
      ? { id: "roadmap", label: "Seed the roadmap from open issues", recommended: false, consequence: "Open issues become roadmap items in a Proposed state; nothing is scheduled until you decide.", reversible: true }
      : { id: "roadmap", label: "Let the Board propose a first roadmap", recommended: false, consequence: "Three proposals arrive in the Inbox for you to accept or edit.", reversible: true },
    any(REVENUE_SOURCES)
      ? { id: "finance", label: "Build the management P&L from revenue history", recommended: false, consequence: "Finance reconciles the imported revenue into a cash-basis P&L.", reversible: true }
      : { id: "finance", label: "Connect a revenue or bank source later", recommended: false, consequence: "Finance works from labelled estimates until then.", reversible: true },
  ];

  const roadmapSeeds = seedsFor(configs, rng);
  const summary = `${name}: ${whatExists.length} source${whatExists.length === 1 ? "" : "s"} imported. ${strengths[0] ?? ""} ${whatIsMissing[0] ?? ""}`.trim();

  return { title: `Scouting report: ${name}`, suggestedName: name, archetypeHint, summary, whatExists, whatIsMissing, strengths, weaknesses, firstDecisions, roadmapSeeds, neverPushed: true, provenance: "Estimate" };
}

/** The brief the Ideation agent gets so the imported business becomes a concept card the Commit screen can take. */
export function reportToPrompt(report: ScoutingReport): string {
  const lines = [
    `Existing business import: ${report.suggestedName}.`,
    `What exists: ${report.whatExists.join("; ")}.`,
    `Strengths: ${report.strengths.join("; ")}.`,
    `Weaknesses: ${report.weaknesses.join("; ")}.`,
    `Missing: ${report.whatIsMissing.join("; ")}.`,
    report.roadmapSeeds.length ? `Roadmap seeds: ${report.roadmapSeeds.map((s) => s.title).join("; ")}.` : "",
    "Produce one concept card that describes this business as it is, not a new idea.",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 3900);
}
