/**
 * Staged foundations drafting (audit P3): the steps that call the model. Not re-exported from the package root, which
 * stays data plus pure functions; apps/api (the in-process run) and apps/orchestrator (one activity per step) import it
 * from `@foundmill/agents/foundations-steps` and hand it their models client and a progress store. Every model call
 * goes through that client (packages/models), streamed so each part is stored the moment it is complete.
 *
 * Step 0 is the project's public page (docs/THESIS_REVIEW.md package 1.2, `runProjectPageStep`): one `projectPage` call
 * before the plan, written through the runner's `ProjectPageStore`; it never fails the drafting (any model failure
 * writes the starter draft instead).
 *
 * Failure policy:
 * - the plan (step 1) fails the attempt if it fails (the client already retried connection errors);
 * - a section batch that fails or leaves a section out is followed by one call per missing section, alone; a section
 *   that still fails fails the attempt, one the model keeps leaving out becomes a placeholder and an open question
 *   (what the single call did for a missing section);
 * - the roadmap is retried once, alone;
 * - errors no retry can fix (refused key, refusal, a bad request, an abort, an attempt superseded) stop at once.
 * Whatever was stored stays stored: Try again resumes from it.
 */
import { FoundationsRoadmapItem, FoundationsSection, FoundationsSkeletonSection, FoundationsVision } from "@foundmill/models/schemas";
import { streamStructured } from "@foundmill/models/structured-stream";
import type { ModelKey } from "@foundmill/models/routing";
import type { CompleteResult, ModelClient, UsageAttribution } from "@foundmill/models/types";
import type { ProjectPageContent } from "@foundmill/shared";
import { finaliseVision, knownNumbers, type FoundationsInputs } from "./foundations";
import { buildProjectPageRequest, finaliseProjectPage, projectPageReadyNote, starterProjectPage, type ProjectPageNote } from "./project-page";
import {
  buildFoundationsRoadmapRequest,
  buildFoundationsSectionsRequest,
  buildFoundationsSkeletonRequest,
  chunkSections,
  emptyFoundationsProgress,
  matchSection,
  progressMatches,
  sectionsToWrite,
  skeletonDone,
  skeletonPatch,
  storedSection,
  type FoundationsProgress,
  type FoundationsProgressAuthor,
  type FoundationsProgressStore,
} from "./foundations-staged";

export interface FoundationsStepLogger {
  warn(obj: unknown, msg?: string): void;
}

export interface FoundationsStepContext {
  models: ModelClient;
  inputs: FoundationsInputs;
  store: FoundationsProgressStore;
  signal?: AbortSignal;
  scope?: string;
  attribution?: UsageAttribution;
  log?: FoundationsStepLogger;
}

/** What the model calls of a step cost (summed over a run; the cost is an Estimate). */
export interface FoundationsUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costMinor: number;
  model: string | null;
  modelKey: ModelKey | null;
  mode: "mock" | "live" | null;
  repaired: boolean;
}

export const NO_FOUNDATIONS_USAGE: FoundationsUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costMinor: 0, model: null, modelKey: null, mode: null, repaired: false };

export function addFoundationsUsage(a: FoundationsUsage, b: FoundationsUsage): FoundationsUsage {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    costMinor: a.costMinor + b.costMinor,
    model: a.model ?? b.model,
    modelKey: a.modelKey ?? b.modelKey,
    mode: a.mode ?? b.mode,
    repaired: a.repaired || b.repaired,
  };
}

function usageOf(res: CompleteResult<unknown> & { calls?: number }): FoundationsUsage {
  return {
    calls: res.calls ?? 1,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    cacheReadInputTokens: res.usage.cacheReadInputTokens,
    cacheCreationInputTokens: res.usage.cacheCreationInputTokens,
    costMinor: Math.max(0, res.cost.costMinorInt),
    model: res.model,
    modelKey: res.modelKey,
    mode: res.mode,
    repaired: res.repaired,
  };
}

