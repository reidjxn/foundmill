/**
 * businessFoundations activities (BUILD §11.1 "Take charge" → first open, §11.5 Vision · Specification · Roadmap).
 *
 * The drafting is staged (audit P3, packages/agents foundations-staged / foundations-steps), one activity per step so
 * each retries on its own:
 * - `draftFoundationsPlan` starts (or resumes) the stored progress and writes the plan: the vision (stored as soon as
 *   it has streamed), one thesis per outline section and the roadmap's titles. It returns the section batches.
 * - `draftFoundationsSections` writes one batch (its sections stored as they stream; a section the batch did not deliver
 *   is retried alone); a Temporal retry of a failed batch only redrafts what is still missing.
 * - `draftFoundationsRoadmap` writes the roadmap items and the open questions.
 * Each step stores what it produced on the `business_foundations` row with a `foundations.progressed` event (outbox), so
 * the screens fill in while the workflow runs; nothing else is written until `applyFoundations`, which assembles the
 * stored progress and writes the vision, the specification blocks (never a pinned one), the roadmap and the Inbox note
 * in one transaction, only for the attempt that is still current. `failFoundations` records a readable reason.
 *
 * For one release `draftFoundations` (the single call, as at 23545f4) stays registered and `applyFoundations` still
 * takes the draft it returns, so a workflow started before the staged drafting finishes on its old path (review item 6;
 * see `legacyBusinessFoundations` in workflows/businessFoundations.ts for when they go).
 */
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  assembleFoundationsDraft,
  buildFoundationsRequest,
  chunkSections,
  describeFoundationsFailure,
  finaliseFoundations,
  foundationsReadyNote,
  progressEventPayload,
  readFoundationsProgress,
  readyEventPayload,
  sectionsToWrite,
  type FoundationsDraft,
  type FoundationsProgress,
  type FoundationsProgressStore,
} from "@foundmill/agents";
import {
  FoundationsSupersededError,
  NO_FOUNDATIONS_USAGE,
  runFoundationsRoadmap,
  runFoundationsSections,
  runFoundationsSkeleton,
  startFoundationsDraft,
  type FoundationsStepContext,
  type FoundationsUsage,
} from "@foundmill/agents/foundations-steps";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { repos, type Executor } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent, systemActor } from "../events";
import type { BusinessFoundationsInput, FoundationsDrafted, FoundationsPlanned, FoundationsStepDone } from "./types";

/** Errors a retry cannot fix: the key was refused, or the model declined. */
const NON_RETRYABLE_CODES = new Set(["auth", "refusal", "request"]);

/**
 * The only failure type the drafting activities throw, and the only one whose message the workflow stores as the
 * reason the founder reads (security review L4): never raw worker or provider text.
 */
export const FOUNDATIONS_DRAFT_ERROR = "FoundationsDraftError";

/** How often a drafting step heartbeats while it waits for the model (the workflow's heartbeatTimeout is a minute). */
export const FOUNDATIONS_HEARTBEAT_MS = 15_000;

/** The activity context when running inside Temporal; null in unit tests that call the activity directly. */
function activityContext(): Context | null {
  try {
    return Context.current();
  } catch {
    return null;
  }
}

/** Progress for one attempt, with the `foundations.progressed` event in the same transaction (outbox). */
function progressStore(db: Executor, businessId: string, attempt: number, authorAgentId: string | null): FoundationsProgressStore {
  return {
    async save(patch, step, section = null) {
      const stored = await repos.foundations.writeProgress(db, businessId, attempt, patch, {
        onWritten: (tx, raw) => {
          const progress = readFoundationsProgress(raw);
          if (!progress) throw new Error("foundations: the stored progress does not read back");
          return emitEvent(tx, { businessId, type: "foundations.progressed", actor: authorAgentId ? agentActor(authorAgentId) : systemActor, payload: progressEventPayload(attempt, step, progress, section) });
        },
      });
      return stored ? readFoundationsProgress(stored) : null;
    },
  };
}

const usageModel = (u: FoundationsUsage): FoundationsStepDone["usage"] => ({ calls: u.calls, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMinor: u.costMinor, model: u.model, mode: u.mode, repaired: u.repaired });

