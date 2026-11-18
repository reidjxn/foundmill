/**
 * What the morning brief reads beside `loadNotifyFacts` (item 10, Nov 13, 2026): the events that can be real outcomes,
 * what is booked in the next two weeks, what the team does next, the agents' names and when this person's last brief
 * went out. Read by the gateway only (`POST /v1/notify/email`, kinds `daily_brief` and `weekly_review`), service role,
 * one business at a time; the orchestrator's sweep never reads it, so its five-minute pass costs nothing more. Nothing
 * here decides what is real or what the person may see: packages/shared `realOutcomes` and the gateway's walls do.
 */
import { BRIEF_BOOKED_DAYS, BRIEF_EVENT_TYPES, EFFORT_EVENT_TYPES, type BookedFact, type BriefEventLike, type ViaPost } from "@foundmill/shared";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";

const DAY_MS = 86_400_000;

export interface BriefTask {
  title: string;
  status: string;
}

export interface BriefAgent {
  id: string;
  name: string;
  role: string;
  personaKey: string | null;
  agentType: string;
  layer: string | null;
}

export interface BriefFacts {
  /** Outcome events (and the conversions that name their lead channel) of the last week, oldest first. */
  events: BriefEventLike[];
  /** The team's effort events of the last week (WP-14 T5; packages/shared effort.ts counts them), oldest first. */
  effortEvents: BriefEventLike[];
  booked: BookedFact[];
  running: string[];
  queued: string[];
  autopilotNextAt: Date | null;
  stopped: boolean;
  agents: BriefAgent[];
  /** When this person's last brief or weekly review went out from this business; null for a first one. */
  lastBriefAt: Date | null;
  /** The shared team post each credited follow, reply or payment came through, by its event id (item 8). */
  viaPosts: Map<string, ViaPost>;
}

/** The outcome events a post can be credited with (packages/db `post_attributions`). */
const CREDITABLE_TYPES: ReadonlySet<string> = new Set(["page.followed", "lead.replied", "payment.received"]);

const titleOf = (t: { founderTitle: string | null; title: string }) => (t.founderTitle ?? t.title).trim();

export async function loadBriefFacts(db: Executor, businessId: string, userId: string, now: Date): Promise<BriefFacts> {
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const horizon = new Date(now.getTime() + (BRIEF_BOOKED_DAYS + 1) * DAY_MS);
  const startOfToday = new Date(now.getTime() - DAY_MS);
  const [business, events, effortEvents, calendar, goals, roadmap, running, queued, agents, lastBriefAt] = await Promise.all([
    repos.businesses.get(db, businessId).catch(() => null),
    repos.notifyFacts.eventsSince(db, businessId, BRIEF_EVENT_TYPES, week, 1_000),
    repos.notifyFacts.eventsSince(db, businessId, EFFORT_EVENT_TYPES, week, 2_000),
    repos.notifyFacts.briefCalendar(db, businessId, { now, from: startOfToday, until: horizon }),
    repos.goals.current(db, businessId),
    repos.product.listRoadmap(db, businessId),
    repos.tasks.list(db, businessId, { status: "running", limit: 5 }),
    repos.tasks.list(db, businessId, { status: ["ready", "planned"], limit: 20 }),
    repos.agents.list(db, businessId, { limit: 100 }),
    repos.notifyFacts.lastBriefSentAt(db, businessId, userId),
  ]);
  const booked: BookedFact[] = [
    ...calendar.campaigns.filter((c) => c.startsAt).map((c) => ({ kind: "campaign" as const, title: c.name, at: c.startsAt, day: null })),
    ...calendar.filings.filter((f) => f.dueAt).map((f) => ({ kind: "filing" as const, title: f.title || f.kind, at: f.dueAt, day: null })),
    ...calendar.compliance.map((c) => ({ kind: "compliance" as const, title: c.title || c.kind, at: c.dueAt, day: null })),
    ...(goals.active ? [{ kind: "goal" as const, title: goals.active.sentence, at: null, day: goals.active.dueOn }] : []),
    ...roadmap.filter((r) => (r.horizon === "now" || r.horizon === "next") && r.targetEnd && !["done", "shipped", "archived"].includes(r.status)).map((r) => ({ kind: "roadmap" as const, title: r.title, at: null, day: r.targetEnd })),
  ];
  const oldestFirst = <T extends { createdAt: Date }>(rows: readonly T[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const ready = oldestFirst(queued.items.filter((t) => t.status === "ready"));
  const planned = oldestFirst(queued.items.filter((t) => t.status === "planned"));
  const autopilotOn = !!business?.autopilotEnabled && !business.autopilotPausedReason;
  const viaPosts = await repos.postAttributions.viaPostFor(db, businessId, events.filter((e) => CREDITABLE_TYPES.has(e.type)).map((e) => e.id));
  return {
    events,
    effortEvents,
    booked,
    running: oldestFirst(running.items).map(titleOf),
    queued: [...ready, ...planned].map(titleOf),
    autopilotNextAt: autopilotOn ? (business?.autopilotNextAt ?? null) : null,
    stopped: !!business?.agentsStoppedAt,
    agents: agents.items.filter((a) => !a.archivedAt).map((a) => ({ id: a.id, name: a.name, role: a.role, personaKey: a.personaKey ?? null, agentType: a.agentType, layer: a.layer ?? null })),
    lastBriefAt,
    viaPosts,
  };
}
