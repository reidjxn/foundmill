/**
 * businessFoundations activities (BUILD §11.1 "Take charge" → first open, §11.5 Vision · Specification · Roadmap).
 *
 * `draftFoundations` reads the inputs (the idea and founder profile, or the Import report and the imported sources),
 * asks the `foundations` route and finalises the answer; it writes nothing, so Temporal can retry it freely.
 * `applyFoundations` writes the vision, the specification blocks (never a pinned one), the roadmap and the Inbox note in
 * one transaction, only for the attempt that is still current. `failFoundations` records a readable reason.
 */
import { ApplicationFailure } from "@temporalio/common";
import { buildFoundationsRequest, describeFoundationsFailure, finaliseFoundations, foundationsReadyNote, type FoundationsDraft } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent } from "../events";
import type { BusinessFoundationsInput, FoundationsDrafted } from "./types";

/** Errors a retry cannot fix: the key was refused, or the model declined. */
const NON_RETRYABLE_CODES = new Set(["auth", "refusal", "request"]);

export function createFoundationsActivities(deps: OrchestratorDeps) {
  return {
    async draftFoundations(input: BusinessFoundationsInput): Promise<FoundationsDrafted> {
      const row = await repos.foundations.get(deps.db, input.businessId);
      if (!row || row.status !== "drafting" || row.attempt !== input.attempt) return { current: false, draft: null, door: row?.door ?? "ideation", model: {} };
      try {
        const inputs = await repos.foundations.inputs(deps.db, input.businessId);
        const request = buildFoundationsRequest(inputs);
        const result = await deps.models.complete({ ...request, scope: `foundations:${input.businessId}`, attribution: { businessId: input.businessId, agentId: inputs.authorAgentId ?? undefined, kind: "foundations" } });
        const draft = finaliseFoundations(result.json, inputs);
        return { current: true, draft, door: inputs.door, model: { route: result.route, model: result.model, mode: result.mode, costMinor: result.cost.costMinorInt, costLabel: "Estimate", repaired: result.repaired, runner: "temporal" } };
      } catch (err) {
        deps.log.warn({ businessId: input.businessId, attempt: input.attempt, err: (err as Error)?.message }, "foundations drafting attempt failed");
        // The founder sees the readable reason; the cause stays in the workflow history for operators.
        throw ApplicationFailure.create({ message: describeFoundationsFailure(err), type: (err as Error)?.name ?? "FoundationsDraftError", nonRetryable: NON_RETRYABLE_CODES.has(String((err as { code?: unknown })?.code)) });
      }
    },

    async applyFoundations(input: BusinessFoundationsInput & { draft: FoundationsDraft; door: "ideation" | "import"; model: Record<string, unknown> }): Promise<{ applied: boolean; inboxItemId: string | null }> {
      const { draft, door } = input;
      const res = await repos.foundations.apply(deps.db, input.businessId, input.attempt, draft, { note: (stats) => foundationsReadyNote(draft, door, stats), model: input.model });
      const item = res.inboxItem;
      if (item?.fromAgentId) {
        await emitEvent(deps.db, {
          businessId: input.businessId,
          type: "inbox.item_created",
          actor: agentActor(item.fromAgentId),
          payload: { inboxItemId: item.id, type: item.type, fromAgentId: item.fromAgentId, subject: item.subject, blocksContinue: item.blocksContinue, sourceEventIds: [], cost: { amountMinor: Number(input.model.costMinor ?? 0), currency: "EUR" } },
        });
      }
      return { applied: res.applied, inboxItemId: item?.id ?? null };
    },

    async failFoundations(input: BusinessFoundationsInput & { error: string }): Promise<{ failed: boolean }> {
      const row = await repos.foundations.fail(deps.db, input.businessId, input.attempt, input.error);
      return { failed: row !== null };
    },
  };
}

export type FoundationsActivities = ReturnType<typeof createFoundationsActivities>;
