"use client";
/**
 * Helpers shared by the team screens: layout, mutations with pending/error state, the live status overlay
 * (AC-11.9.1: `agent.health_changed` updates the squad within 2 s), and the AgentRow → SquadRow mapping.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleDashed, CirclePause } from "lucide-react";
import { Avatar, EntityLink, MODEL_LABELS, PageGrid, StatusPill, agentStatusTone, cn, formatRelative, type EntityDetails, type IconComponent, type SquadRow } from "@foundmill/dugout";
import { type AgentStatus, type DeptColourToken, type MembershipRole } from "@foundmill/shared/constants";
import { SECTIONS } from "@foundmill/shared/permissions";
import { moduleTabHref } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusinessEvents, useWidgetData, useWidgetQuery, type QueryState, type WidgetEvent } from "@foundmill/widgets/data";
import { usSpelling } from "@foundmill/shared/us-spelling";
import { humanise } from "../fit";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import type { AgentHealthChangedPayload, AgentRow, AgentsListResponse, FounderProfileResponse, MembershipRow, TemplateRow } from "./types";

/* ---------- Options the host or a test may override ---------- */

export interface TeamScreenOptions {
  /** Fixed "now" for stories and tests (relative times, "expected back"). */
  now?: Date;
  /** Debounce before the squad list is refetched after a live status event (default 400 ms). */
  liveRefetchMs?: number;
}

const OptionsCtx = createContext<TeamScreenOptions>({});

export function TeamScreenOptionsProvider({ value, children }: { value: TeamScreenOptions; children: ReactNode }) {
  return <OptionsCtx.Provider value={value}>{children}</OptionsCtx.Provider>;
}

export function useTeamOptions(): TeamScreenOptions {
  return useContext(OptionsCtx);
}

/** A stable clock for one render: the option when set, else the time the screen mounted. */
export function useNow(): Date {
  const { now } = useTeamOptions();
  const mounted = useRef<Date | null>(null);
  if (!mounted.current) mounted.current = new Date();
  return now ?? mounted.current;
}

/* ---------- Layout ---------- */

/** A module screen fills the content region: a 12-column PageGrid with the content gutter. */
export function Screen({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <PageGrid data-module-screen={name} className={cn("p-gutter", className)}>
      {children}
    </PageGrid>
  );
}

/* ---------- Mutations ---------- */

export interface ActionState {
  pending: string | null;
  error: Error | null;
  clearError: () => void;
  /** Run a mutation; resolves to the result or undefined when it failed (the error is kept in state). */
  run: <T = unknown>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void }) => Promise<T | undefined>;
}

/** Mutations through the host data source with one pending key and the last error, for buttons and inline errors. */
export function useAction(): ActionState {
  const { mutate } = useWidgetData();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async <T,>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T) => void }): Promise<T | undefined> => {
      const key = opts?.key ?? path;
      setPending(key);
      setError(null);
      try {
        const result = await mutate<T>(path, input);
        opts?.then?.(result);
        return result;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e : new Error(String(e)));
        return undefined;
      } finally {
        if (alive.current) setPending((p) => (p === key ? null : p));
      }
    },
    [mutate],
  );
  return { pending, error, clearError: () => setError(null), run };
}

export function errorMessage(e: Error | string | null | undefined): string {
  if (!e) return "";
  const m = typeof e === "string" ? e : e.message;
  return m && m.length < 200 ? m : "Something went wrong. Try again.";
}

/** One line of status-bad text under a control (never the only signal: the control also stays enabled). */
export function InlineError({ error, className }: { error: Error | string | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn("text-small text-status-bad", className)}>
      {errorMessage(error)}
    </p>
  );
}

/* ---------- Values ---------- */

