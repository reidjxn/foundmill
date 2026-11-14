/**
 * Foundations: the vision, first specification and first roadmap of a new business (BUILD §11.1 "Take charge" → first
 * open; §11.5 Vision · Specification · Roadmap).
 *
 * - Commit writes the `business_foundations` row (pending) and, for a business that came through Import (Door B),
 *   links the Import job: the job id travels on the idea Import drafted (`idea.generate({ importJobId })`), commit
 *   snapshots the Import report on the row and stores the chosen sources as the business's `sources`, not read yet;
 *   commit then starts `importBusiness`, which reads them through the gateway (services/import.ts).
 * - The first open (`product.foundations.ensure`, called by the business shell) claims the row exactly once and starts
 *   the orchestrator's `businessFoundations` workflow (`foundations:{businessId}:{attempt}`). When Temporal does not
 *   answer, the same drafting runs here in the background (`runner: local`), never inside the request.
 * - The drafting is staged (audit P3, packages/agents foundations-staged / foundations-steps): a short plan whose vision
 *   is stored as soon as it has streamed, then the specification sections in parallel batches and the roadmap. Each
 *   part is stored on the row as it lands (`progress`, with a `foundations.progressed` event through the outbox), so
 *   `get` shows the vision within seconds and the sections and roadmap items as they arrive; the final apply stays one
 *   transaction.
 * - A failed attempt is retried by `product.foundations.retry`, which resumes from the stored progress. An attempt that
 *   never finished (a restarted process, a lost worker) is failed after `FOUNDATIONS_STALE_MS`, so the founder gets the
 *   retry instead of a spinner forever.
 */
import {
  assembleFoundationsDraft,
  describeFoundationsFailure,
  foundationsProgressView,
  foundationsSignoffNotes,
  PROJECT_PAGE_ROUTE,
  PROJECT_PAGE_USAGE_KIND,
  progressEventPayload,
  readFoundationsProgress,
  readyEventPayload,
  type FoundationsProgressStore,
  type FoundationsProgressView,
  type FoundationsVisionRecord,
} from "@foundmill/agents";
import { FoundationsSupersededError, draftFoundationsStaged, runProjectPageStep, type ProjectPageStore } from "@foundmill/agents/foundations-steps";
import { repos, type BusinessFoundationsRow, type Db, type DbTx, type Source } from "@foundmill/db";
import { PRICING_CURRENCY, type ModelClient } from "@foundmill/models";
import type { FoundationsDoor, FoundationsRunner, FoundationsStatus } from "@foundmill/shared";
import { writeEventRow } from "./events";
import { decodeJobId, importSourceRow, importStatus, localJobAt, validateConfigs, type ImportStatus, type ScoutingReport } from "./import";
import type { ApiLogger } from "./log";
import { WORKFLOWS, workflowIds, type TemporalService } from "./temporal";
import { ungated } from "./tx-gate";

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
  /** The vision once ready, and while drafting as soon as the plan has streamed it (audit P3). */
  vision: FoundationsVisionRecord | null;
  /** While drafting (or after a failed attempt): what has been stored so far, display-safe; null otherwise. */
  progress: FoundationsProgressView | null;
  summary: Record<string, unknown>;
  /** Door B: the business is linked to the Import job it came from. */
  importLinked: boolean;
}

export const NO_FOUNDATIONS: FoundationsView = { status: "none", door: null, attempt: 0, runner: null, startedAt: null, finishedAt: null, error: null, vision: null, progress: null, summary: {}, importLinked: false };