/** The attempt is no longer the current drafting one: stop without recording anything (the newer attempt owns the row). */
export class FoundationsSupersededError extends Error {
  readonly code = "superseded";
  constructor() {
    super("The foundations drafting attempt was superseded");
    this.name = "FoundationsSupersededError";
  }
}

const NOT_RETRYABLE = new Set(["auth", "refusal", "request", "aborted", "superseded"]);

/** Whether a failed call is worth one more call on its own: not for a refused key, a refusal, a bad request or an abort. */
export function retryableAlone(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown } | null;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return false;
  return !NOT_RETRYABLE.has(String(e?.code));
}

const saved = (p: FoundationsProgress | null): FoundationsProgress => {
  if (!p) throw new FoundationsSupersededError();
  return p;
};

/**
 * The progress this run continues: what is stored when it was drafted for the same outline (a retry resumes), else a
 * fresh start (which also replaces progress drafted for another outline).
 */
export async function startFoundationsDraft(ctx: Pick<FoundationsStepContext, "inputs" | "store">, stored: FoundationsProgress | null, author: FoundationsProgressAuthor | null): Promise<FoundationsProgress> {
  if (progressMatches(stored, ctx.inputs)) return stored;
  return saved(await ctx.store.save({ replace: emptyFoundationsProgress(ctx.inputs, author) }, "started"));
}

/** A vision in a stream snapshot, once it is complete: another top-level member has started after it. */
function completeVision(snapshot: unknown): FoundationsVision | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const keys = Object.keys(snapshot);
  const at = keys.indexOf("vision");
  if (at < 0 || at === keys.length - 1) return null;
  const parsed = FoundationsVision.safeParse((snapshot as Record<string, unknown>).vision);
  return parsed.success ? parsed.data : null;
}

/** Step 1: the plan. The vision is stored the moment it has streamed; the theses and the roadmap titles when it ends. */
export async function runFoundationsSkeleton(ctx: FoundationsStepContext, progress: FoundationsProgress): Promise<{ progress: FoundationsProgress; usage: FoundationsUsage }> {
  if (skeletonDone(progress)) return { progress, usage: NO_FOUNDATIONS_USAGE };
  const known = knownNumbers(ctx.inputs);
  let current = progress;
  let visionWrite: Promise<void> | null = progress.vision ? Promise.resolve() : null;
  let visionError: unknown = null;
  const req = buildFoundationsSkeletonRequest(ctx.inputs);
  const res = await streamStructured(ctx.models, {
    ...req,
    signal: ctx.signal,
    scope: ctx.scope,
    attribution: ctx.attribution,
    elementPath: "sections",
    elementSchema: FoundationsSkeletonSection,
    onPartial: (p) => {
      if (visionWrite) return;
      const vision = completeVision(p.snapshot());
      if (!vision) return;
      const fin = finaliseVision(vision, known);
      visionWrite = ctx.store.save({ set: { vision: fin.vision, visionLabelled: fin.labelled } }, "vision").then(
        (stored) => {
          if (stored) current = stored;
          else visionError = new FoundationsSupersededError();
        },
        (err: unknown) => {
          visionError = err;
        },
      );
    },
  });
  await visionWrite;
  if (visionError) throw visionError;
  const plan = skeletonPatch(res.json, ctx.inputs, known);
  // A vision stored while streaming is the same object; keep it rather than write it twice.
  const set = current.vision ? { theses: plan.theses, planned: plan.planned, planDone: true } : plan;
  return { progress: saved(await ctx.store.save({ set }, "plan")), usage: usageOf(res) };
}

/**
 * Step 2: one batch of sections, each stored as soon as it has streamed. Sections the batch did not deliver (it failed,
 * ran out of room or left one out) get one call each, alone.
 */
