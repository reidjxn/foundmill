/**
 * The Product Researcher's research plan (BUILD §11.5 Research tab; the founder's 2026-10-18 request): as soon as a new
 * business's foundations are ready, the researcher plans how the specification and the direction will be tested with
 * the ICP, in parallel with the build.
 *
 * - `product.research.ensure` (called by Home and the Research tab once the foundations read ready) creates the
 *   `product_research` row on the first ask, claims it exactly once when the foundations are ready, and drafts the plan
 *   here in the background (`runResearchPlanLocally`, one worker call through the api's model client, booked to the
 *   business and the researcher): the artifacts (interview plan and script, smoke test, survey, demo script) as drafts,
 *   the first research tasks for the cycles, the researcher's Inbox note and the `product.research_drafted` event, all
 *   in one transaction with the row turning ready.
 * - A failed attempt keeps a founder-readable reason and is retried by `product.research.retry`; an attempt that never
 *   finished (a restarted api) counts as interrupted after `RESEARCH_STALE_MS`.
 * - Nothing here reaches a person: recruiting, the page and the survey are drafts and tasks that end with the founder's
 *   approval (the template's rules), and the specification travels to the model as untrusted content.
 */
import { buildResearchPlanRequest, describeResearchFailure, finaliseResearchPlan, researchPlanNote, type ResearchPlan } from "@foundmill/agents";
import { repos, type Db, type Executor, type ProductResearchRow, type ResearchArtifact } from "@foundmill/db";
import { PRICING_CURRENCY, type ModelClient } from "@foundmill/models";
import type { ResearchArtifactKind, ResearchArtifactStatus, ResearchStatus } from "@foundmill/shared";
import { writeEventRow } from "./events";
import type { ApiLogger } from "./log";
import { detachFromRequest } from "./tx-gate";

export interface ResearchDeps {
  db: Db;
  models: ModelClient;
  log: ApiLogger;
  now?: () => Date;
}

/** How long an attempt may run before it counts as interrupted (runs live in the api process). */
export const RESEARCH_STALE_MS = 5 * 60_000;
/** At most this many plans drafted at once in one api process; each run is aborted after the timeout, waiting included. */
export const RESEARCH_LOCAL_CONCURRENCY = 2;
export const RESEARCH_LOCAL_TIMEOUT_MS = 3 * 60_000;
/** The first research tasks a plan may create (its `first_steps`, bounded again here). */
export const RESEARCH_MAX_FIRST_STEPS = 4;
export const RESEARCH_INTERRUPTED = "The research plan was interrupted before it finished. Try again.";

export interface ResearchArtifactView {
  id: string;
  kind: ResearchArtifactKind;
  title: string;
  summary: string;
  bodyMd: string;
  status: ResearchArtifactStatus;
  specBlockIds: string[];
  taskId: string | null;
  createdByAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResearchView {
  /** "none" when the business has no plan row yet (and no foundations to draft it from). */
  status: "none" | ResearchStatus;
  attempt: number;
  icp: string;
  error: string | null;
  summary: Record<string, unknown>;
  artifacts: ResearchArtifactView[];
  agent: { id: string; name: string } | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** The attempt ran past its window without finishing (reads as failed, with Try again). */
  stale: boolean;
}

export const NO_RESEARCH: ResearchView = { status: "none", attempt: 0, icp: "", error: null, summary: {}, artifacts: [], agent: null, startedAt: null, finishedAt: null, stale: false };

export function artifactView(a: ResearchArtifact): ResearchArtifactView {
  return { id: a.id, kind: a.kind, title: a.title, summary: a.summary, bodyMd: a.bodyMd, status: a.status, specBlockIds: a.specBlockIds, taskId: a.taskId, createdByAgentId: a.createdByAgentId, createdAt: a.createdAt, updatedAt: a.updatedAt };
}

export function isResearchStale(row: ProductResearchRow, now: Date): boolean {
  return row.status === "drafting" && !!row.startedAt && now.getTime() - row.startedAt.getTime() > RESEARCH_STALE_MS;
}

export function researchView(row: ProductResearchRow | null, artifacts: readonly ResearchArtifact[], agent: { id: string; name: string } | null, now: Date = new Date()): ResearchView {
  if (!row) return { ...NO_RESEARCH, artifacts: artifacts.map(artifactView) };
  return {
    status: row.status,
    attempt: row.attempt,
    icp: row.icp,
    error: row.error,
    summary: row.summary ?? {},
    artifacts: artifacts.map(artifactView),
    agent,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    stale: isResearchStale(row, now),
  };
}

/** Everything `product.research.get` shows: the row, its live artifacts and the agent it is attributed to. */
export async function loadResearchView(db: Executor, businessId: string, now: Date = new Date()): Promise<ResearchView> {
  const [row, artifacts] = await Promise.all([repos.research.get(db, businessId), repos.research.listArtifacts(db, businessId)]);
  if (!row) {
    // No row yet: a business with foundations gets its plan once they are ready (and a writer has opened it), so it
    // reads pending; one committed before foundations existed has nothing to draft from and reads none.
    const foundations = await repos.foundations.get(db, businessId);
    return { ...NO_RESEARCH, status: foundations ? "pending" : "none", artifacts: artifacts.map(artifactView) };
  }
  const agent = row.agentId ? await repos.agents.get(db, businessId, row.agentId).then((a) => ({ id: a.id, name: a.name })).catch(() => null) : null;
  return researchView(row, artifacts, agent, now);
}

// --- in-process runs (tests wait for them) ----------------------------------------------------------------------------

const inFlight = new Set<Promise<void>>();

/** Resolves when every plan drafting started by this process has finished. */
export async function settleResearchRuns(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

let localActive = 0;
const localWaiters: (() => void)[] = [];

/** Take a drafting slot (or wait for one until `signal` aborts); the returned release is safe to call twice. */
export async function acquireResearchSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw signal.reason ?? new Error("aborted");
  if (localActive < RESEARCH_LOCAL_CONCURRENCY) localActive++;
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
    if (next) next();
    else localActive--;
  };
}