export function foundationsView(row: BusinessFoundationsRow | null): FoundationsView {
  if (!row) return NO_FOUNDATIONS;
  const progress = row.status === "drafting" || row.status === "failed" ? readFoundationsProgress(row.progress) : null;
  return {
    status: row.status,
    door: row.door,
    attempt: row.attempt,
    runner: row.runner,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    vision: row.status === "ready" ? ((row.vision ?? null) as FoundationsVisionRecord | null) : (progress?.vision ?? null),
    progress: progress ? foundationsProgressView(progress) : null,
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

/**
 * Bounds on the in-process fallback (security review L2): at most this many drafting runs at once in one api process
 * (the rest wait for a slot), and each run, waiting included, is aborted after `FOUNDATIONS_LOCAL_TIMEOUT_MS`, which is
 * shorter than the window after which a local attempt counts as interrupted, so a retry never overlaps a live run.
 */
export const FOUNDATIONS_LOCAL_CONCURRENCY = 2;
export const FOUNDATIONS_LOCAL_TIMEOUT_MS = 8 * 60_000;

let localActive = 0;
const localWaiters: (() => void)[] = [];

/** Take a drafting slot (or wait for one until `signal` aborts); the returned release is safe to call twice. */
export async function acquireFoundationsSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw signal.reason ?? new Error("aborted");
  if (localActive < FOUNDATIONS_LOCAL_CONCURRENCY) localActive++;
  else {
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const i = localWaiters.indexOf(go);
        if (i >= 0) localWaiters.splice(i, 1);
        reject(signal.reason ?? new Error("aborted"));
      };
      localWaiters.push(go);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = localWaiters.shift();
    // The slot passes straight to the next waiter; otherwise it is freed.
    if (next) next();
    else localActive--;
  };
}

/** Slots in use and runs waiting (tests). */
export function foundationsSlots(): { active: number; waiting: number } {
  return { active: localActive, waiting: localWaiters.length };
}

// --- start / ensure / retry -------------------------------------------------------------------------------------------

export interface StartResult {
  view: FoundationsView;
  /** True when this call claimed the drafting (the first open, or a retry). */
  started: boolean;
}

/**
 * The first open: claims a pending row exactly once and starts the drafting; otherwise reports where it stands. Only
 * an actor who `canStart` (product write) claims, fails a stale attempt or starts anything (security review L3).
 */
export async function ensureFoundations(deps: FoundationsDeps, businessId: string, actor: { userId: string; canStart: boolean }): Promise<StartResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await repos.foundations.get(deps.db, businessId);
  if (!row) return { view: NO_FOUNDATIONS, started: false };
  if (!actor.canStart) return { view: foundationsView(row), started: false };
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
  // The drafting outlives the request that started it: it runs on the database itself, not on the request's gated
  // view, which refuses new transactions once the browser has closed the request (tx-gate.ts, #95).
  const run = runFoundationsLocally({ ...deps, db: ungated(deps.db) }, row.businessId, row.attempt).finally(() => inFlight.delete(run));
  inFlight.add(run);
  return { view: foundationsView(updated ?? row), started: true };
}

/**
 * Where the in-process run stores its progress: `repos.foundations.writeProgress` for this attempt, with the
 * `foundations.progressed` event written through the outbox in the same transaction (open tabs refetch on it).
 */
export function foundationsProgressStore(db: Db, businessId: string, attempt: number, authorAgentId: string | null): FoundationsProgressStore {
  return {
    async save(patch, step, section = null) {
      const stored = await repos.foundations.writeProgress(db, businessId, attempt, patch, {
        onWritten: (tx, raw) => {
          const progress = readFoundationsProgress(raw);
          if (!progress) throw new Error("foundations: the stored progress does not read back");
          return writeEventRow(tx, { businessId, type: "foundations.progressed", actor: authorAgentId ? { kind: "agent", id: authorAgentId } : { kind: "system", id: "api" }, payload: progressEventPayload(attempt, step, progress, section) });
        },
      });
      return stored ? readFoundationsProgress(stored) : null;
    },
  };
}

/**
 * Where the page step writes (package 1.2): `repos.pages.writeTeamDraft`, the same call as the orchestrator's
 * `draftProjectPage` activity, with the note's `inbox.item_created` event through the outbox in the same transaction.
 */
