/**
 * Booking usage against credits (BUILD §10.4 "Cost controls", §10.5 "`credit_balances` debited from `usage_ledger`;
 * when credits run out, agents pause").
 *
 * `bookUsage` is the one call every sink makes (api, orchestrator, composer, gateway tool calls, session end): it writes
 * the ledger row, and when the row is billed to `credits` it charges the business's credit balance for the row's period.
 * Enforcement only starts once a balance row exists for the period (a grant or a top-up): included credit sizes are an
 * open decision (§19), so a business that was never granted anything is metered but never paused. The charge that uses
 * the last credit stops the team (the business's stop flag, reason `credits_exhausted`: nothing starts work until a
 * top-up, a stored key or an owner or admin lifts it) and posts one Inbox warning from the Chief of Staff; later charges
 * on an empty balance are recorded (the ledger is the truth, overrun included) without repeating the pause or the note.
 * Rows billed to `byok` touch no balance: the founder's own vendor invoice is the only real cost.
 */
import { stopBusinessAgents } from "./controls";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import { periodOf, type RecordUsageInput } from "./repos/usage";
import type { CreditBalance, UsageEntry } from "./schema";

export const CREDITS_EXHAUSTED_SUBJECT = "Credits used up: team paused";

export interface CreditsOutcome {
  /** False when the business holds no balance row for the period (nothing granted, nothing enforced). */
  enforced: boolean;
  balance: CreditBalance | null;
  /** `now` on the charge that emptied the balance (agents paused, note posted); `already` when it was empty before. */
  exhausted: "now" | "already" | null;
  pausedAgents: number;
  noteId: string | null;
}

export interface BookUsageResult {
  entry: UsageEntry;
  /** Null for rows billed to `byok`. */
  credits: CreditsOutcome | null;
}

/** Records a usage row and settles it against credits when the platform paid for it (see the module comment). */
export async function bookUsage(db: Executor, businessId: string, input: RecordUsageInput): Promise<BookUsageResult> {
  const entry = await repos.usage.record(db, businessId, input);
  if (entry.billedTo !== "credits") return { entry, credits: null };
  const period = periodOf(entry.occurredAt);
  const charged = await repos.usage.chargeCredits(db, businessId, period, Number(entry.costMinor));
  if (!charged) return { entry, credits: { enforced: false, balance: null, exhausted: null, pausedAgents: 0, noteId: null } };
  if (charged.exhausted !== "now") return { entry, credits: { enforced: true, balance: charged.balance, exhausted: charged.exhausted, pausedAgents: 0, noteId: null } };
  const { pausedAgents, noteId } = await pauseForCredits(db, businessId, period);
  return { entry, credits: { enforced: true, balance: charged.balance, exhausted: "now", pausedAgents, noteId } };
}

/**
 * The 100 % action of BUILD §10.4: stop the team (the business's stop flag, so nothing starts work until it is lifted)
 * and let the Inbox explain and offer a top-up. A top-up or a stored key lifts this stop by itself (`resumeBusinessAgents`).
 */
async function pauseForCredits(db: Executor, businessId: string, period: string): Promise<{ pausedAgents: number; noteId: string | null }> {
  const pausedAgents = (await stopBusinessAgents(db, businessId, { reason: "credits_exhausted" })).paused.length;
  const chief = await repos.agents.chiefOfStaff(db, businessId);
  let noteId: string | null = null;
  if (chief) {
    const note = await repos.inbox.createItem(db, businessId, {
      type: "warning",
      from_agent_id: chief.id,
      subject: CREDITS_EXHAUSTED_SUBJECT,
      body_md: `This month's credits are used up, so every agent is paused. Top up in Settings → Billing or bring your own key in Settings → Keys, and the team resumes by itself; tasks pick up where they stopped. Spend so far is an Estimate; the model invoice is the real figure.`,
      status_strip: [],
      exhibit: { kind: "none", spec_ref: null },
      decision: null,
      blocks_continue: true,
      source_event_ids: [],
      entity_ids: [],
    });
    noteId = note.id;
  }
  await repos.audit.append(db, businessId, { actorKind: "system", action: "billing.credits_exhausted", target: { kind: "business", id: businessId }, details: { period, pausedAgents, noteId } });
  return { pausedAgents, noteId };
}