export function createFoundationsActivities(deps: OrchestratorDeps) {
  /**
   * One drafting step for the current attempt: heartbeats while the model works, passes the activity's cancellation
   * signal to the calls (L2: an attempt that timed out stops its calls instead of running alongside the retry), and
   * turns any failure into a `FoundationsDraftError` with a readable message. `run` receives null when the attempt is
   * no longer the current drafting one (nothing is asked of the model).
   */
  async function step<T>(input: BusinessFoundationsInput, what: string, superseded: T, run: (ctx: FoundationsStepContext, progress: FoundationsProgress | null) => Promise<T>): Promise<T> {
    const ctx = activityContext();
    const beat = ctx ? setInterval(() => ctx.heartbeat({ businessId: input.businessId, attempt: input.attempt, step: what }), FOUNDATIONS_HEARTBEAT_MS) : null;
    try {
      ctx?.heartbeat({ businessId: input.businessId, attempt: input.attempt, step: what });
      const row = await repos.foundations.get(deps.db, input.businessId);
      if (!row || row.status !== "drafting" || row.attempt !== input.attempt) return superseded;
      const inputs = await repos.foundations.inputs(deps.db, input.businessId);
      const stepCtx: FoundationsStepContext = {
        models: deps.models,
        inputs,
        store: progressStore(deps.db, input.businessId, input.attempt, inputs.authorAgentId),
        signal: ctx?.cancellationSignal,
        scope: `foundations:${input.businessId}`,
        attribution: { businessId: input.businessId, agentId: inputs.authorAgentId ?? undefined, kind: "foundations" },
        log: deps.log,
      };
      return await run(stepCtx, readFoundationsProgress(row.progress));
    } catch (err) {
      if (err instanceof FoundationsSupersededError) return superseded;
      deps.log.warn({ businessId: input.businessId, attempt: input.attempt, step: what, err: (err as Error)?.message }, "foundations drafting step failed");
      // The founder sees a fixed readable reason; the cause stays in the worker log for operators.
      throw ApplicationFailure.create({ message: describeFoundationsFailure(err), type: FOUNDATIONS_DRAFT_ERROR, nonRetryable: NON_RETRYABLE_CODES.has(String((err as { code?: unknown })?.code)) });
    } finally {
      if (beat) clearInterval(beat);
    }
  }

  return {
    /**
     * The single-call drafting as at 23545f4, kept registered for one release for workflows started before the staged
     * drafting (review item 6; remove with `legacyBusinessFoundations`). Writes nothing, so Temporal can retry it; it
     * heartbeats and passes the activity's cancellation signal to the call, like the staged steps.
     */
    async draftFoundations(input: BusinessFoundationsInput): Promise<FoundationsDrafted> {
      const ctx = activityContext();
      const beat = ctx ? setInterval(() => ctx.heartbeat({ businessId: input.businessId, attempt: input.attempt }), FOUNDATIONS_HEARTBEAT_MS) : null;
      try {
        ctx?.heartbeat({ businessId: input.businessId, attempt: input.attempt });
        const row = await repos.foundations.get(deps.db, input.businessId);
        if (!row || row.status !== "drafting" || row.attempt !== input.attempt) return { current: false, draft: null, door: row?.door ?? "ideation", model: {} };
        const inputs = await repos.foundations.inputs(deps.db, input.businessId);
        const request = buildFoundationsRequest(inputs);
        const result = await deps.models.complete({ ...request, signal: ctx?.cancellationSignal, scope: `foundations:${input.businessId}`, attribution: { businessId: input.businessId, agentId: inputs.authorAgentId ?? undefined, kind: "foundations" } });
        const draft = finaliseFoundations(result.json, inputs);
        return { current: true, draft, door: inputs.door, model: { route: result.route, model: result.model, mode: result.mode, costMinor: result.cost.costMinorInt, costLabel: "Estimate", repaired: result.repaired, runner: "temporal" } };
      } catch (err) {
        deps.log.warn({ businessId: input.businessId, attempt: input.attempt, err: (err as Error)?.message }, "foundations drafting attempt failed");
        // The founder sees a fixed readable reason; the cause stays in the worker log for operators.
        throw ApplicationFailure.create({ message: describeFoundationsFailure(err), type: FOUNDATIONS_DRAFT_ERROR, nonRetryable: NON_RETRYABLE_CODES.has(String((err as { code?: unknown })?.code)) });
      } finally {
        if (beat) clearInterval(beat);
      }
    },

    /** Step 1: start or resume the progress, then the plan (the vision first). Returns the section batches still to write. */
    async draftFoundationsPlan(input: BusinessFoundationsInput): Promise<FoundationsPlanned> {
      const skipped: FoundationsPlanned = { current: false, door: "ideation", chunks: [], usage: usageModel(NO_FOUNDATIONS_USAGE) };
      return step(input, "plan", skipped, async (ctx, stored) => {
        const author = await repos.foundations.author(deps.db, input.businessId, ctx.inputs.authorAgentId);
        const progress = await startFoundationsDraft(ctx, stored, author);
        const plan = await runFoundationsSkeleton(ctx, progress);
        return { current: true, door: ctx.inputs.door, chunks: chunkSections(sectionsToWrite(plan.progress)), usage: usageModel(plan.usage) };
      });
    },

    /** Step 2: one batch of sections (what is already stored is skipped, so a retry only redrafts what is missing). */
    async draftFoundationsSections(input: BusinessFoundationsInput & { sections: string[] }): Promise<FoundationsStepDone> {
      const skipped: FoundationsStepDone = { current: false, usage: usageModel(NO_FOUNDATIONS_USAGE) };
      return step(input, "sections", skipped, async (ctx, progress) => {
        if (!progress) throw new Error("foundations: no plan stored before the sections");
        const done = await runFoundationsSections(ctx, progress, input.sections);
        return { current: true, usage: usageModel(done.usage) };
      });
    },

    /** Step 3: the roadmap and the open questions. */
    async draftFoundationsRoadmap(input: BusinessFoundationsInput): Promise<FoundationsStepDone> {
      const skipped: FoundationsStepDone = { current: false, usage: usageModel(NO_FOUNDATIONS_USAGE) };
      return step(input, "roadmap", skipped, async (ctx, progress) => {
        if (!progress) throw new Error("foundations: no plan stored before the roadmap");
        const done = await runFoundationsRoadmap(ctx, progress);
        return { current: true, usage: usageModel(done.usage) };
      });
    },

    /**
     * Assemble the stored progress and write it in one transaction, for the current attempt only. A workflow on the
     * single-call path (started before the staged drafting) passes the draft and door `draftFoundations` returned
     * instead; it is written as it is, as at 23545f4.
     */
    async applyFoundations(input: BusinessFoundationsInput & { model: Record<string, unknown>; draft?: FoundationsDraft; door?: "ideation" | "import" }): Promise<{ applied: boolean; inboxItemId: string | null }> {
      const row = await repos.foundations.get(deps.db, input.businessId);
      if (!row || row.status !== "drafting" || row.attempt !== input.attempt) return { applied: false, inboxItemId: null };
      const inputs = await repos.foundations.inputs(deps.db, input.businessId);
      let draft: FoundationsDraft;
      if (input.draft) draft = input.draft;
      else {
        const progress = readFoundationsProgress(row.progress);
        if (!progress) throw ApplicationFailure.create({ message: "The drafting finished but could not be saved. Try again.", type: FOUNDATIONS_DRAFT_ERROR, nonRetryable: true });
        draft = assembleFoundationsDraft(progress, inputs);
      }
      const door = input.door ?? inputs.door;
      const res = await repos.foundations.apply(deps.db, input.businessId, input.attempt, draft, {
        note: (stats) => foundationsReadyNote(draft, door, stats),
        model: input.model,
        // The Inbox event goes through the outbox in the same transaction as the item (a retried apply writes neither).
        onInboxItem: async (tx, item) => {
          if (!item.fromAgentId) return;
          await emitEvent(tx, {
            businessId: input.businessId,
            type: "inbox.item_created",
            actor: agentActor(item.fromAgentId),
            payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: Number(input.model.costMinor ?? 0), currency: CREDITS_CURRENCY } },
          });
        },
        // Open tabs refetch on it and turn ready at once.
        onApplied: (tx) => emitEvent(tx, { businessId: input.businessId, type: "foundations.progressed", actor: inputs.authorAgentId ? agentActor(inputs.authorAgentId) : systemActor, payload: readyEventPayload(input.attempt, draft) }),
      });
      return { applied: res.applied, inboxItemId: res.inboxItem?.id ?? null };
    },

    async failFoundations(input: BusinessFoundationsInput & { error: string }): Promise<{ failed: boolean }> {
      const row = await repos.foundations.fail(deps.db, input.businessId, input.attempt, input.error);
      return { failed: row !== null };
    },
  };
}

export type FoundationsActivities = ReturnType<typeof createFoundationsActivities>;