export function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIso(d: string | Date | null | undefined): string | null {
  const date = toDate(d);
  return date ? date.toISOString() : null;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/* ---------- Queries ---------- */

export function useAgents(opts?: { enabled?: boolean }): QueryState<AgentsListResponse> {
  return useWidgetQuery<AgentsListResponse>("team.agents.list", { includeArchived: false }, opts);
}

export function useHumans(opts?: { enabled?: boolean }): QueryState<MembershipRow[]> {
  return useWidgetQuery<MembershipRow[]>("team.humans.list", undefined, opts);
}

export function useMe(): QueryState<FounderProfileResponse> {
  return useWidgetQuery<FounderProfileResponse>("founder.profile.get", undefined);
}

export function useAgentIndex(agents: readonly AgentRow[] | undefined): Map<string, AgentRow> {
  return useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
}

/* ---------- Agents ---------- */

export function agentDept(agent: Pick<AgentRow, "departments"> | null | undefined): DeptColourToken {
  return agent?.departments?.[0]?.colourToken ?? "dept-1";
}

export function agentHref(businessId: string, agentId: string): string {
  return routes.agent(businessId, agentId);
}

/** A task on the Plan of the department that holds Development now (never a fixed "development" slug). */
export function taskHref(businessId: string, taskId: string, departments: readonly DepartmentRow[] | undefined): string {
  return `${moduleTabHref(businessId, departments, "development", "plan")}?task=${taskId}`;
}

/** Connector keys of an agent's tool grants (the API may send keys or `{ connectorKey, tools }`). */
export function toolKeys(agent: Pick<AgentRow, "tools">): string[] {
  const keys = (agent.tools ?? []).map((t) => (typeof t === "string" ? t : t.connectorKey)).filter((k): k is string => typeof k === "string" && k.length > 0);
  return [...new Set(keys)];
}

/** The plural-ready noun ApplyScopeDialog uses for "Apply to all [type] agents". */
export function agentTypeNoun(agent: Pick<AgentRow, "agentType" | "role" | "layer">): string {
  if (agent.agentType) return usSpelling(agent.agentType.replace(/_/g, " "));
  if (agent.role) return agent.role.toLowerCase();
  return agent.layer ?? "worker";
}

/** Same words ignoring case and punctuation ("Quality Specialist" and "Quality specialist"). */
function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * The line under an agent's name: its role (or its type in words), or null when that only repeats the name
 * ("Quality Specialist" over "Quality specialist"), so a card never says the same thing twice.
 */
export function agentRoleLine(agent: Pick<AgentRow, "name" | "role" | "agentType">): string | null {
  const role = agent.role || humanise(agent.agentType);
  return role && !sameWords(role, agent.name) ? role : null;
}

export function isChiefOfStaff(agent: Pick<AgentRow, "agentType" | "layer">): boolean {
  return agent.agentType === "chief_of_staff" || agent.layer === "assistant";
}

/* ---------- Status vocabulary (CLAUDE.md: "injured" reads "Down" with "expected back") ---------- */

export const STATUS_WORD: Record<AgentStatus, string> = { healthy: "Healthy", degraded: "Degraded", failing: "Failing", injured: "Down", paused: "Paused", idle: "Idle" };

/** Grouping order for the Health board: the ones that need the founder first. */
export const STATUS_ORDER: readonly AgentStatus[] = ["failing", "injured", "degraded", "paused", "idle", "healthy"];

export const STATUS_DESCRIPTION: Record<AgentStatus, string> = {
  failing: "Loop detected or repeated errors. It rests (10 minutes, longer after each failure in a row), then the next cycle gives it work again.",
  injured: "A credential expired or a rate limit hit. Back once the integration is reconnected.",
  degraded: "Error rate above 10% over the last day. Still working, watch the next tasks.",
  paused: "Paused by Stop all agents, a revoked key, used-up credits or the agent's wage cap. Resume agents in the top bar; a wage cap lifts next month or when you raise it.",
  idle: "No task assigned. The Chief of Staff routes work on the next cycle.",
  healthy: "Heartbeat on time, errors low, budget available.",
};

export interface AgentStatusWordPillProps {
  status: AgentStatus;
  expectedReturnAt?: string | Date | null;
  now?: Date;
  /** Show "expected back …" beside a Down pill (default). Off where the line under it already says when. */
  withReturn?: boolean;
  className?: string;
}

/** Each status has its own glyph, so paused and idle (both neutral grey) differ by shape as well as by word. */
export const STATUS_ICON: Partial<Record<AgentStatus, IconComponent>> = { injured: CircleAlert, paused: CirclePause, idle: CircleDashed };

/** Status pill in the product vocabulary; "Down" carries the expected return once known (BUILD §11.9). */
export function AgentStatusWordPill({ status, expectedReturnAt, now = new Date(), withReturn = true, className }: AgentStatusWordPillProps) {
  const { tone } = agentStatusTone(status);
  const back = status === "injured" ? toDate(expectedReturnAt) : null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} data-status={status}>
      <StatusPill tone={tone} icon={STATUS_ICON[status]} className="shrink-0">
        {STATUS_WORD[status]}
      </StatusPill>
      {status === "injured" && withReturn ? <span className="min-w-0 truncate text-small text-secondary">{back ? `expected back ${formatRelative(back, now)}` : "expected back once reconnected"}</span> : null}
    </span>
  );
}

