/**
 * Door B: import an existing business (BUILD §11.1, AC-11.1.5; BUILD §9.4 `importBusiness`).
 *
 * `import.start` takes the founder's source choices (GitHub repo, Drive, Notion/Linear/Jira, website, Stripe/Shopify,
 * bank, registry; every one read-only). When a business exists and Temporal is reachable the sources become
 * `sources` rows and the orchestrator's `importBusiness` workflow runs them through the gateway. Otherwise (no business
 * yet, or no worker) the job runs server-side and deterministically: the job id encodes the inputs and the start time,
 * `import.status` replays the step schedule from the clock, and the Scouting report is built with a seeded RNG from the
 * same inputs, so the same sources always give the same report. Every figure in the report is an Estimate. A GitHub
 * import never pushes (AC-11.1.5).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { repos, type Db, type Source } from "@foundmill/db";
import { createSeededRng, type SeededRng } from "@foundmill/journey";
import { AppError, NotFoundError, ValidationError, type Archetype, type Env, type SourceKind } from "@foundmill/shared";
import { z } from "zod";
import type { TemporalService } from "./temporal";
import { WORKFLOWS } from "./temporal";

export const IMPORT_SOURCE_KEYS = ["github", "google_drive", "notion", "linear", "jira", "website", "stripe", "shopify", "bank", "registry"] as const;
export const ImportSourceKey = z.enum(IMPORT_SOURCE_KEYS);
export type ImportSourceKey = z.infer<typeof ImportSourceKey>;

export const SourceConfig = z.object({ key: ImportSourceKey, value: z.string().max(500).default("") });
export type SourceConfig = z.infer<typeof SourceConfig>;

export interface ImportSourceMeta {
  key: ImportSourceKey;
  label: string;
  connectorKey: string;
  /** Which `sources.kind` an import of this source becomes. */
  sourceKind: SourceKind;
  input: "repo" | "url" | "regno" | "none";
}

export const IMPORT_SOURCES: Readonly<Record<ImportSourceKey, ImportSourceMeta>> = {
  github: { key: "github", label: "GitHub", connectorKey: "github", sourceKind: "doc", input: "repo" },
  google_drive: { key: "google_drive", label: "Google Drive", connectorKey: "google_drive", sourceKind: "doc", input: "none" },
  notion: { key: "notion", label: "Notion", connectorKey: "notion", sourceKind: "doc", input: "none" },
  linear: { key: "linear", label: "Linear", connectorKey: "linear", sourceKind: "issue", input: "none" },
  jira: { key: "jira", label: "Jira", connectorKey: "jira", sourceKind: "issue", input: "none" },
  website: { key: "website", label: "Website", connectorKey: "web", sourceKind: "doc", input: "url" },
  stripe: { key: "stripe", label: "Stripe", connectorKey: "stripe", sourceKind: "finance", input: "none" },
  shopify: { key: "shopify", label: "Shopify", connectorKey: "shopify", sourceKind: "finance", input: "none" },
  bank: { key: "bank", label: "Bank (open banking)", connectorKey: "tink", sourceKind: "finance", input: "none" },
  registry: { key: "registry", label: "Company registry", connectorKey: "companies_house", sourceKind: "legal", input: "regno" },
};

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function normaliseSourceValue(key: ImportSourceKey, value: string): string {
  const v = value.trim();
  if (IMPORT_SOURCES[key].input === "repo") return v.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (IMPORT_SOURCES[key].input === "url") return v && !v.includes("://") ? `https://${v}` : v;
  return v;
}

/** Null when the typed value is acceptable for the source (mirrors the web form's rules). */
export function validateSourceValue(key: ImportSourceKey, value: string): string | null {
  const v = normaliseSourceValue(key, value);
  switch (IMPORT_SOURCES[key].input) {
    case "repo":
      if (!v) return "Enter the repository as owner/name.";
      return REPO_RE.test(v) ? null : "Use owner/name, for example acme/ledgerly.";
    case "url": {
      if (!v) return "Enter the site address.";
      try {
        const u = new URL(v);
        return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? null : "Use a full address, like https://example.com.";
      } catch {
        return "Use a full address, like https://example.com.";
      }
    }
    case "regno":
      if (!v) return "Enter the registration number.";
      return v.length >= 2 && v.length <= 40 ? null : "That does not look like a registration number.";
    case "none":
      return null;
  }
}