/** Slots in use and runs waiting (tests). */
export function researchSlots(): { active: number; waiting: number } {
  return { active: localActive, waiting: localWaiters.length };
}

// --- ensure / retry ---------------------------------------------------------------------------------------------------

export interface ResearchStartResult {
  view: ResearchView;
  /** True when this call claimed the drafting (the first ask once the foundations are ready, or a retry). */
  started: boolean;
}

/**
 * The first ask once the foundations are ready: creates the row, claims it exactly once and drafts the plan in the
 * background; otherwise reports where it stands. Only an actor who `canStart` (product write) claims, fails a stale
 * attempt or starts anything; a stopped team starts nothing (the row stays pending for the resume).
 */
export async function ensureResearchPlan(deps: ResearchDeps, businessId: string, actor: { userId: string; canStart: boolean }): Promise<ResearchStartResult> {
  const now = (deps.now ?? (() => new Date()))();
  const [foundations, existing] = await Promise.all([repos.foundations.get(deps.db, businessId), repos.research.get(deps.db, businessId)]);
  // Nothing to draft from and nothing drafted: a business committed before foundations existed reads "none".
  if (!foundations && !existing) return { view: NO_RESEARCH, started: false };
  if (!actor.canStart) return { view: await loadResearchView(deps.db, businessId, now), started: false };
  const row = existing ?? (await repos.research.ensureRow(deps.db, businessId));
  if (isResearchStale(row, now)) {
    await repos.research.fail(deps.db, businessId, row.attempt, RESEARCH_INTERRUPTED);
    return { view: await loadResearchView(deps.db, businessId, now), started: false };
  }
  if (row.status !== "pending" || foundations?.status !== "ready") return { view: await loadResearchView(deps.db, businessId, now), started: false };
  const stop = await repos.businesses.stopState(deps.db, businessId);
  if (stop.stopped) return { view: await loadResearchView(deps.db, businessId, now), started: false };
  const claimed = await repos.research.claim(deps.db, businessId, ["pending"]);
  if (!claimed) return { view: await loadResearchView(deps.db, businessId, now), started: false };
  await repos.audit.append(deps.db, businessId, { actorKind: "user", actorId: actor.userId, action: "product.research.start", target: { kind: "product_research", id: claimed.id }, details: { attempt: claimed.attempt } });
  startRun(deps, businessId, claimed.attempt);
  return { view: await loadResearchView(deps.db, businessId, now), started: true };
}

/** Retry a failed (or interrupted) drafting. Returns `started: false` when there is nothing to retry. */
export async function retryResearchPlan(deps: ResearchDeps, businessId: string, actor: { userId: string }): Promise<ResearchStartResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await repos.research.get(deps.db, businessId);
  if (!row) return { view: NO_RESEARCH, started: false };
  if (isResearchStale(row, now)) await repos.research.fail(deps.db, businessId, row.attempt, RESEARCH_INTERRUPTED);
  const claimed = await repos.research.claim(deps.db, businessId, ["failed"]);
  if (!claimed) return { view: await loadResearchView(deps.db, businessId, now), started: false };
  await repos.audit.append(deps.db, businessId, { actorKind: "user", actorId: actor.userId, action: "product.research.retry", target: { kind: "product_research", id: claimed.id }, details: { attempt: claimed.attempt } });
  startRun(deps, businessId, claimed.attempt);
  return { view: await loadResearchView(deps.db, businessId, now), started: true };
}

function startRun(deps: ResearchDeps, businessId: string, attempt: number): void {
  // The run outlives the request that started it: the ungated database, never the request's view (services/tx-gate.ts).
  const run = runResearchPlanLocally({ ...deps, db: detachFromRequest(deps.db) }, businessId, attempt).finally(() => inFlight.delete(run));
  inFlight.add(run);
}

