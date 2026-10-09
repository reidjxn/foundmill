/**
 * Foundations: the vision, first specification and first roadmap of a new business (BUILD §11.1 "Take charge" → first
 * open; §11.5 Vision · Specification · Roadmap).
 *
 * - Commit writes the `business_foundations` row (pending) and, for a business that came through Import (Door B),
 *   links the Import job: the job id travels on the idea Import drafted (`idea.generate({ importJobId })`), commit
 *   snapshots the Import report on the row and stores the imported sources as the business's `sources`.
 * - The first open (`product.foundations.ensure`, called by the business shell) claims the row exactly once and starts
 *   the orchestrator's `businessFoundations` workflow (`foundations:{businessId}:{attempt}`). When Temporal does not
 *   answer, the same drafting runs here in the background (`runner: local`), never inside the request.
 * - A failed attempt is retried by `product.foundations.retry`. An attempt that never finished (a restarted process, a
 *   lost worker) is failed after `FOUNDATIONS_STALE_MS`, so the founder gets the retry instead of a spinner forever.
 */
import { buildFoundationsRequest, describeFoundationsFailure, finaliseFoundations, foundationsReadyNote, type FoundationsVisionRecord } from "@foundmill/agents";
import { repos, type BusinessFoundationsRow, type Db, type DbTx, type Source } from "@foundmill/db";
import type { ModelClient } from "@foundmill/models";
import type { FoundationsDoor, FoundationsRunner, FoundationsStatus } from "@foundmill/shared";
import { writeEventRow } from "./events";
import { IMPORT_SOURCES, decodeJobId, importStatus, sourceUri, type ImportStatus, type ScoutingReport } from "./import";
import type { ApiLogger } from "./log";
import { WORKFLOWS, workflowIds, type TemporalService } from "./temporal";

export interface FoundationsDeps {
  db: Db;
  models: ModelClient;
  temporal: TemporalService;
  log: ApiLogger;
  now?: () => Date;
}

/** How long an attempt may run before it counts as interrupted (local runs live in the api process). */
export const FOUNDATIONS_STALE_MS: Record<FoundationsRunner | "unknown", number> = { local: 10 * 60_000, temporal: 45 * 60_000, unknown: 10 * 60_000 };

export interface FoundationsView {
  /** "none" for businesses committed before foundations existed (and the demo seeds): nothing to draft. */
  status: "none" | FoundationsStatus;
  door: FoundationsDoor | null;
  attempt: number;
  runner: FoundationsRunner | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  vision: FoundationsVisionRecord | null;
  summary: Record<string, unknown>;
  /** Door B: the business is linked to the Import job it came from. */
  importLinked: boolean;
}

export const NO_FOUNDATIONS: FoundationsView = { status: "none", door: null, attempt: 0, runner: null, startedAt: null, finishedAt: null, error: null, vision: null, summary: {}, importLinked: false };

export function foundationsView(row: BusinessFoundationsRow | null): FoundationsView {
  if (!row) return NO_FOUNDATIONS;
  return {
    status: row.status,
    door: row.door,
    attempt: row.attempt,
    runner: row.runner,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    vision: row.status === "ready" ? ((row.vision ?? null) as FoundationsVisionRecord | null) : null,
    summary: row.summary ?? {},
    importLinked: Boolean(row.importJobId),
  };
}

export function isStale(row: BusinessFoundationsRow, now: Date): boolean {
  if (row.status !== "drafting" || !row.startedAt) return false;
  return now.getTime() - row.startedAt.getTime() > FOUNDATIONS_STALE_MS[row.runner ?? "unknown"];
}

// --- in-process runs (tests wait for them) ----------------------------------------------------------------------------

const inFlight = new Set<Promise<void>>();

