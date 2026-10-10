"use client";
/**
 * Department card widget (BUILD §11.2, DESIGN §9). One card per department: lead, health, squad strip, up to three
 * "Now" lines (entities linked), the module's headline metric with a sparkline, and "Next up". Reacts to
 * `agent.health_changed` and task events within the same render (AC-11.2.3) and then refetches.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import { LayoutGrid } from "lucide-react";
import type { AgentStatus, EntityKind, ModuleKey } from "@foundmill/shared";
import { MODULE_KEYS } from "@foundmill/shared/constants";
import { DepartmentCard, formatMoney, formatNumber, type DepartmentCardData, type DepartmentMetric, type HealthTone, type SquadMember } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery, type QueryState } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { primaryModule, resolveDepartment, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { departmentRows, useRecentRibbon } from "../shared/ribbon";
import { routes } from "../shared/routes";
import { addDays, dailySeries, dayKey, daysUntil, lastDays, sumInRange } from "../shared/time";
import type { ChannelsListResponse, ComplianceResponse, DepartmentRow, FinanceOverview, Page, RibbonResponse, RoadmapListResponse, TaskRow } from "../shared/types";
import { RUNWAY_WORDS, runwayWords } from "../shared/runway";

export const DEPARTMENT_METRICS = ["auto", "tasks_done", "roadmap_on_track", "blended_cpa", "runway", "squad_health", "next_filing"] as const;
export type DepartmentMetricKey = (typeof DEPARTMENT_METRICS)[number];

export const DepartmentCardSettings = z.object({
  /** Explicit department; wins over `module` and `slot`. */
  departmentId: z.string().nullable().default(null),
  /** The department owning this module (Builder/Seller presets). */
  module: z.enum(MODULE_KEYS).nullable().default(null),
  /** Nth visible department (Founder's view preset works for every archetype). */
  slot: z.number().int().min(0).max(15).nullable().default(null),
  /** Headline metric; "auto" follows the department's module (BUILD §11.2 defaults). */
  metric: z.enum(DEPARTMENT_METRICS).default("auto"),
});
export type DepartmentCardSettings = z.infer<typeof DepartmentCardSettings>;

const MODULE_METRIC: Record<ModuleKey, DepartmentMetricKey> = {
  product: "roadmap_on_track",
  development: "tasks_done",
  distribution: "blended_cpa",
  finance: "runway",
  team: "squad_health",
  legal: "next_filing",
};

export function metricKeyFor(settings: Pick<DepartmentCardSettings, "metric">, dept: Pick<DepartmentRow, "moduleKeys"> | undefined): DepartmentMetricKey {
  if (settings.metric !== "auto") return settings.metric;
  const mod = dept ? primaryModule(dept) : null;
  return mod ? MODULE_METRIC[mod] : "tasks_done";
}

const ACTIVE_TASK_STATUSES = ["running", "review", "merging", "blocked", "paused"] as const;
const NEXT_TASK_STATUSES = ["ready", "planned"] as const;
const TASK_EVENTS = ["task.started", "task.progressed", "task.completed", "task.blocked", "agent.health_changed", "cycle.completed"] as const;

const TASK_VERB: Record<string, string> = {
  running: "is working on",
  review: "is in review on",
  merging: "is merging",
  blocked: "is blocked on",
  paused: "paused",
};

/** Health of the department from its squad and open tasks: any failing agent → bad; waiting/blocked → warn. */
export function departmentHealth(squad: readonly SquadMember[], tasks: readonly TaskRow[]): { health: HealthTone; word: string } {
  if (squad.some((m) => m.status === "failing" || m.status === "injured")) return { health: "bad", word: "Failing" };
  if (tasks.some((t) => t.status === "blocked")) return { health: "warn", word: "Waiting" };
  if (squad.some((m) => m.status === "degraded")) return { health: "warn", word: "Degraded" };
  return { health: "good", word: "Healthy" };
}

/** "Now" lines: one per active task, the agent as an entity mention so it links to the profile. */
export function nowLines(tasks: readonly TaskRow[], squad: readonly SquadMember[], max = 3): string[] {
  const byId = new Map(squad.map((m) => [m.id, m.name]));
  return tasks
    .filter((t) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(t.status))
    .slice(0, max)
    .map((t) => {
      const who = t.assigneeAgentId ? `[[ent:${t.assigneeAgentId}|${byId.get(t.assigneeAgentId) ?? "An agent"}]]` : "The team";
      return `${who} ${TASK_VERB[t.status] ?? "is on"} ${t.title}`;
    });
}

export interface MetricInputs {
  key: DepartmentMetricKey;
  rows: RibbonResponse["rows"];
  days: string[];
  squad: readonly SquadMember[];
  roadmap?: RoadmapListResponse;
  channels?: ChannelsListResponse;
  finance?: FinanceOverview;
  compliance?: ComplianceResponse;
  currency: string;
  today: string;
}

