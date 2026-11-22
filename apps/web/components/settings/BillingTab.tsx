"use client";
/**
 * Settings › Billing (BUILD §10.5, §11.15): the plan and the four plans (Try, Founder, Studio and Partner: names,
 * prices, projects, budgets and what each includes are config, packages/config pricing.ts, WP-14 T14; every label
 * follows `EARLY_ACCESS_STAGE`, so while sign-up is invite-only each plan reads "Free while in early access" and nothing
 * says it stays free), credits, usage by agent and by department (every number an Estimate), and top-ups.
 *
 * Founder and Studio cannot be chosen until they are on sale (the api says why); going back to Try is one press, as
 * choosing a plan is. Partner is by application: its only action is joining its waitlist, with consent, and it charges
 * nothing.
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
 * Paid entry (WP-09 T16): while the server's `PAID_ENTRY` is on, `billing.plan.entryPlan` is set, and the tab leads
 * with the entry plan (Subscribe sends the owner to Stripe's page; mock mode, to the simulated checkout here) and sells
 * credits as the packs, each with the credits it carries (an Estimate until the price per credit is set).
 *
 * Every business holds credits (SEC2): on its own key they pay only for conversations, Refresh and planning, which run
 * on the platform's key, and the tab says so; credits from a mock top-up are labeled and never pay for live calls.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Coins, CreditCard, Handshake, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME, CREDIT_PACK_UNLOCK_MIN_MINOR, CREDITS_CURRENCY, EARLY_ACCESS_STAGE, ENTRY_PLAN, includedCreditsMinor, INVITED_FOUNDERS_LINE, PARTNER_PLAN, PLAN_FEATURE_WORDS, planAdds, planName, planPriceLabel, tierIncludedCreditPlaces, TIER_ORDER, TIERS, TOP_UP_OPTIONS_MINOR, type EarlyAccessStage, type TierKey } from "@foundmill/config";
import { Button, Checkbox, Chip, IconButton, KeyValueList, MiniTable, ProvenanceChip, SimpleSelect, StatusPill, Term, formatCompact, useBuilderView, useDateFormat, type DateFormatPrefs, type StatusTone } from "@foundmill/dugout";
import { PLAN_TIERS } from "@foundmill/shared/constants";
import { formatDate, formatMoney, formatMonthYear, formatNumber, plainWords, plural } from "@/lib/format";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { useInvalidateRouters } from "./SettingsScreen";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

/** "Free while in early access" now; the plan's monthly price from the day sign-up opens. */
export function tierPriceLabel(tier: TierKey, stage: EarlyAccessStage = EARLY_ACCESS_STAGE): string {
  return planPriceLabel(tier, stage);
}

/** Top-up amounts in US cents (the API's `billing.plan.topUp.options` are the amounts offered; these stand in while it loads). */
const TOP_UP_OPTIONS = TOP_UP_OPTIONS_MINOR;

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

/** "$5.00 of credits a month": the plan's team budget, in credits' own currency. */
export function includedCreditsFact(tier: TierKey): string {
  return `${formatMoney({ amountMinor: includedCreditsMinor(tier), currency: CREDITS_CURRENCY })} of credits a month`;
}

/**
 * How a plan reaches Opus and Sonnet, true of the stage: Founder and Studio have them; Try reaches them on the founder's
 * own Anthropic key, and from the day sign-up opens by a credit pack as well.
 */
export function modelsFact(tier: TierKey, stage: EarlyAccessStage = EARLY_ACCESS_STAGE): string {
  if (TIERS[tier].claudeModels) return "Opus and Sonnet included";
  const pack = formatMoney({ amountMinor: CREDIT_PACK_UNLOCK_MIN_MINOR, currency: CREDITS_CURRENCY }).replace(/\.00$/, "");
  return stage === "open" ? `Opus and Sonnet with a credit pack of ${pack} or more, or your own Anthropic key` : "Opus and Sonnet on your own Anthropic key";
}

/**
 * What a plan includes, in plain words: projects (a plan limits projects, never people), agents at once, people, the
 * month's credits and the models. The features a plan adds are listed apart (`planAdds`).
 */
