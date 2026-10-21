/**
 * Door B: import an existing business (BUILD §11.1, AC-11.1.5; BUILD §9.4 `importBusiness`).
 *
 * `import.start` takes the founder's source choices (GitHub repo, Drive, Notion/Linear/Jira, website, Stripe/Shopify,
 * bank, registry; every one read-only). When a business exists and Temporal is reachable the sources become
 * `sources` rows and the orchestrator's `importBusiness` workflow reads each through the gateway (`IMPORT_READERS`).
 * Before a business exists (the sign-up import) nothing can be read: no business, no connection, no gateway session.
 * That job only checks what the founder typed and lists what the import will read once they take charge (status
 * `planned`); commit stores the sources as not read yet and starts `importBusiness` for them. The job id encodes the
 * inputs and the start time and `import.status` replays the check schedule from the clock, so the same sources always
 * give the same job and report.
 *
 * The Import report claims only what was read: a source the gateway read is named with what was read, a source still
 * to be read is worded "once …", a source that failed or has no reader is listed under what is missing, and nothing
 * (counts, issues, findings) is invented for a source that was not read. A source that was not read can be read again
 * (`readImportSourcesAgain`, Read now in Product › Sources) once the founder has connected it. A GitHub import never
 * pushes (AC-11.1.5).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { repos, type Db, type Source } from "@foundmill/db";
import { createSeededRng, type SeededRng } from "@foundmill/journey";
import { AppError, IMPORT_READERS, IMPORT_SOURCE_KEYS, NotFoundError, ValidationError, hasImportConnector, type Archetype, type Env, type OptionAction, type SourceKind, type TaskKind } from "@foundmill/shared";
import { z } from "zod";
import type { TemporalService } from "./temporal";
import { WORKFLOWS, workflowIds } from "./temporal";

export { IMPORT_SOURCE_KEYS };
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
  /** False where no connector reads the source yet (Linear, Jira): the preview job lists it, a business import refuses it. */
  businessImport: boolean;
}