/** Resolves when every in-process drafting run started by this process has finished. */
export async function settleFoundationRuns(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

// --- start / ensure / retry -------------------------------------------------------------------------------------------

export interface StartResult {
  view: FoundationsView;
  /** True when this call claimed the drafting (the first open, or a retry). */
  started: boolean;
}

/** The first open: claims a pending row exactly once and starts the drafting; otherwise reports where it stands. */
export async function ensureFoundations(deps: FoundationsDeps, businessId: string, actor: { userId: string }): Promise<StartResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await repos.foundations.get(deps.db, businessId);
  if (!row) return { view: NO_FOUNDATIONS, started: false };
  if (isStale(row, now)) {
    const failed = await repos.foundations.fail(deps.db, businessId, row.attempt, "The drafting was interrupted before it finished. Try again.");
    return { view: foundationsView(failed ?? (await repos.foundations.get(deps.db, businessId))), started: false };
  }
  if (row.status !== "pending") return { view: foundationsView(row), started: false };
  const claimed = await repos.foundations.claim(deps.db, businessId, ["pending"]);
  if (!claimed) return { view: foundationsView(await repos.foundations.get(deps.db, businessId)), started: false };
  await repos.audit.append(deps.db, businessId, { actorKind: "user", actorId: actor.userId, action: "foundations.start", target: { kind: "business_foundations", id: claimed.id }, details: { attempt: claimed.attempt, door: claimed.door } });
  return startClaimed(deps, claimed);
}

/** Retry a failed (or interrupted) drafting. Returns `started: false` when there is nothing to retry. */
export async function retryFoundations(deps: FoundationsDeps, businessId: string, actor: { userId: string }): Promise<StartResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await repos.foundations.get(deps.db, businessId);
  if (!row) return { view: NO_FOUNDATIONS, started: false };
  if (isStale(row, now)) await repos.foundations.fail(deps.db, businessId, row.attempt, "The drafting was interrupted before it finished. Try again.");
  const claimed = await repos.foundations.claim(deps.db, businessId, ["failed"]);
  if (!claimed) return { view: foundationsView(await repos.foundations.get(deps.db, businessId)), started: false };
  await repos.audit.append(deps.db, businessId, { actorKind: "user", actorId: actor.userId, action: "foundations.retry", target: { kind: "business_foundations", id: claimed.id }, details: { attempt: claimed.attempt } });
  return startClaimed(deps, claimed);
}

async function startClaimed(deps: FoundationsDeps, row: BusinessFoundationsRow): Promise<StartResult> {
  const workflowId = workflowIds.foundations(row.businessId, row.attempt);
  const started = await deps.temporal.start(WORKFLOWS.businessFoundations, { workflowId, args: [{ businessId: row.businessId, attempt: row.attempt }] });
  if (started.queued) {
    const updated = await repos.foundations.setRunner(deps.db, row.businessId, row.attempt, { runner: "temporal", workflowId });
    return { view: foundationsView(updated ?? row), started: true };
  }
  deps.log.info({ businessId: row.businessId, attempt: row.attempt, reason: started.reason }, "foundations: Temporal did not answer; drafting in the api");
  const updated = await repos.foundations.setRunner(deps.db, row.businessId, row.attempt, { runner: "local", workflowId: null });
  const run = runFoundationsLocally(deps, row.businessId, row.attempt).finally(() => inFlight.delete(run));
  inFlight.add(run);
  return { view: foundationsView(updated ?? row), started: true };
}

/**
 * One drafting attempt in this process: inputs → the foundations route → finalise → apply (one transaction) → the
 * Inbox event. Never throws: a failure marks the attempt failed with a founder-readable reason.
 */