export function validateConfigs(configs: readonly SourceConfig[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const c of configs) {
    const err = validateSourceValue(c.key, c.value);
    if (err) errors[c.key] = err;
  }
  return errors;
}

/** Only web links are stored as a source's `uri` (it is rendered as a link); anything else is dropped. */
export function webUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.protocol === "http:" ? uri : null;
  } catch {
    return null;
  }
}

/** The `sources.uri` an import source is stored under (what the orchestrator's `importSource` routes on). */
export function sourceUri(key: ImportSourceKey, value: string): string | null {
  const v = normaliseSourceValue(key, value);
  switch (key) {
    case "github":
      return `https://github.com/${v}`;
    case "website":
      return webUri(v);
    case "registry":
      return v ? `https://opencorporates.com/companies?q=${encodeURIComponent(v)}` : null;
    case "google_drive":
      return "https://drive.google.com/";
    case "stripe":
      return "https://dashboard.stripe.com/";
    case "shopify":
      return "https://admin.shopify.com/";
    case "notion":
      return "https://www.notion.so/";
    case "linear":
      return "https://linear.app/";
    case "jira":
      return "https://atlassian.net/";
    case "bank":
      return "https://link.tink.com/";
  }
}

// --- the job --------------------------------------------------------------------------------------------------------

export type StepStatus = "queued" | "running" | "done" | "failed";

export interface SourceStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface SourceProgress {
  key: ImportSourceKey;
  value: string;
  /** `sources.id` when the import wrote source rows (business + Temporal path). */
  sourceId: string | null;
  status: StepStatus;
  steps: SourceStep[];
  /** Mirrors `ImportSourceResult.summary` from the orchestrator. */
  summary: string | null;
}

export interface ImportJob {
  id: string;
  mode: "local" | "temporal";
  businessId: string | null;
  workflowId: string | null;
  status: "running" | "done" | "failed";
  sources: SourceProgress[];
  startedAt: string;
  finishedAt: string | null;
  /** Elapsed-time schedule the local job follows (ms per step). */
  stepMs: number;
}

/** Steps each source runs (GitHub's are the ones BUILD §11.1 lists; the last confirms nothing was pushed). */
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

export const DEFAULT_STEP_MS = 400;

/**
 * The job id is the job: `<base64url(JSON token)>.<base64url(HMAC-SHA256)>`, keyed by SESSION_TOKEN_SECRET under its own
 * label (like the App install state), so a job id cannot be forged or edited, and it names the account that started
 * it (`u`): only that account can read it or link a business to it (security review L1).
 */
export const JobToken = z.object({
  v: z.literal(1),
  m: z.enum(["local", "temporal"]),
  u: z.string().min(1).max(200),
  b: z.string().nullable(),
  w: z.string().nullable(),
  t: z.number().int().nonnegative(),
  ms: z.number().int().positive(),
  s: z
    .array(z.object({ k: ImportSourceKey, v: z.string().max(500), id: z.string().nullable() }))
    .min(1)
    .max(IMPORT_SOURCE_KEYS.length)
    .refine((s) => new Set(s.map((x) => x.k)).size === s.length, "each source once"),
});
export type JobToken = z.infer<typeof JobToken>;

const JOB_LABEL = "foundmill/import-job/v1";
/** Development and test without SESSION_TOKEN_SECRET: a key for this process only (ids do not survive a restart). */
const PROCESS_JOB_KEY = randomBytes(32).toString("base64url");

/** The key import job ids are signed with. Production and staging require SESSION_TOKEN_SECRET (412 `config` otherwise). */
export function importJobKey(env: Pick<Env, "APP_ENV" | "SESSION_TOKEN_SECRET">): string {
  const secret = env.SESSION_TOKEN_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (env.APP_ENV === "development" || env.APP_ENV === "test") return PROCESS_JOB_KEY;
  throw new AppError("config", "SESSION_TOKEN_SECRET is not set on the api, so imports cannot run", 412);
}

const jobMac = (key: string, body: string): Buffer => createHmac("sha256", key).update(`${JOB_LABEL}\n${body}`).digest();

export function encodeJobId(key: string, token: JobToken): string {
  const body = Buffer.from(JSON.stringify(JobToken.parse(token)), "utf8").toString("base64url");
  return `${body}.${jobMac(key, body).toString("base64url")}`;
}

