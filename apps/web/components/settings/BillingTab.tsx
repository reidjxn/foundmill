"use client";
/**
 * Settings › Billing (BUILD §10.5, §11.15): tier (prices are open decisions → PRICE_TBA_LABEL; paid tiers cannot be
 * chosen until they have one), credits, usage by agent and by department (every number an Estimate), and top-ups.
 *
 * A top-up is a real checkout (audit 2026-10-12 #22): Top up asks the API for a Stripe Checkout session and sends the
 * founder to Stripe's page; Stripe sends them back here with `?checkout=<id>` and the checkout panel follows the
 * payment until the webhook has granted the credits. In mock mode the page is this tab itself: the panel offers the
 * simulated payment (labeled; no money moves).
 *
 * Credits and model costs are US dollars (`CREDITS_CURRENCY`, the model price list's currency), whatever the business's
 * own currency: they are never shown with the business's symbol. Third-party spend booked in another currency (tool
 * calls billed by each provider) is listed apart, never added to the US dollar total.
 *
 * Every business holds credits (SEC2): on its own key they pay only for conversations, Refresh and planning, which run
 * on the platform's key, and the tab says so; credits from a mock top-up are labeled and never pay for live calls.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Coins, CreditCard, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME, CREDITS_CURRENCY, includedCreditsMinor, PRICE_TBA_LABEL, TIERS, type TierKey } from "@foundmill/config";
import { Button, Chip, IconButton, KeyValueList, MiniTable, ProvenanceChip, SimpleSelect, StatusPill, formatCompact, useDateFormat, type DateFormatPrefs, type StatusTone } from "@foundmill/dugout";
import { PLAN_TIERS } from "@foundmill/shared/constants";
import { formatMoney, formatMonthYear, formatNumber, plainWords, plural } from "@/lib/format";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
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

/** Top-up amounts in US cents (the API's `billing.plan.topUp.options` are the amounts offered; these stand in while it loads). */
const TOP_UP_OPTIONS = [2500, 5000, 10000, 25000] as const;

/** How model calls are paid for, in words. */
export const MODEL_BILLING_WORD: Record<string, string> = {
  byok: "Your Anthropic key",
  credits: `${APP_NAME} credits`,
  byok_required: "Your Anthropic key",
  credits_or_byok: "Credits or your Anthropic key",
};

/** "2026-10" → "October 2026" ("2026-10" for ISO `prefs`); anything else is shown as it is. */
export function periodLabel(period: string, prefs?: DateFormatPrefs | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return formatMonthYear(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)), { long: true }, prefs);
}

/** "$5.00 of model credits a month" ("to be announced, at least $5.00" while a paid tier's size is open). */
export function includedCreditsFact(tier: TierKey): string {
  const amount = formatMoney({ amountMinor: includedCreditsMinor(tier), currency: CREDITS_CURRENCY });
  return typeof TIERS[tier].includedCreditsMinor === "number" ? `${amount} of model credits a month` : `Monthly credits to be announced (at least ${amount})`;
}

/** What a tier includes, in plain words with correct plurals ("1 business", "3 seats", "Unlimited businesses"). */
export function tierFacts(tier: TierKey): string[] {
  const spec = TIERS[tier];
  const businesses = typeof spec.businesses === "number" ? plural(spec.businesses, "business", "businesses") : "Unlimited businesses";
  const billing: string = spec.modelBilling;
  return [businesses, `${plural(spec.maxConcurrentAgents, "agent")} at once`, plural(spec.seats, "seat"), includedCreditsFact(tier), billing === "byok_required" ? "Your Anthropic key" : "Then credits or your key"];
}

type CheckoutView = RouterOutputs["billing"]["checkout"]["status"]["checkout"];