export function tierFacts(tier: TierKey, stage: EarlyAccessStage = EARLY_ACCESS_STAGE): string[] {
  const spec = TIERS[tier];
  const limit: number | string = spec.businesses;
  const projects = typeof limit !== "number" ? "Any number of projects" : limit === 1 ? "1 project" : `Up to ${limit} projects`;
  return [projects, `${plural(spec.maxConcurrentAgents, "agent")} at once`, "As many people as you like", includedCreditsFact(tier), modelsFact(tier, stage)];
}

export interface TeamBudgetView {
  outcomes: number;
  costPerOutcomeMinor: number;
  enoughFor: number;
}

/**
 * Billing's first line (WP-14 T3). With a pace to read: "This month's team budget: enough for about 12 more outcomes at
 * your current pace" (an Estimate, marked beside it). With none yet, the label alone: the dollar balance beneath is all
 * there is to say, and no number is made up.
 */
export function teamBudgetLine(budget: TeamBudgetView | null | undefined): string {
  if (!budget) return "This month's team budget";
  if (budget.enoughFor < 1) return "This month's team budget: less than one more outcome at your current pace";
  return `This month's team budget: enough for about ${plural(budget.enoughFor, "more outcome")} at your current pace`;
}

/** "About $0.30 an outcome so far this month (4 outcomes)": on Billing only, never on Today. */
export function costPerOutcomeLine(budget: TeamBudgetView, money: (minor: number) => string): string {
  return `About ${money(budget.costPerOutcomeMinor)} an outcome so far this month (${plural(budget.outcomes, "outcome")}). An outcome is a real result outside the project: your page live, an email sent, a follower, a reply or a payment.`;
}

/** "Adds Vacation mode, Card sharing, …" for a plan that adds features over the one below it; null for Try. */
export function tierAddsLine(tier: TierKey): string | null {
  const adds = planAdds(tier);
  if (!adds.length) return null;
  const below = planName(TIER_ORDER[TIER_ORDER.indexOf(tier) - 1] ?? "free");
  return `Everything in ${below}, and: ${adds.map((f) => PLAN_FEATURE_WORDS[f]).join(", ")}`;
}

type CheckoutView = RouterOutputs["billing"]["checkout"]["status"]["checkout"];

