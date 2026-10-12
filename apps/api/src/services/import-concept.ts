/**
 * Import's concept card, drafted ahead (audit P7; BUILD §11.1 Door B "Continue to Commit").
 *
 * "Continue to Commit" needs one concept card describing the imported business (DECISIONS 2026-10-09 "Import drafts one
 * concept card, not a set"). That card is one model call of tens of seconds live, so it is drafted speculatively as soon
 * as the import report is on screen (`import.prepareConcept`), while the founder reads the report:
 *
 * - The draft is held in memory, keyed by the founder (one at a time: a new import replaces and stops the previous
 *   draft), for `IMPORT_CONCEPT_TTL_MS`. Nothing is written to the database until the founder continues.
 * - `import.continue` takes the held draft (waiting for it if it is still being written), saves it as the founder's idea
 *   with the job recorded on it (commit links the business to the import), and answers with the idea. Without a held
 *   draft (another api replica, a restart, an expired or failed draft) it drafts the card there and then, as before.
 * - Only the founder's own finished sign-up import qualifies (`linkableImportJob`: signed here, started by this
 *   account, no business yet, done), the same rule `idea.generate` applies to `importJobId`.
 *
 * The card is drafted on the same request as `idea.generate({ single: true })` (packages/agents
 * `buildSingleConceptRequest`). The report is not the founder's brief: the brief is a fixed instruction and the report
 * text (what the Import screen used to send) follows it inside an <untrusted_content> block (review item 10), because
 * reports will carry what live connectors read, not only what the founder typed.
 */
import { buildSingleConceptRequest, type IdeationBrief } from "@foundmill/agents";
import { repos, type Db, type IdeaWithVersion } from "@foundmill/db";
import { ModelOutputError, type ConceptCard, type ModelClient, type ModelMode } from "@foundmill/models";
import { AppError, ValidationError } from "@foundmill/shared";
import { linkableImportJob } from "./foundations";
import { founderBrief, ideaFromCard, IDEATION_TOO_LONG_MESSAGE, takeIdeationAllowance } from "./ideation";
import { importStatus, type ScoutingReport } from "./import";
import type { RateLimitStore } from "./rate-limit";

/** How long a drafted card waits for the founder to continue. */
export const IMPORT_CONCEPT_TTL_MS = 30 * 60_000;
/** Founders with a held draft at once (oldest dropped first). */
export const IMPORT_CONCEPT_MAX_ENTRIES = 1_000;

/** The founder-side brief for the imported business's card: a fixed instruction, never text from the report. */
export const IMPORT_CONCEPT_BRIEF = "Produce one concept card that describes the existing business in the import report as it is, not a new idea.";