export function projectPageStore(db: Db, businessId: string, authorAgentId: string | null): ProjectPageStore {
  return {
    needed: () => repos.pages.teamDraftNeeded(db, businessId),
    async write({ draft, source, reason, note, usage }) {
      const slug = await repos.pages.suggestSlug(db, businessId);
      const out = await repos.pages.writeTeamDraft(db, businessId, {
        draft,
        slug,
        agentId: authorAgentId,
        source,
        reason,
        model: { route: PROJECT_PAGE_ROUTE, model: usage.model, mode: usage.mode, costMinor: usage.costMinor, costLabel: "Estimate", runner: "local" },
        note,
        onInboxItem: (tx, item) =>
          writeEventRow(tx, {
            businessId,
            type: "inbox.item_created",
            actor: { kind: "agent", id: item.fromAgentId! },
            payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: usage.costMinor, currency: PRICING_CURRENCY } },
          }),
      });
      return { written: out.written, inboxItemId: out.item?.id ?? null };
    },
  };
}

/**
 * One drafting attempt in this process: the project's page first (package 1.2, never in the way), then inputs → the
 * staged drafting (the plan, then the sections and the roadmap at
 * once, each part stored as it lands) → assemble → apply (one transaction, with the two sign-off notes) → the Inbox
 * events. Resumes from the progress an earlier attempt stored. Never throws: a failure marks the attempt failed with a
 * founder-readable reason.
 */