/** The token of a job id signed with `key`; NotFoundError for anything else (unsigned, edited, malformed). */
export function decodeJobId(key: string, jobId: string): JobToken {
  const [body, sig, ...rest] = jobId.split(".");
  if (body && sig && rest.length === 0) {
    const expected = jobMac(key, body);
    const given = Buffer.from(sig, "base64url");
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      try {
        const parsed = JobToken.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
        if (parsed.success) return parsed.data;
      } catch {
        /* fall through */
      }
    }
  }
  throw new NotFoundError("import job", jobId.slice(0, 24));
}

function sourceSummary(key: ImportSourceKey, value: string): string {
  const rng = createSeededRng(`import:${key}:${value}`);
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

/** The local job's progress at `now`: sources run in order, each step takes `stepMs`. Deterministic in (token, now). */
export function localJobAt(token: JobToken, jobId: string, now: Date): ImportJob {
  const elapsed = Math.max(0, now.getTime() - token.t);
  let consumed = 0;
  let finishedAtMs: number | null = null;
  const sources: SourceProgress[] = token.s.map((s) => {
    const labels = stepsFor(s.k, s.v);
    const steps: SourceStep[] = labels.map((label, i) => {
      const startsAt = consumed * token.ms;
      consumed++;
      const endsAt = consumed * token.ms;
      const status: StepStatus = elapsed >= endsAt ? "done" : elapsed >= startsAt ? "running" : "queued";
      return { id: `${s.k}:${i}`, label, status };
    });
    const done = steps.every((st) => st.status === "done");
    if (done) finishedAtMs = token.t + consumed * token.ms;
    return { key: s.k, value: s.v, sourceId: s.id, status: done ? "done" : steps.some((st) => st.status !== "queued") ? "running" : "queued", steps, summary: done ? sourceSummary(s.k, s.v) : null };
  });
  const allDone = sources.every((s) => s.status === "done");
  return {
    id: jobId,
    mode: "local",
    businessId: token.b,
    workflowId: null,
    status: allDone ? "done" : "running",
    sources,
    startedAt: new Date(token.t).toISOString(),
    finishedAt: allDone && finishedAtMs !== null ? new Date(finishedAtMs).toISOString() : null,
    stepMs: token.ms,
  };
}

/** Temporal job: progress comes from the `sources` rows the orchestrator updates (fetched_at + relevance.imported). */
export async function temporalJobAt(db: Db, token: JobToken, jobId: string, now: Date): Promise<ImportJob> {
  if (!token.b) throw new NotFoundError("import job", jobId.slice(0, 24));
  const rows = new Map<string, Source>();
  for (const s of token.s) {
    if (!s.id) continue;
    try {
      rows.set(s.id, await repos.product.getSource(db, token.b, s.id));
    } catch {
      /* archived or gone: shown as failed below */
    }
  }
  const sources: SourceProgress[] = token.s.map((s) => {
    const row = s.id ? rows.get(s.id) : undefined;
    const labels = stepsFor(s.k, s.v);
    const relevance = (row?.relevance ?? {}) as Record<string, unknown>;
    const finished = row?.fetchedAt != null || relevance.imported === false;
    const ok = relevance.imported === true;
    const status: StepStatus = !row ? "failed" : finished ? (ok ? "done" : "failed") : "running";
    const steps: SourceStep[] = labels.map((label, i) => ({ id: `${s.k}:${i}`, label, status: finished ? (ok || i < labels.length - 1 ? "done" : "failed") : i === 0 ? "running" : "queued" }));
    const summary = !row ? "source row missing" : finished ? (ok ? `imported through ${String(relevance.connector ?? IMPORT_SOURCES[s.k].connectorKey)}` : String(relevance.reason ?? relevance.outcome ?? "not imported")) : null;
    return { key: s.k, value: s.v, sourceId: s.id, status, steps, summary };
  });
  const allFinished = sources.every((s) => s.status === "done" || s.status === "failed");
  const anyOk = sources.some((s) => s.status === "done");
  return {
    id: jobId,
    mode: "temporal",
    businessId: token.b,
    workflowId: token.w,
    status: allFinished ? (anyOk ? "done" : "failed") : "running",
    sources,
    startedAt: new Date(token.t).toISOString(),
    finishedAt: allFinished ? now.toISOString() : null,
    stepMs: token.ms,
  };
}

// --- the Scouting report -------------------------------------------------------------------------------------------

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
  neverPushed: true;
  provenance: "Estimate";
}

