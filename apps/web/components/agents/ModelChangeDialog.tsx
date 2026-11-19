"use client";
/**
 * Model change from anywhere on the profile (header chip, Training › Model): `agent.model.compare` feeds the
 * ModelPicker with the predicted change in cost per month (Estimate), the Chief of Staff downgrade warning and the Inbox Composer lock
 * notice are shown before ApplyScopeDialog asks "this agent / all of its type / all agents", then `agent.model.set`
 * applies it and the API queues the retests (BUILD §11.10 "Model selection", AC-11.10.5).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { ApplyScopeDialog, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, MODEL_LABELS, ModelPicker, ProvenanceChip, SkeletonText, Term, formatMoney, useToast, type ApplyScope } from "@foundmill/dugout";
import type { ModelKey } from "@foundmill/shared";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { agentTypeNoun, chiefOfStaffDowngradeWarning, describeModelSet, isChiefOfStaffDowngrade, localPeriod, modelOptions, type AgentProfile } from "./logic";

export interface ModelChangeDialogProps {
  businessId: string;
  profile: AgentProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Agents sharing the type and the whole squad, for the scope dialog's copy. */
  typeCount?: number;
  allCount?: number;
  /** The cost deltas' currency: model costs are metered in US dollars (`CREDITS_CURRENCY`), never the business's. */
  currency?: string;
  /** Open straight at the warning/scope step for this model (Training › Model has its own picker). */
  preselect?: ModelKey | null;
}

type Step = "pick" | "warn" | "scope";

export function ModelChangeDialog({ businessId, profile, open, onOpenChange, typeCount, allCount, currency = CREDITS_CURRENCY, preselect = null }: ModelChangeDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const agent = profile.agent;
  const compareQ = useQuery(trpc.agent.model.compare.queryOptions({ businessId, agentId: agent.id, period: localPeriod() }, { enabled: open, staleTime: 60_000 }));
  const [candidate, setCandidate] = useState<ModelKey | null>(null);
  const [step, setStep] = useState<Step>("pick");
  // Retests for every agent of the type, or all, run only when chosen (WP-09 T9, TS-03 c).
  const [retestWide, setRetestWide] = useState(false);
  useEffect(() => {
    if (!open) {
      setCandidate(null);
      setStep("pick");
      setRetestWide(false);
      return;
    }
    if (preselect && preselect !== agent.modelKey && !profile.modelLock) {
      const needsWarning = isChiefOfStaffDowngrade(agent, preselect);
      setCandidate((c) => c ?? preselect);
      setStep((s) => (s === "pick" ? (needsWarning ? "warn" : "scope") : s));
    }
  }, [open, preselect, agent, profile.route, profile.modelLock]);

  const setModel = useMutation(
    trpc.agent.model.set.mutationOptions({
      onSuccess: (result, vars) => {
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("agent") as unknown[] });
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("team") as unknown[] });
        toast({ title: `Model: ${MODEL_LABELS[vars.modelKey]}`, description: describeModelSet(result, vars.modelKey), tone: result.skipped.length ? "warn" : "good" });
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Model change failed", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const current = compareQ.data?.current ?? agent.modelKey;
  const options = compareQ.data ? modelOptions(compareQ.data, currency) : [];
  const locked = profile.modelLock || compareQ.data?.locked === true;
  const cosWarning = candidate && isChiefOfStaffDowngrade(agent, candidate) ? chiefOfStaffDowngradeWarning(candidate) : undefined;

  const choose = (m: ModelKey) => {
    if (m === current || locked) return;
    setCandidate(m);
    setStep(isChiefOfStaffDowngrade(agent, m) ? "warn" : "scope");
  };
  const reset = () => {
    setCandidate(null);
    setStep("pick");
  };

  return (
    <>
      <Dialog open={open && step === "pick"} onOpenChange={onOpenChange}>
        <DialogContent size="md" data-testid="model-dialog">
          <DialogHeader>
            <DialogTitle>Model for {agent.name}</DialogTitle>
            <DialogDescription>Cost per month is an estimate from this month's usage. Its skills are re-tested on the new model so the ratings stay honest.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {locked ? (
              <p className="flex items-start gap-1.5 rounded-panel border border-subtle bg-panel-alt p-2 text-small text-secondary" data-testid="model-locked-notice">
                <Icon icon={Lock} size="inline" className="mt-0.5" />
                {profile.route === "inboxComposer" ? "The Inbox Composer is locked to Opus. Only the current model is allowed for this agent." : "This agent's route is locked; only the current model is allowed."}
              </p>
            ) : null}
            {compareQ.isLoading ? <SkeletonText lines={3} /> : compareQ.error ? <p className="text-small text-status-bad">{errorMessage(compareQ.error)}</p> : <ModelPicker options={options} value={current} onChange={choose} disabled={setModel.isPending || locked} />}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open && step === "warn"} onOpenChange={(o) => !o && reset()}>
        <DialogContent size="sm" data-testid="cos-downgrade-warning">
          <DialogHeader>
            <DialogTitle>
              Downgrade the <Term id="chief_of_staff">Chief of Staff</Term>?
            </DialogTitle>
            <DialogDescription>{cosWarning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={reset}>
              Keep {MODEL_LABELS[agent.modelKey]}
            </Button>
            <Button variant="danger" icon={TriangleAlert} onClick={() => setStep("scope")} data-testid="cos-downgrade-continue">
              Continue anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplyScopeDialog
        open={open && step === "scope" && !!candidate}
        onOpenChange={(o) => !o && reset()}
        agentName={agent.name}
        agentType={agentTypeNoun(agent)}
        typeCount={typeCount}
        allCount={allCount}
        settingLabel={`Model: ${candidate ? MODEL_LABELS[candidate] : ""}`}
        extra={(scope) => (candidate ? <RetestNote businessId={businessId} agentId={agent.id} modelKey={candidate} scope={scope} wide={retestWide} onWide={setRetestWide} /> : null)}
        onApply={async (scope: ApplyScope) => {
          if (!candidate) return;
          await setModel.mutateAsync({ businessId, agentId: agent.id, modelKey: candidate, applyScope: scope, retest: scope === "agent" || retestWide });
        }}
      />
    </>
  );
}

/** The retests a model change would queue and their price (Estimate), before the founder applies it (WP-09 T9). */
function RetestNote({ businessId, agentId, modelKey, scope, wide, onWide }: { businessId: string; agentId: string; modelKey: ModelKey; scope: ApplyScope; wide: boolean; onWide: (on: boolean) => void }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.agent.model.retestEstimate.queryOptions({ businessId, agentId, modelKey, applyScope: scope }, { staleTime: 60_000 }));
  if (!q.data) return null;
  if (q.data.agents === 0) return <p className="text-small text-secondary">No skills to re-test on this model.</p>;
  const price = <ProvenanceChip kind="estimate">{formatMoney({ amountMinor: q.data.costMinor, currency: CREDITS_CURRENCY })}</ProvenanceChip>;
  if (scope === "agent") return <p className="text-small text-secondary" data-testid="retest-price">Re-testing its skills on the new model costs about {price}.</p>;
  return (
    <label className="flex items-center gap-2 text-small text-secondary">
      <Checkbox checked={wide} onCheckedChange={(c) => onWide(c === true)} data-testid="retest-wide" />
      <span>
        Also re-test {q.data.agents} {q.data.agents === 1 ? "agent" : "agents"}, about {price}
      </span>
    </label>
  );
}
