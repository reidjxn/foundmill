"use client";
/**
 * Department card widget (BUILD §11.2, DESIGN §9). One card per department: lead, health, team strip, up to three
 * "Working on now" lines (entities linked), the module's headline metric with a sparkline (captions in plain words,
 * UX plan B9: "Tasks finished this week", "Cost to win a customer", "Months of cash left"), and "Next". A quiet
 * department (no task in progress) gets one line from real data instead of a void: the note waiting for the founder,
 * an unread note, or the last task it finished (`quietLine`). Reacts to `agent.health_changed` and task events within
 * the same render (AC-11.2.3) and then refetches.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import { LayoutGrid } from "lucide-react";
import type { AgentStatus, EntityKind, ModuleKey } from "@foundmill/shared";
import { MODULE_KEYS } from "@foundmill/shared/constants";
import { DepartmentCard, formatDate, formatMoney, formatNumber, useDateFormat, useWidgetInstanceLabel, type DateFormatPrefs, type DepartmentCardData, type DepartmentMetric, type DepartmentQuietLine, type HealthTone, type SquadMember } from "@foundmill/dugout";
import { useBusinessEvents, useGlossary, useToday, useWidgetData, useWidgetQuery, type QueryState } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, primaryModule, resolveDepartment, useDepartments } from "../shared/departments";
import { failedWithoutData, unavailableWords } from "../shared/errors";
import { WidgetFrame } from "../shared/frame";
import { NEEDS_ATTENTION_STATUSES, needsAttention, teamHealth } from "../shared/health";
import { departmentRows, useRecentRibbon } from "../shared/ribbon";
import { routes } from "../shared/routes";
import { addDays, dailySeries, daysUntil, lastDays, sumInRange } from "../shared/time";
import type { ChannelsListResponse, ComplianceResponse, DepartmentRow, FinanceOverview, InboxItemRow, InboxListResponse, Page, RibbonResponse, RoadmapListResponse, TaskRow } from "../shared/types";
import { RESPOND_TAG, noteRowTag } from "../shared/note-tags";
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

/**
 * Health of the department from its team and open tasks, in Team › Health's words: a failing agent → "Failing", a down
 * one (`injured`: waiting on a credential, with an expected return) → "Down", a blocked task → "Waiting", a degraded
 * agent → "Degraded". Idle and paused agents are healthy (shared/health.ts). `tasks` null: the open tasks could not be
 * loaded, so the word comes from the team alone rather than from an empty list.
 */
export function departmentHealth(squad: readonly SquadMember[], tasks: readonly TaskRow[] | null, throughput?: { doneLast7Days: number } | null): { health: HealthTone; word: string } {
  if (squad.some((m) => m.status === "failing")) return { health: "bad", word: "Failing" };
  if (squad.some((m) => m.status === "injured")) return { health: "bad", word: "Down" };
  // Work, not liveness (Nov 1, 2026: "Healthy · Quiet" over three days of nothing shipped and nine blocked tasks): a
  // department with many blocked tasks and nothing finished this week is stalled, whatever its agents' statuses say.
  const blocked = tasks?.filter((t) => t.status === "blocked").length ?? 0;
  if (blocked >= STALLED_BLOCKED_TASKS && throughput && throughput.doneLast7Days === 0) return { health: "bad", word: "Stalled" };
  if (blocked >= STALLED_BLOCKED_TASKS) return { health: "warn", word: "Stuck" };
  if (blocked > 0) return { health: "warn", word: "Waiting" };
  if (squad.some((m) => m.status === "degraded")) return { health: "warn", word: "Degraded" };
  return { health: "good", word: "Healthy" };
}

/** Blocked tasks from which a department reads as stuck (stalled when nothing finished this week either). */
export const STALLED_BLOCKED_TASKS = 5;

/** Tasks a department finished in the last seven days, from the business-wide ended-tasks page the cards share. */
export function doneLast7Days(done: readonly TaskRow[] | undefined, departmentId: string, today: string): number {
  if (!done) return 0;
  const from = Date.parse(`${addDays(today, -6)}T00:00:00.000Z`);
  return done.filter((t) => t.departmentId === departmentId && t.status === "done" && (toMs(t.endedAt) ?? 0) >= from).length;
}