/** What the checkout panel says about a checkout, in words (the founder came back from Stripe, or is paying in mock mode). */
export function checkoutNotice(checkout: Pick<CheckoutView, "status" | "mode" | "amountMinor" | "currency" | "failure"> & { kind?: "credits" | "subscription" | "domain"; creditsMinor?: number | null }, opts: { canceled?: boolean; waitedLong?: boolean } = {}): { tone: StatusTone; word: string; text: string } {
  const amount = formatMoney({ amountMinor: checkout.amountMinor, currency: checkout.currency });
  if (checkout.kind === "subscription") return subscriptionNotice(checkout, amount, opts);
  // A domain's payment (0150) finishes in Settings › Integrations, where the domain is registered.
  if (checkout.kind === "domain") return checkout.status === "paid" ? { tone: "good", word: "Paid", text: `${amount} for a domain, registered in Settings › Integrations.` } : { tone: "neutral", word: "Domain", text: `${amount} for a domain. Its payment and registration are in Settings › Integrations.` };
  const credits = checkout.creditsMinor ? formatMoney({ amountMinor: checkout.creditsMinor, currency: checkout.currency }) : null;
  if (credits && checkout.status === "paid") return { tone: "good", word: "Paid", text: checkout.mode === "mock" ? `${credits} in credits added for ${amount}. Mock top-up: no money moved.` : `${credits} in credits added for ${amount}. Stripe sends the receipt to your email.` };
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

/** `checkoutNotice` for the entry plan's checkout (a subscription). */
function subscriptionNotice(checkout: Pick<CheckoutView, "status" | "mode" | "failure">, amount: string, opts: { canceled?: boolean; waitedLong?: boolean }): { tone: StatusTone; word: string; text: string } {
  switch (checkout.status) {
    case "paid":
      return { tone: "good", word: "Subscribed", text: checkout.mode === "mock" ? `Your ${ENTRY_PLAN.name} plan is on and your team can start. Mock subscription: no money moved.` : `Your ${ENTRY_PLAN.name} plan is on and your team can start. Stripe sends the receipt to your email.` };
    case "failed":
      return { tone: "bad", word: "Not subscribed", text: checkout.failure ?? "This checkout could not be opened. Nothing was charged." };
    case "expired":
      return { tone: "neutral", word: "Expired", text: "This checkout expired before it was paid. Nothing was charged." };
    default:
      if (opts.canceled) return { tone: "neutral", word: "Canceled", text: "Checkout canceled: nothing was charged. Subscribe whenever you like." };
      if (checkout.mode === "mock") return { tone: "info", word: "Mock checkout", text: `${ENTRY_PLAN.name} plan, ${amount} a month. This server simulates payments: no money moves.` };
      return opts.waitedLong
        ? { tone: "warn", word: "Waiting", text: "Stripe has not confirmed the subscription yet. Your plan turns on here once it does; you can leave this page." }
        : { tone: "info", word: "Confirming", text: "Confirming your subscription with Stripe…" };
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
      onSuccess: (r) => (void invalidate(["billing", "business", "team", "cycle"]), r.continued?.started ? t.saved(r.subscribed ? "Subscribed: the team started" : "Credits added: the team started", r.continued.summary ?? r.label) : r.subscribed ? t.saved("Subscribed", r.label) : t.saved("Credits added", r.resumed ? `${r.label}. ${r.resumed.agents} agent${r.resumed.agents === 1 ? "" : "s"} resumed.` : r.label)),
      onError: (e) => t.failed(e, "Not paid"),
    }),
  );
  const checkout = complete.data?.checkout ?? status.data?.checkout;
  if (loadFailed(status)) return <ErrorPanel title="Checkout" message={errorMessage(status.error)} onRetry={() => void status.refetch()} />;
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
  const builder = useBuilderView();
  const { businessId, isOwner } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const plan = useQuery(trpc.billing.plan.queryOptions({ businessId }));
  const usage = useQuery(trpc.billing.usage.queryOptions({ businessId }));
  const changeTier = useMutation(trpc.billing.changeTier.mutationOptions({ onSuccess: () => (void invalidate(["billing", "business"]), t.saved("Plan changed")), onError: (e) => t.failed(e) }));
  const joinPartner = useMutation(trpc.billing.partner.join.mutationOptions({ onSuccess: () => (void invalidate(["billing"]), t.saved("You're on the Partner waitlist")), onError: (e) => t.failed(e) }));
  const [partnerConsent, setPartnerConsent] = useState(false);
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
  // Canceling is one press, as subscribing is (founder, Nov 18, 2026): Stripe's own page, or the simulated cancel here.
  const manage = useMutation(
    trpc.billing.manage.mutationOptions({
      onSuccess: (r) => (r.url ? window.location.assign(r.url) : (void invalidate(["billing", "business"]), t.saved("Plan canceled", r.label ?? undefined))),
      onError: (e) => t.failed(e, "Billing page not opened"),
    }),
  );
  const subscribe = useMutation(
    trpc.billing.subscribe.mutationOptions({
      onSuccess: (r) => {
        if (r.mode === "live") window.location.assign(r.checkoutUrl);
        else router.replace(`${billingPath}?checkout=${r.checkout.id}`);
      },
      onError: (e) => t.failed(e, "Checkout not opened"),
    }),
  );
  const [amount, setAmount] = useState<string>(String(TOP_UP_OPTIONS[1]));

  if (loadFailed(plan)) return <ErrorPanel title="Billing" message={errorMessage(plan.error)} onRetry={() => void plan.refetch()} />;
  const p = plan.data;
  // Credits and model costs are US dollars, never the business's currency.
  const currency = p?.creditsCurrency ?? CREDITS_CURRENCY;
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency });
  const tierChange = (tier: TierKey) => p?.tierChanges.find((c) => c.tier === tier);
  const closedTiers = PLAN_TIERS.filter((tier) => tier !== p?.tier && tierChange(tier)?.available === false);
  const topUpOptions: readonly number[] = p?.topUp.options ?? TOP_UP_OPTIONS;
  // The packs (paid entry) do not hold the free amounts' default: start on the first one offered.
  const chosen = topUpOptions.includes(Number(amount)) ? amount : String(topUpOptions[0] ?? amount);
  const entry = p?.entryPlan ?? null;
  const packCredits = (priceMinor: number) => entry?.packs.find((k) => k.priceMinor === priceMinor)?.creditsMinor ?? null;

  return (
    <>
      {refreshFailed(plan) ? <RefreshFailedNotice query={plan} className="flex items-center gap-2" /> : null}
      {returnedCheckout ? <CheckoutPanel key={returnedCheckout} checkoutId={returnedCheckout} canceled={canceled} onDone={closeCheckout} /> : null}
      {entry ? (
        <SettingsSection title={`${entry.name} plan`} meta={`${money(entry.priceMonthlyMinor)} a month`}>
          <div className="flex flex-col gap-3" data-testid="entry-plan" data-open={entry.open ? "true" : "false"}>
            <div className="flex flex-wrap items-center gap-2">
              {entry.open ? <StatusPill tone="good">On</StatusPill> : <StatusPill tone="info">Not subscribed</StatusPill>}
              {entry.mine?.status === "past_due" ? <Chip tone="warn">Payment due</Chip> : null}
              {entry.mine?.status === "canceled" ? <Chip tone="neutral">Canceled</Chip> : null}
            </div>
            <p className="text-body text-primary">
              {money(entry.priceMonthlyMinor)} a month, with {money(entry.includedCreditsMinor)} of AI included each month. Your page, plan and foundations are yours either way; your team starts by itself as soon as the payment is confirmed.
            </p>
            {!entry.open ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" icon={CreditCard} disabled={!isOwner || !entry.available} loading={subscribe.isPending} onClick={() => subscribe.mutate({ businessId, resume: "continue" })} data-testid="subscribe">
                  {isOwner ? `Subscribe for ${money(entry.priceMonthlyMinor)} a month` : "Owner only"}
                </Button>
                {p?.topUp.mode === "mock" && entry.available ? <Chip tone="info">Mock payments</Chip> : null}
              </div>
            ) : null}
            {entry.mine && entry.mine.status !== "canceled" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" loading={manage.isPending} onClick={() => manage.mutate({ businessId })} data-testid="manage-plan">
                  {entry.mine.mode === "mock" ? "Cancel plan (mock)" : "Manage or cancel"}
                </Button>
              </div>
            ) : null}
            {!entry.available ? <Hint>{p?.topUp.reason}</Hint> : <Hint>You subscribe on Stripe&apos;s secure page and can cancel any time.</Hint>}
          </div>
        </SettingsSection>
      ) : null}
      <SettingsSection wide title="Plan" meta={p ? periodLabel(p.period, datePrefs) : undefined} loading={plan.isLoading}>
        {p ? (
          <>
            {/* The team budget leads, as outcomes where there is a pace to read (WP-14 T3); the dollar balance sits beneath. */}
            <div className="flex flex-col gap-1" data-testid="team-budget" data-estimate={p.teamBudget ? "outcomes" : "none"}>
              <p className="t-display-sm flex flex-wrap items-center gap-2">
                <span data-testid="team-budget-line">{teamBudgetLine(p.teamBudget)}</span>
                {p.teamBudget ? <ProvenanceChip kind="estimate" /> : null}
              </p>
              <p className="inline-flex flex-wrap items-center gap-2 text-small text-secondary" data-testid="credits-balance">
                {money(p.credits.balanceMinor)} left of {money(p.credits.grantedMinor)} <ProvenanceChip kind="estimate" />
                {p.credits.mockMinor > 0 ? <Chip tone="info">{money(p.credits.mockMinor)} from mock top-ups</Chip> : null}
                {p.resting ? (
                  <Chip tone="warn" data-testid="resting">
                    <Term id="resting">Resting</Term> until {formatDate(p.resting.until, datePrefs)}
                    {p.modelBilling === "byok" ? ": conversations and Refresh" : null}
                  </Chip>
                ) : null}
              </p>
              {p.teamBudget ? (
                <p className="inline-flex flex-wrap items-center gap-2 text-small text-secondary" data-testid="cost-per-outcome">
                  {costPerOutcomeLine(p.teamBudget, money)} <ProvenanceChip kind="estimate" />
                </p>
              ) : null}
            </div>
            <KeyValueList
              items={[
                { label: "Plan", value: <span className="flex flex-wrap items-center gap-2" data-testid="current-plan">{planName(p.tier)} <Chip tone="neutral">{tierPriceLabel(p.tier, p.stage)}</Chip></span> },
                { label: "Model calls", value: MODEL_BILLING_WORD[p.modelBilling] ?? plainWords(p.modelBilling) },
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
            {p.atZero ? (
              <div data-testid="credits-zero">
                <Hint>
                  {p.atZero.stopped} {p.atZero.stillWorks} {p.atZero.ways}
                </Hint>
              </div>
            ) : null}
            <div className="grid grid-cols-4 gap-3" data-testid="plans">
              {PLAN_TIERS.map((tier) => {
                const current = tier === p.tier;
                const open = tierChange(tier)?.available !== false;
                const adds = tierAddsLine(tier);
                return (
                  <div key={tier} className={`flex flex-col gap-2 rounded-md border p-3 ${current ? "border-kit-lift/60 bg-kit-primary/8" : "border-line"}`} data-tier={tier}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="t-display-sm">{planName(tier)}</span>
                      {current ? <Chip tone="kit">Current</Chip> : null}
                    </div>
                    <p className="text-small text-secondary" data-testid="plan-price">{tierPriceLabel(tier, p.stage)}</p>
                    <ul className="flex flex-col gap-0.5 text-small text-primary">
                      {tierFacts(tier, p.stage).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    {adds ? <p className="text-small text-secondary">{adds}</p> : null}
                    {!current ? (
                      <Button size="sm" className="mt-auto self-start" variant="default" disabled={!isOwner || !open} title={open ? undefined : (tierChange(tier)?.reason ?? undefined)} loading={changeTier.isPending && changeTier.variables?.tier === tier} onClick={() => changeTier.mutate({ businessId, tier })}>
                        {!open ? "Not open yet" : isOwner ? `Choose ${planName(tier)}` : "Owner only"}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-tier="partner">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="t-display-sm">{PARTNER_PLAN.name}</span>
                  <Chip tone="neutral">{PARTNER_PLAN.byApplication}</Chip>
                </div>
                <p className="text-small text-secondary" data-testid="plan-price">{formatMoney({ amountMinor: PARTNER_PLAN.priceMonthlyMinor, currency: CREDITS_CURRENCY }).replace(/\.00$/, "")} / month</p>
                <ul className="flex flex-col gap-0.5 text-small text-primary">
                  <li>Everything in {planName("scale")}</li>
                  <li>{PARTNER_PLAN.adds}</li>
                </ul>
                <p className="text-small text-secondary">{PARTNER_PLAN.opens}</p>
                {p.partner.joinedAt ? (
                  <Chip tone="good" className="mt-auto self-start" data-testid="partner-joined">
                    On the Partner waitlist
                  </Chip>
                ) : (
                  <div className="mt-auto flex flex-col gap-2">
                    <label className="flex items-start gap-2 text-small text-primary">
                      <Checkbox checked={partnerConsent} onCheckedChange={(v) => setPartnerConsent(v === true)} disabled={!isOwner} aria-label="Agree to be contacted about the Partner plan" />
                      <span>{APP_NAME} may contact me about the Partner plan for this project.</span>
                    </label>
                    <Button size="sm" className="self-start" variant="default" icon={Handshake} disabled={!isOwner || !partnerConsent} loading={joinPartner.isPending} onClick={() => joinPartner.mutate({ businessId, consent: true })} data-testid="partner-join">
                      {isOwner ? PARTNER_PLAN.action : "Owner only"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {p.stage === "invite_only" ? <Hint>{INVITED_FOUNDERS_LINE} Every plan has everything listed here until sign-up opens.</Hint> : null}
            {p.resting ? (
              <Hint>
                {p.modelBilling === "byok"
                  ? `This month's budget for work on ${APP_NAME}'s key is used, so conversations, Refresh and planning rest until ${formatDate(p.resting.until, datePrefs)}, when your budget resets. Your agents keep working on your own key.`
                  : `Paused is a choice. Resting is a team out of budget until the date shown: nothing was stopped part-way, and the team picks up on ${formatDate(p.resting.until, datePrefs)}, when your budget resets${p.topUp.available ? ", after a top-up" : ""} or on your own Anthropic key in Settings › Keys. Your Inbox has the note with what was finished and what comes next.`}
              </Hint>
            ) : null}
            {closedTiers.length ? <Hint>{tierChange(closedTiers[0]!)?.reason}</Hint> : null}
            {p.modelBilling === "byok" ? (
              <Hint>Your agents run on your own Anthropic key. Conversations, Refresh and planning run on {APP_NAME}&apos;s key and use these credits; when they run out, those rest until next month&apos;s credits or a top-up.</Hint>
            ) : null}
            {p.credits.includedMinor === 0 && includedCreditsMinor(p.tier) > 0 ? <Hint>This month&apos;s included credits already went to another project you took charge of: a plan&apos;s credits go to one project a month.</Hint> : null}
            {p.credits.mockMinor > 0 ? <Hint>Credits from mock top-ups pay for simulated model calls only, never for live ones.</Hint> : null}
            <Hint>Third-party spend (ads, postage, email sending, registry fees) is billed by each provider to your own accounts and never resold.</Hint>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title={<Term id="credits">Credits</Term>} meta={CREDITS_CURRENCY} loading={plan.isLoading}>
        <div className="flex flex-wrap items-center gap-3">
          <SimpleSelect aria-label="Top-up amount" controlSize="sm" value={chosen} onValueChange={setAmount} options={topUpOptions.map((a) => ({ value: String(a), label: packCredits(a) !== null && packCredits(a) !== a ? `${money(a)} (${money(packCredits(a)!)} of team budget)` : money(a) }))} className="w-40" />
          <Button variant="primary" icon={Coins} disabled={!isOwner || p?.topUp.available === false} loading={topUp.isPending} onClick={() => topUp.mutate({ businessId, amountMinor: Number(chosen), currency: CREDITS_CURRENCY, ...(p?.atZero ? { resume: "continue" as const } : {}) })} data-testid="top-up">
            {isOwner ? (entry ? "Buy credits" : "Top up") : "Owner only"}
          </Button>
          {p?.topUp.mode === "mock" && p.topUp.available ? <Chip tone="info">Mock payments</Chip> : null}
        </div>
        {entry ? <Hint>Credits come in packs, and bigger packs add a bonus: $50 adds $52.50, $100 adds $110.00, $250 adds $287.50 and $500 adds $600.00.</Hint> : null}
        {p?.topUp.available === false ? (
          <Hint>{p.topUp.reason}</Hint>
        ) : p?.topUp.mode === "mock" ? (
          <Hint>Credits are in US dollars and pay for model calls on {APP_NAME}&apos;s key. Your plan includes {p ? money(p.includedCreditsMinor) : "some"} a month, used first; credits you buy last 12 months. When they run out the team finishes the task it is on and rests until your budget resets, you top up or you add your own Anthropic key in Settings › Keys. This server simulates payments: Top up opens a mock checkout here, no money moves, and the credits are labeled as a mock top-up.</Hint>
        ) : (
          <Hint>Credits are in US dollars, the currency model prices are listed in, and pay for model calls on {APP_NAME}&apos;s key. Your plan includes {p ? money(p.includedCreditsMinor) : "some"} a month, used first; credits you buy last 12 months. When they run out the team finishes the task it is on and rests until your budget resets, you top up or you add your own Anthropic key in Settings › Keys. You pay on Stripe&apos;s secure page; the credits arrive once Stripe confirms the payment.</Hint>
        )}
      </SettingsSection>

      <SettingsSection wide title={<Term id="ai_usage">Usage</Term>} meta={usage.data ? periodLabel(usage.data.period, datePrefs) : undefined} loading={usage.isLoading} error={usage.error ? errorMessage(usage.error) : undefined} onRetry={() => void usage.refetch()} actions={<ProvenanceChip kind="estimate" />}>
        {usage.data ? (
          <div className="grid grid-cols-12 items-start gap-4">
            <MiniTable
              className="col-span-7"
              aria-label="Usage by agent"
              caption={`By agent · ${periodLabel(usage.data.period, datePrefs)} · Estimate`}
              columns={[
                { id: "agent", header: "Agent", cell: (r) => <span title={r.name ?? "Platform"}>{r.name ?? "Platform"}</span> },
                // AI usage in tokens is Builder view's (docs/DESIGN.md); the cost Estimate always shows.
                ...(builder ? [{ id: "tokens", header: <Term id="tokens">Tokens</Term>, numeric: true, cell: (r: (typeof usage.data.byAgent)[number]) => formatCompact(r.tokens) }] : []),
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