/** What the checkout panel says about a checkout, in words (the founder came back from Stripe, or is paying in mock mode). */
export function checkoutNotice(checkout: Pick<CheckoutView, "status" | "mode" | "amountMinor" | "currency" | "failure">, opts: { canceled?: boolean; waitedLong?: boolean } = {}): { tone: StatusTone; word: string; text: string } {
  const amount = formatMoney({ amountMinor: checkout.amountMinor, currency: checkout.currency });
  switch (checkout.status) {
    case "paid":
      return { tone: "good", word: "Paid", text: checkout.mode === "mock" ? `${amount} in credits added. Mock top-up: no money moved.` : `${amount} in credits added. Stripe sends the receipt to your email.` };
    case "failed":
      return { tone: "bad", word: "Not paid", text: checkout.failure ?? "This checkout could not be opened. Nothing was charged." };
    case "expired":
      return { tone: "neutral", word: "Expired", text: "This checkout expired before it was paid. Nothing was charged." };
    default:
      if (opts.canceled) return { tone: "neutral", word: "Canceled", text: `Checkout canceled: nothing was charged. Top up again whenever you like.` };
      if (checkout.mode === "mock") return { tone: "info", word: "Mock checkout", text: `${amount} in credits. This server simulates payments: no money moves, and the credits are labeled as a mock top-up.` };
      return opts.waitedLong
        ? { tone: "warn", word: "Waiting", text: `Stripe has not confirmed the payment of ${amount} yet. The credits appear here once it does; you can leave this page.` }
        : { tone: "info", word: "Confirming", text: `Confirming your payment of ${amount} with Stripe…` };
  }
}

/** How long the panel polls a live checkout for Stripe's confirmation before it says it is still waiting. */
const CONFIRM_POLL_MS = 2_000;
const CONFIRM_WAIT_MS = 60_000;