/** "Working on now" lines: one per active task, the agent as an entity mention so it links to the profile. */
export function nowLines(tasks: readonly TaskRow[], squad: readonly SquadMember[], max = 3): string[] {
  const byId = new Map(squad.map((m) => [m.id, m.name]));
  return tasks
    .filter((t) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(t.status))
    .slice(0, max)
    .map((t) => {
      const who = t.assigneeAgentId ? `[[ent:${t.assigneeAgentId}|${byId.get(t.assigneeAgentId) ?? "An agent"}]]` : "The team";
      return `${who} ${TASK_VERB[t.status] ?? "is on"} ${t.founderTitle ?? t.title}`;
    });
}

/**
 * The Inbox page the shell already reads for its badges and Continue (apps/web `SHELL_INBOX_PAGE`): asking for the same
 * page lets every card answer from that cache instead of a request of its own.
 */
export const QUIET_INBOX_PAGE = 50;
/** Recently ended tasks (finished or failed), one business-wide request shared by every card. */
export const QUIET_DONE_PAGE = 100;
export const QUIET_ENDED_STATUSES = ["done", "failed"] as const;

/** A card whose open tasks could not be loaded: one line that says so and retries (DepartmentCard renders it). */
export const TASKS_FAILED_LINE: DepartmentQuietLine = { kind: "error", label: "Couldn't load", text: "What this department is working on could not be loaded.", detail: "Retry" };

/** The line plus what it opens: the note in the Inbox, the agent's profile, or the failed task on the Plan. */
export type QuietLine = DepartmentQuietLine & { inboxItemId?: string; agentId?: string; taskId?: string };

/** The kicker over a note that waits for the founder: the one "needs you" word (UX plan §5.5), the Autopilot chip's too. */
export const NEEDS_ANSWER_LABEL = "Needs your answer";