export async function runFoundationsSections(ctx: FoundationsStepContext, progress: FoundationsProgress, sections: readonly string[]): Promise<{ usage: FoundationsUsage; written: string[]; missing: string[] }> {
  const todo = sections.filter((s) => !progress.sections[s]);
  if (!todo.length) return { usage: NO_FOUNDATIONS_USAGE, written: [], missing: [] };
  const known = knownNumbers(ctx.inputs);
  const done = new Set<string>();
  let usage = NO_FOUNDATIONS_USAGE;
  const call = async (names: readonly string[]) => {
    const req = buildFoundationsSectionsRequest(ctx.inputs, progress, names);
    const res = await streamStructured(ctx.models, {
      ...req,
      signal: ctx.signal,
      scope: ctx.scope,
      attribution: ctx.attribution,
      elementPath: "sections",
      elementSchema: FoundationsSection,
      onElement: async ({ value }) => {
        const target = matchSection(value.section, names);
        if (!target || done.has(target)) return;
        saved(await ctx.store.save({ section: storedSection(value, target, ctx.inputs, known) }, "section", target));
        done.add(target);
      },
    });
    usage = addFoundationsUsage(usage, usageOf(res));
  };
  try {
    await call(todo);
  } catch (err) {
    if (!retryableAlone(err)) throw err;
    ctx.log?.warn({ sections: todo, delivered: [...done], err: (err as Error)?.message, code: (err as { code?: string })?.code }, "foundations: a section batch failed; retrying its missing sections one by one");
  }
  const missing = todo.filter((s) => !done.has(s));
  if (missing.length) {
    const results = await Promise.allSettled(missing.map((s) => call([s])));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  }
  return { usage, written: todo.filter((s) => done.has(s)), missing: todo.filter((s) => !done.has(s)) };
}

