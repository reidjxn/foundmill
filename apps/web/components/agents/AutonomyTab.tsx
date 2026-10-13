"use client";
/**
 * Autonomy and negotiation panel (BUILD §9.2 `autonomy` / `negotiation`, §9.6 per-agent overrides and LIVE
 * negotiation): the override relative to the business mode with spend cap and approval threshold, and the negotiation
 * settings (off by default; limits mandatory when on; final terms, signing and payment stay hard-gated). Every save
 * opens ApplyScopeDialog ("this agent / all of this type / all agents") → `agent.autonomy.set` / `agent.negotiation.set`.
 * Money fields are MoneyInputs holding exactly what the founder typed; amounts become minor units only when read for
 * validation and save, never on a keystroke.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ApplyScopeDialog, Button, Chip, Field, Icon, Input, MoneyInput, Panel, RadioGroup, RadioOption, Switch, useToast, type ApplyScope } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import type { TabProps } from "./AgentProfileScreen";
import { AUTONOMY_MODE_COPY, agentTypeNoun, autonomyDraft, autonomyFromAgent, autonomyToInput, negotiationDraft, negotiationFromAgent, negotiationToInput, readAutonomyDraft, readNegotiationDraft, validateAutonomy, validateNegotiation, type AutonomyDraft, type AutonomyMode, type NegotiationDraft } from "./logic";

const MODE_WORD: Record<string, string> = { augmented: "Augmented", assisted: "Assisted", automated: "Automated" };

export function AutonomyTab({ businessId, profile, currency, typeCount, allCount, refetch }: TabProps & { typeCount?: number; allCount?: number }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Autonomy, caps and negotiation widen what the agent does on its own: owners and admins change them (the api refuses anyone else).
  const { data, isAdmin } = useBusiness();
  const agent = profile.agent;
  const live = data.business.gameMode === "live";

  const [autonomy, setAutonomy] = useState<AutonomyDraft>(() => autonomyDraft(autonomyFromAgent(agent.autonomy)));
  const [negotiation, setNegotiation] = useState<NegotiationDraft>(() => negotiationDraft(negotiationFromAgent(agent.negotiation)));
  const [topicDraft, setTopicDraft] = useState("");
  const autonomyKey = JSON.stringify(agent.autonomy ?? {});
  const negotiationKey = JSON.stringify(agent.negotiation ?? {});
  // Reset the forms when the stored values change (a save, another tab), not on every refetch of the same row.
  useEffect(() => setAutonomy(autonomyDraft(autonomyFromAgent(JSON.parse(autonomyKey)))), [autonomyKey]);
  useEffect(() => setNegotiation(negotiationDraft(negotiationFromAgent(JSON.parse(negotiationKey)))), [negotiationKey]);
  const [scope, setScope] = useState<"autonomy" | "negotiation" | null>(null);

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
  const setNegotiationM = useMutation(
    trpc.agent.negotiation.set.mutationOptions({
      onSuccess: (r) => {
        toast({ title: negotiation.enabled ? "Negotiation on" : "Negotiation off", description: `${r.updated.length} ${r.updated.length === 1 ? "agent" : "agents"} changed.`, tone: "good" });
        void invalidate();
        refetch();
      },
      onError: (err) => toast({ title: "Negotiation not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const autonomyForm = readAutonomyDraft(autonomy);
  const negotiationForm = readNegotiationDraft(negotiation);
  const autonomyError = validateAutonomy(autonomyForm);
  const negotiationError = validateNegotiation(negotiationForm);
  const money = (label: string, id: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <Field htmlFor={id} label={label} hint={hint}>
      <MoneyInput id={id} controlSize="lg" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" currency={currency} />
    </Field>
  );

  const apply = async (s: ApplyScope) => {
    if (scope === "autonomy") await setAutonomyM.mutateAsync({ businessId, agentId: agent.id, autonomy: autonomyToInput(autonomyForm), applyScope: s });
    else if (scope === "negotiation") await setNegotiationM.mutateAsync({ businessId, agentId: agent.id, negotiation: negotiationToInput(negotiationForm), applyScope: s });
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
            <Button size="sm" variant="primary" className="ml-auto" disabled={!isAdmin || !!autonomyError} loading={setAutonomyM.isPending} onClick={() => setScope("autonomy")} data-testid="save-autonomy">
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
            {money("Spend cap per action", "spend-cap", autonomy.spendCap, (v) => setAutonomy((a) => ({ ...a, spendCap: v })), "Above this the call is denied outright.")}
            {money("Ask above", "approval-threshold", autonomy.approvalThreshold, (v) => setAutonomy((a) => ({ ...a, approvalThreshold: v })), "Spends above this become a decision in your Inbox.")}
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

      <Panel
        title="Negotiation"
        span={6}
        actions={
          <span className="inline-flex items-center gap-2">
            {live ? <Chip tone="info">LIVE</Chip> : <Chip tone="neutral">Applies on LIVE</Chip>}
            <Chip tone={negotiation.enabled ? "good" : "neutral"} icon={Handshake}>
              {negotiation.enabled ? "On" : "Off"}
            </Chip>
          </span>
        }
        footer={
          <span className="flex w-full items-center gap-2">
            <span>Within these limits the agent negotiates without per-message approval. Final terms, signing and payment stay hard-gated; transcripts go on the counterparty's CRM profile; the other side always knows it is an agent.</span>
            <Button size="sm" variant="primary" className="ml-auto shrink-0" disabled={!isAdmin || !!negotiationError} loading={setNegotiationM.isPending} onClick={() => setScope("negotiation")} data-testid="save-negotiation">
              Save negotiation
            </Button>
          </span>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <label className="flex items-center gap-3 text-body text-primary" htmlFor="negotiation-enabled">
            <Switch id="negotiation-enabled" checked={negotiation.enabled} onCheckedChange={(v) => setNegotiation((n) => ({ ...n, enabled: v }))} />
            Let {agent.name} negotiate with other businesses' agents and people
          </label>
          <div className="grid grid-cols-2 gap-3">
            {money("Price floor", "price-min", negotiation.priceMin, (v) => setNegotiation((n) => ({ ...n, priceMin: v })))}
            {money("Price ceiling", "price-max", negotiation.priceMax, (v) => setNegotiation((n) => ({ ...n, priceMax: v })))}
            {money("Walk away at", "walk-away", negotiation.walkAway, (v) => setNegotiation((n) => ({ ...n, walkAway: v })), "Required when negotiation is on.")}
            <Field htmlFor="max-concession" label="Max concession" hint="Percent the agent may move from its opening position.">
              <Input id="max-concession" numeric inputMode="decimal" value={negotiation.maxConcession} onChange={(e) => setNegotiation((n) => ({ ...n, maxConcession: e.target.value }))} suffix="%" />
            </Field>
          </div>
          <Field htmlFor="topics" label="Topics" hint="Press Enter to add. Only these topics may be negotiated.">
            <div className="flex flex-col gap-1.5">
              <Input
                id="topics"
                value={topicDraft}
                onChange={(e) => setTopicDraft(e.target.value)}
                placeholder="price, delivery date, minimum order"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const t = topicDraft.trim();
                    if (t && !negotiation.topics.includes(t)) setNegotiation((n) => ({ ...n, topics: [...n.topics, t] }));
                    setTopicDraft("");
                  }
                }}
              />
              {negotiation.topics.length ? (
                <div className="flex flex-wrap gap-1" data-testid="negotiation-topics">
                  {negotiation.topics.map((t) => (
                    <Chip key={t} tone="neutral" onRemove={() => setNegotiation((n) => ({ ...n, topics: n.topics.filter((x) => x !== t) }))} removeLabel={`Remove ${t}`}>
                      {t}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          </Field>
          {negotiationError ? (
            <p role="alert" className="text-small text-status-bad" data-testid="negotiation-error">
              {negotiationError}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-small text-secondary">
              <Icon icon={ShieldCheck} size="inline" /> Accepting final terms always creates a hard-gate task for you.
            </p>
          )}
        </form>
      </Panel>

      <ApplyScopeDialog open={scope !== null} onOpenChange={(o) => !o && setScope(null)} agentName={agent.name} agentType={agentTypeNoun(agent)} typeCount={typeCount} allCount={allCount} settingLabel={scope === "autonomy" ? `Autonomy: ${AUTONOMY_MODE_COPY[autonomy.mode].label}` : `Negotiation: ${negotiation.enabled ? "on" : "off"}`} onApply={apply} />
    </div>
  );
}