const AT_RISK = new Set(["blocked", "at_risk", "late", "overdue"]);

/** The headline metric per BUILD §11.2 module defaults; every non-measured number carries provenance. */
export function headlineMetric(i: MetricInputs): DepartmentMetric {
  const weekFrom = addDays(i.today, -6);
  const prevFrom = addDays(i.today, -13);
  const prevTo = addDays(i.today, -7);
  const delta = (now: number, before: number, goodWhen: "up" | "down" = "up"): Pick<DepartmentMetric, "delta" | "deltaTone"> => {
    if (before === 0 && now === 0) return {};
    const diff = now - before;
    if (diff === 0) return { delta: "— 0", deltaTone: "good" };
    const good = goodWhen === "up" ? diff > 0 : diff < 0;
    return { delta: `${diff > 0 ? "▲" : "▼"} ${formatNumber(Math.abs(diff), { maxDigits: 1 })}`, deltaTone: good ? "good" : "bad" };
  };
  switch (i.key) {
    case "roadmap_on_track": {
      const now = (i.roadmap?.items ?? []).filter((it) => it.horizon === "now");
      const onTrack = now.filter((it) => !AT_RISK.has(it.status)).length;
      return { label: "Roadmap items on track", value: now.length ? `${onTrack}/${now.length}` : "—", series: dailySeries(i.rows, i.days, (r) => r.tasksDone) };
    }
    case "blended_cpa": {
      const b = i.channels?.blended;
      const cpa = b && b.customers > 0 ? Math.round(b.spendMinor / b.customers) : null;
      return { label: "Cost per customer", value: cpa === null ? "—" : formatMoney({ amountMinor: cpa, currency: i.currency }), series: dailySeries(i.rows, i.days, (r) => r.spendMinor), provenance: "estimate" };
    }
    case "runway": {
      const months = i.finance?.runway.months ?? null;
      // The shared runway words when there is no figure ("No limit" when cash-flow positive); Estimate only on a real estimate.
      if (months === null) return { label: "Runway", value: runwayWords(i.finance)?.value ?? RUNWAY_WORDS.no_bank.value, series: dailySeries(i.rows, i.days, (r) => r.revenueMinor) };
      return { label: "Runway", value: `${formatNumber(months, { maxDigits: 1 })} mo`, series: dailySeries(i.rows, i.days, (r) => r.revenueMinor), provenance: "estimate" };
    }
    case "squad_health": {
      const healthy = i.squad.filter((m) => m.status === "healthy").length;
      const pct = i.squad.length ? Math.round((healthy / i.squad.length) * 100) : null;
      return { label: "Team health", value: pct === null ? "—" : `${pct}%`, series: dailySeries(i.rows, i.days, (r) => r.agentHours) };
    }
    case "next_filing": {
      const dues = [...(i.compliance?.deadlines ?? []), ...(i.compliance?.filings ?? []).filter((f) => !f.filedAt), ...(i.compliance?.events ?? [])]
        .map((d) => daysUntil(d.dueAt ?? null))
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
      const next = dues[0];
      return { label: "Days to next filing", value: next === undefined ? "—" : formatNumber(next, { maxDigits: 0 }), series: dailySeries(i.rows, i.days, (r) => r.decisions), deltaTone: next !== undefined && next < 14 ? "warn" : undefined };
    }
    case "tasks_done":
    case "auto":
    default: {
      const week = sumInRange(i.rows, weekFrom, i.today, (r) => r.tasksDone);
      const before = sumInRange(i.rows, prevFrom, prevTo, (r) => r.tasksDone);
      return { label: "Tasks merged this week", value: formatNumber(week, { maxDigits: 0 }), series: dailySeries(i.rows, i.days, (r) => r.tasksDone), ...delta(week, before) };
    }
  }
}

export function toSquad(dept: DepartmentRow, overrides: Record<string, AgentStatus>, tasks: readonly TaskRow[]): SquadMember[] {
  return dept.squad.map((a) => ({
    id: a.id,
    name: a.name,
    seed: a.avatarSeed || a.id,
    status: overrides[a.id] ?? a.status,
    role: a.role,
    model: String(a.modelKey),
    task: tasks.find((t) => t.assigneeAgentId === a.id && (ACTIVE_TASK_STATUSES as readonly string[]).includes(t.status))?.title ?? null,
  }));
}

