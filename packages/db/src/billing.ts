/**
 * Booking usage against credits (BUILD §10.4 "Cost controls", §10.5 "`credit_balances` debited from `usage_ledger`;
 * when credits run out, agents pause") and the ceiling on the platform's Anthropic key.
 *
 * `bookUsage` is the one call every sink makes (api, orchestrator, composer, gateway tool calls, live sessions): it
 * writes the ledger row and, when the platform paid for it, charges the business's credit balance for the row's period.
 * Credits are always enforced (DECISIONS 2026-10-12): every tier includes a monthly platform credit
 * (`includedCreditsMinor`, packages/config), granted on the first charge of the period when no top-up came first, so no
 * business runs on the platform's key without a ceiling. The included credit is a per-founder monthly pool: the
 * businesses one founder took charge of (archived ones included) share as many included credits a month as their plan's
 * `includedCreditBusinesses` (`includedCreditsFor`), so archiving and taking charge again never yields a second free
 * grant, and lifting the business limit (founder, 2026-10-16) never widens the pool.
 *
 * What is charged: every platform cost in the credits currency (USD), whatever the business's model billing. A business
 * on its own key runs its agents on that key (billed `byok`, never charged), but the api's and the composer's calls
 * (conversations, Refresh, plan compiles, recommenders, logos, foundations) run on the platform key and are charged to
 * its included credits like anyone's (DECISIONS 2026-10-12 "Platform-key calls are charged whatever the billing").
 * A tool row is third-party spend the vendor bills to the founder's own account, and an amount in another currency is
 * never subtracted from a USD balance.
 *
 * **Resting** (WP-14 T1; founder, Nov 17, 2026) is a team that has used the month's budget: nothing new starts until
 * the date the budget resets, a top-up or the founder's own key. Paused is a choice; Resting is not. A team rests in one
 * of two ways, and each posts the same one note from the Chief of Staff (`restTeam`):
 * - before a session starts, when what is left is under the reserve for it (`restBeforeSession`, called by the
 *   orchestrator): the session does not start, nothing is booked and what is left stays in the balance;
 * - on the charge that uses the last credit (`bookUsage`). A session already running is not stopped by it: it finishes,
 *   up to the backstop ceiling (apps/orchestrator session-credits.ts).
 * Internally it is still the business's stop flag with reason `credits_exhausted`. On its own key the team keeps
 * working, and the note says what waits. Later charges on an empty balance are recorded (the ledger is the truth,
 * overrun included) without repeating either. A team waiting at the platform's monthly cap (WP-13 T4, T6) is not
 * Resting: that is `freeCapCheck`'s own message and it sets no stop.
 *
 * Settling after the fact bounds spend only to within one call, so every caller of the platform key also asks first:
 * `assertPlatformCredits` refuses a call while the month's credits are used up (or stopped for it), and where calls are
 * live, credits granted by a simulated payment never count (`ALLOW_MOCK_PAYMENTS`, docs/DEPLOY.md §4).
 */
import { APP_NAME, chargedMinor, creditsAreLow, EARLY_ACCESS_STAGE, planName, subscriptionChargingOpen, tierShowsBuiltOnMark, type TierKey, CREDITS_CURRENCY, includedCreditsMinor, lowCreditsThresholdMinor, ownPlanFunds, tierIncludedCreditPlaces } from "@foundmill/config";
import { CreditsExhaustedError, platformBillingMode, type Env, type FundingSource } from "@foundmill/shared";
import { stopBusinessAgents } from "./controls";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import { MICRO_PER_MINOR, periodOf, periodRange, type RecordUsageInput } from "./repos/usage";
import type { Business, CreditBalance, UsageEntry } from "./schema";
import { businessAllowance } from "./tiers";

/** The one note when a team on credits rests (the name is older than the word). */
export const CREDITS_EXHAUSTED_SUBJECT = "The team is resting: this month's budget is used";
export const RESTING_SUBJECT = CREDITS_EXHAUSTED_SUBJECT;
/** The one note a month when credits fall below the low line and routine work moves to a lower-cost model. */
export const CREDITS_LOW_SUBJECT = "Credits running low: routine work moved to a lighter model";
/** The audit action that records the low-credits note (one per business and month). */
export const CREDITS_LOW_AUDIT_ACTION = "billing.credits_low";
/** The warning a business on its own key gets: its agents keep working, the platform-key features wait. */
export const PLATFORM_CREDITS_EXHAUSTED_SUBJECT = "Conversations and Refresh are resting: this month's budget is used";

/** Why `agent.health_changed` says the team stopped (the agent's pill and Activity read it). */
export const CREDITS_EXHAUSTED_HEALTH_REASON = "Resting: this month's budget is used";