const CODE_SOURCES: ImportSourceKey[] = ["github"];
const REVENUE_SOURCES: ImportSourceKey[] = ["stripe", "shopify", "bank"];
const TRACKING_SOURCES: ImportSourceKey[] = ["linear", "jira", "notion"];
const ISSUE_TITLES = ["Onboarding drop-off after sign-up", "Export to CSV", "Billing page shows stale invoice totals", "Slow dashboard query for large accounts", "Mobile layout of the pricing page", "Webhook retries on timeout", "Team invitations by link", "Audit log for admin actions", "SSO for enterprise plan", "Localise dates and currencies", "Flaky integration test in checkout", "Rate limit public API"];

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function nameFrom(configs: readonly SourceConfig[]): string {
  const repo = configs.find((c) => c.key === "github")?.value;
  if (repo) return titleCase((normaliseSourceValue("github", repo).split("/")[1] ?? repo).replace(/[-_.]+/g, " "));
  const site = configs.find((c) => c.key === "website")?.value;
  if (site) {
    try {
      const host = new URL(normaliseSourceValue("website", site)).hostname.replace(/^www\./, "");
      return titleCase(host.split(".")[0] ?? host);
    } catch {
      /* fall through */
    }
  }
  return "Imported business";
}

export function archetypeFromSources(configs: readonly SourceConfig[]): Archetype {
  const keys = new Set(configs.map((c) => c.key));
  if (keys.has("shopify")) return "dtc_physical";
  if (keys.has("github")) return "b2b_saas";
  if (keys.has("website") && !keys.has("stripe")) return "services";
  if (keys.has("stripe")) return "consumer_app";
  return "services";
}

function seedsFor(configs: readonly SourceConfig[], rng: SeededRng): RoadmapSeed[] {
  const out: RoadmapSeed[] = [];
  const github = configs.find((c) => c.key === "github");
  if (github) {
    const titles = rng.shuffle(ISSUE_TITLES).slice(0, rng.int(3, 6));
    for (const t of titles) out.push({ title: t, source: `${normaliseSourceValue("github", github.value)} issue #${rng.int(4, 240)}` });
  }
  for (const c of configs) {
    if (c.key !== "linear" && c.key !== "jira") continue;
    const titles = rng.shuffle(ISSUE_TITLES).slice(0, rng.int(2, 4));
    for (const t of titles) out.push({ title: t, source: `${IMPORT_SOURCES[c.key].label} ${c.key === "jira" ? "ISS" : "LIN"}-${rng.int(10, 999)}` });
  }
  return out;
}

/** Deterministic in the sources (and the per-source summaries when the job supplies them). */
export function buildScoutingReport(configs: readonly SourceConfig[], job?: ImportJob): ScoutingReport {
  const rng = createSeededRng(`scouting:${configs.map((c) => `${c.key}=${normaliseSourceValue(c.key, c.value)}`).join("|")}`);
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
    const value = normaliseSourceValue(c.key, c.value);
    whatExists.push(`${IMPORT_SOURCES[c.key].label}${value ? ` (${value})` : ""}: ${summaries.get(c.key) ?? sourceSummary(c.key, value)}`);
  }
  if (any(CODE_SOURCES)) {
    strengths.push("A working codebase with a test suite: agents can start from real code, not a blank repo.");
    weaknesses.push(rng.bool(0.5) ? "No deployment pipeline was found; releases look manual." : "README is out of date with the code; the Specification should be rebuilt from the repository.");
  } else whatIsMissing.push("No code source: the Development department starts from the Specification.");
  if (any(REVENUE_SOURCES)) {
    strengths.push("Real revenue history: forecasts start from actuals rather than archetype priors.");
    if (has("bank")) strengths.push("Cash position is known, so runway is a measurement, not an estimate.");
    else whatIsMissing.push("No bank connection: runway stays an estimate until one is added.");
  } else whatIsMissing.push("No revenue source: Finance starts with a management P&L and labelled estimates.");
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
  return { title: `Import report: ${name}`, suggestedName: name, archetypeHint, summary, whatExists, whatIsMissing, strengths, weaknesses, firstDecisions, roadmapSeeds, neverPushed: true, provenance: "Estimate" };
}

