/**
 * The facts the founder emails are built from (retention plan, 2026-11-11; one sender since 2026-11-12), read the same
 * way by the orchestrator's notifier (which decides what is due) and the gateway's `/v1/notify/email` (which reads them
 * again before it writes and sends). One business at a time, service role. Null for a business that is archived, a
 * sample, or not committed yet: nobody is emailed about those.
 */
import { FOUNDER_NOTIFICATION_LIMITS, type BusinessNotifyFacts, type RunEndFact } from "@foundmill/shared";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";

const DAY_MS = 86_400_000;

export async function loadNotifyFacts(db: Executor, businessId: string, now: Date): Promise<BusinessNotifyFacts | null> {
  const business = await repos.businesses.get(db, businessId).catch(() => null);
  if (!business || business.isDemo || !business.committedAt) return null;
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const [openDecisions, recentItems, milestones, events] = await Promise.all([
    repos.notifyFacts.openDecisions(db, businessId),
    repos.notifyFacts.itemsSince(db, businessId, ["customer_won", "milestone", "warning"], week),
    repos.notifyFacts.milestonesSince(db, businessId, week),
    repos.notifyFacts.eventsSince(db, businessId, ["cycle.completed", "cycle.run_ended"], week),
  ]);
  const ended = events.filter((e) => e.type === "cycle.run_ended" && now.getTime() - e.occurredAt.getTime() <= FOUNDER_NOTIFICATION_LIMITS.lookbackMs);
  const starts = await repos.notifyFacts.runStarts(db, businessId, ended.map((e) => String(e.payload.runId)));
  const runEnds: RunEndFact[] = ended.map((e) => {
    const p = e.payload as { runId: string; reason: string; rounds?: number; cost?: { amountMinor?: number; currency?: string } };
    const start = starts.get(p.runId);
    return { runId: p.runId, endedAt: e.occurredAt, reason: p.reason, rounds: p.rounds ?? 0, costMinor: p.cost?.amountMinor ?? 0, currency: p.cost?.currency ?? "USD", startedBy: start?.actor.kind === "user" ? start.actor.id : null, startedAt: start?.at ?? null };
  });
  return { businessId, name: business.name, timeZone: business.timeZone, now, openDecisions, recentItems, milestones, runEnds, cycles: events.filter((e) => e.type === "cycle.completed") };
}