export async function runFoundationsLocally(deps: FoundationsDeps, businessId: string, attempt: number, opts: { timeoutMs?: number } = {}): Promise<void> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? FOUNDATIONS_LOCAL_TIMEOUT_MS);
  let release: (() => void) | null = null;
  try {
    release = await acquireFoundationsSlot(signal);
    const inputs = await repos.foundations.inputs(deps.db, businessId);
    const [row, author] = await Promise.all([repos.foundations.get(deps.db, businessId), repos.foundations.author(deps.db, businessId, inputs.authorAgentId)]);
    const attribution = { businessId, agentId: inputs.authorAgentId ?? undefined, kind: "foundations" };
    // Step 0 (package 1.2), as the orchestrator's `draftProjectPage` activity: the page first, never in the way of the rest.
    if (row?.status === "drafting" && row.attempt === attempt) {
      await runProjectPageStep({ models: deps.models, inputs, signal, scope: `foundations:${businessId}`, attribution: { ...attribution, kind: PROJECT_PAGE_USAGE_KIND }, log: deps.log }, projectPageStore(deps.db, businessId, inputs.authorAgentId)).catch((err: unknown) => {
        if (signal.aborted) throw err;
        deps.log.warn({ businessId, attempt, err: (err as Error)?.message }, "project page: the draft could not be written");
      });
    }
    const store = foundationsProgressStore(deps.db, businessId, attempt, inputs.authorAgentId);
    // Each call is booked to the business's usage ledger by the API's model client as it ends (attribution `businessId`,
    // services/models.ts), as the orchestrator's client does through its usage sink: nothing is booked here.
    const { usage } = await draftFoundationsStaged({ models: deps.models, inputs, store, signal, scope: `foundations:${businessId}`, attribution, log: deps.log }, { stored: readFoundationsProgress(row?.progress), author });
    const progress = readFoundationsProgress((await repos.foundations.get(deps.db, businessId))?.progress);
    if (!progress) throw new FoundationsSupersededError();
    const draft = assembleFoundationsDraft(progress, inputs);
    // The two sign-off notes (founder, 2026-10-18): the specification and the roadmap, each a decision from the Product lead.
    const applied = await repos.foundations.apply(deps.db, businessId, attempt, draft, {
      signoffs: { spec: (stats) => foundationsSignoffNotes(draft, inputs.door, stats).spec, roadmap: (stats) => foundationsSignoffNotes(draft, inputs.door, stats).roadmap },
      model: { route: "foundations", model: usage.model, mode: usage.mode, costMinor: usage.costMinor, costLabel: "Estimate", repaired: usage.repaired, runner: "local", staged: true, calls: usage.calls },
      // The Inbox events are written through the outbox in the same transaction as the items.
      onInboxItem: (tx, item) =>
        writeEventRow(tx, {
          businessId,
          type: "inbox.item_created",
          actor: { kind: "agent", id: item.fromAgentId! },
          payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: usage.costMinor, currency: PRICING_CURRENCY } },
        }),
      // Open tabs refetch on it and turn ready at once (the last progress event came before the apply).
      onApplied: (tx) => writeEventRow(tx, { businessId, type: "foundations.progressed", actor: inputs.authorAgentId ? { kind: "agent", id: inputs.authorAgentId } : { kind: "system", id: "api" }, payload: readyEventPayload(attempt, draft) }),
    });
    deps.log.info({ businessId, attempt, applied: applied.applied, stats: applied.stats, calls: usage.calls }, "foundations drafted");
  } catch (err) {
    if (err instanceof FoundationsSupersededError) {
      deps.log.info({ businessId, attempt }, "foundations: the attempt was superseded; stopping");
      return;
    }
    deps.log.warn({ businessId, attempt, err: (err as Error)?.message, code: (err as { code?: string })?.code }, "foundations drafting failed");
    await repos.foundations.fail(deps.db, businessId, attempt, describeFoundationsFailure(err)).catch((e: unknown) => deps.log.error({ businessId, err: (e as Error).message }, "foundations: could not record the failure"));
  } finally {
    release?.();
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
 * A job id is usable as a link only when it was signed here (`key`, security review L1), was started by this account,
 * belongs to the sign-up import (no business yet: a job naming a business is that business's own import and must never
 * be read on behalf of another one), and has finished.
 */
export function linkableImportJob(key: string, jobId: string | null | undefined, userId: string, now: Date = new Date()): string | null {
  if (!jobId) return null;
  try {
    const token = decodeJobId(key, jobId);
    if (token.u !== userId || token.b !== null || token.m !== "local") return null;
    return localJobAt(token, jobId, now).status === "done" ? jobId : null;
  } catch {
    return null;
  }
}

export interface ImportLink {
  jobId: string;
  status: ImportStatus;
  report: ScoutingReport | null;
}

/** What the Board's import decision reads from a report: the live report, or the snapshot on the foundations row. */
export type ScoutingReportLike = Pick<ScoutingReport, "summary"> & { firstDecisions: Pick<ScoutingReport["firstDecisions"][number], "id" | "label" | "consequence" | "because" | "recommended" | "reversible" | "actions">[] };

/**
 * Rebuild the Import job's state and report (deterministic in the job token) for the commit to snapshot. The sources
 * are validated again, as `import.start` did, so nothing reaches the business's `sources` that import would refuse.
 */
export async function resolveImportLink(db: Db, key: string, jobId: string | null, userId: string, now: Date = new Date()): Promise<ImportLink | null> {
  const usable = linkableImportJob(key, jobId, userId, now);
  if (!usable) return null;
  const status = await importStatus({ db, key }, usable, userId, now);
  if (status.job.status !== "done") return null;
  if (Object.keys(validateConfigs(status.job.sources.map((s) => ({ key: s.key, value: s.value })))).length) return null;
  return { jobId: usable, status, report: status.report };
}

/**
 * Inside the commit transaction: the foundations row (pending) and, for Door B, the chosen sources as `sources` rows
 * that are not read yet (`import.status: "pending"`, no summary). The sign-up job read nothing, so nothing it showed is
 * stored as a finding; commit then starts `importBusiness`, which reads each row through the gateway and records what
 * it read or why it could not.
 */
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
  for (const s of link.status.job.sources) sources.push(await repos.product.createSource(tx, businessId, importSourceRow(s.key, s.value)));
  return { sources };
}