export interface CreditsOutcome {
  /** Always true since 2026-10-12 (every business holds a balance for the platform key); kept for callers that read it. */
  enforced: boolean;
  balance: CreditBalance | null;
  /** `now` on the charge that emptied the balance (team stopped or note posted); `already` when it was empty before. */
  exhausted: "now" | "already" | null;
  pausedAgents: number;
  noteId: string | null;
  /** The low-credits note this charge posted (the first charge of the month below the low line), else null. */
  lowNoteId?: string | null;
}

export interface BookUsageResult {
  entry: UsageEntry;
  /** Null for a row that is not settled against credits (see `chargesCredits`), and for a repeat (`replayed`). */
  credits: CreditsOutcome | null;
  /** The booking's `idempotencyKey` was already booked: the existing row is returned and nothing is charged again. */
  replayed?: boolean;
}

/** Overrides of `FLAGS.ownPlanFunding` and `OWN_PLAN_PROVIDERS` (tests); the product reads packages/config. */
export interface OwnPlanOptions {
  enabled?: boolean;
  providers?: readonly string[];
}

/**
 * Whether a ledger row is a platform cost charged to credits: billed to credits, not a tool call, in USD, and not paid by
 * the founder's own plan. A row's own claim of the plan (`details.funding`) is believed only while the plan can fund work
 * at all (`ownPlanFunds` for the provider it names: the flag on and the provider integrated); with the flag off, a row that
 * says `own_plan` is charged like any other.
 */
export function chargesCredits(entry: Pick<UsageEntry, "billedTo" | "kind" | "currency"> & { details?: unknown }, ownPlan?: OwnPlanOptions): boolean {
  if (entry.billedTo !== "credits" || entry.kind === "tool" || entry.currency !== CREDITS_CURRENCY) return false;
  if (fundingOfRow(entry) !== "own_plan") return true;
  const provider = (entry.details as { funding?: { provider?: unknown } } | null | undefined)?.funding?.provider;
  return !ownPlanFunds(typeof provider === "string" ? provider : null, ownPlan);
}

/** Which source paid for a usage row, with the provider when it is the founder's own plan or own key. */
export interface UsageFunding {
  source: FundingSource;
  provider?: string;
}

/** The funding recorded on a row (`details.funding.source`), else what its `billedTo` means. */
export function fundingOfRow(entry: Pick<UsageEntry, "billedTo"> & { details?: unknown }): FundingSource {
  const recorded = (entry.details as { funding?: { source?: unknown } } | null | undefined)?.funding?.source;
  if (recorded === "foundmill_credits" || recorded === "own_api_key" || recorded === "own_plan") return recorded;
  return entry.billedTo === "byok" ? "own_api_key" : "foundmill_credits";
}

/**
 * What funds a business's agents' model calls now (0104): the founder's own plan only while `FLAGS.ownPlanFunding` is on
 * and its provider is integrated (`ownPlanFunds`, packages/config; with the flag off, never); otherwise the founder's own
 * key on `byok`, else the month's credits. `ownPlan` overrides the flag and the provider list (tests).
 */
export function agentWorkFunding(business: Pick<Business, "modelBilling" | "fundingSource" | "fundingPlanProvider">, ownPlan?: OwnPlanOptions): UsageFunding {
  if (business.fundingSource === "own_plan" && ownPlanFunds(business.fundingPlanProvider, ownPlan)) return { source: "own_plan", provider: business.fundingPlanProvider! };
  return business.modelBilling === "byok" ? { source: "own_api_key", provider: "anthropic" } : { source: "foundmill_credits" };
}

/** A booking, with the source that paid when the caller knows it (else it follows `billedTo`). */
export type BookUsageInput = RecordUsageInput & { funding?: UsageFunding };

/** What `billedTo` means: the founder's own Anthropic key, or the platform's key paid from credits. */
function fundingOfBilling(billedTo: RecordUsageInput["billedTo"]): UsageFunding {
  return billedTo === "byok" ? { source: "own_api_key", provider: "anthropic" } : { source: "foundmill_credits" };
}

/**
 * The funding a booking records. A caller's claim that the founder's own plan paid is checked against the business: it
 * holds only when the business's agent work is funded by that plan now (`agentWorkFunding`: on `own_plan`, the flag on,
 * the provider integrated) and names the same provider; otherwise the row records what its `billedTo` means and is charged
 * as such. Any other claim is replaced by what `billedTo` means too, so the row and its billing never disagree.
 */
async function fundingFor(db: Executor, businessId: string, input: BookUsageInput, ownPlan?: OwnPlanOptions): Promise<UsageFunding> {
  if (input.funding?.source !== "own_plan") return fundingOfBilling(input.billedTo);
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const plan = agentWorkFunding(business, ownPlan);
  return plan.source === "own_plan" && plan.provider === input.funding.provider ? plan : fundingOfBilling(input.billedTo);
}

type CreditsBusiness = Pick<Business, "id" | "planTier" | "createdBy">;