/** Milliseconds of a timestamp as the API sends it (a Date through superjson, an ISO string in fixtures); null if none. */
function toMs(at: unknown): number | null {
  const ms = at instanceof Date ? at.getTime() : typeof at === "string" || typeof at === "number" ? new Date(at).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** "Aug 31" this year, "Jan 13, 2025" before it (in the signed-in person's format when `prefs` is given). */
function dayLabel(ms: number, today: string, prefs?: DateFormatPrefs | null): string {
  return formatDate(ms, String(new Date(ms).getUTCFullYear()) === today.slice(0, 4) ? "dayMonth" : "date", prefs);
}

/** What an agent that needs the founder is doing, in Team › Health's words. */
const ATTENTION_WORDS: Record<(typeof NEEDS_ATTENTION_STATUSES)[number], { verb: string; detail: string }> = {
  failing: { verb: "is failing", detail: "Sessions are stopped until you look" },
  injured: { verb: "is down", detail: "Back once reconnected" },
  degraded: { verb: "is degraded", detail: "Errors above 10%" },
};

/**
 * A quiet department's one line, from real data, the most useful first: an agent of its team that needs the founder
 * (failing, then down, then degraded, as Team › Health says it), else a note from its agents waiting for the founder's
 * answer ("Needs your answer", the same rule as the Inbox's "Respond" tag), else an unread note from them, else its last
 * task when that one failed, else the last task it finished (with the day), else "All clear" once both the Inbox and
 * the finished tasks have answered. Null while that is not known, so the card never claims "nothing waiting" on
 * missing data, and never "All clear" next to a Failing pill.
 */
export function quietLine(input: { agentIds: ReadonlySet<string>; departmentId: string; inbox: readonly InboxItemRow[] | undefined; done: readonly TaskRow[] | undefined; today: string; datePrefs?: DateFormatPrefs | null; squad?: readonly SquadMember[] }): QuietLine | null {
  const squad = input.squad ?? [];
  for (const status of NEEDS_ATTENTION_STATUSES) {
    const first = squad.find((m) => m.status === status);
    if (!first) continue;
    const others = squad.filter((m) => needsAttention(m.status)).length - 1;
    const words = ATTENTION_WORDS[status];
    return { kind: "attention", label: "Needs you", text: `${first.name} ${words.verb}`, detail: others > 0 ? `${others} more ${others === 1 ? "agent needs" : "agents need"} you` : words.detail, agentId: first.id };
  }
  const notes = (input.inbox ?? [])
    .filter((n) => n.fromAgentId !== null && input.agentIds.has(n.fromAgentId) && n.state !== "archived")
    .sort((a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0));
  const respond = notes.filter((n) => noteRowTag(n) === RESPOND_TAG);
  const waiting = respond[0];
  if (waiting) return { kind: "respond", label: NEEDS_ANSWER_LABEL, text: waiting.subject, detail: respond.length > 1 ? `${respond.length - 1} more in the Inbox` : undefined, inboxItemId: waiting.id };
  const unread = notes.find((n) => n.state === "unread");
  if (unread) return { kind: "inbox", label: "New in your Inbox", text: unread.subject, inboxItemId: unread.id };
  const last = (input.done ?? [])
    .flatMap((t) => {
      const ended = toMs(t.endedAt);
      return t.departmentId === input.departmentId && (t.status === "done" || t.status === "failed") && ended !== null ? [{ id: t.id, title: t.title, failed: t.status === "failed", ended }] : [];
    })
    .sort((a, b) => b.ended - a.ended)[0];
  if (last?.failed) return { kind: "attention", label: "Last task failed", text: last.title, detail: dayLabel(last.ended, input.today, input.datePrefs), taskId: last.id };
  if (last) return { kind: "finished", label: "Last finished", text: last.title, detail: dayLabel(last.ended, input.today, input.datePrefs) };
  if (input.inbox && input.done) return { kind: "clear", label: "All clear", text: "Nothing in progress, and nothing waiting on you." };
  return null;
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
  /** The metric's own query failed with nothing cached: the value says so ("No access", "Couldn't load"). */
  error?: Error | null;
}

/** The section each metric reads, for "Your role has no access to …" (the squad and the daily rows come with Home). */
const METRIC_SECTION: Partial<Record<DepartmentMetricKey, string>> = { roadmap_on_track: "Product", blended_cpa: "Distribution", runway: "Finance", next_filing: "Legal" };

const AT_RISK = new Set(["blocked", "at_risk", "late", "overdue"]);

/** The Finance card's runway metric in words (UX plan B9); the status strip's tile keeps "Runway" and defines it in its caption. */
export const RUNWAY_METRIC_LABEL = "Months of cash left";

/**
 * The headline metric in plain words under its figure while guidance is on (PlainFigure, UX plan §7.8): the id of its
 * definition where the map has one (runway, team health, the cost to win a customer), else one line of the card's own.
 */
export const METRIC_PLAIN: Record<DepartmentMetricKey, { metricId: string } | { plain: string }> = {
  auto: { plain: "Tasks the team finished in the last 7 days." },
  tasks_done: { plain: "Tasks the team finished in the last 7 days." },
  roadmap_on_track: { plain: "Roadmap items due now that are not blocked or late." },
  blended_cpa: { metricId: "acquisition_cost" },
  runway: { metricId: "runway" },
  squad_health: { metricId: "team_health" },
  next_filing: { plain: "Days until the next filing or legal deadline is due." },
};

/**
 * The business's bank balance at the end of each of the last `months` months (oldest first; the current month as of
 * now), walked back from today's balance by each month's net cash flow (finance.overview, cash basis). Real figures,
 * not an estimate; empty without a bank or with under two months of history.
 */
export function monthEndCash(finance: FinanceOverview | undefined, months = 6): number[] {
  if (!finance || !finance.cash.accounts) return [];
  const monthly = finance.revenue.monthly.slice().sort((a, b) => a.month.localeCompare(b.month));
  if (monthly.length < 2) return [];
  const out: number[] = [];
  let balance = finance.cash.amountMinor;
  for (let m = monthly.length - 1; m >= 0 && out.length < months; m -= 1) {
    out.push(balance);
    balance -= monthly[m]!.netMinor;
  }
  return out.reverse();
}

/**
 * The headline metric per BUILD §11.2 module defaults; every non-measured number carries provenance. When the metric's
 * query failed the card says why instead of a figure ("Runway · No access", never "Not known yet" for a refusal).
 */
export function headlineMetric(i: MetricInputs): DepartmentMetric {
  const metric = metricFigure(i);
  const section = METRIC_SECTION[i.key];
  if (!i.error || !section) return metric;
  return { label: metric.label, value: unavailableWords(i.error, section).value, series: [] };
}

function metricFigure(i: MetricInputs): DepartmentMetric {
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
      return { label: "Cost to win a customer", value: cpa === null ? "—" : formatMoney({ amountMinor: cpa, currency: i.currency }), series: dailySeries(i.rows, i.days, (r) => r.spendMinor), provenance: "estimate" };
    }
    case "runway": {
      const months = i.finance?.runway.months ?? null;
      // The line is the business's month-end cash (the department rows carry no money): what the runway moves with.
      const series = monthEndCash(i.finance);
      const seriesLabel = series.length ? `Cash at month end, last ${series.length} months` : undefined;
      // The shared runway words when there is no figure ("No limit" when cash-flow positive); Estimate only on a real estimate.
      if (months === null) return { label: RUNWAY_METRIC_LABEL, value: runwayWords(i.finance)?.value ?? RUNWAY_WORDS.no_bank.value, series, seriesLabel };
      return { label: RUNWAY_METRIC_LABEL, value: `${formatNumber(months, { maxDigits: 1 })} mo`, series, seriesLabel, provenance: "estimate" };
    }
    case "squad_health": {
      // The one team-health definition (shared/health.ts), the figure the status strip's Team health also uses.
      const share = teamHealth(i.squad.map((m) => m.status));
      return { label: "Team health", value: share === null ? "—" : `${Math.round(share * 100)}%`, series: dailySeries(i.rows, i.days, (r) => r.agentHours), seriesLabel: "Hours of team work per day, last 14 days" };
    }
    case "next_filing": {
      const dues = [...(i.compliance?.deadlines ?? []), ...(i.compliance?.filings ?? []).filter((f) => !f.filedAt), ...(i.compliance?.events ?? [])]
        .map((d) => daysUntil(d.dueAt ?? null))
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
      const next = dues[0];
      // No line: no daily series measures a filing calendar (the department rows count no decisions or deadlines).
      return { label: "Days to next filing", value: next === undefined ? "—" : formatNumber(next, { maxDigits: 0 }), series: [], deltaTone: next !== undefined && next < 14 ? "warn" : undefined };
    }
    case "tasks_done":
    case "auto":
    default: {
      const week = sumInRange(i.rows, weekFrom, i.today, (r) => r.tasksDone);
      const before = sumInRange(i.rows, prevFrom, prevTo, (r) => r.tasksDone);
      return { label: "Tasks finished this week", value: formatNumber(week, { maxDigits: 0 }), series: dailySeries(i.rows, i.days, (r) => r.tasksDone), ...delta(week, before) };
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
  const { businessId, navigate, currency } = useWidgetData();
  const today = useToday();
  const datePrefs = useDateFormat();
  const g = useGlossary();
  const departments = useDepartments();
  const dept = resolveDepartment(departments.data, settings);
  // The grid's edit controls name this card by its department ("Move Department card: Product").
  useWidgetInstanceLabel(dept?.name);
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
  // A quiet card's line: the shell's own Inbox page (served from its cache) and one shared list of finished tasks.
  const inbox = useWidgetQuery<InboxListResponse>("inbox.list", { limit: QUIET_INBOX_PAGE }, { enabled });
  const done = useWidgetQuery<Page<TaskRow>>("dev.tasks.list", { status: QUIET_ENDED_STATUSES, limit: QUIET_DONE_PAGE }, { enabled });

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
    if (event.type === "task.completed" || event.type === "cycle.completed") {
      ribbon.refetch();
      done.refetch();
    }
  }, TASK_EVENTS);

  const taskItems = useMemo(() => tasks.data?.items ?? [], [tasks.data]);
  // The open tasks failed to load (and none are cached): say so, never "Quiet", "Nothing planned yet" or a health word
  // computed from an empty list.
  const tasksFailed = failedWithoutData(tasks);
  // The headline metric's own query, when it failed with nothing cached.
  const metricQuery = metricKey === "roadmap_on_track" ? roadmap : metricKey === "blended_cpa" ? channels : metricKey === "runway" ? finance : metricKey === "next_filing" ? compliance : null;
  const metricError = metricQuery && failedWithoutData(metricQuery) ? metricQuery.error : null;
  const card: DepartmentCardData | null = useMemo(() => {
    if (!dept) return null;
    const metric = headlineMetric({ key: metricKey, rows, days: lastDays(14, today), squad: toSquad(dept, overrides, taskItems), roadmap: roadmap.data, channels: channels.data, finance: finance.data, compliance: compliance.data, currency, today, error: metricError });
    const squad = toSquad(dept, overrides, taskItems);
    const { health, word } = departmentHealth(squad, tasksFailed ? null : taskItems, done.data ? { doneLast7Days: doneLast7Days(done.data.items, dept.id, today) } : null);
    const leadRow = dept.lead ?? dept.squad.find((a) => a.id === dept.leadAgentId) ?? dept.squad[0] ?? null;
    const next = taskItems.find((t) => (NEXT_TASK_STATUSES as readonly string[]).includes(t.status));
    const now = nowLines(taskItems, squad);
    const agentIds = new Set([...dept.squad.map((a) => a.id), ...(leadRow ? [leadRow.id] : [])]);
    return {
      id: dept.id,
      name: dept.name,
      dept: dept.colourToken,
      lead: leadRow ? { name: leadRow.name, seed: leadRow.avatarSeed || leadRow.id, status: overrides[leadRow.id] ?? leadRow.status } : { name: "No lead yet", seed: dept.id, status: "idle" },
      health,
      healthWord: word,
      squad,
      now,
      nowLoading: !tasks.data && tasks.isLoading,
      quiet: tasksFailed ? TASKS_FAILED_LINE : now.length === 0 ? quietLine({ agentIds, departmentId: dept.id, inbox: inbox.data?.items, done: done.data?.items, today, datePrefs, squad }) : null,
      // The metric's caption in the business's words ("Team health" → "Crew health").
      metric: { ...metric, label: g(metric.label) },
      // A short status, not an instruction: every quiet card would otherwise repeat the same sentence (UX plan E6).
      nextUp: tasksFailed ? "Couldn't load" : next ? next.title : "Nothing planned yet",
    };
  }, [dept, overrides, taskItems, tasksFailed, tasks.data, tasks.isLoading, inbox.data, done.data, metricKey, rows, roadmap.data, channels.data, finance.data, compliance.data, metricError, currency, today, datePrefs, g]);

  const entityKinds = useMemo(() => Object.fromEntries([...squadIds].map((id) => [id, "agent" as EntityKind])), [squadIds]);
  const openEntity = (id: string) => navigate(squadIds.has(id) ? routes.agent(businessId, id) : routes.crm(businessId, id));
  const firstTab = dept?.tabs.slice().sort((a, b) => a.position - b.position)[0];
  const quiet = card?.quiet as QuietLine | null | undefined;
  // What the quiet line opens: Retry for a failed load, the note, the agent who needs the founder, the failed task.
  const planHref = moduleHref(businessId, departments.data, "development", "plan");
  const openQuiet =
    quiet?.kind === "error"
      ? () => tasks.refetch()
      : quiet?.inboxItemId
        ? () => navigate(routes.inbox(businessId, quiet.inboxItemId!))
        : quiet?.agentId
          ? () => navigate(routes.agent(businessId, quiet.agentId!))
          : quiet?.taskId && planHref
            ? () => navigate(`${planHref}?task=${quiet.taskId}`)
            : undefined;

  if (card && dept) {
    const plain = METRIC_PLAIN[metricKey];
    // The Home tour's anchor (`data-coachmark="department-card"`): DepartmentCard takes no extra attributes, so a box
    // the card fills carries it.
    return (
      <div data-coachmark="department-card" className="h-full min-w-0">
        <DepartmentCard
          department={card}
          className="h-full"
          onOpen={firstTab ? () => navigate(routes.department(businessId, dept.slug, firstTab.slug)) : undefined}
          onOpenAgent={(agentId) => navigate(routes.agent(businessId, agentId))}
          onOpenEntity={openEntity}
          onOpenQuiet={openQuiet}
          entityKinds={entityKinds}
          // The metric in plain words while guidance is on; never on a figure that says "No access" or "Couldn't load".
          metricId={metricError ? undefined : "metricId" in plain ? plain.metricId : undefined}
          metricPlain={metricError ? undefined : "plain" in plain ? g(plain.plain) : undefined}
        />
      </div>
    );
  }
  const dependent: QueryState<unknown>[] = enabled ? [departments, ribbon, tasks] : [departments];
  return (
    <WidgetFrame
      title={dept ? dept.name : "Department"}
      data-widget="department_card"
      data-coachmark="department-card"
      queries={dependent}
      empty={departments.data && !dept ? { icon: LayoutGrid, text: "No department in this slot. Pick one in the widget settings, or add a department in Settings." } : null}
    />
  );
}

export const departmentCardWidget = registerWidget<DepartmentCardSettings>({
  key: "department_card",
  title: "Department card",
  description: "Lead, health, team, what it is working on now, the headline metric and what is next for one department.",
  icon: "layout-grid",
  surfaces: ["home", "department"],
  // Sized to the card's content (header, team strip, three "Working on now" lines, the metric, "Next"): a stored taller cell
  // (the seeded and API presets keep h 30) is clamped here rather than drawn as an empty plate (DESIGN §9 Home).
  defaultSize: { w: 4, h: 12, minW: 3, minH: 10, maxH: 16 },
  settingsSchema: DepartmentCardSettings,
  defaultSettings: DepartmentCardSettings.parse({}),
  Component: DepartmentCardWidget,
});
