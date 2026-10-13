/**
 * Booking usage against credits (BUILD §10.4 "Cost controls", §10.5 "`credit_balances` debited from `usage_ledger`;
 * when credits run out, agents pause") and the ceiling on the platform's Anthropic key.
 *
 * `bookUsage` is the one call every sink makes (api, orchestrator, composer, gateway tool calls, live sessions): it
 * writes the ledger row and, when the platform paid for it, charges the business's credit balance for the row's period.
 * Credits are always enforced (DECISIONS 2026-10-12): every tier includes a monthly platform credit
 * (`includedCreditsMinor`, packages/config), granted on the first charge of the period when no top-up came first, so no
 * business runs on the platform's key without a ceiling. The included credit is a per-founder monthly pool: the
 * businesses one founder took charge of (archived ones included) share as many included credits a month as their plan
 * holds businesses (`includedCreditsFor`), so archiving and taking charge again never yields a second free grant.
 *
 * What is charged: every platform cost in the credits currency (USD), whatever the business's model billing. A business
 * on its own key runs its agents on that key (billed `byok`, never charged), but the api's and the composer's calls
 * (conversations, Refresh, plan compiles, recommenders, logos, foundations) run on the platform key and are charged to
 * its included credits like anyone's (DECISIONS 2026-10-12 "Platform-key calls are charged whatever the billing").
 * A tool row is third-party spend the vendor bills to the founder's own account, and an amount in another currency is
 * never subtracted from a USD balance.
 *
 * The charge that uses the last credit of a business on credits stops the team (the business's stop flag, reason
 * `credits_exhausted`: nothing starts work until a top-up, a stored key or an owner or admin lifts it) and posts one
 * Inbox warning from the Chief of Staff. On its own key the team keeps working, and the warning says what waits.
 * Later charges on an empty balance are recorded (the ledger is the truth, overrun included) without repeating either.
 *
 * Settling after the fact bounds spend only to within one call, so every caller of the platform key also asks first:
 * `assertPlatformCredits` refuses a call while the month's credits are used up (or stopped for it), and where calls are
 * live, credits granted by a simulated payment never count (`ALLOW_MOCK_PAYMENTS`, docs/DEPLOY.md §4).
 */
import { APP_NAME, CREDITS_CURRENCY, includedCreditsMinor, TIERS } from "@foundmill/config";
import { CreditsExhaustedError } from "@foundmill/shared";
import { stopBusinessAgents } from "./controls";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import { MICRO_PER_MINOR, periodOf, periodRange, type RecordUsageInput } from "./repos/usage";
import type { Business, CreditBalance, UsageEntry } from "./schema";
import { businessAllowance } from "./tiers";

export const CREDITS_EXHAUSTED_SUBJECT = "Credits used up: team paused";
/** The warning a business on its own key gets: its agents keep working, the platform-key features wait. */
export const PLATFORM_CREDITS_EXHAUSTED_SUBJECT = "Credits used up: conversations and Refresh paused";

/** Why `agent.health_changed` says the team stopped (the agent's pill and Activity read it). */
export const CREDITS_EXHAUSTED_HEALTH_REASON = "Credits used up";

export interface CreditsOutcome {
  /** Always true since 2026-10-12 (every business holds a balance for the platform key); kept for callers that read it. */
  enforced: boolean;
  balance: CreditBalance | null;
  /** `now` on the charge that emptied the balance (team stopped or note posted); `already` when it was empty before. */
  exhausted: "now" | "already" | null;
  pausedAgents: number;
  noteId: string | null;
}

export interface BookUsageResult {
  entry: UsageEntry;
  /** Null for a row that is not settled against credits (see `chargesCredits`). */
  credits: CreditsOutcome | null;
}

/** Whether a ledger row is a platform cost charged to credits: billed to credits, not a tool call, in USD. */
export function chargesCredits(entry: Pick<UsageEntry, "billedTo" | "kind" | "currency">): boolean {
  return entry.billedTo === "credits" && entry.kind !== "tool" && entry.currency === CREDITS_CURRENCY;
}

type CreditsBusiness = Pick<Business, "id" | "planTier" | "createdBy">;

/**
 * What `business`'s tier includes for `period`, after the founder's monthly pool: the businesses one founder took charge
 * of (`created_by`, archived ones included) are granted included credits for at most as many businesses a month as the
 * founder's plan holds (`businessAllowance`; unlimited on Scale). Past that, a business starts the month with nothing
 * included (a top-up or the founder's own key keeps it working). `lock` serializes grants of one founder's businesses
 * (inside the transaction that creates the balance row). A business with no recorded founder (old seeds) is not pooled.
 */