/**
 * What `business`'s tier includes for `period`, after the founder's monthly pool: the businesses one founder took charge
 * of (`created_by`, archived ones included) are granted included credits for at most as many businesses a month as the
 * founder's plan covers (`tierIncludedCreditPlaces` of the founder's tier, `businessAllowance`; every one on Scale).
 * It is its own number, not the business limit (there is none for now). Past that, a business starts the month with nothing
 * included (a top-up or the founder's own key keeps it working). `lock` serializes grants of one founder's businesses
 * (inside the transaction that creates the balance row). A business with no recorded founder (old seeds) is not pooled.
 */
export async function includedCreditsFor(db: Executor, business: CreditsBusiness, period: string, options: { lock?: boolean } = {}): Promise<number> {
  const included = includedCreditsMinor(business.planTier);
  if (included <= 0 || !business.createdBy) return included;
  if (options.lock) await repos.usage.lockIncludedCredits(db, business.createdBy);
  const [{ tier }, taken] = await Promise.all([businessAllowance(db, business.createdBy), repos.usage.includedCreditPlacesTaken(db, business.createdBy, period, { exceptBusinessId: business.id })]);
  const places = tierIncludedCreditPlaces(tier);
  return places !== null && taken >= places ? 0 : included;
}

/**
 * Records a usage row and settles it against credits when the platform paid for it (see the module comment). One
 * transaction: the row, the charge and, on the last credit, the pause and its note commit together, so a failure after
 * the charge never leaves an empty balance with the team still working (audit BILL-20). A booking with an
 * `idempotencyKey` that was already booked (a retried session end) returns that row and charges nothing.
 */
export async function bookUsage(db: Executor, businessId: string, input: BookUsageInput, options: { ownPlan?: OwnPlanOptions; topUps?: boolean; markup?: number } = {}): Promise<BookUsageResult> {
  const { funding: _funding, ...row } = input;
  return db.transaction(async (tx) => {
    // Which source paid is recorded on the row (0104), checked against the business, so only a row the founder's own
    // plan really paid is left uncharged.
    const recorded: RecordUsageInput = input.kind === "tool" ? row : { ...row, details: { ...(row.details ?? {}), funding: await fundingFor(tx, businessId, input, options.ownPlan) } };
    const { entry, created } = await repos.usage.recordOnce(tx, businessId, recorded);
    if (!created) return { entry, credits: null, replayed: true };
    if (!chargesCredits(entry, options.ownPlan)) return { entry, credits: null };
    const business = await repos.businesses.get(tx, businessId, { includeArchived: true });
    const period = periodOf(entry.occurredAt);
    // The exact cost (0039): a call under half a cent is carried until the period's charges complete a cent.
    // Credits are charged at cost plus the markup (founder, Nov 17, 2026, `CREDIT_MARKUP`); the row keeps the true cost.
    const trueMicro = Number(entry.costMicroMinor ?? Number(entry.costMinor) * MICRO_PER_MINOR);
    // `markup` is for the tests of the charge's own mechanics (balances, carries, the pause), which state amounts at cost.
    const chargeMicro = options.markup === undefined ? chargedMinor(trueMicro) : Math.round(trueMicro * (1 + options.markup));
    const charged = await repos.usage.chargeCreditsMicro(tx, businessId, period, chargeMicro, { includedMinor: (t) => includedCreditsFor(t, business, period, { lock: true }) });
    if (!charged) return { entry, credits: { enforced: false, balance: null, exhausted: null, pausedAgents: 0, noteId: null } };
    if (charged.exhausted === null) {
      const lowNoteId = await creditsLowNotice(tx, business, period, charged.balance, options.topUps ?? false);
      return { entry, credits: { enforced: true, balance: charged.balance, exhausted: null, pausedAgents: 0, noteId: null, lowNoteId } };
    }
    if (charged.exhausted !== "now") return { entry, credits: { enforced: true, balance: charged.balance, exhausted: charged.exhausted, pausedAgents: 0, noteId: null } };
    const { pausedAgents, noteId } = await creditsUsedUp(tx, business, period, charged.balance, { topUps: options.topUps });
    return { entry, credits: { enforced: true, balance: charged.balance, exhausted: "now", pausedAgents, noteId } };
  });
}

/**
 * The 100 % action once a business's credits for `period` are used up: a team on credits is stopped and told the way
 * back; a team on its own key keeps working and is told what waits. `bookUsage` runs it on the charge that used the
 * last credit; Commit runs it for a business that starts a month with nothing included (the founder's pool was used).
 */
export async function creditsUsedUp(db: Executor, business: Business, period: string, balance: Pick<CreditBalance, "grantedMinor" | "balanceMinor">, options: { topUps?: boolean } = {}): Promise<{ pausedAgents: number; noteId: string | null }> {
  const topUps = options.topUps ?? false;
  return business.modelBilling === "byok" ? noteForOwnKey(db, business, period, balance, topUps) : restTeam(db, business, period, balance, topUps);
}