/** Step 3: the roadmap, items stored as they stream, then the open questions; retried once, alone. */
export async function runFoundationsRoadmap(ctx: FoundationsStepContext, progress: FoundationsProgress): Promise<{ usage: FoundationsUsage }> {
  if (progress.roadmapDone) return { usage: NO_FOUNDATIONS_USAGE };
  const once = async () => {
    const items: FoundationsRoadmapItem[] = [];
    const req = buildFoundationsRoadmapRequest(ctx.inputs, progress);
    const res = await streamStructured(ctx.models, {
      ...req,
      signal: ctx.signal,
      scope: ctx.scope,
      attribution: ctx.attribution,
      elementPath: "roadmap",
      elementSchema: FoundationsRoadmapItem,
      onElement: async ({ index, value }) => {
        items[index] = value;
        saved(await ctx.store.save({ set: { roadmap: items.filter(Boolean) } }, "roadmap"));
      },
    });
    saved(await ctx.store.save({ set: { roadmap: res.json.roadmap, openQuestions: res.json.open_questions, roadmapDone: true } }, "roadmap"));
    return { usage: usageOf(res) };
  };
  try {
    return await once();
  } catch (err) {
    if (!retryableAlone(err)) throw err;
    ctx.log?.warn({ err: (err as Error)?.message, code: (err as { code?: string })?.code }, "foundations: the roadmap call failed; retrying it once");
    return once();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Step 0: the project's public page (docs/THESIS_REVIEW.md package 1.2)
// ---------------------------------------------------------------------------------------------------------------------

/** Where the page step writes: each runner implements it over `repos.pages` (the same repo call in both). */
export interface ProjectPageStore {
  /** False when the page needs no draft: a row exists already (the founder saved, or an earlier attempt wrote it) or a sample business. */
  needed(): Promise<boolean>;
  /** Writes the draft (never over an existing row) with the Product lead's note; `written: false` when a row appeared meanwhile. */
  write(input: { draft: ProjectPageContent; source: "model" | "starter"; reason: string | null; note: ProjectPageNote; usage: FoundationsUsage }): Promise<{ written: boolean; inboxItemId: string | null }>;
}

/** The page step's context; `positioning` is the approved notes when the project has them (a redraft), else none. */
export type ProjectPageStepContext = Omit<FoundationsStepContext, "store"> & { positioning?: string | null };

export interface ProjectPageDrafted {
  draft: ProjectPageContent;
  /** `model`: the Product lead's draft; `starter`: the deterministic draft (the call failed, was refused or the answer was not usable). */
  source: "model" | "starter";
  /** Why the starter was used (a refusal of the answer, or the error code of the call); null for a model draft. */
  reason: string | null;
  usage: FoundationsUsage;
}

/**
 * The page draft: one call on the `projectPage` route, checked against the shared page schema. Any failure (the call
 * failed, used-up credits, an answer outside the rules) falls back silently to the starter draft, so the founder always
 * gets a page; only an abort of the run itself is rethrown.
 */
export async function draftProjectPage(ctx: ProjectPageStepContext): Promise<ProjectPageDrafted> {
  const starter = (reason: string, usage: FoundationsUsage = NO_FOUNDATIONS_USAGE): ProjectPageDrafted => ({ draft: starterProjectPage(ctx.inputs), source: "starter", reason, usage });
  let res: CompleteResult<unknown>;
  try {
    const req = buildProjectPageRequest(ctx.inputs, { positioning: ctx.positioning });
    res = await ctx.models.complete({ ...req, signal: ctx.signal, scope: ctx.scope, attribution: ctx.attribution });
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    const code = String((err as { code?: unknown })?.code ?? "error");
    ctx.log?.warn({ err: (err as Error)?.message, code }, "project page: the model call failed; using the starter draft");
    return starter(code);
  }
  const fin = finaliseProjectPage(res.json, ctx.inputs);
  if ("refused" in fin) {
    ctx.log?.warn({ refused: fin.refused }, "project page: the answer was not usable; using the starter draft");
    return starter(fin.refused, usageOf(res));
  }
  return { draft: fin.draft, source: "model", reason: null, usage: usageOf(res) };
}

/**
 * Step 0 of the foundations: the page, before the vision. Nothing is asked of the model when the page already has a
 * row. Never published here: publishing is the founder's act.
 */
export async function runProjectPageStep(ctx: ProjectPageStepContext, store: ProjectPageStore): Promise<{ written: boolean; source: ProjectPageDrafted["source"] | null; inboxItemId: string | null; usage: FoundationsUsage }> {
  if (!(await store.needed())) return { written: false, source: null, inboxItemId: null, usage: NO_FOUNDATIONS_USAGE };
  const drafted = await draftProjectPage(ctx);
  const out = await store.write({ draft: drafted.draft, source: drafted.source, reason: drafted.reason, note: projectPageReadyNote(), usage: drafted.usage });
  return { written: out.written, source: drafted.source, inboxItemId: out.inboxItemId, usage: drafted.usage };
}

/**
 * The whole drafting in one process (the api's fallback when Temporal does not answer; the evals): the plan, then
 * every section batch and the roadmap at once. The first failure stops the other calls (their model calls are
 * aborted) and is rethrown; what was stored stays stored. The caller reads the final progress back from its store.
 */
export async function draftFoundationsStaged(ctx: FoundationsStepContext, opts: { stored: FoundationsProgress | null; author: FoundationsProgressAuthor | null }): Promise<{ usage: FoundationsUsage }> {
  let progress = await startFoundationsDraft(ctx, opts.stored, opts.author);
  const plan = await runFoundationsSkeleton(ctx, progress);
  progress = plan.progress;
  let usage = plan.usage;

  const stop = new AbortController();
  const onAbort = () => stop.abort(ctx.signal?.reason);
  if (ctx.signal?.aborted) onAbort();
  else ctx.signal?.addEventListener("abort", onAbort, { once: true });
  const child: FoundationsStepContext = { ...ctx, signal: stop.signal };
  let first: { err: unknown } | null = null;
  const guard = <T>(p: Promise<T>) =>
    p.catch((err: unknown) => {
      if (!first) {
        first = { err };
        stop.abort(err);
      }
      throw err;
    });
  try {
    const settled = await Promise.allSettled([...chunkSections(sectionsToWrite(progress)).map((c) => guard(runFoundationsSections(child, progress, c))), guard(runFoundationsRoadmap(child, progress))]);
    if (first) throw (first as { err: unknown }).err;
    for (const r of settled) if (r.status === "fulfilled") usage = addFoundationsUsage(usage, r.value.usage);
    return { usage };
  } finally {
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}
