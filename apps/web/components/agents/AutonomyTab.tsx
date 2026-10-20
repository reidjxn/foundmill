"use client";
/**
 * Autonomy panel (BUILD §9.2 `autonomy`, §9.6 per-agent overrides): the override relative to the business mode with the
 * spend cap and the approval threshold ("Needs your OK above"). Every save opens ApplyScopeDialog ("this agent / all of
 * this type / all agents") → `agent.autonomy.set`. Money fields are MoneyInputs holding exactly what the founder
 * typed; amounts become minor units only when read for validation and save, never on a keystroke.
 *
 * Negotiation (BUILD §9.2 `negotiation`, LIVE business-to-business deals) has no runtime yet (AC-11.14.3): until it
 * ships the tab says so in one line instead of offering a form that saves limits nothing reads (UX plan C12). The
 * form's logic (`negotiationDraft`, `validateNegotiation`, `negotiationToInput` in ./logic) stays for that day.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ApplyScopeDialog, Button, Chip, Field, Icon, MoneyInput, Panel, RadioGroup, RadioOption, useToast, type ApplyScope } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import type { TabProps } from "./AgentProfileScreen";
import { AUTONOMY_MODE_COPY, agentTypeNoun, autonomyDraft, autonomyFromAgent, autonomyToInput, readAutonomyDraft, validateAutonomy, type AutonomyDraft, type AutonomyMode } from "./logic";

const MODE_WORD: Record<string, string> = { augmented: "Augmented", assisted: "Assisted", automated: "Automated" };

/** The one line the tab says about negotiation until it ships. */
export const NEGOTIATION_NOTE = "Negotiation arrives with LIVE deals.";

export function AutonomyTab({ businessId, profile, currency, typeCount, allCount, refetch }: TabProps & { typeCount?: number; allCount?: number }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Autonomy and caps widen what the agent does on its own: owners and admins change them (the api refuses anyone else).
  const { data, isAdmin } = useBusiness();
  const agent = profile.agent;
  // A released agent's settings stay as a record; they are not changed any more (the API refuses it too).
  const released = !!agent.archivedAt;

  const [autonomy, setAutonomy] = useState<AutonomyDraft>(() => autonomyDraft(autonomyFromAgent(agent.autonomy)));
  const autonomyKey = JSON.stringify(agent.autonomy ?? {});
  // Reset the form when the stored values change (a save, another tab), not on every refetch of the same row.
  useEffect(() => setAutonomy(autonomyDraft(autonomyFromAgent(JSON.parse(autonomyKey)))), [autonomyKey]);
  const [scopeOpen, setScopeOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("agent") as unknown[] });
  const setAutonomyM = useMutation(
    trpc.agent.autonomy.set.mutationOptions({
      onSuccess: (r) => {
        toast({ title: "Autonomy updated", description: `${r.updated.length} ${r.updated.length === 1 ? "agent" : "agents"} changed.`, tone: "good" });
        void invalidate();
        refetch();
      },
      onError: (err) => toast({ title: "Autonomy not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const autonomyForm = readAutonomyDraft(autonomy);
  const autonomyError = validateAutonomy(autonomyForm);
  const money = (label: string, id: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <Field htmlFor={id} label={label} hint={hint}>
      <MoneyInput id={id} controlSize="lg" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" currency={currency} />
    </Field>
  );

  const apply = async (s: ApplyScope) => {
    await setAutonomyM.mutateAsync({ businessId, agentId: agent.id, autonomy: autonomyToInput(autonomyForm), applyScope: s });
  };

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-autonomy">
      <Panel
        title="Autonomy"
        span={6}
        actions={<Chip tone="neutral">Business mode: {MODE_WORD[data.business.businessMode] ?? data.business.businessMode}</Chip>}
        footer={
          <span className="flex w-full items-center gap-2">
            <span data-testid="autonomy-footer">{isAdmin ? "Hard gates (money, signing, identity, deletion, security) never lift, whatever the override." : "Only an owner or admin changes autonomy and spend caps. Hard gates never lift, whatever the override."}</span>
            <Button size="sm" variant="primary" className="ml-auto" disabled={!isAdmin || released || !!autonomyError} loading={setAutonomyM.isPending} onClick={() => setScopeOpen(true)} data-testid="save-autonomy">
              Save autonomy
            </Button>
          </span>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <RadioGroup value={autonomy.mode} onValueChange={(v) => setAutonomy((a) => ({ ...a, mode: v as AutonomyMode }))} aria-label="Autonomy override" className="gap-2">
            {(Object.keys(AUTONOMY_MODE_COPY) as AutonomyMode[]).map((m) => (
              <RadioOption key={m} id={`autonomy-${m}`} value={m} label={AUTONOMY_MODE_COPY[m].label} description={AUTONOMY_MODE_COPY[m].description} />
            ))}
          </RadioGroup>
          <div className="grid grid-cols-2 gap-3">
            {money("Spend cap per action", "spend-cap", autonomy.spendCap, (v) => setAutonomy((a) => ({ ...a, spendCap: v })), "Above this the agent is stopped; it cannot spend more in one go.")}
            {money("Needs your OK above", "approval-threshold", autonomy.approvalThreshold, (v) => setAutonomy((a) => ({ ...a, approvalThreshold: v })), "Spends above this become a decision in your Inbox.")}
          </div>
          {autonomyError ? (
            <p role="alert" className="text-small text-status-bad" data-testid="autonomy-error">
              {autonomyError}
            </p>
          ) : autonomyForm.spendCapMinor === 0 ? (
            // The default: no spending of its own. Not an error; say what it means.
            <p className="flex items-center gap-1 text-small text-secondary" data-testid="autonomy-note">
              <Icon icon={ShieldCheck} size="inline" /> No spending of its own: the agent cannot spend, so anything that costs money comes to you.
            </p>
          ) : null}
        </form>
      </Panel>

      {/* Hidden until it ships (C12): one line, no form. The limits form returns with the LIVE negotiation runtime. */}
      <Panel title="Negotiation" span={6} className="self-start" actions={<Chip tone="neutral" icon={Handshake}>Not available yet</Chip>}>
        <p className="text-body text-secondary" data-testid="negotiation-note">
          {NEGOTIATION_NOTE} Final terms, signing and payment will always stay with you.
        </p>
      </Panel>

      <ApplyScopeDialog open={scopeOpen} onOpenChange={(o) => !o && setScopeOpen(false)} agentName={agent.name} agentType={agentTypeNoun(agent)} typeCount={typeCount} allCount={allCount} settingLabel={`Autonomy: ${AUTONOMY_MODE_COPY[autonomy.mode].label}`} onApply={apply} />
    </div>
  );
}