/**
 * Rests the team before a session that would not fit (WP-14 T1): what is left of the month's budget is under the
 * session's reserve, so the session does not start, nothing is booked and the balance keeps what is left. One call
 * rests the team and posts the note; later ones find it resting and do nothing. For a business on its own key nothing
 * rests (its agents run on that key).
 */
export async function restBeforeSession(db: Executor, businessId: string, input: { reserveMinor: number; now?: Date; topUps?: boolean }): Promise<{ rested: boolean; noteId: string | null }> {
  return db.transaction(async (tx) => {
    const business = await repos.businesses.get(tx, businessId, { includeArchived: true });
    if (business.modelBilling === "byok") return { rested: false, noteId: null };
    const period = periodOf(input.now ?? new Date());
    const credits = await platformCredits(tx, business, period);
    const { noteId } = await restTeam(tx, business, period, credits, input.topUps ?? false, { reserveMinor: input.reserveMinor });
    return { rested: true, noteId };
  });
}

export interface PlatformCredits {
  currency: typeof CREDITS_CURRENCY;
  balanceMinor: number;
  grantedMinor: number;
  spentMinor: number;
  /** What the tier includes this month for this business, after the founder's pool (`includedCreditsFor`). */
  includedMinor: number;
  /** Credits granted this month by a simulated payment (labeled; they never pay for live model calls). */
  mockMinor: number;
  exhausted: boolean;
}

/**
 * Where a business's credits stand this period, without writing anything: the balance row, or what its tier includes
 * when the period has no row yet (it is created on the first charge). Every business has them, on its own key too:
 * they pay for the api's and the composer's calls on the platform key.
 */
export async function platformCredits(db: Executor, business: CreditsBusiness, period: string): Promise<PlatformCredits> {
  const [row, includedMinor, mockMinor] = await Promise.all([repos.usage.creditBalance(db, business.id, period), includedCreditsFor(db, business, period), repos.checkouts.mockGrantedMinor(db, business.id, period)]);
  const balanceMinor = row ? Number(row.balanceMinor) : includedMinor;
  return { currency: CREDITS_CURRENCY, balanceMinor, grantedMinor: row ? Number(row.grantedMinor) : includedMinor, spentMinor: row ? Number(row.spentMinor) : 0, includedMinor, mockMinor, exhausted: balanceMinor <= 0 };
}

/**
 * The credits that pay for a business's agents this period (the cycle's budget, the Billing tab of a business on
 * credits); null for a business on its own key, whose agents run on that key.
 */
export async function creditsState(db: Executor, business: CreditsBusiness & Pick<Business, "modelBilling">, period: string): Promise<PlatformCredits | null> {
  if (business.modelBilling === "byok") return null;
  return platformCredits(db, business, period);
}

export interface ModelBudgetState {
  period: string;
  /** The business's monthly model budget in USD cents (0059); null when none is set. */
  budgetMinor: number | null;
  /** The month's metered cost so far, USD cents (an Estimate): every agent, whoever pays the model. */
  spentMinor: number;
  /** What is left, never below zero; null when no budget is set. */
  remainingMinor: number | null;
}

/**
 * Where a business's monthly model budget stands (0059), without writing anything. It applies whoever pays the model:
 * the month's cost is the usage ledger's USD total, credits and own-key rows alike (the sum of the agents' wages). The
 * ledger is read only when a budget is set.
 */
export async function modelBudgetState(db: Executor, business: Pick<Business, "id" | "modelBudgetMinor">, now: Date = new Date()): Promise<ModelBudgetState> {
  const period = periodOf(now);
  if (business.modelBudgetMinor === null || business.modelBudgetMinor === undefined) return { period, budgetMinor: null, spentMinor: 0, remainingMinor: null };
  const budgetMinor = Number(business.modelBudgetMinor);
  const { from, to } = periodRange(period);
  const { costMinor } = await repos.usage.totals(db, business.id, { from, to });
  return { period, budgetMinor, spentMinor: costMinor, remainingMinor: Math.max(0, budgetMinor - costMinor) };
}

export interface PlatformCreditsCheck {
  ok: boolean;
  /** Null when the call may run. */
  reason: "exhausted" | "mock_only" | null;
  period: string;
  /** The period's balance (what the tier includes before the first charge), USD cents. */
  balanceMinor: number;
  /** What a live call may spend: the balance less credits granted by a simulated payment. Never below zero. */
  spendableMinor: number;
  /**
   * The call may run, but what is spendable is below the low line (`creditsAreLow`, packages/config): routine work runs on
   * its lower-cost model (the credit saver, `ModelCallVerdict.lowCredits`). False whenever `ok` is false.
   */
  low: boolean;
  modelBilling: Business["modelBilling"];
  /**
   * Who pays for the call: the month's credits, unless the call is routed to the founder's own plan at its provider
   * (`routedTo`, `agentWorkFunding`), which skips Foundmill's credits. With `FLAGS.ownPlanFunding` off, never.
   */
  fundedBy: FundingSource;
}