function DepartmentCardWidget({ settings }: WidgetProps<DepartmentCardSettings>) {
  const { businessId, navigate, currency = "EUR" } = useWidgetData();
  const today = dayKey();
  const departments = useDepartments();
  const dept = resolveDepartment(departments.data, settings);
  const enabled = !!dept;
  const metricKey = metricKeyFor(settings, dept);

  // The business-wide recent ribbon every card shares (one request for all of them), this department's rows picked here.
  const ribbon = useRecentRibbon({ enabled });
  const rows = useMemo(() => (dept ? departmentRows(ribbon.data, dept.id) : []), [ribbon.data, dept]);
  const tasks = useWidgetQuery<Page<TaskRow>>("dev.tasks.list", { departmentId: dept?.id, status: [...ACTIVE_TASK_STATUSES, ...NEXT_TASK_STATUSES], limit: 50 }, { enabled });
  const roadmap = useWidgetQuery<RoadmapListResponse>("product.roadmap.list", {}, { enabled: enabled && metricKey === "roadmap_on_track" });
  const channels = useWidgetQuery<ChannelsListResponse>("distribution.channels.list", {}, { enabled: enabled && metricKey === "blended_cpa" });
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {}, { enabled: enabled && metricKey === "runway" });
  const compliance = useWidgetQuery<ComplianceResponse>("legal.compliance.list", { pendingOnly: true, days: 365 }, { enabled: enabled && metricKey === "next_filing" });

  const [overrides, setOverrides] = useState<Record<string, AgentStatus>>({});
  const squadIds = useMemo(() => new Set(dept?.squad.map((a) => a.id) ?? []), [dept]);

  useBusinessEvents((event) => {
    if (event.type === "agent.health_changed") {
      const agentId = event.payload.agentId;
      const to = event.payload.to;
      if (typeof agentId === "string" && typeof to === "string" && (squadIds.has(agentId) || dept?.lead?.id === agentId)) {
        setOverrides((o) => ({ ...o, [agentId]: to as AgentStatus }));
        departments.refetch();
      }
      return;
    }
    tasks.refetch();
    if (event.type === "task.completed" || event.type === "cycle.completed") ribbon.refetch();
  }, TASK_EVENTS);

  const taskItems = useMemo(() => tasks.data?.items ?? [], [tasks.data]);
  const card: DepartmentCardData | null = useMemo(() => {
    if (!dept) return null;
    const squad = toSquad(dept, overrides, taskItems);
    const { health, word } = departmentHealth(squad, taskItems);
    const leadRow = dept.lead ?? dept.squad.find((a) => a.id === dept.leadAgentId) ?? dept.squad[0] ?? null;
    const next = taskItems.find((t) => (NEXT_TASK_STATUSES as readonly string[]).includes(t.status));
    return {
      id: dept.id,
      name: dept.name,
      dept: dept.colourToken,
      lead: leadRow ? { name: leadRow.name, seed: leadRow.avatarSeed || leadRow.id, status: overrides[leadRow.id] ?? leadRow.status } : { name: "No lead yet", seed: dept.id, status: "idle" },
      health,
      healthWord: word,
      squad,
      now: nowLines(taskItems, squad),
      metric: headlineMetric({ key: metricKey, rows, days: lastDays(14, today), squad, roadmap: roadmap.data, channels: channels.data, finance: finance.data, compliance: compliance.data, currency, today }),
      // A short status, not an instruction: every quiet card would otherwise repeat the same sentence.
      nextUp: next ? next.title : "Nothing queued",
    };
  }, [dept, overrides, taskItems, metricKey, rows, roadmap.data, channels.data, finance.data, compliance.data, currency, today]);

  const entityKinds = useMemo(() => Object.fromEntries([...squadIds].map((id) => [id, "agent" as EntityKind])), [squadIds]);
  const openEntity = (id: string) => navigate(squadIds.has(id) ? routes.agent(businessId, id) : routes.crm(businessId, id));
  const firstTab = dept?.tabs.slice().sort((a, b) => a.position - b.position)[0];

  if (card && dept) {
    return (
      <DepartmentCard
        department={card}
        className="h-full"
        onOpen={firstTab ? () => navigate(routes.department(businessId, dept.slug, firstTab.slug)) : undefined}
        onOpenAgent={(agentId) => navigate(routes.agent(businessId, agentId))}
        onOpenEntity={openEntity}
        entityKinds={entityKinds}
      />
    );
  }
  const dependent: QueryState<unknown>[] = enabled ? [departments, ribbon, tasks] : [departments];
  return (
    <WidgetFrame
      title={dept ? dept.name : "Department"}
      data-widget="department_card"
      queries={dependent}
      empty={departments.data && !dept ? { icon: LayoutGrid, text: "No department in this slot. Pick one in the widget settings, or add a department in Settings." } : null}
    />
  );
}

export const departmentCardWidget = registerWidget<DepartmentCardSettings>({
  key: "department_card",
  title: "Department card",
  description: "Lead, health, team, what is happening now, the headline metric and what is next for one department.",
  icon: "layout-grid",
  surfaces: ["home", "department"],
  // Sized to the card's content (header, team strip, three "Now" lines, the metric, "Next up"): a stored taller cell
  // (the seeded and API presets keep h 30) is clamped here rather than drawn as an empty plate (DESIGN §9 Home).
  defaultSize: { w: 4, h: 12, minW: 3, minH: 10, maxH: 16 },
  settingsSchema: DepartmentCardSettings,
  defaultSettings: DepartmentCardSettings.parse({}),
  Component: DepartmentCardWidget,
});
