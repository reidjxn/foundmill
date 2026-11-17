/**
 * The chapter report (WP-14 T8; the founder's brief of Nov 17, 2026, A13): at the end of each chapter (a quarter) the
 * Chief of Staff writes one page to the Inbox: what we set out to do, what we did, the best moment, what we learned,
 * what's next.
 *
 * Real records only. The page is a template (packages/shared chapter-report.ts) over rows that exist, with no model
 * call, so it cannot invent: goals, the
 * work agents finished (`task.completed`), customers won (first payments), the reports agents saved, the work in hand.
 * Anything simulated is left out. Every item names the agent or the customer it is about as an entity link
 * (`[[ent:<uuid>|Name]]`), and the note carries the events and CRM entities it was built from (`source_event_ids`,
 * `entity_ids`). A section with nothing on record says so, and a chapter with little in it is called quiet.
 *
 * One report a chapter (`chapterReportKey`), written when the chapter's stored title is first asked for after it ended
 * (`ComposerService.chapterTitle`), for the chapter that has just ended only, and never for a sample business.
 */
import { repos, type ComposerItem, type Db } from "@foundmill/db";
import type { ModelLogger } from "@foundmill/models";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { CHAPTER_REPORT_SECTION_MAX, chapterReportBody, chapterReportKey, chapterReportSubject, isSimulatedEvent, type ChapterReportFacts, type ReportEntity } from "@foundmill/shared";
import { parseQuarter } from "./chapter";
import { persistNote, type Persisted } from "./persist";

const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
const titleOf = (t: { founderTitle: string | null; title: string }): string => (t.founderTitle ?? t.title).trim();

export interface LoadedChapterReport {
  facts: ChapterReportFacts;
  /** The events the items were built from (`task.completed`, the payments' source events). */
  sourceEventIds: string[];
  /** The CRM entities named (customers). */
  entityIds: string[];
}

/** The chapter's facts, read through the repositories. `chiefId` stands in as proposer for a goal that names none. */
export async function loadChapterReportFacts(db: Db, businessId: string, quarter: string, chief: ReportEntity): Promise<LoadedChapterReport> {
  const { from, to, label } = parseQuarter(quarter);
  const [goals, current, done, payments, reports, running, queued, agents, titles] = await Promise.all([
    repos.goals.recent(db, businessId, 50),
    repos.goals.current(db, businessId),
    repos.events.list(db, businessId, { type: "task.completed", from, to, limit: 500 }),
    repos.journeys.listConversions(db, businessId, { kind: "payment", firstPayment: true, from, to, limit: 500 }),
    repos.taskReports.listForBusiness(db, businessId, { limit: 500 }),
    repos.tasks.list(db, businessId, { status: "running", limit: 20 }),
    repos.tasks.list(db, businessId, { status: "ready", limit: 20 }),
    repos.agents.list(db, businessId, { limit: 200 }),
    repos.journeys.chapterTitles(db, businessId),
  ]);
  const agentOf = new Map(agents.items.map((a) => [a.id, { id: a.id, name: a.name }]));
  const proposer = (id: string | null): ReportEntity => (id ? agentOf.get(id) : undefined) ?? chief;

  // Goals in force at some point in the chapter: approved before it ended, not replaced before it began.
  const inForce = goals.filter((g) => g.approvedAt && g.approvedAt < to && (!g.replacedAt || g.replacedAt >= from)).sort((a, b) => b.approvedAt!.getTime() - a.approvedAt!.getTime());

  // Finished work, by agent. A simulated result is not work done.
  const real = done.items.filter((e) => !isSimulatedEvent(e));
  const byAgent = new Map<string, { done: number; longest: { taskId: string; title: string; minutes: number } | null }>();
  for (const e of real) {
    const p = e.payload as { assigneeAgentId?: unknown; taskId?: unknown; title?: unknown; durationMs?: unknown };
    if (typeof p.assigneeAgentId !== "string" || !agentOf.has(p.assigneeAgentId)) continue;
    const row = byAgent.get(p.assigneeAgentId) ?? { done: 0, longest: null };
    row.done += 1;
    const minutes = typeof p.durationMs === "number" ? Math.round(p.durationMs / 60_000) : 0;
    if (minutes >= 1 && (!row.longest || minutes > row.longest.minutes)) row.longest = { taskId: String(p.taskId ?? ""), title: String(p.title ?? ""), minutes };
    byAgent.set(p.assigneeAgentId, row);
  }
  const counted = real.filter((e) => byAgent.has(String((e.payload as { assigneeAgentId?: unknown }).assigneeAgentId)));

  // Customers won: first payments from a named customer whose payment event was real.
  const labeled = await repos.journeys.labelConversions(db, businessId, payments.items);
  const paymentEvents = await repos.events.byIds(db, businessId, labeled.map((c) => c.sourceEventId).filter((id): id is string => !!id));
  const simulated = new Set(paymentEvents.filter((e) => isSimulatedEvent(e)).map((e) => e.id));
  const won = labeled.filter((c) => c.entityId && c.entityName && !(c.sourceEventId && simulated.has(c.sourceEventId))).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const saved = reports.items.filter((r) => !r.simulated && r.createdAt >= from && r.createdAt < to && agentOf.has(r.agentId));
  const upcoming = [...running.items.map((t) => ({ t, running: true })), ...queued.items.map((t) => ({ t, running: false }))].filter(({ t }) => t.assigneeAgentId && agentOf.has(t.assigneeAgentId));

  return {
    facts: {
      label,
      title: titles[quarter] ?? null,
      goals: inForce.map((g) => ({ sentence: g.sentence, proposedBy: proposer(g.proposedByAgentId), achieved: !!g.achievedAt && g.achievedAt >= from && g.achievedAt < to })),
      work: [...byAgent.entries()].map(([id, w]) => ({ agent: agentOf.get(id)!, done: w.done, longest: w.longest ? { title: w.longest.title, minutes: w.longest.minutes } : null })).sort((a, b) => b.done - a.done),
      customers: won.map((c) => ({ customer: { id: c.entityId!, name: c.entityName! }, day: c.occurredAt.toLocaleDateString("en-US", DAY) })),
      reports: saved.map((r) => ({ agent: agentOf.get(r.agentId)!, title: r.title })),
      next: upcoming.map(({ t, running: isRunning }) => ({ agent: agentOf.get(t.assigneeAgentId!)!, title: titleOf(t), running: isRunning })),
      activeGoal: current.active ? { sentence: current.active.sentence, proposedBy: proposer(current.active.proposedByAgentId) } : null,
    },
    sourceEventIds: [...new Set([...counted.map((e) => e.id), ...won.map((c) => c.sourceEventId).filter((id): id is string => !!id)])].slice(0, 200),
    entityIds: [...new Set(won.slice(0, CHAPTER_REPORT_SECTION_MAX).map((c) => c.entityId!))],
  };
}