export interface CreditsCheckOptions {
  /** The call spends real money (simulated credits do not count). */
  live: boolean;
  now?: Date;
  /**
   * The provider whose plan the call is routed to, for a call that does not run on the platform key. Absent for every
   * platform-key call (the api's, the composer's, the orchestrator's platform client), which never skips credits.
   */
  routedTo?: string;
  ownPlan?: OwnPlanOptions;
  /**
   * Credits can be bought on this server (packages/shared `topUpsOnSale`). Default false: a refusal never names a
   * top-up unless the caller says one can be bought (WP-09 T13).
   */
  topUps?: boolean;
}

/**
 * May a model call on the platform key run for this business now? No once the month's credits are used up (or the
 * team was stopped for it this month), and, where calls are `live`, no when only credits granted by a simulated
 * payment are left: free credits never pay for real model spend. Reads only; see `assertPlatformCredits`.
 */
export async function checkPlatformCredits(db: Executor, businessId: string, options: CreditsCheckOptions): Promise<PlatformCreditsCheck> {
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const period = periodOf(options.now ?? new Date());
  const row = await repos.usage.creditBalance(db, business.id, period);
  // Only a call routed to the founder's own plan at its provider skips Foundmill's credits (0104); with the flag off none
  // is. Every call on the platform key (no `routedTo`) keeps the stop and the zero check, whatever the business's funding.
  const plan = agentWorkFunding(business, options.ownPlan);
  if (options.routedTo !== undefined && plan.source === "own_plan" && plan.provider === options.routedTo) {
    const balanceMinor = row ? Number(row.balanceMinor) : 0;
    return { ok: true, reason: null, period, balanceMinor, spendableMinor: balanceMinor, low: false, modelBilling: business.modelBilling, fundedBy: "own_plan" };
  }
  const included = row ? null : await includedCreditsFor(db, business, period);
  const balanceMinor = row ? Number(row.balanceMinor) : (included ?? 0);
  const mockMinor = options.live && balanceMinor > 0 ? await repos.checkouts.mockGrantedMinor(db, business.id, period) : 0;
  const spendableMinor = Math.max(0, balanceMinor - mockMinor);
  // A credits stop from an earlier month is lifted by the new month's credits (resuming the agents stays with an admin).
  const stopped = business.agentsStoppedReason === "credits_exhausted" && business.agentsStoppedAt !== null && periodOf(business.agentsStoppedAt) === period;
  const reason = stopped || balanceMinor <= 0 ? "exhausted" : spendableMinor <= 0 ? "mock_only" : null;
  const low = reason === null && (await belowLowLine(db, business, period, spendableMinor, included));
  return { ok: reason === null, reason, period, balanceMinor, spendableMinor, low, modelBilling: business.modelBilling, fundedBy: "foundmill_credits" };
}

/**
 * Whether `amountMinor` is below this month's low line. The line is a share of what the month includes for this business
 * (after the founder's pool, `includedCreditsFor`), so the pool is read only when the amount is under the highest line
 * the tier could have: almost every call answers without a query. `included` is passed when the caller already has it.
 */
async function belowLowLine(db: Executor, business: CreditsBusiness, period: string, amountMinor: number, included: number | null = null): Promise<boolean> {
  if (amountMinor <= 0 || amountMinor >= lowCreditsThresholdMinor(includedCreditsMinor(business.planTier))) return false;
  return creditsAreLow(amountMinor, included ?? (await includedCreditsFor(db, business, period)));
}

/** Throws `CreditsExhaustedError` (402, a sentence the founder can act on) when `checkPlatformCredits` says no. */
export async function assertPlatformCredits(db: Executor, businessId: string, options: CreditsCheckOptions): Promise<PlatformCreditsCheck> {
  const check = await checkPlatformCredits(db, businessId, options);
  if (check.ok) return check;
  const ways = waysToContinue({ topUps: options.topUps ?? false, nextCreditsOn: periodRange(check.period).to, ownKey: check.modelBilling === "byok" });
  const message =
    check.reason === "mock_only"
      ? `Only simulated credits are left this month, and they never pay for live model calls. ${ways}`
      : check.modelBilling === "byok"
        ? `This month's budget for work on ${APP_NAME}'s key (conversations, Refresh, planning) is used, so that work is resting. Your agents keep working on your own Anthropic key. ${ways}`
        : `The team is resting: this month's team budget is used, so ${APP_NAME} makes no more model calls for this project. ${ways}`;
  throw new CreditsExhaustedError(message, { reason: check.reason ?? "exhausted", businessId, period: check.period, balanceMinor: check.balanceMinor });
}

