/**
 * Helpers shared by the team screens: layout, mutations with pending/error state, the live status overlay
 * (AC-11.9.1: `agent.health_changed` updates the squad within 2 s), and the AgentRow → SquadRow mapping.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { PageGrid, StatusPill, agentStatusTone, cn, formatRelative, type SquadRow } from "@foundmill/dugout";
import { MODULE_KEYS, type AgentStatus, type DeptColourToken, type MembershipRole } from "@foundmill/shared";
import { routes, useBusinessEvents, useWidgetData, useWidgetQuery, type QueryState, type WidgetEvent } from "@foundmill/widgets";
import type { AgentHealthChangedPayload, AgentRow, AgentsListResponse, FounderProfileResponse, MembershipRow } from "./types";

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

export function taskHref(businessId: string, taskId: string): string {
  return `${routes.department(businessId, "development", "plan")}?task=${taskId}`;
}

/** Connector keys of an agent's tool grants (the API may send keys or `{ connectorKey, tools }`). */
export function toolKeys(agent: Pick<AgentRow, "tools">): string[] {
  const keys = (agent.tools ?? []).map((t) => (typeof t === "string" ? t : t.connectorKey)).filter((k): k is string => typeof k === "string" && k.length > 0);
  return [...new Set(keys)];
}

/** The plural-ready noun ApplyScopeDialog uses for "Apply to all [type] agents". */
export function agentTypeNoun(agent: Pick<AgentRow, "agentType" | "role" | "layer">): string {
  if (agent.agentType) return agent.agentType.replace(/_/g, " ");
  if (agent.role) return agent.role.toLowerCase();
  return agent.layer ?? "worker";
}

export function isChiefOfStaff(agent: Pick<AgentRow, "agentType" | "layer">): boolean {
  return agent.agentType === "chief_of_staff" || agent.layer === "assistant";
}

/* ---------- Status vocabulary (CLAUDE.md: "injured" reads "Down" with "expected back") ---------- */

export const STATUS_WORD: Record<AgentStatus, string> = { healthy: "Healthy", degraded: "Degraded", failing: "Failing", injured: "Down", paused: "Paused", idle: "Idle" };

/** Grouping order for the Health board: the ones that need the founder first. */
export const STATUS_ORDER: readonly AgentStatus[] = ["failing", "injured", "degraded", "paused", "idle", "healthy"];

export const STATUS_DESCRIPTION: Record<AgentStatus, string> = {
  failing: "Loop detected or repeated errors. Sessions are stopped until you look.",
  injured: "A credential expired or a rate limit hit. Back once the integration is reconnected.",
  degraded: "Error rate above 10 % over the last day. Still working, watch the next tasks.",
  paused: "Paused by you or by a holiday rule. Resume from the profile.",
  idle: "No task assigned. The Chief of Staff routes work on the next cycle.",
  healthy: "Heartbeat on time, errors low, budget available.",
};

export interface AgentStatusWordPillProps {
  status: AgentStatus;
  expectedReturnAt?: string | Date | null;
  now?: Date;
  className?: string;
}

/** Status pill in the product vocabulary; "Down" carries the expected return once known (BUILD §11.9). */
export function AgentStatusWordPill({ status, expectedReturnAt, now = new Date(), className }: AgentStatusWordPillProps) {
  const { tone } = agentStatusTone(status);
  const back = status === "injured" ? toDate(expectedReturnAt) : null;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-status={status}>
      <StatusPill tone={tone} icon={status === "injured" ? CircleAlert : undefined}>
        {STATUS_WORD[status]}
      </StatusPill>
      {status === "injured" ? <span className="text-small text-secondary">{back ? `expected back ${formatRelative(back, now)}` : "expected back once reconnected"}</span> : null}
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

export function toSquadRow(agent: AgentRow, currency = "EUR"): SquadRow {
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
    wage: { amountMinor: agent.wage?.costMinor ?? 0, currency: agent.currency ?? currency },
    latestUpdate: latest,
    expectedReturnAt: expected,
  };
}

/* ---------- Staff ---------- */

export const ROLE_LABELS: Record<MembershipRole, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer", advisor: "Advisor" };

/** Sections a membership can carry per-section permissions for (apps/api `SECTIONS`): the modules plus the fixed surfaces. */
export const STAFF_SECTIONS: readonly string[] = [...MODULE_KEYS, "inbox", "crm", "settings", "billing", "live"];

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