export type ChapterReportResult = { written: true; note: Persisted; facts: ChapterReportFacts } | { written: false; reason: "sample_business" | "not_ended" | "not_the_last_chapter" | "before_the_project" | "no_chief_of_staff" };

/**
 * Writes the chapter's report once. Only for the chapter that has just ended (an older one's records are history the
 * founder has already lived through, and a project that opens its Ribbon for the first time must not get a page for
 * every past quarter), only for a project that existed during it, never for a sample business.
 */
export async function composeChapterReport(deps: { db: Db; log: ModelLogger }, businessId: string, quarter: string, now: Date): Promise<ChapterReportResult> {
  const { from, to } = parseQuarter(quarter);
  if (to.getTime() > now.getTime()) return { written: false, reason: "not_ended" };
  const lastStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3 - 3, 1));
  if (from.getTime() !== lastStart.getTime()) return { written: false, reason: "not_the_last_chapter" };
  const business = await repos.businesses.get(deps.db, businessId);
  if (business.isDemo) return { written: false, reason: "sample_business" };
  if (business.createdAt.getTime() >= to.getTime()) return { written: false, reason: "before_the_project" };
  const chief = await repos.agents.chiefOfStaff(deps.db, businessId);
  if (!chief) return { written: false, reason: "no_chief_of_staff" };
  const loaded = await loadChapterReportFacts(deps.db, businessId, quarter, { id: chief.id, name: chief.name });
  const item: ComposerItem = {
    type: "report",
    from_agent_id: chief.id,
    subject: chapterReportSubject(loaded.facts.label),
    body_md: chapterReportBody(loaded.facts),
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: null,
    blocks_continue: false,
    source_event_ids: loaded.sourceEventIds,
    entity_ids: loaded.entityIds,
  };
  // The source events were narrated when they happened: this page cites them and marks nothing.
  const note = await persistNote(deps.db, deps.log, { businessId, item, eventIds: [], now, costMinorInt: 0, costCurrency: CREDITS_CURRENCY, slot: "chapter_report", idempotencyKey: chapterReportKey(quarter) });
  return { written: true, note, facts: loaded.facts };
}