export const IMPORT_SOURCES: Readonly<Record<ImportSourceKey, ImportSourceMeta>> = {
  github: { key: "github", label: "GitHub", connectorKey: "github", sourceKind: "doc", input: "repo", businessImport: hasImportConnector("github") },
  google_drive: { key: "google_drive", label: "Google Drive", connectorKey: "google_drive", sourceKind: "doc", input: "none", businessImport: hasImportConnector("google_drive") },
  notion: { key: "notion", label: "Notion", connectorKey: "notion", sourceKind: "doc", input: "none", businessImport: hasImportConnector("notion") },
  linear: { key: "linear", label: "Linear", connectorKey: "linear", sourceKind: "issue", input: "none", businessImport: hasImportConnector("linear") },
  jira: { key: "jira", label: "Jira", connectorKey: "jira", sourceKind: "issue", input: "none", businessImport: hasImportConnector("jira") },
  website: { key: "website", label: "Website", connectorKey: "web", sourceKind: "doc", input: "url", businessImport: hasImportConnector("website") },
  stripe: { key: "stripe", label: "Stripe", connectorKey: "stripe", sourceKind: "finance", input: "none", businessImport: hasImportConnector("stripe") },
  shopify: { key: "shopify", label: "Shopify", connectorKey: "shopify", sourceKind: "finance", input: "none", businessImport: hasImportConnector("shopify") },
  bank: { key: "bank", label: "Bank (open banking)", connectorKey: "tink", sourceKind: "finance", input: "none", businessImport: hasImportConnector("bank") },
  registry: { key: "registry", label: "Company registry", connectorKey: "opencorporates", sourceKind: "legal", input: "regno", businessImport: hasImportConnector("registry") },
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

/** `planned`: what the import will do once the business exists (the sign-up job never reads a source itself). */
export type StepStatus = "queued" | "running" | "done" | "failed" | "planned";

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
  /** What was read (done), why not (failed), or what happens after commit (planned). Never an invented figure. */
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

/** The founder-typed value the sign-up job checks (and the one step it actually runs). */
export function checkStepLabel(key: ImportSourceKey, value: string): string {
  const meta = IMPORT_SOURCES[key];
  switch (meta.input) {
    case "repo":
      return `Check the repository name ${value}`;
    case "url":
      return `Check the address ${value}`;
    case "regno":
      return `Check the registration number ${value}`;
    case "none":
      return `Note the ${meta.label} connection it needs`;
  }
}

/** The read the gateway makes for a source (orchestrator `importSource`); a source with no reader says so. */
export function readStepLabel(key: ImportSourceKey, value: string): string {
  const label = IMPORT_SOURCES[key].label;
  switch (key) {
    case "github":
      return `Read the file tree of ${value} through the GitHub App (read only; nothing is pushed)`;
    case "google_drive":
      return "List your Drive files (read only)";
    case "notion":
      return "Search the pages Notion shares with the business (read only)";
    case "stripe":
      return "Read the Stripe account (read only)";
    case "shopify":
      return "Read the Shopify store (read only)";
    case "bank":
      return "List the bank accounts (read only)";
    case "registry":
      return `Look up ${value} in the public register`;
    case "linear":
    case "jira":
    case "website":
      return `The import has no reader for ${label} yet, so it is listed as not read`;
  }
}

/** True when the gateway can read this source (`IMPORT_READERS`); false sources are reported as not read. */
export function hasReader(key: ImportSourceKey): boolean {
  return Boolean(IMPORT_READERS[key]);
}

/** Steps a job shows for a source: the sign-up job checks the value, then plans the read; a business job reads. */
export function stepsFor(key: ImportSourceKey, value: string, mode: "local" | "temporal" = "local"): string[] {
  return mode === "local" ? [checkStepLabel(key, value), readStepLabel(key, value)] : [readStepLabel(key, value)];
}

/** What the sign-up job says about a source it has checked: nothing was read, and what happens after commit. */
export function plannedSummary(key: ImportSourceKey): string {
  const meta = IMPORT_SOURCES[key];
  if (!hasReader(key)) return `Not read: the import has no reader for ${meta.label} yet.`;
  if (meta.input === "none") return `Not read yet: read after you take charge, if ${meta.label} is connected in Settings › Integrations.`;
  return "Not read yet: read after you take charge (read only).";
}

/**
 * Step length of the local (sign-up) job's checks, so they are readable as they pass: 120 ms keeps a three-source job
 * well under a second (audit P7). Temporal jobs follow the real `sources` rows and are unaffected.
 */
export const DEFAULT_STEP_MS = 120;

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

/**
 * The sign-up job's progress at `now`: each source's value is checked in turn (one step of `stepMs`), then its read is
 * planned for after commit. Nothing is read here, so a checked source is `planned`, never `done`; a source the import has
 * no reader for is `failed` (not read) once checked. Deterministic in (token, now).
 */
export function localJobAt(token: JobToken, jobId: string, now: Date): ImportJob {
  const elapsed = Math.max(0, now.getTime() - token.t);
  let consumed = 0;
  let finishedAtMs: number | null = null;
  const sources: SourceProgress[] = token.s.map((s) => {
    const [check, read] = stepsFor(s.k, s.v, "local") as [string, string];
    const startsAt = consumed * token.ms;
    consumed++;
    const endsAt = consumed * token.ms;
    const checkStatus: StepStatus = elapsed >= endsAt ? "done" : elapsed >= startsAt ? "running" : "queued";
    const checked = checkStatus === "done";
    if (checked) finishedAtMs = token.t + consumed * token.ms;
    const readable = hasReader(s.k);
    const steps: SourceStep[] = [
      { id: `${s.k}:0`, label: check, status: checkStatus },
      // The read always happens after commit, whatever the check's progress; without a reader it never happens.
      { id: `${s.k}:1`, label: read, status: readable ? "planned" : checked ? "failed" : "queued" },
    ];
    const status: StepStatus = !checked ? checkStatus : readable ? "planned" : "failed";
    return { key: s.k, value: s.v, sourceId: s.id, status, steps, summary: checked ? plannedSummary(s.k) : null };
  });
  const allDone = sources.every((s) => s.status === "planned" || s.status === "failed");
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

/**
 * How long a business import may take before a source nobody finished is reported as failed. The workflow runs three
 * sources at a time, each activity bounded at 10 minutes and retried, so this is past anything a healthy run needs; it
 * only decides for a run whose worker is gone, so the screen can never spin forever.
 */
export const IMPORT_DEADLINE_MS = 45 * 60_000;

/** What an unfinished source reads after the deadline. */
export const IMPORT_TIMED_OUT = "The import did not finish in time. Start it again to retry.";

/**
 * Temporal job: progress comes from the `sources` rows the orchestrator updates (`fetched_at` + `relevance.imported`,
 * and `relevance.reason` when a source could not be read). A source is finished when the orchestrator says so, or when
 * the deadline has passed; `finishedAt` is the time the last source finished, never the time of the poll.
 */
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
  const timedOut = now.getTime() - token.t > IMPORT_DEADLINE_MS;
  const finishedAtMs: number[] = [];
  const sources: SourceProgress[] = token.s.map((s) => {
    const row = s.id ? rows.get(s.id) : undefined;
    const relevance = (row?.relevance ?? {}) as Record<string, unknown>;
    const settled = row?.fetchedAt != null || relevance.imported === false;
    const finished = settled || (row != null && timedOut);
    const ok = relevance.imported === true;
    const status: StepStatus = !row ? "failed" : finished ? (ok ? "done" : "failed") : "running";
    const steps: SourceStep[] = stepsFor(s.k, s.v, "temporal").map((label, i) => ({ id: `${s.k}:${i}`, label, status }));
    const summary = !row ? "The source row is missing." : finished ? (settled ? readSummary(relevance, ok) : IMPORT_TIMED_OUT) : null;
    const at = typeof relevance.finishedAt === "string" ? Date.parse(relevance.finishedAt) : row?.fetchedAt ? row.fetchedAt.getTime() : NaN;
    finishedAtMs.push(Number.isFinite(at) ? at : settled || !row ? token.t : token.t + IMPORT_DEADLINE_MS);
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
    finishedAt: allFinished ? new Date(Math.max(token.t, ...finishedAtMs)).toISOString() : null,
    stepMs: token.ms,
  };
}

/** What the orchestrator recorded on a finished source row: what was read, or why it was not. */
export function readSummary(relevance: Record<string, unknown>, ok: boolean): string {
  const connector = typeof relevance.connector === "string" ? relevance.connector : null;
  const tool = typeof relevance.tool === "string" ? relevance.tool : null;
  if (ok) return `Read through ${connector ?? "the gateway"}${tool ? ` (${tool})` : ""}, read only.`;
  const reason = relevance.reason ?? relevance.outcome;
  return `Not read: ${typeof reason === "string" && reason ? reason : "the gateway did not answer"}.`;
}

// --- the Scouting report -------------------------------------------------------------------------------------------

export interface ScoutingDecision {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  /**
   * Why the recommended option is recommended, from the founder's seat ("Recommended because …", UX plan §7.19). The
   * Board item's option carries it under the consequence line; options that are not recommended leave it out.
   */
  because?: string;
  reversible: boolean;
  /** What choosing it runs (the Board item's option carries them): never parsed from the words (audit IAE-20). */
  actions?: OptionAction[];
}

export interface RoadmapSeed {
  title: string;
  source: string;
}

/** One source as the report states it: read, still to be read after commit, or not read (and why). */
export interface ReportSource {
  key: ImportSourceKey;
  label: string;
  value: string;
  state: "read" | "planned" | "not_read";
  note: string;
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
  /** Open issues actually read from a tracker or repository; empty until a reader returns issues. Never invented. */
  roadmapSeeds: RoadmapSeed[];
  /** Every chosen source with what is true of it now (read, planned, not read). */
  sources: ReportSource[];
  /** AC-11.1.5: a GitHub import never pushes. */
  neverPushed: true;
  provenance: "Estimate";
}

const CODE_SOURCES: ImportSourceKey[] = ["github"];
const REVENUE_SOURCES: ImportSourceKey[] = ["stripe", "shopify", "bank"];
const TRACKING_SOURCES: ImportSourceKey[] = ["linear", "jira", "notion"];

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

/** Each source's state from the job: `done` was read, `planned` waits for commit, anything else (or no reader) was not read. */
export function reportSources(configs: readonly SourceConfig[], job?: ImportJob): ReportSource[] {
  const progress = new Map(job?.sources.map((s) => [s.key, s]) ?? []);
  return configs.map((c) => {
    const value = normaliseSourceValue(c.key, c.value);
    const label = IMPORT_SOURCES[c.key].label;
    const p = progress.get(c.key);
    const status = p?.status ?? "planned";
    const state: ReportSource["state"] = status === "done" ? "read" : status === "planned" && hasReader(c.key) ? "planned" : "not_read";
    const note = p?.summary ?? plannedSummary(c.key);
    return { key: c.key, label, value, state, note };
  });
}

/**
 * What a source makes possible, worded by what is true of it: read (exactly what the one read returned, and what it
 * did not bring in: an account answering is not its revenue history), or still to be read ("Once Stripe is connected,
 * …"). A source that was not read adds nothing here; it is listed under what is missing.
 */
const STRENGTH: Record<"code" | "revenue" | "bank" | "tracking" | "registry", { read: (label: string) => string; planned: (label: string) => string }> = {
  code: { read: (l) => `${l} was read through the gateway (its file tree, read only): agents start from your real code, not a blank repository.`, planned: (l) => `Once ${l} is read after you take charge, agents start from your real code, not a blank repository.` },
  revenue: { read: (l) => `${l} is connected read only and its account answered. Its revenue history was not imported, so forecasts still start from archetype priors.`, planned: (l) => `Once ${l} is connected, forecasts can start from real revenue history rather than archetype priors.` },
  bank: { read: (l) => `${l} is connected read only and its accounts were listed. Transactions were not imported, so cash and runway stay estimates.`, planned: (l) => `Once ${l} is connected, cash and runway can be measured instead of estimated.` },
  tracking: { read: (l) => `${l} is connected read only: the pages it shares were listed for the team to read.`, planned: (l) => `Once ${l} is connected, the team can read the pages it shares: specs, roadmaps and notes.` },
  registry: { read: (l) => `The ${l.toLowerCase()} answered a search for this number (read only); the entity goes on record once Legal confirms the match with you.`, planned: (l) => `Once the ${l.toLowerCase()} is read, the legal entity and its filing deadlines can be put on record.` },
};

/**
 * Deterministic in the sources and the job's per-source outcome. Claims only what was read: no counts, findings or
 * issues are made up for a source that was not read, failed sources are listed under what is missing, and every
 * strength of a source still to be read is worded "once …".
 */
export function buildScoutingReport(configs: readonly SourceConfig[], job?: ImportJob): ScoutingReport {
  const sources = reportSources(configs, job);
  const usable = sources.filter((s) => s.state !== "not_read");
  const usableConfigs = configs.filter((c) => usable.some((s) => s.key === c.key));
  const stateOf = (k: ImportSourceKey) => sources.find((s) => s.key === k)?.state ?? null;
  const usableKey = (k: ImportSourceKey) => stateOf(k) === "read" || stateOf(k) === "planned";
  const any = (ks: ImportSourceKey[]) => ks.some(usableKey);
  const first = (ks: ImportSourceKey[]) => sources.find((s) => ks.includes(s.key) && s.state !== "not_read");
  const name = nameFrom(configs);
  const archetypeHint = archetypeFromSources(usableConfigs.length ? usableConfigs : configs);
  const read = sources.filter((s) => s.state === "read").length;
  const planned = sources.filter((s) => s.state === "planned").length;

  const whatExists = usable.map((s) => `${s.label}${s.value ? ` (${s.value})` : ""}: ${s.note}`);
  const whatIsMissing: string[] = sources.filter((s) => s.state === "not_read").map((s) => `${s.label}${s.value ? ` (${s.value})` : ""}: ${s.note}`);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const strength = (kind: keyof typeof STRENGTH, s: ReportSource | undefined) => {
    if (s) strengths.push(s.state === "read" ? STRENGTH[kind].read(s.label) : STRENGTH[kind].planned(s.label));
  };

  if (any(CODE_SOURCES)) strength("code", first(CODE_SOURCES));
  else whatIsMissing.push("No code source: the engineering work starts from the Specification.");
  if (any(["stripe", "shopify"])) strength("revenue", first(["stripe", "shopify"]));
  if (usableKey("bank")) strength("bank", first(["bank"]));
  else if (any(REVENUE_SOURCES)) whatIsMissing.push("No bank connection: runway stays an estimate until one is added.");
  if (!any(REVENUE_SOURCES)) whatIsMissing.push("No revenue source: the finances start with a management P&L and labeled estimates.");
  if (any(TRACKING_SOURCES)) strength("tracking", first(TRACKING_SOURCES));
  else whatIsMissing.push("No work tracking: the first roadmap comes from the Board's proposals.");
  if (!usableKey("website")) whatIsMissing.push("No website read: positioning will be drafted from the Specification.");
  if (usableKey("registry")) strength("registry", first(["registry"]));
  else whatIsMissing.push("No registry record: Legal will ask whether an entity exists.");
  if (!any(["stripe", "shopify"]) && any(CODE_SOURCES)) weaknesses.push("No revenue source was given alongside the code: distribution is the main unknown.");
  if (read === 0) weaknesses.push(planned ? "Nothing has been read yet, so no weakness is measured: the team reports what it finds once the import has read your sources." : "Nothing could be read, so no weakness is measured yet.");

  const task = (assignee: string, kind: TaskKind, title: string, goal: string): OptionAction => ({ type: "create_task", params: { kind, title, goal }, assignee });
  const firstDecisions: ScoutingDecision[] = [
    {
      id: "spec",
      label: "Rebuild the Specification from the imported sources",
      recommended: true,
      consequence: "The Product lead drafts the spec from what exists; you review it before any task starts.",
      because:
        usable.length > 0
          ? "Recommended because every department works from the Specification, and a draft built from what you already have is quicker to check than one written from nothing."
          : "Recommended because every department works from the Specification; it is drafted from your sources once they are read, and you check it before anything is built.",
      reversible: true,
      actions: [task("product_lead", "research", "Rebuild the specification from the imported sources", "Draft the specification from what the import found, one block per outline section with every claim citing its source; the founder reviews it before any task starts.")],
    },
    any(TRACKING_SOURCES) || any(CODE_SOURCES)
      ? {
          id: "roadmap",
          label: "Seed the roadmap from open issues",
          recommended: false,
          consequence: "Open issues become roadmap items in a Proposed state; nothing is scheduled until you decide.",
          reversible: true,
          actions: [task("product_lead", "research", "Seed the roadmap from open issues", "Turn the imported open issues into roadmap items in a Proposed state, each linked to its issue; nothing is scheduled until the founder decides.")],
        }
      : {
          id: "roadmap",
          label: "Let the Board propose a first roadmap",
          recommended: false,
          consequence: "Three proposals arrive in the Inbox for you to accept or edit.",
          reversible: true,
          actions: [task("product_lead", "research", "Propose a first roadmap", "Draft three first-roadmap proposals from the import for the founder to accept or edit in the Inbox.")],
        },
    any(REVENUE_SOURCES)
      ? {
          id: "finance",
          label: "Build the management P&L from revenue history",
          recommended: false,
          consequence: "Finance reconciles the imported revenue into a cash-basis P&L.",
          reversible: true,
          actions: [task("finance_lead", "finance", "Management P&L from revenue history", "Reconcile the imported revenue history into a cash-basis management P&L; every figure not from a source is labeled Estimate.")],
        }
      : {
          id: "finance",
          label: "Connect a revenue or bank source later",
          recommended: false,
          consequence: "Finance works from labeled estimates until then.",
          reversible: true,
          actions: [{ type: "reply_only", params: { acknowledgement: "You chose to connect a revenue or bank source later; Finance keeps working from labeled estimates until then." } }],
        },
  ];
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const state =
    read > 0
      ? `${count(read, "source")} of ${sources.length} read${sources.length - read - planned > 0 ? `, ${sources.length - read - planned} not read` : ""}.`
      : planned > 0
        ? `${count(planned, "source")} to read after you take charge; nothing has been read yet.`
        : "None of the sources could be read.";
  const summary = `${name}: ${state} ${strengths[0] ?? ""} ${whatIsMissing[0] ?? ""}`.replace(/\s+/g, " ").trim();
  return { title: `Import report: ${name}`, suggestedName: name, archetypeHint, summary, whatExists, whatIsMissing, strengths, weaknesses, firstDecisions, roadmapSeeds: [], sources, neverPushed: true, provenance: "Estimate" };
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

/**
 * The `sources` row an import source becomes on a business: not read yet (`import.status: "pending"`), no summary.
 * The orchestrator's `importSource` records what the gateway read (or why it could not) on the same row.
 */
export function importSourceRow(key: ImportSourceKey, value: string): { kind: SourceKind; uri: string | null; title: string; relevance: Record<string, unknown> } {
  const meta = IMPORT_SOURCES[key];
  return {
    kind: meta.sourceKind,
    uri: webUri(sourceUri(key, value)),
    title: `${meta.label} import${value ? `: ${value}` : ""}`.slice(0, 400),
    relevance: { import: { key, value, connector: IMPORT_READERS[key]?.connector ?? meta.connectorKey, readOnly: true, status: "pending" } },
  };
}

/**
 * Start `importBusiness` over a business's import sources (import.start with a business, and commit for Door B). When
 * Temporal does not take it, nothing will read them: each row is marked not read with the reason, so no screen shows
 * a source as imported or as still running.
 */
export async function queueImportReads(deps: Pick<ImportDeps, "db" | "temporal">, businessId: string, sourceIds: readonly string[], now: Date = new Date()): Promise<{ queued: boolean; workflowId: string; reason?: string }> {
  const workflowId = workflowIds.importBusiness(businessId, now);
  if (sourceIds.length === 0) return { queued: false, workflowId, reason: "no sources to import" };
  const workflow = await deps.temporal.start(WORKFLOWS.importBusiness, { workflowId, args: [{ businessId, sourceIds: [...sourceIds] }] });
  if (workflow.queued) return workflow;
  const reason = `the import worker was not reachable (${workflow.reason ?? "unavailable"}), so nothing was read`;
  for (const id of sourceIds) {
    const row = await repos.product.getSource(deps.db, businessId, id);
    const relevance = (row.relevance ?? {}) as Record<string, unknown>;
    const meta = (relevance.import ?? {}) as Record<string, unknown>;
    await repos.product.updateSource(deps.db, businessId, id, { relevance: { ...relevance, imported: false, reason, import: { ...meta, status: "failed", note: `Not read: ${reason}.` } } });
  }
  return workflow;
}

/** True for a `sources` row an import created (`relevance.import`) that the gateway has not read. */
export function isUnreadImportSource(source: Pick<Source, "relevance">): boolean {
  const relevance = (source.relevance ?? {}) as Record<string, unknown>;
  const meta = relevance.import;
  if (!meta || typeof meta !== "object") return false;
  return relevance.imported !== true && (meta as Record<string, unknown>).status !== "read";
}

/**
 * Read now (Product › Sources): read again the import sources the gateway has not read, typically once the founder has
 * connected them in Settings › Integrations. Each row goes back to "not read yet" (the old reason is dropped) and
 * `importBusiness` reads them; without a worker they are marked not read again with that reason. A source that was
 * read, or that did not come from an import, is refused rather than read twice.
 */
export async function readImportSourcesAgain(deps: Pick<ImportDeps, "db" | "temporal">, businessId: string, sourceIds: readonly string[], now: Date = new Date()): Promise<{ sourceIds: string[]; workflow: { queued: boolean; workflowId: string; reason?: string } }> {
  const rows: Source[] = [];
  for (const id of new Set(sourceIds)) rows.push(await repos.product.getSource(deps.db, businessId, id));
  const refused = rows.find((r) => !isUnreadImportSource(r));
  if (refused) throw new ValidationError("Only an import source that was not read can be read again", { sourceId: refused.id });
  for (const row of rows) {
    const relevance = { ...((row.relevance ?? {}) as Record<string, unknown>) };
    const meta = relevance.import as Record<string, unknown>;
    delete relevance.imported;
    delete relevance.reason;
    delete relevance.outcome;
    const { note: _note, ...kept } = meta;
    await repos.product.updateSource(deps.db, businessId, row.id, { relevance: { ...relevance, import: { ...kept, status: "pending" } } });
  }
  const ids = rows.map((r) => r.id);
  return { sourceIds: ids, workflow: await queueImportReads(deps, businessId, ids, now) };
}

/** Start the import: Temporal workflow over `sources` rows when a business exists, else the sign-up job (checks only). */
export async function startImport(deps: ImportDeps, input: StartImportInput): Promise<ImportStatus> {
  const now = input.now ?? new Date();
  const configs = input.sources.map((s) => ({ key: s.key, value: normaliseSourceValue(s.key, s.value) }));
  const errors = validateConfigs(configs);
  if (Object.keys(errors).length) throw new ValidationError("Check the sources before importing", errors);
  if (new Set(configs.map((c) => c.key)).size !== configs.length) throw new ValidationError("Each source can be imported once", { sources: "Each source can be imported once" });
  const stepMs = input.stepMs ?? DEFAULT_STEP_MS;

  if (input.businessId) {
    const businessId = input.businessId;
    // A business import reads the sources through connectors; one without a connector cannot be read, so it is refused up front.
    const unreadable = configs.filter((c) => !IMPORT_SOURCES[c.key].businessImport);
    if (unreadable.length) {
      const labels = unreadable.map((c) => IMPORT_SOURCES[c.key].label);
      throw new ValidationError(`${labels.join(" and ")} cannot be imported into a business yet`, Object.fromEntries(unreadable.map((c) => [c.key, `${IMPORT_SOURCES[c.key].label} has no connector yet, so it cannot be read.`])));
    }
    const rows = await deps.db.transaction(async (tx) => {
      const out: Source[] = [];
      for (const c of configs) out.push(await repos.product.createSource(tx, businessId, importSourceRow(c.key, c.value)));
      return out;
    });
    // Without a worker nothing reads the sources: they are marked not read at once rather than shown as running.
    const workflow = await queueImportReads(deps, businessId, rows.map((r) => r.id), now);
    const token: JobToken = { v: 1, m: "temporal", u: input.userId, b: businessId, w: workflow.queued ? workflow.workflowId : null, t: now.getTime(), ms: stepMs, s: configs.map((c, i) => ({ k: c.key, v: c.value, id: rows[i]!.id })) };
    const jobId = encodeJobId(deps.key, token);
    const job = await temporalJobAt(deps.db, token, jobId, now);
    return { job, report: job.status === "running" ? null : buildScoutingReport(configs, job), workflow };
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
  // The report states each source by its own outcome (read, planned, not read), never by what was configured.
  return { job, report: job.status === "running" ? null : buildScoutingReport(configs, job), workflow: token.w ? { queued: true, workflowId: token.w } : null };
}