/** The Import report as the Ideation agent reads it (what the Import screen used to send): data, never instructions. */
export function importReportText(report: ScoutingReport): string {
  const lines = [
    `Existing business import: ${report.suggestedName}.`,
    `What exists: ${report.whatExists.join("; ")}.`,
    `Strengths: ${report.strengths.join("; ")}.`,
    `Weaknesses: ${report.weaknesses.join("; ")}.`,
    `Missing: ${report.whatIsMissing.join("; ")}.`,
    report.roadmapSeeds.length ? `Roadmap seeds: ${report.roadmapSeeds.map((s) => s.title).join("; ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 3900);
}

/** The brief the Ideation agent drafts the imported business's card from: the fixed instruction, the report as untrusted content. */
export function importConceptBrief(report: ScoutingReport, founder: IdeationBrief["founder"]): IdeationBrief {
  return { prompt: IMPORT_CONCEPT_BRIEF, archetypeHint: report.archetypeHint, founder, source: { kind: "import_report", content: { import_report: importReportText(report) } } };
}

interface DraftedConcept {
  card: ConceptCard;
  costMinor: number;
  mode: ModelMode;
}

interface HeldDraft {
  jobId: string;
  createdAt: number;
  controller: AbortController;
  promise: Promise<DraftedConcept>;
  settled: boolean;
  failed: boolean;
}

/** In-memory drafts, one per founder. Per api process: with several replicas a Continue on another one drafts again (and spends a draft). */
export class ImportConceptCache {
  private readonly entries = new Map<string, HeldDraft>();

  constructor(
    private readonly ttlMs = IMPORT_CONCEPT_TTL_MS,
    private readonly maxEntries = IMPORT_CONCEPT_MAX_ENTRIES,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The founder's held draft for `jobId`, if it is still fresh. */
  get(userId: string, jobId: string): HeldDraft | undefined {
    const entry = this.entries.get(userId);
    if (!entry) return undefined;
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.drop(userId);
      return undefined;
    }
    return entry.jobId === jobId ? entry : undefined;
  }

  /** Holds a draft for the founder, stopping one for another job that is still being written. */
  set(userId: string, entry: HeldDraft): void {
    const previous = this.entries.get(userId);
    if (previous && previous !== entry && !previous.settled) previous.controller.abort();
    this.entries.delete(userId);
    this.entries.set(userId, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.drop(oldest);
    }
  }

  /** Removes and returns the founder's draft for `jobId` (a draft is saved once). */
  take(userId: string, jobId: string): HeldDraft | undefined {
    const entry = this.get(userId, jobId);
    if (entry) this.entries.delete(userId);
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    for (const userId of [...this.entries.keys()]) this.drop(userId);
  }

  private drop(userId: string): void {
    const entry = this.entries.get(userId);
    if (entry && !entry.settled) entry.controller.abort();
    this.entries.delete(userId);
  }
}

/** One process-wide cache. */
export const importConcepts = new ImportConceptCache();

export interface ImportConceptDeps {
  db: Db;
  models: ModelClient;
  /** The api's allowance windows (`ctx.limits`): a new draft spends one from the drafting allowance. */
  limits: RateLimitStore;
  /** `importJobKey(env)`: verifies job ids. */
  key: string;
  cache?: ImportConceptCache;
}

/** The founder's own finished sign-up import and its report, or a ValidationError. */
async function finishedImport(deps: ImportConceptDeps, jobId: string, userId: string): Promise<{ jobId: string; report: ScoutingReport }> {
  const linked = linkableImportJob(deps.key, jobId, userId);
  if (!linked) throw new ValidationError("That import job cannot be linked to a new business");
  const status = await importStatus({ db: deps.db, key: deps.key }, linked, userId);
  if (!status.report) throw new ValidationError("The import has not finished yet");
  return { jobId: linked, report: status.report };
}

async function draftConcept(deps: ImportConceptDeps, userId: string, report: ScoutingReport, signal?: AbortSignal): Promise<DraftedConcept> {
  const brief = importConceptBrief(report, await founderBrief(deps.db, userId));
  const res = await deps.models.complete({ ...buildSingleConceptRequest(brief), signal, scope: `ideation:${userId}`, attribution: { kind: "ideation" } });
  return { card: res.json, costMinor: res.cost.costMinorInt, mode: res.mode };
}

/**
 * Starts drafting the card for a finished import (idempotent per job): "drafting" while the call runs, "ready" once
 * the card is held. A draft that failed is started again.
 */
export async function prepareImportConcept(deps: ImportConceptDeps, jobId: string, userId: string): Promise<{ status: "drafting" | "ready" }> {
  const { jobId: linked, report } = await finishedImport(deps, jobId, userId);
  const cache = deps.cache ?? importConcepts;
  const held = cache.get(userId, linked);
  if (held && !held.failed) return { status: held.settled ? "ready" : "drafting" };
  // A new draft spends the founder's drafting allowance (asking again for a job already drafting does not).
  const ticket = await takeIdeationAllowance(deps.limits, userId);
  // Another request for the same job may have started its draft while this one waited for the allowance.
  const raced = cache.get(userId, linked);
  if (raced && !raced.failed) {
    await deps.limits.refund(ticket);
    return { status: raced.settled ? "ready" : "drafting" };
  }
  const controller = new AbortController();
  const entry: HeldDraft = { jobId: linked, createdAt: Date.now(), controller, settled: false, failed: false, promise: Promise.resolve(null as never) };
  entry.promise = draftConcept(deps, userId, report, controller.signal).then(
    (drafted) => {
      entry.settled = true;
      return drafted;
    },
    (err: unknown) => {
      entry.settled = true;
      entry.failed = true;
      throw err;
    },
  );
  // Read by `continueImport`, which drafts again when this one failed; never an unhandled rejection.
  entry.promise.catch(() => undefined);
  cache.set(userId, entry);
  return { status: "drafting" };
}

export interface ContinuedImport {
  idea: IdeaWithVersion;
  costMinor: number;
  costLabel: "Estimate";
  mode: ModelMode;
  /** True when the card drafted ahead was used (Continue did not wait on a new model call). */
  speculative: boolean;
}

/** "Continue to Commit": saves the card drafted ahead (or drafts it now) as the founder's idea, linked to the import. */
export async function continueImport(deps: ImportConceptDeps, jobId: string, userId: string): Promise<ContinuedImport> {
  const { jobId: linked, report } = await finishedImport(deps, jobId, userId);
  const cache = deps.cache ?? importConcepts;
  const held = cache.take(userId, linked);
  let drafted: DraftedConcept | null = null;
  if (held && !held.failed) drafted = await held.promise.catch(() => null);
  const speculative = drafted !== null;
  if (!drafted) {
    await takeIdeationAllowance(deps.limits, userId);
    drafted = await draftConcept(deps, userId, report).catch((err: unknown) => {
      throw err instanceof ModelOutputError && err.code === "max_tokens" ? new AppError("ideation_too_long", IDEATION_TOO_LONG_MESSAGE, 502) : err;
    });
  }
  const [idea] = await repos.ideas.createMany(deps.db, userId, [ideaFromCard(drafted.card, { import_job_id: linked })]);
  return { idea: idea!, costMinor: drafted.costMinor, costLabel: "Estimate", mode: drafted.mode, speculative };
}
