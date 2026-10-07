"use client";
/**
 * Settings › Billing (BUILD §10.5, §11.15): tier (prices are open decisions → PRICE_TBA_LABEL), credits, usage by
 * agent and by department (every number an Estimate), top-ups (mock grants credits; live never moves money here).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useState } from "react";
import { PRICE_TBA_LABEL, TIERS, type TierKey } from "@foundmill/config";
import { Button, Chip, KeyValueList, MiniTable, ProvenanceChip, SimpleSelect } from "@foundmill/dugout";
import { PLAN_TIERS } from "@foundmill/shared";
import { formatMoney } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { useInvalidateRouters } from "./SettingsScreen";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

/** "Price to be announced" until a tier has a number (BUILD §10.5, §19). */
export function tierPriceLabel(tier: TierKey): string {
  const price = TIERS[tier].priceMonthly as string | number | null;
  if (price === null) return "Free";
  if (typeof price === "number") return `${price} / month`;
  return PRICE_TBA_LABEL;
}

const TOP_UP_OPTIONS = [2500, 5000, 10000, 25000] as const;

export function BillingTab() {
  const { businessId, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const plan = useQuery(trpc.billing.plan.queryOptions({ businessId }));
  const usage = useQuery(trpc.billing.usage.queryOptions({ businessId }));
  const changeTier = useMutation(trpc.billing.changeTier.mutationOptions({ onSuccess: () => (void invalidate(["billing", "business"]), t.saved("Tier changed")), onError: (e) => t.failed(e) }));
  const topUp = useMutation(trpc.billing.topUp.mutationOptions({ onSuccess: (r) => (void invalidate(["billing"]), r.granted ? t.saved("Credits added", r.label) : t.info("Payment is yours to make", r.label)), onError: (e) => t.failed(e) }));
  const [amount, setAmount] = useState<string>(String(TOP_UP_OPTIONS[1]));

  if (plan.error) return <ErrorPanel title="Billing" message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />;
  const p = plan.data;
  const currency = p?.balance?.currency ?? "EUR";

  return (
    <>
      <SettingsSection title="Plan" loading={plan.isLoading}>
        {p ? (
          <>
            <KeyValueList
              items={[
                { label: "Tier", value: <span className="flex items-center gap-2">{p.tier} <Chip tone="neutral">{tierPriceLabel(p.tier)}</Chip></span> },
                { label: "Model billing", value: p.modelBilling },
                { label: "Period", value: p.period, mono: true },
                { label: "Credits", value: p.balance ? formatMoney({ amountMinor: p.balance.balanceMinor, currency: p.balance.currency }) : "No credits this period", numeric: true },
                { label: "Spent this period", value: <span className="flex items-center gap-2">{formatMoney({ amountMinor: p.usage.costMinor, currency })} <ProvenanceChip kind="estimate" /></span>, numeric: true },
              ]}
            />
            <div className="grid grid-cols-3 gap-2">
              {PLAN_TIERS.map((tier) => {
                const spec = TIERS[tier];
                const current = tier === p.tier;
                return (
                  <div key={tier} className={`rounded-panel border p-3 ${current ? "border-kit-primary" : "border-subtle"}`} data-tier={tier}>
                    <div className="flex items-center justify-between">
                      <span className="t-display-sm capitalize">{tier}</span>
                      {current ? <Chip tone="kit">Current</Chip> : null}
                    </div>
                    <p className="text-small text-secondary">{tierPriceLabel(tier)}</p>
                    <ul className="mt-2 flex flex-col gap-0.5 text-small">
                      <li>{String(spec.businesses)} businesses</li>
                      <li>{spec.maxConcurrentAgents} agents at once</li>
                      <li>{spec.seats} seats</li>
                      <li>{spec.modelBilling === "byok_required" ? "Your Anthropic key" : "Credits or your key"}</li>
                    </ul>
                    {!current ? (
                      <Button size="sm" className="mt-3" variant="default" disabled={!isOwner} loading={changeTier.isPending && changeTier.variables?.tier === tier} onClick={() => changeTier.mutate({ businessId, tier })}>
                        {isOwner ? "Choose" : "Owner only"}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Hint>Third-party spend (ads, postage, SendGrid, registry fees) is billed by each provider to your own accounts and never resold.</Hint>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Credits" loading={plan.isLoading}>
        <div className="flex items-center gap-3">
          <SimpleSelect aria-label="Top-up amount" controlSize="sm" value={amount} onValueChange={setAmount} options={TOP_UP_OPTIONS.map((a) => ({ value: String(a), label: formatMoney({ amountMinor: a, currency }) }))} className="w-40" />
          <Button variant="primary" icon={Coins} disabled={!isOwner} loading={topUp.isPending} onClick={() => topUp.mutate({ businessId, amountMinor: Number(amount), currency })}>
            Top up
          </Button>
        </div>
        <Hint>Paying is a hard gate: in live mode you complete the payment yourself and the webhook grants the credits. In mock mode credits are granted and labelled.</Hint>
      </SettingsSection>

      <SettingsSection title="Usage" loading={usage.isLoading} error={usage.error ? errorMessage(usage.error) : undefined} onRetry={() => void usage.refetch()} actions={<ProvenanceChip kind="estimate" />}>
        {usage.data ? (
          <div className="grid grid-cols-2 gap-4">
            <MiniTable
              aria-label="Usage by agent"
              caption={`By agent · ${usage.data.period} · Estimate`}
              columns={[
                { id: "agent", header: "Agent", cell: (r) => r.name ?? "Platform" },
                { id: "tokens", header: "Tokens", numeric: true, cell: (r) => r.tokens.toLocaleString() },
                { id: "calls", header: "Tool calls", numeric: true, cell: (r) => r.toolCalls.toLocaleString() },
                { id: "cost", header: "Cost", numeric: true, cell: (r) => formatMoney({ amountMinor: r.costMinor, currency }) },
              ]}
              rows={usage.data.byAgent}
              getRowKey={(r, i) => r.agentId ?? `platform-${i}`}
              maxRows={12}
              emptyText="No usage this period."
            />
            <MiniTable
              aria-label="Usage by department"
              caption={`By department · ${usage.data.period} · Estimate`}
              columns={[
                { id: "dept", header: "Department", cell: (r) => r.name },
                { id: "cost", header: "Cost", numeric: true, cell: (r) => formatMoney({ amountMinor: r.costMinor, currency }) },
              ]}
              rows={usage.data.byDepartment}
              getRowKey={(r) => r.departmentId}
              maxRows={12}
              emptyText="No usage this period."
            />
          </div>
        ) : null}
      </SettingsSection>
    </>
  );
}
