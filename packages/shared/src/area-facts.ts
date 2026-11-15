/**
 * The facts behind each founder area's opening sentence (area-words.ts), read from the shapes the api answers: pure
 * mappings shared by the web (@foundmill/modules AreaOpening, from the tiles' own reads) and the api
 * (`business.areas.words`, for the mobile app), so both clients build the same sentence from the same figures. Every
 * input is a structural "Like" of the api's answer, never the api's type itself, so a browser bundle pays nothing.
 */
import type { CompanyAreaFacts, CustomersAreaFacts, MoneyAreaFacts, PlanAreaFacts, ProductAreaFacts, TeamAreaFacts } from "./area-words";
import { CHANNEL_META, type ChannelKey } from "./constants";
import { CHANNEL_WINDOW_DAYS } from "./constants";
import { deadlineWindow } from "./filings";
import { daysBetweenDays } from "./goals";
import { runwayState } from "./runway-state";
import { agentTier, isBackgroundAgent, type TierAgent, type TierDepartment } from "./team-tiers";

type DateLike = string | Date | null | undefined;
const dayOf = (d: DateLike): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/* ---------- Money ---------- */

export interface FinanceOverviewLike {
  cash: { amountMinor: number; currency: string; accounts: number };
  burn: { netBurnMinor: number; grossBurnMinor: number };
  runway: { months: number | null };
}

/** The Money line's facts from `finance.overview`. */
export function moneyFacts(overview: FinanceOverviewLike, currency: string): MoneyAreaFacts {
  return {
    currency: overview.cash.currency || currency,
    cashMinor: overview.cash.amountMinor,
    accounts: overview.cash.accounts,
    netBurnMinor: overview.burn.netBurnMinor,
    grossBurnMinor: overview.burn.grossBurnMinor,
    runwayMonths: overview.runway.months,
    runwayState: runwayState(overview),
  };
}

/* ---------- Company ---------- */

export interface IncorporationStatusLike {
  entity: { legalName: string; status: string } | null;
}
export interface ComplianceLike {
  events?: { id: string; dueAt: DateLike; completedAt?: DateLike }[];
  upcoming?: { filings?: { id: string; dueAt: DateLike; filedAt?: DateLike; status: string }[]; compliance?: { id: string; dueAt: DateLike; completedAt?: DateLike }[] };
  filings?: { id: string; dueAt: DateLike; filedAt?: DateLike; status: string }[];
}

/** The Company line's facts: the entity and every open filing and compliance date (each once, as the calendar lists them). */
export function companyFacts(status: IncorporationStatusLike | undefined, compliance: ComplianceLike | undefined, today: string): CompanyAreaFacts {
  const seen = new Set<string>();
  const deadlines: CompanyAreaFacts["deadlines"][number][] = [];
  for (const e of [...(compliance?.events ?? []), ...(compliance?.upcoming?.compliance ?? [])]) {
    if (seen.has(`c:${e.id}`)) continue;
    seen.add(`c:${e.id}`);
    const dueOn = dayOf(e.dueAt);
    deadlines.push({ dueOn, open: !e.completedAt, ...(dueOn && !e.completedAt ? { window: deadlineWindow(dueOn, today) } : {}) });
  }
  for (const f of [...(compliance?.filings ?? []), ...(compliance?.upcoming?.filings ?? [])]) {
    if (seen.has(`f:${f.id}`)) continue;
    seen.add(`f:${f.id}`);
    const dueOn = dayOf(f.dueAt);
    const open = !f.filedAt && f.status !== "filed" && f.status !== "waived";
    // The same window and stored-status rule as Compliance's calendar (`deadlineWindow`, ./filings).
    deadlines.push({ dueOn, open, ...(dueOn && open ? { window: deadlineWindow(dueOn, today, f.status) } : {}) });
  }
  return { legalName: status?.entity?.legalName ?? null, status: status?.entity?.status ?? null, deadlines, today };
}

/* ---------- Plan ---------- */

export interface GoalViewsLike {
  active: { sentence: string; progress: { pace: string } | null } | null;
  proposed: { sentence: string } | null;
}
export interface RoadmapLike {
  items: { horizon: string; targetEnd: string | null; status: string }[];
}