export async function includedCreditsFor(db: Executor, business: CreditsBusiness, period: string, options: { lock?: boolean } = {}): Promise<number> {
  const included = includedCreditsMinor(business.planTier);
  if (included <= 0 || !business.createdBy) return included;
  if (options.lock) await repos.usage.lockIncludedCredits(db, business.createdBy);
  const [{ allowed }, taken] = await Promise.all([businessAllowance(db, business.createdBy), repos.usage.includedCreditPlacesTaken(db, business.createdBy, period, { exceptBusinessId: business.id })]);
  return allowed !== null && taken >= allowed ? 0 : included;
}

/** Records a usage row and settles it against credits when the platform paid for it (see the module comment). */
export async function bookUsage(db: Executor, businessId: string, input: RecordUsageInput): Promise<BookUsageResult> {
  const entry = await repos.usage.record(db, businessId, input);
  if (!chargesCredits(entry)) return { entry, credits: null };
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const period = periodOf(entry.occurredAt);
  // The exact cost (0039): a call under half a cent is carried until the period's charges complete a cent.
  const charged = await repos.usage.chargeCreditsMicro(db, businessId, period, Number(entry.costMicroMinor ?? Number(entry.costMinor) * MICRO_PER_MINOR), { includedMinor: (tx) => includedCreditsFor(tx, business, period, { lock: true }) });
  if (!charged) return { entry, credits: { enforced: false, balance: null, exhausted: null, pausedAgents: 0, noteId: null } };
  if (charged.exhausted !== "now") return { entry, credits: { enforced: true, balance: charged.balance, exhausted: charged.exhausted, pausedAgents: 0, noteId: null } };
  const { pausedAgents, noteId } = await creditsUsedUp(db, business, period, charged.balance);
  return { entry, credits: { enforced: true, balance: charged.balance, exhausted: "now", pausedAgents, noteId } };
}

/**
 * The 100 % action once a business's credits for `period` are used up: a team on credits is stopped and told the way
 * back; a team on its own key keeps working and is told what waits. `bookUsage` runs it on the charge that used the
 * last credit; Commit runs it for a business that starts a month with nothing included (the founder's pool was used).
 */
