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
  areaKindWords,
  companyAreaWords,
  companyFacts,
  customersAreaWords,
  customersFacts,
  moneyAreaWords,
  moneyFacts,
  planAreaWords,
  planFacts,
  productAreaWords,
  productFacts,
  teamAreaWords,
  teamFacts,
  type AreaKey,
  type AreaSectionKey,
  type AreaWords,
  type ComplianceLike,
  type DeploymentsLike,
  type GoalViewsLike,
  type IncorporationStatusLike,
  type PrsLike,
  type RoadmapLike,
  type TeamAgentLike,
} from "@foundmill/shared";
import { useToday, useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import type { ChannelsListResponse, FinanceOverview, Page } from "@foundmill/widgets/shared/types";
import { useBusinessStage } from "../stage";

// The inputs the area's own screens send, so the line shares their cache entries (and their requests).
const OVERVIEW_INPUT: Record<string, unknown> = {};
const EMPTY_INPUT: Record<string, unknown> = {};
const COMPLIANCE_INPUT = { pendingOnly: false, days: 365 } as const;
const CAMPAIGNS_INPUT = { limit: 200 } as const;
const AGENTS_INPUT = { includeArchived: false } as const;

/* ---------- Facts from the reads: the pure builders in @foundmill/shared (area-facts.ts), shared with the api ---------- */

export { companyFacts, customersFacts, moneyFacts, planFacts, productFacts, teamFacts, topChannelOf } from "@foundmill/shared";
export type { ComplianceLike, DeploymentsLike, GoalViewsLike, IncorporationStatusLike, PrsLike, RoadmapLike, TeamAgentLike } from "@foundmill/shared";

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
