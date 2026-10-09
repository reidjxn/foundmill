/**
 * businessFoundations activities (BUILD §11.1 "Take charge" → first open, §11.5 Vision · Specification · Roadmap).
 *
 * `draftFoundations` reads the inputs (the idea and founder profile, or the Import report and the imported sources),
 * asks the `foundations` route and finalises the answer; it writes nothing, so Temporal can retry it freely.
 * `applyFoundations` writes the vision, the specification blocks (never a pinned one), the roadmap and the Inbox note in
 * one transaction, only for the attempt that is still current. `failFoundations` records a readable reason.
 */
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { buildFoundationsRequest, describeFoundationsFailure, finaliseFoundations, foundationsReadyNote, type FoundationsDraft } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent } from "../events";
import type { BusinessFoundationsInput, FoundationsDrafted } from "./types";

/** Errors a retry cannot fix: the key was refused, or the model declined. */
const NON_RETRYABLE_CODES = new Set(["auth", "refusal", "request"]);

/**
 * The only failure type `draftFoundations` throws, and the only one whose message the workflow stores as the reason
 * the founder reads (security review L4): never raw worker or provider text.
 */
export const FOUNDATIONS_DRAFT_ERROR = "FoundationsDraftError";

/** How often the drafting heartbeats while it waits for the model (the workflow's heartbeatTimeout is a minute). */
export const FOUNDATIONS_HEARTBEAT_MS = 15_000;

/** The activity context when running inside Temporal; null in unit tests that call the activity directly. */
function activityContext(): Context | null {
  try {
    return Context.current();
  } catch {
    return null;
  }
}

export function createFoundationsActivities(deps: OrchestratorDeps) {
  return {
    /**
     * Writes nothing, so Temporal can retry it. It heartbeats while the model works and passes the activity's
     * cancellation signal to the call (L2): an attempt that timed out or was cancelled stops its Opus call instead of
     * running alongside the retry.
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

    async applyFoundations(input: BusinessFoundationsInput & { draft: FoundationsDraft; door: "ideation" | "import"; model: Record<string, unknown> }): Promise<{ applied: boolean; inboxItemId: string | null }> {
      const { draft, door } = input;
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
            payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: Number(input.model.costMinor ?? 0), currency: "EUR" } },
          });
        },
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