/** "$5.00" for a USD credits amount in copy the founder reads. */
const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "Nov 1, 2026" (US dates). */
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** Why a month started with nothing included: another business of the same founder took the pool's place. */
function poolSentence(business: Business, balance: Pick<CreditBalance, "grantedMinor">): string {
  if (Number(balance.grantedMinor) > 0 || includedCreditsMinor(business.planTier) <= 0) return "";
  const n = tierIncludedCreditPlaces(business.planTier);
  const places = n !== null ? `${n} project${n === 1 ? "" : "s"}` : "every project";
  return ` ${planName(business.planTier)}'s budget goes to ${places} a month, and this month's already went to another project you took charge of.`;
}

/**
 * The one sentence of ways to continue once this month's credits are gone (WP-09 T13): credits first where they can be
 * bought here (`topUps`), the founder's own Anthropic key unless the business already runs on one (`ownKey`), and the
 * date next month's credits arrive. It names no model: credits buy the same work on every plan.
 */
export function waysToContinue(input: { topUps: boolean; nextCreditsOn: Date; ownKey?: boolean; plans?: boolean; voice?: "rest" }): string {
  const rest = input.voice === "rest";
  const plans = input.plans ?? subscriptionChargingOpen(EARLY_ACCESS_STAGE);
  const ways = [
    ...(input.topUps ? [rest ? "top up in Settings › Billing" : "add credits in Settings › Billing"] : []),
    ...(plans ? ["change plan"] : []),
    ...(input.ownKey ? [] : ["add your own Anthropic key in Settings › Keys (billed by Anthropic, not by us)"]),
    rest ? `let us rest until ${shortDate(input.nextCreditsOn)}, when your budget resets` : `wait for next month's credits on ${shortDate(input.nextCreditsOn)}`,
  ];
  const sentence = ways.length === 1 ? ways[0]! : `${ways.slice(0, -1).join(", ")}${ways.length > 2 ? "," : ""} or ${ways.at(-1)}`;
  return `${rest ? "You can" : "To keep going,"} ${sentence}.`;
}

/** What stops at zero credits, and what still works with no model call (each one a test proves: credits-ceiling.test.ts). */
export const CREDITS_ZERO_STOPPED = "What stopped: the agents, conversations, Refresh, planning and drafting.";
export const CREDITS_ZERO_STILL_WORKS = "What still works: reading everything the team wrote, editing and publishing your public page by hand, and answering a note with one of its options.";

/** "Dec 1" (US date, year implied): when next month's included credits arrive. */
const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The personal zero-credits message (founder, Nov 17, 2026): it names no plan, so the plan's name and price stay config,
 * and the date is when next month's included credits arrive.
 */
export function includedAiUsedUp(nextCreditsOn: Date): string {
  return `You've used all your included AI! It is back on ${monthDay(nextCreditsOn)}. To keep going now, connect your own Anthropic key.`;
}

/** Up to five tasks finished this month and three that come next, by the titles the founder reads. Real records only. */
async function finishedAndNext(db: Executor, businessId: string, period: string): Promise<{ finished: string[]; next: string[] }> {
  const { from, to } = periodRange(period);
  const [done, open] = await Promise.all([repos.tasks.finishedBetween(db, businessId, { from, to, limit: 5 }), repos.tasks.upNext(db, businessId, 3)]);
  const title = (t: { title: string; founderTitle: string | null }) => (t.founderTitle ?? t.title).replace(/\s+/g, " ").trim();
  return { finished: done.map(title), next: open.map(title) };
}

/** The resting note's body: the brief's sentence, the two lists from real records, the plan by its name, and the ways on. */
export function restingNoteBody(input: { planTier: Business["planTier"]; finished: readonly string[]; next: readonly string[]; leftMinor: number; nextOn: Date; pool?: string; topUps?: boolean; plans?: boolean }): string {
  const lists = input.finished.length > 0 || input.next.length > 0;
  const ways = waysToContinue({ topUps: input.topUps ?? false, ...(input.plans === undefined ? {} : { plans: input.plans }), nextCreditsOn: input.nextOn, voice: "rest" });
  const parts = [`We've used this month's team budget.${lists ? " Here's what we finished, and here's what we'd do next." : ""} ${ways}`];
  if (input.finished.length > 0) parts.push(`**Finished this month**\n${input.finished.map((t) => `- ${t}`).join("\n")}`);
  if (input.next.length > 0) parts.push(`**What we'd do next**\n${input.next.map((t) => `- ${t}`).join("\n")}`);
  const left = input.leftMinor > 0 ? ` ${usd(input.leftMinor)} is left: too little to finish another task, so it stays in your balance.` : "";
  parts.push(
    `You're on ${planName(input.planTier)}, which includes ${usd(includedCreditsMinor(input.planTier))} of team budget a month.${input.pool ?? ""}${left} Nothing was stopped part-way: the task that was running finished. ${input.topUps ? "With a top-up or your own key" : "With your own key"} the team picks up by itself, and tasks carry on where they stopped; on ${shortDate(input.nextOn)}, press Resume agents. Conversations, Refresh and planning run on ${APP_NAME}'s key, so they rest too. Spend so far is an Estimate in US dollars; the model invoice is the real figure.`,
  );
  return parts.join("\n\n");
}

