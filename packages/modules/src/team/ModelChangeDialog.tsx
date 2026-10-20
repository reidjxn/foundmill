"use client";
/**
 * Change an agent's model from the team table (BUILD §11.9 Model column, §11.10 AC-11.10.5): the picker shows the
 * predicted cost per month per model (Estimate, from `agent.model.compare`), locked routes with the reason, then ApplyScopeDialog
 * asks "this agent / all of its type / all agents" and `agent.model.set` applies it; retests are queued by the API.
 */
import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { ApplyScopeDialog, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, MODEL_LABELS, ModelPicker, SkeletonText, type ApplyScope, type ModelOption } from "@foundmill/dugout";
import type { ModelKey } from "@foundmill/shared";
import { useWidgetQuery } from "@foundmill/widgets/data";
import { InlineError, agentTypeNoun, errorMessage, useAction } from "./shared";
import type { AgentRow, ModelCompareResponse, ModelSetResponse } from "./types";

const MODEL_DESCRIPTIONS: Record<ModelKey, string> = {
  opus: "Deepest judgment; the default for the Chief of Staff and leads.",
  sonnet: "Fast and capable; the default for workers.",
  haiku: "Cheapest; classification, linking and other utility work.",
};

/**
 * Dugout's picker rows from the API's comparison; wage deltas are relative to the current model (Estimate) and in the
 * comparison's currency: metered model cost, so US dollars, never the business's or the agent's currency.
 */
export function toModelOptions(compare: ModelCompareResponse, currency: string = compare.currency ?? CREDITS_CURRENCY): ModelOption[] {
  const current = compare.options.find((o) => o.modelKey === compare.current);
  const base = current?.predictedWageMinor ?? 0;
  return compare.options.map((o) => ({
    key: o.modelKey,
    label: MODEL_LABELS[o.modelKey],
    description: MODEL_DESCRIPTIONS[o.modelKey],
    skillDelta: o.predictedSkillDelta ?? null,
    wageDelta: { amountMinor: o.predictedWageMinor - base, currency: compare.currency ?? currency },
    lockedReason: o.allowed ? undefined : (o.warning ?? "Locked for this agent's route."),
    warning: o.allowed && o.warning ? o.warning : undefined,
  }));
}

/** One line for the footer after a change: who moved, who was skipped, what was queued. */
export function describeModelSet(result: ModelSetResponse, modelKey: ModelKey): string {
  const parts = [`Model set to ${MODEL_LABELS[modelKey]} for ${result.updated.length} ${result.updated.length === 1 ? "agent" : "agents"}`];
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped (${[...new Set(result.skipped.map((s) => s.reason))].join("; ")})`);
  if (result.retests?.length) parts.push(`${result.retests.length} ${result.retests.length === 1 ? "retest" : "retests"} queued`);
  // Earlier retests of a model the agents no longer run (in flight or awaiting a decision) were canceled.
  if (result.superseded?.length) parts.push(`${result.superseded.length} earlier ${result.superseded.length === 1 ? "retest" : "retests"} canceled`);
  if (result.warnings.length) parts.push(result.warnings.join("; "));
  return parts.join(" · ");
}

export interface ModelChangeDialogProps {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  /** Agents sharing the type and the whole squad, for the scope dialog's copy. */
  typeCount: number;
  allCount: number;
  /** Called after `agent.model.set` succeeded with the API result. */
  onApplied: (result: ModelSetResponse, modelKey: ModelKey, scope: ApplyScope) => void;
}

export function ModelChangeDialog({ agent, onOpenChange, typeCount, allCount, onApplied }: ModelChangeDialogProps) {
  const compare = useWidgetQuery<ModelCompareResponse>("agent.model.compare", agent ? { agentId: agent.id } : undefined, { enabled: !!agent });
  const action = useAction();
  const [candidate, setCandidate] = useState<ModelKey | null>(null);
  useEffect(() => {
    if (agent) {
      setCandidate(null);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per agent
  }, [agent?.id]);
  const current = compare.data?.current ?? agent?.modelKey ?? "sonnet";
  const options = compare.data ? toModelOptions(compare.data) : [];
  const apply = async (scope: ApplyScope) => {
    if (!agent || !candidate) return;
    const result = await action.run<ModelSetResponse>("agent.model.set", { agentId: agent.id, modelKey: candidate, applyScope: scope }, { key: `model:${agent.id}` });
    if (result) {
      onApplied(result, candidate, scope);
      setCandidate(null);
      onOpenChange(false);
    } else {
      // Keep the scope dialog closed; the picker shows the error.
      setCandidate(null);
    }
  };
  return (
    <>
      <Dialog open={!!agent && !candidate} onOpenChange={onOpenChange}>
        <DialogContent size="md" data-testid="model-dialog">
          <DialogHeader>
            <DialogTitle>Model for {agent?.name}</DialogTitle>
            <DialogDescription>Cost per month is an estimate from this month's usage. Its skills are re-tested on the new model so the ratings stay honest.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {compare.isLoading ? <SkeletonText lines={3} /> : compare.error ? <InlineError error={errorMessage(compare.error)} /> : <ModelPicker options={options} value={current} onChange={(m) => m !== current && setCandidate(m)} disabled={action.pending !== null} />}
            {compare.data?.locked ? <p className="mt-2 text-small text-secondary">This agent's route is locked; only the current model is allowed.</p> : null}
            <InlineError error={action.error} className="mt-2" />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" icon={Cpu} onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {agent ? (
        <ApplyScopeDialog
          open={!!candidate}
          onOpenChange={(o) => {
            if (!o) setCandidate(null);
          }}
          agentName={agent.name}
          agentType={agentTypeNoun(agent)}
          typeCount={typeCount}
          allCount={allCount}
          settingLabel={`Model: ${candidate ? MODEL_LABELS[candidate] : ""}`}
          onApply={apply}
        />
      ) : null}
    </>
  );
}