/* ---------- Agent name cell ---------- */

export interface AgentCellProps {
  businessId: string;
  agent: { id: string; name: string; seed: string | number; dept: DeptColourToken; status?: AgentStatus };
  details?: EntityDetails;
  onOpen: (agentId: string) => void;
  avatarSize?: 20 | 24;
  className?: string;
}

/**
 * An agent in a table row: portrait and the name as an entity link. A block-level flex row (not inline-flex), so the
 * name sits on the row's centre line with the other cells, and the link itself truncates with an ellipsis when the
 * column is narrow (the full name is in the hover card).
 */
export function AgentCell({ businessId, agent, details, onOpen, avatarSize = 24, className }: AgentCellProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar size={avatarSize} name={agent.name} agent={{ seed: agent.seed, dept: agent.dept }} status={agent.status} className="shrink-0" />
      <EntityLink
        entity={{ id: agent.id, kind: "agent", name: agent.name, href: agentHref(businessId, agent.id) }}
        details={details}
        hideIcon
        className="min-w-0 truncate text-body-strong"
        onOpen={(e) => onOpen(e.id)}
        onVerb={(verb, e) => verb === "open_profile" && onOpen(e.id)}
      />
    </span>
  );
}

/* ---------- Live status overlay (AC-11.9.1) ---------- */

export interface LiveStatus {
  status: AgentStatus;
  expectedReturnAt: string | null;
  reason: string | null;
  at: string;
}

export function readHealthChanged(event: WidgetEvent): (AgentHealthChangedPayload & { agentId: string }) | null {
  if (event.type !== "agent.health_changed") return null;
  const p = event.payload as Partial<AgentHealthChangedPayload>;
  if (typeof p.agentId !== "string" || typeof p.to !== "string") return null;
  return p as AgentHealthChangedPayload & { agentId: string };
}

/**
 * Overlay `agent.health_changed` events on the squad list: the status flips in the table the moment the stream
 * delivers the event (well inside the 2 s budget) and the list is refetched once, debounced, so the server copy
 * catches up. Overrides are dropped when the refetched row agrees with them.
 */
export function useLiveAgentStatus(query: QueryState<AgentsListResponse>, opts: { debounceMs?: number } = {}): Map<string, LiveStatus> {
  const debounceMs = opts.debounceMs ?? 400;
  const [overrides, setOverrides] = useState<Map<string, LiveStatus>>(() => new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetch = query.refetch;
  useBusinessEvents((event) => {
    const p = readHealthChanged(event);
    if (!p) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(p.agentId, { status: p.to, expectedReturnAt: p.expectedReturnAt ?? null, reason: p.reason ?? null, at: event.occurredAt ?? new Date().toISOString() });
      return next;
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      refetch();
    }, debounceMs);
  }, ["agent.health_changed"]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  // Drop overrides the server now agrees with.
  const agents = query.data?.agents;
  useEffect(() => {
    if (!agents || overrides.size === 0) return;
    let changed = false;
    const next = new Map(overrides);
    for (const a of agents) {
      const o = next.get(a.id);
      if (o && o.status === a.status) {
        next.delete(a.id);
        changed = true;
      }
    }
    if (changed) setOverrides(next);
  }, [agents, overrides]);
  return overrides;
}

