"use client";
/**
 * The opening line of each founder area (docs/DESIGN.md §9 "Opening line"): the design system's `AreaLine` with the
 * sentence of @foundmill/shared/area-words, built from the same reads (same paths, same inputs, so the same cache
 * entries) as the area's tabs, so the sentence always shows the number the tiles show:
 *
 * - Money: `finance.overview` and `runwayState` (Overview, Runway), with the Company line from
 *   `legal.incorporate.status` and `legal.compliance.list` (Company, Compliance).
 * - Plan: `goal.current` (its sentence and pace line) and `product.roadmap.list` (Roadmap).
 * - Customers: `business.get` (selling started), `distribution.channels.list` (the 35-day channel window) and
 *   `distribution.campaigns.list` (Campaigns).
 * - Product: `business.get` (the product stage), `dev.prs.list` (What changed) and `dev.deployments.list` (Live product).
 * - Team: `team.agents.list` tiers with `department.list` (Agents), the Chief of Staff named through EntityLink under
 *   the reader's naming preference.
 *
 * A read this person may not open (a walled section) leaves its part out; a read that fails hides the line rather than
 * guessing. The kind line comes from the host: the department this tab belongs to, when its name is not the area's.
 */
import { useMemo, type ReactNode } from "react";
import { AreaLine, EntityLink, parseEntityText, useAgentPersona } from "@foundmill/dugout";
import {
  AREA_LABELS,
  CHANNEL_META,
  CHANNEL_WINDOW_DAYS,
  areaKindWords,
  companyAreaWords,
  customersAreaWords,
  daysBetweenDays,
  deadlineWindow,
  moneyAreaWords,
  planAreaWords,
  productAreaWords,
  teamAreaWords,
  agentTier,
  isBackgroundAgent,
  type AreaKey,
  type AreaSectionKey,
  type AreaWords,
  type ChannelKey,
  type CompanyAreaFacts,
  type CustomersAreaFacts,
  type MoneyAreaFacts,
  type PlanAreaFacts,
  type ProductAreaFacts,
  type ProductStage,
  type TeamAreaFacts,
  type TierAgent,
  type TierDepartment,
} from "@foundmill/shared";
import { useToday, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { runwayState } from "@foundmill/widgets/shared/runway";
import type { ChannelsListResponse, FinanceOverview, Page } from "@foundmill/widgets/shared/types";
import { useBusinessStage } from "../stage";

// The inputs the area's own screens send, so the line shares their cache entries (and their requests).
const OVERVIEW_INPUT: Record<string, unknown> = {};
const EMPTY_INPUT: Record<string, unknown> = {};
const COMPLIANCE_INPUT = { pendingOnly: false, days: 365 } as const;
const CAMPAIGNS_INPUT = { limit: 200 } as const;
const AGENTS_INPUT = { includeArchived: false } as const;

type DateLike = string | Date | null | undefined;
const dayOf = (d: DateLike): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/* ---------- Facts from the reads (pure, exported for tests) ---------- */

/** The Money line's facts from `finance.overview`. */
export function moneyFacts(overview: FinanceOverview, currency: string): MoneyAreaFacts {
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
    // The same window and stored-status rule as Compliance's calendar (`deadlineWindow`, @foundmill/shared/filings).
    deadlines.push({ dueOn, open, ...(dueOn && open ? { window: deadlineWindow(dueOn, today, f.status) } : {}) });
  }
  return { legalName: status?.entity?.legalName ?? null, status: status?.entity?.status ?? null, deadlines, today };
}

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

/** The channel most of the window's customers came from (else most of its leads), by its display name. */
export function topChannelOf(channels: ChannelsListResponse["channels"]): string | null {
  const rows = channels.filter((c) => c.form);
  const by = (key: "customers" | "leads") => rows.filter((c) => c.form![key] > 0).sort((a, b) => b.form![key] - a.form![key])[0];
  const top = by("customers") ?? by("leads");
  if (!top) return null;
  return top.meta?.label ?? CHANNEL_META[top.channelKey as ChannelKey]?.label ?? null;
}