export async function runFoundationsLocally(deps: FoundationsDeps, businessId: string, attempt: number): Promise<void> {
  try {
    const inputs = await repos.foundations.inputs(deps.db, businessId);
    const request = buildFoundationsRequest(inputs);
    const result = await deps.models.complete({ ...request, scope: `foundations:${businessId}`, attribution: { businessId, agentId: inputs.authorAgentId ?? undefined, kind: "foundations" } });
    const draft = finaliseFoundations(result.json, inputs);
    const applied = await repos.foundations.apply(deps.db, businessId, attempt, draft, {
      note: (stats) => foundationsReadyNote(draft, inputs.door, stats),
      model: { route: result.route, model: result.model, mode: result.mode, costMinor: result.cost.costMinorInt, costLabel: "Estimate", repaired: result.repaired, runner: "local" },
    });
    if (applied.inboxItem) {
      const item = applied.inboxItem;
      await writeEventRow(deps.db, {
        businessId,
        type: "inbox.item_created",
        actor: { kind: "agent", id: item.fromAgentId! },
        payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: result.cost.costMinorInt, currency: "EUR" } },
      }).catch((err: unknown) => deps.log.warn({ businessId, err: (err as Error).message }, "foundations: inbox event not written"));
    }
    deps.log.info({ businessId, attempt, applied: applied.applied, stats: applied.stats }, "foundations drafted");
  } catch (err) {
    deps.log.warn({ businessId, attempt, err: (err as Error)?.message }, "foundations drafting failed");
    await repos.foundations.fail(deps.db, businessId, attempt, describeFoundationsFailure(err)).catch((e: unknown) => deps.log.error({ businessId, err: (e as Error).message }, "foundations: could not record the failure"));
  }
}

// --- Door B: link the Import job at commit ----------------------------------------------------------------------------

const META_KIND = "foundmill:meta";

/** The Import job id Import's "Continue to Commit" recorded on the idea it drafted (`idea.generate({ importJobId })`). */
export function importJobIdOf(research: unknown): string | null {
  const citations = (research as { citations?: unknown[] } | undefined)?.citations ?? [];
  const meta = citations.find((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && (c as { kind?: unknown }).kind === META_KIND);
  return typeof meta?.import_job_id === "string" ? meta.import_job_id : null;
}

/**
 * A job id is usable as a link only when it decodes and belongs to the sign-up import (no business yet): a job token
 * naming a business is that business's own import and must never be read on behalf of another one.
 */
export function linkableImportJob(jobId: string | null | undefined): string | null {
  if (!jobId) return null;
  try {
    const token = decodeJobId(jobId);
    return token.b === null && token.m === "local" ? jobId : null;
  } catch {
    return null;
  }
}

export interface ImportLink {
  jobId: string;
  status: ImportStatus;
  report: ScoutingReport | null;
}

/** Rebuild the Import job's state and report (deterministic in the job token) for the commit to snapshot. */
export async function resolveImportLink(db: Db, jobId: string | null): Promise<ImportLink | null> {
  const usable = linkableImportJob(jobId);
  if (!usable) return null;
  const status = await importStatus({ db }, usable);
  return { jobId: usable, status, report: status.report };
}

/** Inside the commit transaction: the foundations row (pending) and, for Door B, the imported sources. */
export async function seedFoundations(tx: DbTx, businessId: string, input: { ideaId: string; link: ImportLink | null }): Promise<{ sources: Source[] }> {
  const { link } = input;
  await repos.foundations.create(tx, businessId, {
    door: link ? "import" : "ideation",
    ideaId: input.ideaId,
    importJobId: link?.jobId ?? null,
    importReport: link?.report ? (JSON.parse(JSON.stringify(link.report)) as Record<string, unknown>) : null,
  });
  const sources: Source[] = [];
  if (!link) return { sources };
  for (const s of link.status.job.sources) {
    const meta = IMPORT_SOURCES[s.key];
    sources.push(
      await repos.product.createSource(tx, businessId, {
        kind: meta.sourceKind,
        uri: sourceUri(s.key, s.value),
        title: `${meta.label} import${s.value ? `: ${s.value}` : ""}`.slice(0, 400),
        relevance: { import: { key: s.key, value: s.value, connector: meta.connectorKey, readOnly: true, status: s.status, summary: s.summary, provenance: "Estimate" }, summary: s.summary ?? undefined },
      }),
    );
  }
  return { sources };
}