export async function creditsUsedUp(db: Executor, business: Business, period: string, balance: CreditBalance): Promise<{ pausedAgents: number; noteId: string | null }> {
  return business.modelBilling === "byok" ? noteForOwnKey(db, business, period, balance) : pauseForCredits(db, business, period, balance);
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

export interface PlatformCreditsCheck {
  ok: boolean;
  /** Null when the call may run. */
  reason: "exhausted" | "mock_only" | null;
  period: string;
  /** The period's balance (what the tier includes before the first charge), USD cents. */
  balanceMinor: number;
  /** What a live call may spend: the balance less credits granted by a simulated payment. Never below zero. */
  spendableMinor: number;
  modelBilling: Business["modelBilling"];
}

/**
 * May a model call on the platform key run for this business now? No once the month's credits are used up (or the
 * team was stopped for it this month), and, where calls are `live`, no when only credits granted by a simulated
 * payment are left: free credits never pay for real model spend. Reads only; see `assertPlatformCredits`.
 */
export async function checkPlatformCredits(db: Executor, businessId: string, options: { live: boolean; now?: Date }): Promise<PlatformCreditsCheck> {
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const period = periodOf(options.now ?? new Date());
  const row = await repos.usage.creditBalance(db, business.id, period);
  const balanceMinor = row ? Number(row.balanceMinor) : await includedCreditsFor(db, business, period);
  const mockMinor = options.live && balanceMinor > 0 ? await repos.checkouts.mockGrantedMinor(db, business.id, period) : 0;
  const spendableMinor = Math.max(0, balanceMinor - mockMinor);
  // A credits stop from an earlier month is lifted by the new month's credits (resuming the agents stays with an admin).
  const stopped = business.agentsStoppedReason === "credits_exhausted" && business.agentsStoppedAt !== null && periodOf(business.agentsStoppedAt) === period;
  const reason = stopped || balanceMinor <= 0 ? "exhausted" : spendableMinor <= 0 ? "mock_only" : null;
  return { ok: reason === null, reason, period, balanceMinor, spendableMinor, modelBilling: business.modelBilling };
}

/** Throws `CreditsExhaustedError` (402, a sentence the founder can act on) when `checkPlatformCredits` says no. */
export async function assertPlatformCredits(db: Executor, businessId: string, options: { live: boolean; now?: Date }): Promise<PlatformCreditsCheck> {
  const check = await checkPlatformCredits(db, businessId, options);
  if (check.ok) return check;
  const next = shortDate(periodRange(check.period).to);
  const message =
    check.reason === "mock_only"
      ? `Only simulated credits are left this month, and they never pay for live model calls. Top up with a real payment in Settings › Billing, or wait for next month's credits on ${next}.`
      : check.modelBilling === "byok"
        ? `This month's credits for work on ${APP_NAME}'s key (conversations, Refresh, planning) are used up. Top up in Settings › Billing, or wait for next month's credits on ${next}. Your agents keep working on your own Anthropic key.`
        : `This month's credits are used up, so ${APP_NAME} makes no more model calls for this business. Top up in Settings › Billing, or wait for next month's credits on ${next}.`;
  throw new CreditsExhaustedError(message, { reason: check.reason ?? "exhausted", businessId, period: check.period, balanceMinor: check.balanceMinor });
}

/** "$5.00" for a USD credits amount in copy the founder reads. */
const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "Nov 1, 2026" (US dates). */
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const tierWord = (tier: Business["planTier"]) => tier.charAt(0).toUpperCase() + tier.slice(1);

/** Why a month started with nothing included: another business of the same founder took the pool's place. */
function poolSentence(business: Business, balance: CreditBalance): string {
  if (Number(balance.grantedMinor) > 0 || includedCreditsMinor(business.planTier) <= 0) return "";
  const allowed = TIERS[business.planTier].businesses;
  const places = typeof allowed === "number" ? `${allowed} business${allowed === 1 ? "" : "es"}` : "its businesses";
  return ` The ${tierWord(business.planTier)} plan includes credits for ${places} a month, and this month's already went to another business you took charge of.`;
}

/**
 * The way back when this month's credits are gone, worded for the tier (the Inbox note and a refused call). `pool` is
 * `poolSentence`'s reason for a month that started with nothing included, inserted after the state it explains.
 */
function creditsWayBack(tier: Business["planTier"], state: "used up" | "paused", pool = ""): string {
  if (tier === "free") {
    const head = `The free plan includes ${usd(includedCreditsMinor("free"))} of model use a month, and this month's is used up`;
    return state === "paused"
      ? `${head}, so every agent is paused.${pool} Add your own Anthropic key in Settings → Keys to keep the team working (your key is billed by Anthropic, not by us) and the team resumes by itself; tasks pick up where they stopped.`
      : `${head}.${pool} Add your own Anthropic key in Settings → Keys to keep working (your key is billed by Anthropic, not by us).`;
  }
  return state === "paused"
    ? `This month's credits are used up, so every agent is paused.${pool} Top up in Settings → Billing, or bring your own Anthropic key in Settings → Keys, and the team resumes by itself; tasks pick up where they stopped.`
    : `This month's credits are used up.${pool} Top up in Settings → Billing, or bring your own Anthropic key in Settings → Keys, to keep working.`;
}

/**
 * The 100 % action of BUILD §10.4 for a business on credits: stop the team (the business's stop flag, so nothing starts
 * work until it is lifted) and let the Inbox explain the way back for this tier. A top-up or a stored key lifts this
 * stop by itself (`resumeBusinessAgents`).
 */
async function pauseForCredits(db: Executor, business: Business, period: string, balance: CreditBalance): Promise<{ pausedAgents: number; noteId: string | null }> {
  const businessId = business.id;
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
  let noteId: string | null = null;
  if (chief) {
    const way = creditsWayBack(business.planTier, "paused", poolSentence(business, balance));
    const note = await repos.inbox.createItem(db, businessId, {
      type: "warning",
      from_agent_id: chief.id,
      subject: CREDITS_EXHAUSTED_SUBJECT,
      body_md: `${way} Conversations, Refresh and planning run on ${APP_NAME}'s key, so they wait for a top-up or next month's credits on ${shortDate(periodRange(period).to)}. Spend so far is an Estimate in US dollars; the model invoice is the real figure.`,
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
  await repos.audit.append(db, businessId, { actorKind: "system", action: "billing.credits_exhausted", target: { kind: "business", id: businessId }, details: { period, pausedAgents, noteId, planTier: business.planTier, modelBilling: business.modelBilling, teamStopped: true } });
  return { pausedAgents, noteId };
}

/**
 * The 100 % action for a business on its own key: its agents keep working on that key, so nothing is stopped; the Inbox
 * says that conversations, Refresh and planning (the platform key's work) wait for a top-up or next month's credits.
 */
async function noteForOwnKey(db: Executor, business: Business, period: string, balance: CreditBalance): Promise<{ pausedAgents: number; noteId: string | null }> {
  const businessId = business.id;
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  let noteId: string | null = null;
  if (chief) {
    const note = await repos.inbox.createItem(db, businessId, {
      type: "warning",
      from_agent_id: chief.id,
      subject: PLATFORM_CREDITS_EXHAUSTED_SUBJECT,
      body_md: `Your agents run on your own Anthropic key and keep working. Conversations, Refresh and planning run on ${APP_NAME}'s key and use this month's credits, which are used up.${poolSentence(business, balance)} They wait for a top-up in Settings → Billing or next month's credits on ${shortDate(periodRange(period).to)}. Spend so far is an Estimate in US dollars; the model invoice is the real figure.`,
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