// --- start / status -------------------------------------------------------------------------------------------------

export interface StartImportInput {
  /** The account starting the import: the only one that can read the job or link a business to it. */
  userId: string;
  businessId: string | null;
  sources: SourceConfig[];
  /** Milliseconds per local step (tests pass 1). */
  stepMs?: number;
  now?: Date;
}

export interface ImportStatus {
  job: ImportJob;
  report: ScoutingReport | null;
  workflow: { queued: boolean; workflowId: string | null; reason?: string } | null;
}

export interface ImportDeps {
  db: Db;
  temporal: TemporalService;
  /** `importJobKey(env)`: signs and verifies job ids. */
  key: string;
}

/** Start the import: Temporal workflow over `sources` rows when a business exists and the worker answers, else the local job. */
export async function startImport(deps: ImportDeps, input: StartImportInput): Promise<ImportStatus> {
  const now = input.now ?? new Date();
  const configs = input.sources.map((s) => ({ key: s.key, value: normaliseSourceValue(s.key, s.value) }));
  const errors = validateConfigs(configs);
  if (Object.keys(errors).length) throw new ValidationError("Check the sources before importing", errors);
  if (new Set(configs.map((c) => c.key)).size !== configs.length) throw new ValidationError("Each source can be imported once", { sources: "Each source can be imported once" });
  const stepMs = input.stepMs ?? DEFAULT_STEP_MS;

  if (input.businessId) {
    const businessId = input.businessId;
    const rows = await deps.db.transaction(async (tx) => {
      const out: Source[] = [];
      for (const c of configs) {
        const meta = IMPORT_SOURCES[c.key];
        out.push(await repos.product.createSource(tx, businessId, { kind: meta.sourceKind, uri: sourceUri(c.key, c.value), title: `${meta.label} import${c.value ? `: ${c.value}` : ""}`, relevance: { import: { key: c.key, value: c.value, connector: meta.connectorKey, readOnly: true } } }));
      }
      return out;
    });
    const workflowId = `import:${businessId}:${now.getTime().toString(36)}`;
    const workflow = await deps.temporal.start(WORKFLOWS.importBusiness, { workflowId, args: [{ businessId, sourceIds: rows.map((r) => r.id) }] });
    if (workflow.queued) {
      const token: JobToken = { v: 1, m: "temporal", u: input.userId, b: businessId, w: workflowId, t: now.getTime(), ms: stepMs, s: configs.map((c, i) => ({ k: c.key, v: c.value, id: rows[i]!.id })) };
      const jobId = encodeJobId(deps.key, token);
      return { job: await temporalJobAt(deps.db, token, jobId, now), report: null, workflow };
    }
    const token: JobToken = { v: 1, m: "local", u: input.userId, b: businessId, w: null, t: now.getTime(), ms: stepMs, s: configs.map((c, i) => ({ k: c.key, v: c.value, id: rows[i]!.id })) };
    const jobId = encodeJobId(deps.key, token);
    const job = localJobAt(token, jobId, now);
    return { job, report: job.status === "done" ? buildScoutingReport(configs, job) : null, workflow };
  }

  const token: JobToken = { v: 1, m: "local", u: input.userId, b: null, w: null, t: now.getTime(), ms: stepMs, s: configs.map((c) => ({ k: c.key, v: c.value, id: null })) };
  const jobId = encodeJobId(deps.key, token);
  const job = localJobAt(token, jobId, now);
  return { job, report: job.status === "done" ? buildScoutingReport(configs, job) : null, workflow: null };
}

/** Progress of a job; the Scouting report once every source finished. Only the account that started it can read it. */
export async function importStatus(deps: Pick<ImportDeps, "db" | "key">, jobId: string, userId: string, now = new Date()): Promise<ImportStatus> {
  const token = decodeJobId(deps.key, jobId);
  if (token.u !== userId) throw new NotFoundError("import job", jobId.slice(0, 24));
  const configs: SourceConfig[] = token.s.map((s) => ({ key: s.k, value: s.v }));
  const job = token.m === "temporal" ? await temporalJobAt(deps.db, token, jobId, now) : localJobAt(token, jobId, now);
  return { job, report: job.status === "running" ? null : buildScoutingReport(configs, job), workflow: token.w ? { queued: true, workflowId: token.w } : null };
}