/**
 * Rests a team on credits (the 100 % action of BUILD §10.4): the business's stop flag, so nothing new starts, and one
 * note from the Chief of Staff with what was finished, what comes next and the ways on. A top-up or a stored key lifts
 * it by itself (`resumeBusinessAgents`). A team already resting this month is left as it is: one note, not two.
 */
async function restTeam(db: Executor, business: Business, period: string, balance: Pick<CreditBalance, "grantedMinor" | "balanceMinor">, topUps: boolean, options: { reserveMinor?: number } = {}): Promise<{ pausedAgents: number; noteId: string | null }> {
  const businessId = business.id;
  const state = await repos.businesses.stopState(db, businessId);
  if (state.reason === "credits_exhausted" && state.stoppedAt !== null && periodOf(state.stoppedAt) === period) return { pausedAgents: 0, noteId: null };
  const stop = await stopBusinessAgents(db, businessId, { reason: "credits_exhausted" });
  const pausedAgents = stop.paused.length;
  // Every agent the stop paused tells the open screens (audit BILL-21), as the kill switch does.
  for (const a of stop.paused) {
    await repos.events.write(db, businessId, {
      type: "agent.health_changed",
      actor: { kind: "system", id: "billing" },
      entityIds: [a.id],
      payload: { agentId: a.id, from: a.from, to: "paused", reason: CREDITS_EXHAUSTED_HEALTH_REASON, signals: {}, expectedReturnAt: null, sessionId: null },
    });
  }
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  const leftMinor = Math.max(0, Number(balance.balanceMinor));
  let noteId: string | null = null;
  if (chief) {
    const { finished, next } = await finishedAndNext(db, businessId, period);
    const note = await repos.inbox.createItem(db, businessId, {
      type: "warning",
      from_agent_id: chief.id,
      subject: RESTING_SUBJECT,
      body_md: restingNoteBody({ planTier: business.planTier, finished, next, leftMinor, nextOn: periodRange(period).to, pool: poolSentence(business, balance), topUps }),
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    noteId = note.id;
    await repos.events.write(db, businessId, {
      type: "inbox.item_created",
      actor: { kind: "agent", id: chief.id },
      entityIds: [note.id],
      payload: { inboxItemId: note.id, type: note.type, fromAgentId: chief.id, subject: note.subject, blocksContinue: note.blocksContinue, sourceEventIds: [], cost: null },
    });
  }
  await repos.audit.append(db, businessId, { actorKind: "system", action: "billing.credits_exhausted", target: { kind: "business", id: businessId }, details: { period, pausedAgents, noteId, planTier: business.planTier, modelBilling: business.modelBilling, teamStopped: true, resting: true, leftMinor, reserveMinor: options.reserveMinor ?? null } });
  return { pausedAgents, noteId };
}

/**
 * The low-credits note (the credit saver's one notice): the first charge of a month that leaves the balance above zero
 * but below the low line posts one Inbox note from the Chief of Staff, in plain words: what changed (routine work runs on
 * a lighter model), what did not (founder-facing and high-stakes work), and how to avoid it (a top-up or the founder's
 * own key). One per business and month, recorded in the audit log (`CREDITS_LOW_AUDIT_ACTION`); the charges of one
 * month are serialized on the balance row, so two charges never post two notes. Returns the note's id, else null.
 */
async function creditsLowNotice(db: Executor, business: Business, period: string, balance: CreditBalance, topUps: boolean): Promise<string | null> {
  const balanceMinor = Number(balance.balanceMinor);
  if (!(await belowLowLine(db, business, period, balanceMinor))) return null;
  // Matched on the period it is about, not on when it was written: a late-booked charge belongs to its own month.
  if (await repos.audit.latestMatching(db, business.id, CREDITS_LOW_AUDIT_ACTION, { period }, new Date(0))) return null;
  const { to } = periodRange(period);
  const chief = await repos.agents.chiefOfStaff(db, business.id);
  let noteId: string | null = null;
  if (chief) {
    const note = await repos.inbox.createItem(db, business.id, {
      type: "warning",
      from_agent_id: chief.id,
      subject: CREDITS_LOW_SUBJECT,
      body_md: creditsLowBody(business, balanceMinor, to, topUps),
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: false,
      source_event_ids: [],
      entity_ids: [],
    });
    noteId = note.id;
    await repos.events.write(db, business.id, {
      type: "inbox.item_created",
      actor: { kind: "agent", id: chief.id },
      entityIds: [note.id],
      payload: { inboxItemId: note.id, type: note.type, fromAgentId: chief.id, subject: note.subject, blocksContinue: note.blocksContinue, sourceEventIds: [], cost: null },
    });
  }
  await repos.audit.append(db, business.id, { actorKind: "system", action: CREDITS_LOW_AUDIT_ACTION, target: { kind: "business", id: business.id }, details: { period, balanceMinor, noteId, planTier: business.planTier, modelBilling: business.modelBilling } });
  return noteId;
}

/** The low-credits note's body, worded for how the business pays for its agents and for its plan. */
function creditsLowBody(business: Business, balanceMinor: number, nextMonth: Date, topUps: boolean): string {
  const left = `This month's credits are down to ${usd(balanceMinor)} (an Estimate in US dollars).`;
  const kept = "Replies to you, plans, the Chief of Staff, anything that goes outside the business, and money and legal work keep their usual model.";
  if (business.modelBilling === "byok") {
    return `${left} Your agents run on your own Anthropic key, so they are not affected. To make the credits last, planning and first drafts on ${APP_NAME}'s key now use a lighter, lower-cost model. ${kept} ${topUps ? "To keep everything on its usual model, top up in Settings → Billing. " : ""}Next month's credits arrive on ${shortDate(nextMonth)}.`;
  }
  const avoid = topUps
    ? "To keep everything on its usual model, top up in Settings → Billing, or add your own Anthropic key in Settings → Keys (Anthropic bills your key, not us)."
    : "To keep everything on its usual model, add your own Anthropic key in Settings → Keys (Anthropic bills your key, not us).";
  const until = topUps ? "you top up or add your key" : "you add your key";
  return `${left} To make them last, routine work now runs on a lighter, lower-cost model: research, drafts, internal prep and planning. ${kept} ${avoid} If the budget runs out, the team finishes the task it is on and rests until ${until}, or until next month's budget arrives on ${shortDate(nextMonth)}.`;
}

/**
 * The 100 % action for a business on its own key: its agents keep working on that key, so nothing is stopped; the Inbox
 * says that conversations, Refresh and planning (the platform key's work) wait for a top-up or next month's credits.
 */
async function noteForOwnKey(db: Executor, business: Business, period: string, balance: Pick<CreditBalance, "grantedMinor" | "balanceMinor">, topUps: boolean): Promise<{ pausedAgents: number; noteId: string | null }> {
  const businessId = business.id;
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  let noteId: string | null = null;
  if (chief) {
    const note = await repos.inbox.createItem(db, businessId, {
      type: "warning",
      from_agent_id: chief.id,
      subject: PLATFORM_CREDITS_EXHAUSTED_SUBJECT,
      body_md: `Your agents run on your own Anthropic key and keep working. Conversations, Refresh and planning run on ${APP_NAME}'s key and use this month's budget, which is used, so they are resting.${poolSentence(business, balance)} ${waysToContinue({ topUps, nextCreditsOn: periodRange(period).to, ownKey: true })} Spend so far is an Estimate in US dollars; the model invoice is the real figure.`,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: false,
      source_event_ids: [],
      entity_ids: [],
    });
    noteId = note.id;
  }
  await repos.audit.append(db, businessId, { actorKind: "system", action: "billing.credits_exhausted", target: { kind: "business", id: businessId }, details: { period, pausedAgents: 0, noteId, planTier: business.planTier, modelBilling: business.modelBilling, teamStopped: false } });
  return { pausedAgents: 0, noteId };
}

/**
 * Whether what a project's visitors see carries the small "Built on" mark (founder, 2026-11-12 and 2026-11-17): the free
 * plan does; a paid plan removes it (`tierShowsBuiltOnMark`); and once sign-up is paid entry (`PAID_ENTRY`), an owner's
 * credit pack removes it too (WP-09 T16). Where the platform's billing is live only a pack paid on Stripe counts.
 */
export async function showsBuiltOnMark(db: Executor, business: { id: string; planTier: TierKey }, billing: { paidEntry: boolean; live: boolean }): Promise<boolean> {
  if (!tierShowsBuiltOnMark(business.planTier)) return false;
  if (!billing.paidEntry) return true;
  return !(await repos.accountPlans.ownerBoughtPack(db, business.id, { live: billing.live }));
}

/** The `billing` facts of `showsBuiltOnMark` from a service's environment. */
export const markBilling = (env: Partial<Pick<Env, "PAID_ENTRY">> & Pick<Env, "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">): { paidEntry: boolean; live: boolean } => ({ paidEntry: env.PAID_ENTRY === true, live: platformBillingMode(env) === "live" });