/** Apply the live overlay to the rows. */
export function withLiveStatus(agents: readonly AgentRow[] | undefined, overrides: Map<string, LiveStatus>): AgentRow[] {
  return (agents ?? []).map((a) => {
    const o = overrides.get(a.id);
    if (!o) return a;
    return { ...a, status: o.status, expectedReturnAt: o.expectedReturnAt ?? a.expectedReturnAt ?? null, health: { ...(a.health ?? {}), expectedReturnAt: o.expectedReturnAt ?? a.health?.expectedReturnAt ?? null, reason: o.reason ?? a.health?.reason ?? null } };
  });
}

/* ---------- AgentRow → SquadRow (dugout squad cells) ---------- */

export function skillRating(agent: Pick<AgentRow, "rating" | "skills">): number {
  if (typeof agent.rating === "number" && Number.isFinite(agent.rating)) return agent.rating;
  const skills = agent.skills ?? [];
  if (!skills.length) return 0;
  return Math.round((skills.reduce((s, k) => s + k.displayed, 0) / skills.length) * 5) / 10;
}

/** `currency`: the business's own, for an agent stored without one. */
export function toSquadRow(agent: AgentRow, currency: string): SquadRow {
  const expected = toIso(agent.expectedReturnAt ?? agent.health?.expectedReturnAt ?? null);
  const latest = agent.latestUpdate ? { at: toIso(agent.latestUpdate.at) ?? new Date(0).toISOString(), text: agent.latestUpdate.text } : agent.currentTask ? { at: toIso(agent.updatedAt) ?? new Date(0).toISOString(), text: `Working on ${agent.currentTask.title}` } : null;
  return {
    id: agent.id,
    name: agent.name,
    seed: agent.avatarSeed || agent.id,
    dept: agentDept(agent),
    role: agent.role ?? "",
    departments: (agent.departments ?? []).map((d) => d.name),
    status: agent.status,
    currentTask: agent.currentTask ? { id: agent.currentTask.id, title: agent.currentTask.title } : null,
    form: agent.form ?? [],
    rating: skillRating(agent),
    tools: toolKeys(agent),
    model: agent.modelKey,
    wage: { amountMinor: agent.wage?.costMinor ?? 0, currency: agent.wage?.currency ?? agent.currency ?? currency },
    latestUpdate: latest,
    expectedReturnAt: expected,
  };
}

/* ---------- Staff ---------- */

export const ROLE_LABELS: Record<MembershipRole, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer", advisor: "Advisor" };

/** Sections a membership can carry per-section permissions for (`SECTIONS`, @foundmill/shared): the modules plus the fixed surfaces. */
export const STAFF_SECTIONS: readonly string[] = SECTIONS;

export const SECTION_LABELS: Record<string, string> = { product: "Product", development: "Development", distribution: "Distribution", finance: "Finance", team: "Team", legal: "Legal", inbox: "Inbox", crm: "CRM", settings: "Settings", billing: "Billing", live: "LIVE" };

export function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? section;
}

/** What a member is called in the UI: display name, e-mail, or a short id (memberships carry no name yet). */
export function memberName(m: Pick<MembershipRow, "userId" | "displayName" | "email">, me?: { userId?: string | null; displayName?: string | null; email?: string | null } | null): string {
  if (m.displayName) return m.displayName;
  if (me?.userId && me.userId === m.userId) return me.displayName || me.email || `You (${shortId(m.userId)})`;
  if (m.email) return m.email;
  return `Member ${shortId(m.userId)}`;
}

export interface Me {
  userId: string | null;
  displayName: string | null;
  email: string | null;
}

/** The signed-in user as the screens need them (the profile may be absent before onboarding completes). */
export function readMe(data: FounderProfileResponse | undefined, businessId?: string): Me {
  const membership = data?.memberships?.find((m) => !businessId || m.businessId === businessId) ?? data?.memberships?.[0];
  return { userId: data?.profile?.userId ?? membership?.userId ?? null, displayName: data?.profile?.displayName ?? null, email: data?.email ?? null };
}

/** The sections a member can write, then read, as short summaries for a table cell. */
export function permissionSummary(perms: Record<string, string> | undefined): { write: string[]; read: string[]; none: string[] } {
  const write: string[] = [];
  const read: string[] = [];
  const none: string[] = [];
  for (const [section, level] of Object.entries(perms ?? {})) {
    if (level === "write") write.push(sectionLabel(section));
    else if (level === "read") read.push(sectionLabel(section));
    else if (level === "none") none.push(sectionLabel(section));
  }
  return { write, read, none };
}

