"use client";
/**
 * Settings › Billing (BUILD §10.5, §11.15): tier (prices are open decisions → PRICE_TBA_LABEL), credits, usage by
 * agent and by department (every number an Estimate), top-ups (mock grants credits; live never moves money here).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useState } from "react";
import { APP_NAME, PRICE_TBA_LABEL, TIERS, type TierKey } from "@foundmill/config";
import { Button, Chip, KeyValueList, MiniTable, ProvenanceChip, SimpleSelect, formatCompact } from "@foundmill/dugout";
import { PLAN_TIERS } from "@foundmill/shared/constants";
import { formatMoney, formatMonthYear, formatNumber, plainWords, plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
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

/** How model calls are paid for, in words. */
export const MODEL_BILLING_WORD: Record<string, string> = {
  byok: "Your Anthropic key",
  credits: `${APP_NAME} credits`,
  byok_required: "Your Anthropic key",
  credits_or_byok: "Credits or your Anthropic key",
};

/** "2026-10" → "October 2026"; anything else is shown as it is. */
export function periodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return formatMonthYear(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)), { long: true });
}

/** What a tier includes, in plain words with correct plurals ("1 business", "3 seats", "Unlimited businesses"). */
export function tierFacts(tier: TierKey): string[] {
  const spec = TIERS[tier];
  const businesses = typeof spec.businesses === "number" ? plural(spec.businesses, "business", "businesses") : "Unlimited businesses";
  return [businesses, `${plural(spec.maxConcurrentAgents, "agent")} at once`, plural(spec.seats, "seat"), spec.modelBilling === "byok_required" ? "Your Anthropic key" : "Credits or your key"];
}

export function BillingTab() {
  const { businessId, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const businessCurrency = useBusinessCurrency();
  const plan = useQuery(trpc.billing.plan.queryOptions({ businessId }));
  const usage = useQuery(trpc.billing.usage.queryOptions({ businessId }));
  const changeTier = useMutation(trpc.billing.changeTier.mutationOptions({ onSuccess: () => (void invalidate(["billing", "business"]), t.saved("Tier changed")), onError: (e) => t.failed(e) }));
  const topUp = useMutation(trpc.billing.topUp.mutationOptions({ onSuccess: (r) => (void invalidate(["billing"]), r.granted ? t.saved("Credits added", r.label) : t.info("Payment is yours to make", r.label)), onError: (e) => t.failed(e) }));
  const [amount, setAmount] = useState<string>(String(TOP_UP_OPTIONS[1]));

  if (plan.error) return <ErrorPanel title="Billing" message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />;
  const p = plan.data;
  // Credits keep their own currency once granted; everything else is in the business's currency.
  const currency = p?.balance?.currency ?? businessCurrency;

  return (
    <>
      <SettingsSection wide title="Plan" meta={p ? periodLabel(p.period) : undefined} loading={plan.isLoading}>
        {p ? (
          <>
            <KeyValueList
              items={[
                { label: "Tier", value: <span className="flex flex-wrap items-center gap-2">{plainWords(p.tier)} <Chip tone="neutral">{tierPriceLabel(p.tier)}</Chip></span> },
                { label: "Model calls", value: MODEL_BILLING_WORD[p.modelBilling] ?? plainWords(p.modelBilling) },
                { label: "Credits", value: p.balance ? formatMoney({ amountMinor: p.balance.balanceMinor, currency: p.balance.currency }) : "No credits this month", numeric: true },
                { label: "Spent this month", value: <span className="inline-flex items-center gap-2">{formatMoney({ amountMinor: p.usage.costMinor, currency })} <ProvenanceChip kind="estimate" /></span>, numeric: true },
              ]}
            />
            <div className="grid grid-cols-3 gap-3">
              {PLAN_TIERS.map((tier) => {
                const current = tier === p.tier;
                return (
                  <div key={tier} className={`flex flex-col gap-2 rounded-md border p-3 ${current ? "border-kit-lift/60 bg-kit-primary/8" : "border-line"}`} data-tier={tier}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="t-display-sm">{plainWords(tier)}</span>
                      {current ? <Chip tone="kit">Current</Chip> : null}
                    </div>
                    <p className="text-small text-secondary">{tierPriceLabel(tier) === plainWords(tier) ? "No monthly fee" : tierPriceLabel(tier)}</p>
                    <ul className="flex flex-col gap-0.5 text-small text-primary">
                      {tierFacts(tier).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    {!current ? (
                      <Button size="sm" className="mt-auto self-start" variant="default" disabled={!isOwner} loading={changeTier.isPending && changeTier.variables?.tier === tier} onClick={() => changeTier.mutate({ businessId, tier })}>
                        {isOwner ? `Choose ${plainWords(tier)}` : "Owner only"}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Hint>Third-party spend (ads, postage, email sending, registry fees) is billed by each provider to your own accounts and never resold.</Hint>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Credits" loading={plan.isLoading}>
        <div className="flex flex-wrap items-center gap-3">
          <SimpleSelect aria-label="Top-up amount" controlSize="sm" value={amount} onValueChange={setAmount} options={TOP_UP_OPTIONS.map((a) => ({ value: String(a), label: formatMoney({ amountMinor: a, currency }) }))} className="w-40" />
          <Button variant="primary" icon={Coins} disabled={!isOwner} loading={topUp.isPending} onClick={() => topUp.mutate({ businessId, amountMinor: Number(amount), currency })}>
            Top up
          </Button>
        </div>
        <Hint>Paying is always yours to do: you complete the payment yourself and the credits arrive once it clears. In test mode no money moves: credits are granted at once and labeled as such.</Hint>
      </SettingsSection>

      <SettingsSection wide title="Usage" meta={usage.data ? periodLabel(usage.data.period) : undefined} loading={usage.isLoading} error={usage.error ? errorMessage(usage.error) : undefined} onRetry={() => void usage.refetch()} actions={<ProvenanceChip kind="estimate" />}>
        {usage.data ? (
          <div className="grid grid-cols-12 items-start gap-4">
            <MiniTable
              className="col-span-7"
              aria-label="Usage by agent"
              caption={`By agent · ${periodLabel(usage.data.period)} · Estimate`}
              columns={[
                { id: "agent", header: "Agent", cell: (r) => <span title={r.name ?? "Platform"}>{r.name ?? "Platform"}</span> },
                { id: "tokens", header: "Tokens", numeric: true, cell: (r) => formatCompact(r.tokens) },
                { id: "calls", header: "Tool calls", numeric: true, cell: (r) => formatNumber(r.toolCalls) },
                { id: "cost", header: "Cost", numeric: true, cell: (r) => formatMoney({ amountMinor: r.costMinor, currency }) },
              ]}
              rows={usage.data.byAgent}
              getRowKey={(r, i) => r.agentId ?? `platform-${i}`}
              maxRows={12}
              emptyText="No usage this month."
            />
            <MiniTable
              className="col-span-5"
              aria-label="Usage by department"
              caption={`By department · ${periodLabel(usage.data.period)} · Estimate`}
              columns={[
                { id: "dept", header: "Department", cell: (r) => r.name },
                { id: "cost", header: "Cost", numeric: true, cell: (r) => formatMoney({ amountMinor: r.costMinor, currency }) },
              ]}
              rows={usage.data.byDepartment}
              getRowKey={(r) => r.departmentId}
              maxRows={12}
              emptyText="No usage this month."
            />
          </div>
        ) : null}
      </SettingsSection>
    </>
  );
}