/** The task that starts one of the plan's first steps: a research task for the researcher, ready for the next cycle. */
export function firstStepTask(step: ResearchPlan["firstSteps"][number], agentId: string | null, departmentId: string | null) {
  return {
    kind: "research" as const,
    title: step.title.slice(0, 200),
    goalMd: `${step.goal}\n\nFrom the research plan on Product › Research. Nothing is sent to anyone without the founder's approval; findings are filed as sources with citations.`,
    acceptance: step.acceptance,
    assigneeAgentId: agentId,
    departmentId,
    status: "ready" as const,
  };
}

/**
 * One drafting attempt in this process: inputs → one worker call (the Product Researcher's instructions, the prompt,
 * the specification as untrusted content) → finalize → ready (one transaction: the artifacts, the first tasks, the
 * Inbox note and the events). Never throws: a failure marks the attempt failed with a founder-readable reason.
 */
export async function runResearchPlanLocally(deps: ResearchDeps, businessId: string, attempt: number, opts: { timeoutMs?: number } = {}): Promise<void> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? RESEARCH_LOCAL_TIMEOUT_MS);
  let release: (() => void) | null = null;
  try {
    release = await acquireResearchSlot(signal);
    const inputs = await repos.research.inputs(deps.db, businessId);
    const agentId = inputs.researcherAgentId;
    const agent = agentId ? await repos.agents.get(deps.db, businessId, agentId) : null;
    const request = buildResearchPlanRequest(inputs);
    // Booked to the business's usage ledger by the api's model client as the call ends (services/models.ts).
    const res = await deps.models.complete({ ...request, signal, scope: `research:${businessId}`, attribution: { businessId, agentId: agentId ?? undefined, kind: "research_plan" }, ...(agent ? { modelOverride: agent.modelKey } : {}) });
    const plan = finaliseResearchPlan(res.json, inputs);
    const departments = await repos.departments.list(deps.db, businessId, { includeHidden: true });
    const productDepartmentId = departments.find((d) => (d.moduleKeys as string[]).includes("product"))?.id ?? null;
    const model = { route: res.route, model: res.model, mode: res.mode, costMinor: Math.max(0, res.cost.costMinorInt), costLabel: "Estimate", repaired: res.repaired, runner: "local" };
    // The one-line ICP (the Customers section's first sentence) names the plan in titles and subjects; the model's
    // longer summary is kept with the plan.
    const icp = inputs.icp || plan.icpSummary;
    const applied = await repos.research.ready(deps.db, businessId, attempt, {
      icp,
      specVersion: inputs.specVersion,
      agentId,
      summary: { icp, icpSummary: plan.icpSummary, assumptions: plan.assumptions, openQuestions: plan.openQuestions, notes: plan.notes, model },
      artifacts: plan.artifacts.map((a) => ({ kind: a.kind, title: a.title, summary: a.summary, bodyMd: a.bodyMd, status: "draft" as const, createdByAgentId: agentId })),
      onWritten: async (tx, written) => {
        const taskIds: string[] = [];
        for (const step of plan.firstSteps.slice(0, RESEARCH_MAX_FIRST_STEPS)) {
          const task = await repos.tasks.create(tx, businessId, firstStepTask(step, agentId, productDepartmentId));
          taskIds.push(task.id);
        }
        let inboxItemId: string | null = null;
        if (agentId) {
          const note = researchPlanNote(plan, icp);
          const item = await repos.inbox.createItem(tx, businessId, { type: "update", from_agent_id: agentId, subject: note.subject, body_md: note.bodyMd, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] }, { costMinor: model.costMinor, currency: PRICING_CURRENCY });
          inboxItemId = item.id;
          await writeEventRow(tx, {
            businessId,
            type: "inbox.item_created",
            actor: { kind: "agent", id: agentId },
            payload: { inboxItemId: item.id, type: item.type, fromAgentId: agentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: model.costMinor, currency: PRICING_CURRENCY } },
          });
        }
        await writeEventRow(tx, {
          businessId,
          type: "product.research_drafted",
          actor: agentId ? { kind: "agent", id: agentId } : { kind: "system", id: "api" },
          payload: { researchId: written.row.id, attempt, agentId, artifactIds: written.artifacts.map((a) => a.id).slice(0, 12), taskIds: taskIds.slice(0, 8), inboxItemId },
        });
        return { firstStepTaskIds: taskIds, inboxItemId };
      },
    });
    deps.log.info({ businessId, attempt, applied: applied.applied, artifacts: applied.artifacts.length, placeholders: plan.notes.missingKinds }, "research plan drafted");
  } catch (err) {
    deps.log.warn({ businessId, attempt, err: (err as Error)?.message, code: (err as { code?: string })?.code }, "research plan drafting failed");
    await repos.research.fail(deps.db, businessId, attempt, describeResearchFailure(err)).catch((e: unknown) => deps.log.error({ businessId, err: (e as Error).message }, "research plan: could not record the failure"));
  } finally {
    release?.();
  }
}
