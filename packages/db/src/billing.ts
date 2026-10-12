/**
 * Booking usage against credits (BUILD §10.4 "Cost controls", §10.5 "`credit_balances` debited from `usage_ledger`;
 * when credits run out, agents pause").
 *
 * `bookUsage` is the one call every sink makes (api, orchestrator, composer, gateway tool calls, session end): it writes
 * the ledger row and, when the platform paid for it, charges the business's credit balance for the row's period.
 * Credits are always enforced (DECISIONS 2026-10-12): every tier includes a monthly platform credit
 * (`includedCreditsMinor`, packages/config), granted on the first charge of the period when no top-up came first, so a
 * business on credits can never run on the platform's key without a ceiling. The charge that uses the last credit
 * pauses every agent and posts one Inbox warning from the Chief of Staff; later charges on an empty balance are
 * recorded (the ledger is the truth, overrun included) without repeating the pause or the note.
 *
 * What is charged: only platform costs in the credits currency (USD) for a business on credits. A business on its own
 * key never touches credits, not even for the api's and composer's platform-key calls (they are metered, labeled
 * Estimate); a tool row is third-party spend the vendor bills to the founder's own account; and an amount in another
 * currency is never subtracted from a USD balance.
 */
import { CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import { periodOf, type RecordUsageInput } from "./repos/usage";
import type { Business, CreditBalance, UsageEntry } from "./schema";

export const CREDITS_EXHAUSTED_SUBJECT = "Credits used up: team paused";

export interface CreditsOutcome {
  /** Always true since 2026-10-12 (every business on credits holds a balance); kept for callers that read it. */
  enforced: boolean;
  balance: CreditBalance | null;
  /** `now` on the charge that emptied the balance (agents paused, note posted); `already` when it was empty before. */
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

/** Records a usage row and settles it against credits when the platform paid for it (see the module comment). */
export async function bookUsage(db: Executor, businessId: string, input: RecordUsageInput): Promise<BookUsageResult> {
  const entry = await repos.usage.record(db, businessId, input);
  if (!chargesCredits(entry)) return { entry, credits: null };
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  if (business.modelBilling === "byok") return { entry, credits: null };
  const period = periodOf(entry.occurredAt);
  const charged = await repos.usage.chargeCredits(db, businessId, period, Number(entry.costMinor), { includedMinor: includedCreditsMinor(business.planTier) });
  if (!charged) return { entry, credits: { enforced: false, balance: null, exhausted: null, pausedAgents: 0, noteId: null } };
  if (charged.exhausted !== "now") return { entry, credits: { enforced: true, balance: charged.balance, exhausted: charged.exhausted, pausedAgents: 0, noteId: null } };
  const { pausedAgents, noteId } = await pauseForCredits(db, business, period);
  return { entry, credits: { enforced: true, balance: charged.balance, exhausted: "now", pausedAgents, noteId } };
}

/**
 * Where a business's credits stand this period, without writing anything: the balance row, or what the tier includes
 * when the period has no row yet (it is created on the first charge). Null for a business on its own key.
 */
export async function creditsState(db: Executor, business: Pick<Business, "id" | "planTier" | "modelBilling">, period: string): Promise<{ currency: typeof CREDITS_CURRENCY; balanceMinor: number; grantedMinor: number; spentMinor: number; includedMinor: number; exhausted: boolean } | null> {
  if (business.modelBilling === "byok") return null;
  const includedMinor = includedCreditsMinor(business.planTier);
  const row = await repos.usage.creditBalance(db, business.id, period);
  const balanceMinor = row ? Number(row.balanceMinor) : includedMinor;
  return { currency: CREDITS_CURRENCY, balanceMinor, grantedMinor: row ? Number(row.grantedMinor) : includedMinor, spentMinor: row ? Number(row.spentMinor) : 0, includedMinor, exhausted: balanceMinor <= 0 };
}

/** "$5.00" for a USD credits amount in copy the founder reads. */
const usd = (minor: number) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The 100 % action of BUILD §10.4: pause every agent and let the Inbox explain the way back for this tier. */
async function pauseForCredits(db: Executor, business: Business, period: string): Promise<{ pausedAgents: number; noteId: string | null }> {
  const businessId = business.id;
  const pausedAgents = await repos.agents.pauseAll(db, businessId);
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  let noteId: string | null = null;
  if (chief) {
    const way =
      business.planTier === "free"
        ? `The free plan includes ${usd(includedCreditsMinor("free"))} of model use a month, and this month's is used up, so every agent is paused. Add your own Anthropic key in Settings → Keys to keep the team working (your key is billed by Anthropic, not by us), then resume the team; tasks pick up where they stopped.`
        : `This month's credits are used up, so every agent is paused. Top up in Settings → Billing, or bring your own Anthropic key in Settings → Keys, then resume the team; tasks pick up where they stopped.`;
    const note = await repos.inbox.createItem(db, businessId, {
      type: "warning",
      from_agent_id: chief.id,
      subject: CREDITS_EXHAUSTED_SUBJECT,
      body_md: `${way} Spend so far is an Estimate in US dollars; the model invoice is the real figure.`,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    noteId = note.id;
  }
  await repos.audit.append(db, businessId, { actorKind: "system", action: "billing.credits_exhausted", target: { kind: "business", id: businessId }, details: { period, pausedAgents, noteId, planTier: business.planTier } });
  return { pausedAgents, noteId };
}