/** The Plan line's facts from `goal.current` and `product.roadmap.list` (null roadmap: not readable here). */
export function planFacts(goals: GoalViewsLike | null | undefined, roadmap: RoadmapLike | null | undefined, today: string): PlanAreaFacts {
  return {
    goalUnknown: !goals,
    goal: goals?.active ? { sentence: goals.active.sentence, pace: goals.active.progress?.pace ?? null } : null,
    proposedGoal: goals?.proposed ? { sentence: goals.proposed.sentence } : null,
    roadmap: roadmap ? roadmap.items.map((i) => ({ horizon: i.horizon, targetEnd: i.targetEnd, done: i.status === "done" })) : null,
    today,
  };
}

/* ---------- Customers ---------- */

export interface ChannelRowLike {
  channelKey: string;
  meta?: { label: string } | null;
  form: { customers: number; leads: number } | null;
}
export interface ChannelsListLike {
  channels: ChannelRowLike[];
  blended: { days: number; leads: number; customers: number };
}

/** The channel most of the window's customers came from (else most of its leads), by its display name. */
export function topChannelOf(channels: readonly ChannelRowLike[]): string | null {
  const rows = channels.filter((c) => c.form);
  const by = (key: "customers" | "leads") => rows.filter((c) => c.form![key] > 0).sort((a, b) => b.form![key] - a.form![key])[0];
  const top = by("customers") ?? by("leads");
  if (!top) return null;
  return top.meta?.label ?? CHANNEL_META[top.channelKey as ChannelKey]?.label ?? null;
}

/** The Customers line's facts: whether selling started, the channel window's totals and the live campaigns. */
export function customersFacts(selling: boolean | null, channels: ChannelsListLike | undefined, campaigns: { items: { status: string }[] } | null | undefined): CustomersAreaFacts {
  const blended = channels?.blended;
  return {
    selling,
    days: blended?.days || CHANNEL_WINDOW_DAYS,
    leads: blended?.leads ?? 0,
    customers: blended?.customers ?? 0,
    topChannel: channels ? topChannelOf(channels.channels) : null,
    liveCampaigns: campaigns ? campaigns.items.filter((c) => c.status === "live").length : null,
  };
}

/* ---------- Product ---------- */

export interface PrsLike {
  open: { kind?: string }[];
  merged: { occurredAt: DateLike }[];
}
export interface DeploymentsLike {
  items: { environment: string; occurredAt: DateLike }[];
}

/** The Product line's facts: the stage, what went live in the last 7 days, what waits, when the live product last changed. */
export function productFacts(stage: ProductAreaFacts["stage"], prs: PrsLike | null | undefined, deployments: DeploymentsLike | null | undefined, today: string, days = 7): ProductAreaFacts {
  const recent = (d: DateLike) => {
    const day = dayOf(d);
    if (!day) return false;
    const ago = daysBetweenDays(day, today);
    return ago >= 0 && ago < days;
  };
  const production = (deployments?.items ?? []).filter((d) => d.environment === "production").map((d) => dayOf(d.occurredAt)).filter((d): d is string => !!d).sort();
  return {
    stage,
    liveInWindow: prs ? prs.merged.filter((m) => recent(m.occurredAt)).length : null,
    waiting: prs ? prs.open.filter((p) => p.kind === undefined || p.kind === "code").length : null,
    lastLiveOn: production.at(-1) ?? null,
    today,
    days,
  };
}

/* ---------- Team ---------- */

export interface TeamAgentLike extends TierAgent {
  name: string;
  role?: string | null;
  personaKey?: string | null;
  status: string;
  archivedAt?: unknown;
}

/** The Team line's facts from the agents' tiers; `shownName` is the name the reader sees for an agent. */
export function teamFacts<A extends TeamAgentLike>(agents: readonly A[], departments: readonly TierDepartment[] | undefined, shownName: (a: A) => string): { facts: TeamAreaFacts; chief: A | null } {
  const visible = agents.filter((a) => !a.archivedAt && !isBackgroundAgent(a));
  const tiers = visible.map((a) => ({ a, tier: agentTier(a, departments) }));
  const chief = tiers.find((t) => t.tier === "chief")?.a ?? null;
  const shown = chief ? shownName(chief).trim() : "";
  const role = (chief?.role ?? "").trim().toLowerCase();
  const named = !!chief && shown.toLowerCase() !== "chief of staff" && shown.toLowerCase() !== role;
  return {
    chief,
    facts: {
      chief: chief ? { id: chief.id, name: shown || chief.name, named } : null,
      leads: tiers.filter((t) => t.tier === "lead").length,
      specialists: tiers.filter((t) => t.tier === "specialist").length,
      needYou: visible.filter((a) => a.status === "failing" || a.status === "injured").length,
    },
  };
}