/** The Customers line's facts: whether selling started, the channel window's totals and the live campaigns. */
export function customersFacts(selling: boolean | null, channels: ChannelsListResponse | undefined, campaigns: Page<{ status: string }> | null | undefined): CustomersAreaFacts {
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

export interface PrsLike {
  open: { kind?: string }[];
  merged: { occurredAt: DateLike }[];
}
export interface DeploymentsLike {
  items: { environment: string; occurredAt: DateLike }[];
}

/** The Product line's facts: the stage, what went live in the last 7 days, what waits, when the live product last changed. */
export function productFacts(stage: ProductStage | null, prs: PrsLike | null | undefined, deployments: DeploymentsLike | null | undefined, today: string, days = 7): ProductAreaFacts {
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

export interface TeamAgentLike extends TierAgent {
  name: string;
  role?: string | null;
  personaKey?: string | null;
  status: string;
  archivedAt?: unknown;
}

/** The Team line's facts from `team.agents.list` tiers; `shownName` is the name the reader sees for an agent. */
export function teamFacts(agents: readonly TeamAgentLike[], departments: readonly TierDepartment[] | undefined, shownName: (a: TeamAgentLike) => string): { facts: TeamAreaFacts; chief: TeamAgentLike | null } {
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

/* ---------- The lines ---------- */

interface LineState {
  words: AreaWords | null;
  loading: boolean;
}

const readable = (q: { error: Error | null }) => !q.error;

function useMoneyLine(): LineState {
  const { currency } = useWidgetData();
  const q = useWidgetQuery<FinanceOverview>("finance.overview", OVERVIEW_INPUT);
  return useMemo(() => ({ words: q.data ? moneyAreaWords(moneyFacts(q.data, currency)) : null, loading: q.isLoading }), [q.data, q.isLoading, currency]);
}

function useCompanyLine(today: string): LineState {
  const status = useWidgetQuery<IncorporationStatusLike>("legal.incorporate.status", EMPTY_INPUT);
  const compliance = useWidgetQuery<ComplianceLike>("legal.compliance.list", COMPLIANCE_INPUT);
  return useMemo(() => {
    if (!readable(status) || !status.data) return { words: null, loading: status.isLoading };
    return { words: companyAreaWords(companyFacts(status.data, readable(compliance) ? compliance.data : undefined, today)), loading: false };
  }, [status, compliance, today]);
}

function usePlanLine(today: string): LineState {
  const goals = useWidgetQuery<GoalViewsLike>("goal.current", EMPTY_INPUT);
  const roadmap = useWidgetQuery<RoadmapLike>("product.roadmap.list", EMPTY_INPUT);
  return useMemo(() => {
    if (!goals.data && goals.isLoading) return { words: null, loading: true };
    if (!roadmap.data && roadmap.isLoading) return { words: null, loading: true };
    if (!goals.data && !roadmap.data) return { words: null, loading: false };
    return { words: planAreaWords(planFacts(readable(goals) ? goals.data : null, readable(roadmap) ? roadmap.data : null, today)), loading: false };
  }, [goals, roadmap, today]);
}

function useCustomersLine(): LineState {
  const stage = useBusinessStage();
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", EMPTY_INPUT);
  const campaigns = useWidgetQuery<Page<{ status: string }>>("distribution.campaigns.list", CAMPAIGNS_INPUT);
  return useMemo(() => {
    if (stage.distributionStarted === false) return { words: customersAreaWords(customersFacts(false, undefined, null)), loading: false };
    if (stage.isLoading || channels.isLoading) return { words: null, loading: true };
    if (!channels.data) return { words: null, loading: false };
    return { words: customersAreaWords(customersFacts(stage.distributionStarted, channels.data, readable(campaigns) ? campaigns.data : null)), loading: false };
  }, [stage.distributionStarted, stage.isLoading, channels, campaigns]);
}

function useProductLine(today: string): LineState {
  const stage = useBusinessStage();
  const prs = useWidgetQuery<PrsLike>("dev.prs.list", EMPTY_INPUT);
  const deployments = useWidgetQuery<DeploymentsLike>("dev.deployments.list", EMPTY_INPUT);
  return useMemo(() => {
    if (stage.isLoading && !stage.stage) return { words: null, loading: true };
    const before = stage.stage === "drafting" || stage.stage === "awaiting_signoff";
    if (!before && prs.isLoading) return { words: null, loading: true };
    return { words: productAreaWords(productFacts(stage.stage, readable(prs) ? prs.data : null, readable(deployments) ? deployments.data : null, today)), loading: false };
  }, [stage.stage, stage.isLoading, prs, deployments, today]);
}

/** The Team sentence with the Chief of Staff as an EntityLink under the reader's naming preference. */
function useTeamLine(): LineState & { node: ReactNode } {
  const { businessId } = useWidgetData();
  const q = useWidgetQuery<{ agents: TeamAgentLike[] }>("team.agents.list", AGENTS_INPUT);
  const departments = useDepartments();
  const persona = useAgentPersona();
  return useMemo(() => {
    if (!q.data) return { words: null, loading: q.isLoading, node: null };
    const { facts, chief } = teamFacts(q.data.agents, departments.data, (a) => persona.nameFor({ name: a.name, role: a.role ?? null, personaKey: a.personaKey ?? null, layer: a.layer ?? null }));
    const words = teamAreaWords(facts);
    const node = parseEntityText(words.text).map((n, i) =>
      n.type === "entity" && chief ? (
        <EntityLink
          key={i}
          entity={{ id: chief.id, kind: "agent", name: chief.name, href: routes.agent(businessId, chief.id) }}
          details={{ id: chief.id, kind: "agent", name: chief.name, subtitle: chief.role ?? undefined, role: chief.role ?? null, personaKey: chief.personaKey ?? null }}
          display={n.display}
          personaText="name"
        />
      ) : (
        <span key={i}>{n.type === "text" ? n.text : n.type === "entity" ? n.display : ""}</span>
      ),
    );
    return { words, loading: false, node };
  }, [q.data, q.isLoading, departments.data, persona, businessId]);
}

export interface AreaOpeningProps {
  area: AreaKey;
  /** The department this tab belongs to, for the kind line; leave out on a fixed tab (Milestones, Contacts). */
  departmentName?: string | null;
  /** The section of the area the tab sits in (Company), for the kind line. */
  section?: AreaSectionKey | null;
  /** The business's day ("2026-11-09"); defaults to today in the business time zone. */
  today?: string;
  className?: string;
}

function Line({ area, state, sections, kind, className, sentence }: { area: AreaKey; state: LineState; sections?: { id: string; label: string; state: LineState }[]; kind: string | null; className?: string; sentence?: ReactNode }) {
  return (
    <AreaLine
      area={AREA_LABELS[area]}
      data-area={area}
      sentence={state.words ? (sentence ?? state.words.text) : null}
      provenance={state.words?.provenance ?? null}
      loading={state.loading}
      sections={sections?.map((s) => ({ id: s.id, label: s.label, sentence: s.state.words?.text ?? null, provenance: s.state.words?.provenance ?? null }))}
      kind={kind}
      className={className}
    />
  );
}

function MoneyOpening({ today, kind, className }: { today: string; kind: string | null; className?: string }) {
  const money = useMoneyLine();
  const company = useCompanyLine(today);
  return <Line area="money" state={money} sections={[{ id: "company", label: "Company", state: company }]} kind={kind} className={className} />;
}

function PlanOpening({ today, kind, className }: { today: string; kind: string | null; className?: string }) {
  return <Line area="plan" state={usePlanLine(today)} kind={kind} className={className} />;
}

function CustomersOpening({ kind, className }: { kind: string | null; className?: string }) {
  return <Line area="customers" state={useCustomersLine()} kind={kind} className={className} />;
}

function ProductOpening({ today, kind, className }: { today: string; kind: string | null; className?: string }) {
  return <Line area="product" state={useProductLine(today)} kind={kind} className={className} />;
}

function TeamOpening({ kind, className }: { kind: string | null; className?: string }) {
  const team = useTeamLine();
  return <Line area="team" state={team} sentence={team.node} kind={kind} className={className} />;
}

/** The area's opening line, first on each of its tabs. */
export function AreaOpening({ area, departmentName, section, today: todayProp, className }: AreaOpeningProps) {
  const businessToday = useToday();
  const today = todayProp ?? businessToday;
  const kind = departmentName ? areaKindWords({ departmentName, area, section }) : null;
  switch (area) {
    case "money":
      return <MoneyOpening today={today} kind={kind} className={className} />;
    case "plan":
      return <PlanOpening today={today} kind={kind} className={className} />;
    case "customers":
      return <CustomersOpening kind={kind} className={className} />;
    case "product":
      return <ProductOpening today={today} kind={kind} className={className} />;
    case "team":
      return <TeamOpening kind={kind} className={className} />;
  }
}