/* ---------- Entity links ---------- */

/** Hover-card details for an agent (DESIGN §8 EntityLink: portrait, chips, three facts). */
export function agentEntity(businessId: string, agent: AgentRow, currency: string): EntityDetails {
  const wage = agent.wage?.costMinor ?? 0;
  return {
    id: agent.id,
    kind: "agent",
    name: agent.name,
    href: agentHref(businessId, agent.id),
    subtitle: agent.role,
    portrait: { type: "agent", seed: agent.avatarSeed || agent.id, dept: agentDept(agent), status: agent.status },
    chips: [{ label: STATUS_WORD[agent.status], tone: agentStatusTone(agent.status).tone }, { label: MODEL_LABELS[agent.modelKey] ?? agent.modelKey }],
    facts: [
      { label: "Departments", value: (agent.departments ?? []).map((d) => d.name).join(", ") || "—" },
      { label: "Wage (Estimate)", value: `${new Intl.NumberFormat("en-US", { style: "currency", currency: agent.wage?.currency ?? agent.currency ?? currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(wage / 100)}/mo` },
      { label: "Current task", value: agent.currentTask?.title ?? "None" },
    ],
    verbs: ["open_profile", "message"],
  };
}

export function memberEntity(businessId: string, m: MembershipRow, me?: Me | null): EntityDetails {
  const name = memberName(m, me);
  return {
    id: m.entityId ?? m.userId,
    kind: "team_member",
    name,
    href: m.entityId ? routes.crm(businessId, m.entityId) : undefined,
    subtitle: ROLE_LABELS[m.role],
    portrait: { type: "person" },
    chips: [{ label: ROLE_LABELS[m.role], tone: m.role === "owner" ? "kit" : "neutral" }],
    facts: [
      { label: "E-mail", value: m.email ?? "—" },
      { label: "Writes", value: permissionSummary(m.sectionPermissions).write.join(", ") || "—" },
      { label: "Member since", value: m.createdAt ? formatRelative(toDate(m.createdAt) ?? new Date(), new Date()) : "—" },
    ],
    verbs: m.entityId ? ["open_profile", "message"] : ["message"],
  };
}

/* ---------- Responsibilities ---------- */

// The words live in ./decisions (no React) so Settings › Departments can read them without the Team screens.
export { AGENT_GATED_DECISIONS, DECISION_DESCRIPTIONS, DECISION_LABELS } from "./decisions";

/* ---------- Recruitment ---------- */

export const FAMILY_LABELS: Record<TemplateRow["family"], string> = { assistant: "Chief of Staff", lead: "Lead", worker: "Worker", channel: "Channel engine", specialist: "Specialist", utility: "Utility" };

const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "to", "of", "for", "in", "on", "with", "who", "that", "our", "my", "me", "we", "i", "is", "are", "be", "can", "will", "it", "as", "at", "by", "from", "this", "agent", "someone", "need", "want", "help", "helps", "please"]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export interface TemplateMatch {
  template: TemplateRow;
  /** 0–1 share of the sentence's words found in the template. */
  score: number;
  matched: string[];
}

/**
 * The agent builder's first step without a model call: rank catalogue templates by how many of the sentence's words
 * appear in their name, role, description, skills and module. Stems loosely (prefix match on 4+ letters) so "writes"
 * finds "writer". Returns the best three with at least one matched word.
 */
export function suggestTemplates(sentence: string, catalogue: readonly TemplateRow[], limit = 3): TemplateMatch[] {
  const words = [...new Set(tokenize(sentence))];
  if (!words.length) return [];
  const scored = catalogue.map((template) => {
    const haystack = tokenize([template.name, template.role, template.description, template.module ?? "", ...(template.skills ?? []), ...(template.traits ?? [])].join(" "));
    const matched = words.filter((w) => haystack.some((h) => h === w || (w.length >= 4 && h.length >= 4 && (h.startsWith(w.slice(0, 4)) || w.startsWith(h.slice(0, 4))))));
    return { template, score: matched.length / words.length, matched };
  });
  return scored
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name))
    .slice(0, limit);
}