/** The checkout the founder came back to (or is paying in mock mode): follows it until it is settled. */
function CheckoutPanel({ checkoutId, canceled, onDone }: { checkoutId: string; canceled: boolean; onDone: () => void }) {
  const { businessId, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  // After a minute without Stripe's confirmation the panel stops polling and says it is still waiting.
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedLong(true), CONFIRM_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const status = useQuery(
    trpc.billing.checkout.status.queryOptions(
      { businessId, checkoutId },
      {
        // A live checkout is settled by Stripe's webhook a moment after the founder lands here: poll until it is.
        refetchInterval: (q) => (q.state.data?.checkout.status === "open" && q.state.data.checkout.mode === "live" && !canceled && !waitedLong ? CONFIRM_POLL_MS : false),
      },
    ),
  );
  const complete = useMutation(
    trpc.billing.checkout.completeMock.mutationOptions({
      // Credits back after they ran out: the team resumes by itself, and the toast says so.
      onSuccess: (r) => (void invalidate(["billing", "business", "team"]), t.saved("Credits added", r.resumed ? `${r.label}. ${r.resumed.agents} agent${r.resumed.agents === 1 ? "" : "s"} resumed.` : r.label)),
      onError: (e) => t.failed(e, "Not paid"),
    }),
  );
  const checkout = complete.data?.checkout ?? status.data?.checkout;
  if (status.error) return <ErrorPanel title="Checkout" message={errorMessage(status.error)} onRetry={() => void status.refetch()} />;
  if (!checkout) return <SettingsSection title="Checkout" loading>{null}</SettingsSection>;
  const notice = checkoutNotice(checkout, { canceled, waitedLong });
  const payable = checkout.status === "open" && checkout.mode === "mock" && !canceled;
  return (
    <SettingsSection title="Checkout" meta={formatMoney({ amountMinor: checkout.amountMinor, currency: checkout.currency })} actions={<IconButton label="Close the checkout panel" icon={X} size="sm" onClick={onDone} />}>
      <div className="flex flex-col gap-3" data-testid="checkout-panel" data-status={checkout.status}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={notice.tone}>{notice.word}</StatusPill>
          {checkout.mode === "mock" ? <Chip tone="info">No money moves</Chip> : null}
        </div>
        <p className="text-body text-primary">{notice.text}</p>
        {payable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={CreditCard} disabled={!isOwner} loading={complete.isPending} onClick={() => complete.mutate({ businessId, checkoutId })}>
              {isOwner ? `Complete mock payment of ${formatMoney({ amountMinor: checkout.amountMinor, currency: checkout.currency })}` : "Owner only"}
            </Button>
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}

export function BillingTab() {
  const datePrefs = useDateFormat();
  const { businessId, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const plan = useQuery(trpc.billing.plan.queryOptions({ businessId }));
  const usage = useQuery(trpc.billing.usage.queryOptions({ businessId }));
  const changeTier = useMutation(trpc.billing.changeTier.mutationOptions({ onSuccess: () => (void invalidate(["billing", "business"]), t.saved("Tier changed")), onError: (e) => t.failed(e) }));
  // Back from Stripe (or into the simulated checkout): `?checkout=<id>[&canceled=1]`.
  const returnedCheckout = /^[0-9a-f-]{36}$/i.test(search?.get("checkout") ?? "") ? search!.get("checkout")! : null;
  const canceled = search?.get("canceled") === "1";
  const billingPath = pathname ?? `/b/${businessId}/settings/billing`;
  const closeCheckout = () => (void invalidate(["billing"]), router.replace(billingPath));
  const topUp = useMutation(
    trpc.billing.topUp.mutationOptions({
      onSuccess: (r) => {
        // Live: Stripe's own page. Mock: the simulated checkout is this tab.
        if (r.mode === "live") window.location.assign(r.checkoutUrl);
        else router.replace(`${billingPath}?checkout=${r.checkout.id}`);
      },
      onError: (e) => t.failed(e, "Checkout not opened"),
    }),
  );
  const [amount, setAmount] = useState<string>(String(TOP_UP_OPTIONS[1]));

  if (plan.error) return <ErrorPanel title="Billing" message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />;
  const p = plan.data;
  // Credits and model costs are US dollars, never the business's currency.
  const currency = p?.creditsCurrency ?? CREDITS_CURRENCY;
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency });
  const tierChange = (tier: TierKey) => p?.tierChanges.find((c) => c.tier === tier);
  const closedTiers = PLAN_TIERS.filter((tier) => tier !== p?.tier && tierChange(tier)?.available === false);
  const topUpOptions = p?.topUp.options ?? TOP_UP_OPTIONS;

  return (
    <>
      {returnedCheckout ? <CheckoutPanel key={returnedCheckout} checkoutId={returnedCheckout} canceled={canceled} onDone={closeCheckout} /> : null}
      <SettingsSection wide title="Plan" meta={p ? periodLabel(p.period, datePrefs) : undefined} loading={plan.isLoading}>
        {p ? (
          <>
            <KeyValueList
              items={[
                { label: "Tier", value: <span className="flex flex-wrap items-center gap-2">{plainWords(p.tier)} <Chip tone="neutral">{tierPriceLabel(p.tier)}</Chip></span> },
                { label: "Model calls", value: MODEL_BILLING_WORD[p.modelBilling] ?? plainWords(p.modelBilling) },
                {
                  label: "Credits",
                  value: (
                    <span className="inline-flex flex-wrap items-center gap-2" data-testid="credits-balance">
                      {money(p.credits.balanceMinor)} left of {money(p.credits.grantedMinor)} <ProvenanceChip kind="estimate" />
                      {p.credits.mockMinor > 0 ? <Chip tone="info">{money(p.credits.mockMinor)} from mock top-ups</Chip> : null}
                      {p.credits.exhausted ? <Chip tone="bad">{p.modelBilling === "byok" ? "Used up: conversations and Refresh paused" : "Used up: team paused"}</Chip> : null}
                    </span>
                  ),
                  numeric: true,
                },
                {
                  label: "Spent this month",
                  value: (
                    <span className="inline-flex flex-wrap items-center gap-2" data-testid="spent-this-month">
                      {money(p.usage.costMinor)} <ProvenanceChip kind="estimate" />
                      {p.usage.otherCurrencies.length ? <span className="text-small text-secondary">plus {p.usage.otherCurrencies.map((o) => formatMoney({ amountMinor: o.costMinor, currency: o.currency })).join(" and ")} billed by providers</span> : null}
                    </span>
                  ),
                  numeric: true,
                },
              ]}
            />
            <div className="grid grid-cols-3 gap-3">
              {PLAN_TIERS.map((tier) => {
                const current = tier === p.tier;
                const open = tierChange(tier)?.available !== false;
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
                      <Button size="sm" className="mt-auto self-start" variant="default" disabled={!isOwner || !open} title={open ? undefined : (tierChange(tier)?.reason ?? undefined)} loading={changeTier.isPending && changeTier.variables?.tier === tier} onClick={() => changeTier.mutate({ businessId, tier })}>
                        {!open ? "Not on sale yet" : isOwner ? `Choose ${plainWords(tier)}` : "Owner only"}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {closedTiers.length ? <Hint>{tierChange(closedTiers[0]!)?.reason}</Hint> : null}
            {p.modelBilling === "byok" ? (
              <Hint>Your agents run on your own Anthropic key. Conversations, Refresh and planning run on {APP_NAME}&apos;s key and use these credits; when they run out, those wait for a top-up or next month&apos;s credits.</Hint>
            ) : null}
            {p.credits.includedMinor === 0 && includedCreditsMinor(p.tier) > 0 ? <Hint>This month&apos;s included credits already went to another business you took charge of: your plan includes them for as many businesses a month as it holds.</Hint> : null}
            {p.credits.mockMinor > 0 ? <Hint>Credits from mock top-ups pay for simulated model calls only, never for live ones.</Hint> : null}
            <Hint>Third-party spend (ads, postage, email sending, registry fees) is billed by each provider to your own accounts and never resold.</Hint>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Credits" meta={CREDITS_CURRENCY} loading={plan.isLoading}>
        <div className="flex flex-wrap items-center gap-3">
          <SimpleSelect aria-label="Top-up amount" controlSize="sm" value={amount} onValueChange={setAmount} options={topUpOptions.map((a) => ({ value: String(a), label: money(a) }))} className="w-40" />
          <Button variant="primary" icon={Coins} disabled={!isOwner || p?.topUp.available === false} loading={topUp.isPending} onClick={() => topUp.mutate({ businessId, amountMinor: Number(amount), currency: CREDITS_CURRENCY })} data-testid="top-up">
            {isOwner ? "Top up" : "Owner only"}
          </Button>
          {p?.topUp.mode === "mock" && p.topUp.available ? <Chip tone="info">Mock payments</Chip> : null}
        </div>
        {p?.topUp.available === false ? (
          <Hint>{p.topUp.reason}</Hint>
        ) : p?.topUp.mode === "mock" ? (
          <Hint>Credits are in US dollars and pay for model calls on {APP_NAME}&apos;s key. Your plan includes {p ? money(p.includedCreditsMinor) : "some"} a month; when they run out the team pauses until you top up or add your own Anthropic key in Settings › Keys. This server simulates payments: Top up opens a mock checkout here, no money moves, and the credits are labeled as a mock top-up.</Hint>
        ) : (
          <Hint>Credits are in US dollars, the currency model prices are listed in, and pay for model calls on {APP_NAME}&apos;s key. Your plan includes {p ? money(p.includedCreditsMinor) : "some"} a month; when they run out the team pauses until you top up or add your own Anthropic key in Settings › Keys. You pay on Stripe&apos;s secure page; the credits arrive once Stripe confirms the payment.</Hint>
        )}
      </SettingsSection>

      <SettingsSection wide title="Usage" meta={usage.data ? periodLabel(usage.data.period, datePrefs) : undefined} loading={usage.isLoading} error={usage.error ? errorMessage(usage.error) : undefined} onRetry={() => void usage.refetch()} actions={<ProvenanceChip kind="estimate" />}>
        {usage.data ? (
          <div className="grid grid-cols-12 items-start gap-4">
            <MiniTable
              className="col-span-7"
              aria-label="Usage by agent"
              caption={`By agent · ${periodLabel(usage.data.period, datePrefs)} · Estimate`}
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
              caption={`By department · ${periodLabel(usage.data.period, datePrefs)} · Estimate`}
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
