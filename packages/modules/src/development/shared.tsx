"use client";
/** Helpers shared by the development screens: layout, mutations with pending/error state, agent and task lookups. */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { PageGrid, StatusPill, TASK_STATUS_META, cn, useGuided, type TileAgent } from "@foundmill/dugout";
import type { DeptColourToken, TaskStatus } from "@foundmill/shared";
import { departmentForModule, useDepartments } from "@foundmill/widgets/shared/departments";
import { routes } from "@foundmill/widgets/shared/routes";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import { useWidgetData, useWidgetQuery, type QueryState } from "@foundmill/widgets/data";
import type { AgentRow, AgentsListResponse, TaskRow } from "./types";

/* ---------- Layout ---------- */

/** A module screen fills the content region: a 12-column PageGrid with the content gutter. */
export function Screen({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <PageGrid data-module-screen={name} className={cn("p-gutter", className)}>
      {children}
    </PageGrid>
  );
}

/* ---------- Tables ---------- */

/** The built-in "Simple" saved view every table carries: its four most important columns (UX plan §7.10). */
export const SIMPLE_VIEW_ID = "simple";

/**
 * The view a table opens on before the person picks one: "Simple" while guidance is on, the screen's general view
 * otherwise. A view the person left open (stored per table) still wins; this only fills the gap (saved-views.ts).
 */
export function useDefaultViewId(general: string): string {
  return useGuided() ? SIMPLE_VIEW_ID : general;
}

/* ---------- Mutations ---------- */

/** How many of the sessions a control was meant for received it (the api answers `queued` per signal). */
export interface Delivery {
  delivered: number;
  total: number;
  /** Why the first signal that did not arrive did not, in the founder's words. */
  reason: string | null;
}

/** Words for why a signal did not reach a session (the api passes Temporal's own message). */
export function notDeliveredReason(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (/workflow(execution)?\s*not\s*found|WorkflowNotFound|not found for ID/i.test(r)) return "the session is no longer running";
  if (/unreachable|disabled|ECONNREFUSED|timeout/i.test(r)) return "the orchestrator is not reachable";
  if (/already (completed|closed)|execution already/i.test(r)) return "the session has already ended";
  const plain = r.replace(/^[A-Za-z]*Error:\s*/, "").replace(/\s+/g, " ").slice(0, 120);
  return plain || "the session did not answer";
}

/**
 * Read the delivery of a control from a mutation result: `{ workflow: { queued } }` for one session, `{ results: [{ queued }] }`
 * for a nudge to several. Null when the result carries neither (nothing was signalled).
 */
export function deliveryOf(result: unknown): Delivery | null {
  const r = (result ?? null) as { workflow?: { queued?: unknown; reason?: unknown } | null; results?: unknown } | null;
  if (!r || typeof r !== "object") return null;
  const entries = Array.isArray(r.results) ? (r.results as { queued?: unknown; reason?: unknown }[]) : r.workflow && typeof r.workflow.queued === "boolean" ? [r.workflow] : null;
  if (!entries) return null;
  const failed = entries.find((e) => e.queued !== true);
  return { delivered: entries.filter((e) => e.queued === true).length, total: entries.length, reason: failed ? notDeliveredReason(typeof failed.reason === "string" ? failed.reason : null) : null };
}

/** The founder-facing line for a control that did not (fully) arrive; null when it did. */
export function deliveryMessage(d: Delivery | null): string | null {
  if (!d || d.delivered === d.total) return d && d.total === 0 ? "Not delivered: no session is running to receive this." : null;
  if (d.total === 1) return `Not delivered: ${d.reason}. The agent is not listening.`;
  return d.delivered === 0 ? `Not delivered: ${d.reason}. No session received it.` : `Delivered to ${d.delivered} of ${d.total} sessions. Not delivered to the rest: ${d.reason}.`;
}

export interface ActionState {
  pending: string | null;
  /** The last failure, or a control that did not reach its session (`deliveryMessage`). */
  error: Error | null;
  /** A short confirmation that stays a few seconds: a nudge that reached several sessions. */
  notice: string | null;
  clearError: () => void;
  /** Run a mutation; resolves to the result or undefined when it failed (the error is kept in state). `then` also gets how far the control reached. */
  run: <T = unknown>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T, delivery: Delivery | null) => void }) => Promise<T | undefined>;
}

const NOTICE_MS = 6000;

/** Mutations through the host data source with one pending key and the last error, for buttons and inline errors. */
export function useAction(): ActionState {
  const { mutate } = useWidgetData();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  const run = useCallback(
    async <T,>(path: string, input: Record<string, unknown>, opts?: { key?: string; then?: (result: T, delivery: Delivery | null) => void }): Promise<T | undefined> => {
      const key = opts?.key ?? path;
      setPending(key);
      setError(null);
      setNotice(null);
      try {
        const result = await mutate<T>(path, input);
        // A 200 only says the api took the request: whether the session heard it is in the result (audit OL-04, TPD-16).
        const delivery = deliveryOf(result);
        const problem = deliveryMessage(delivery);
        if (problem && alive.current) setError(new Error(problem));
        else if (delivery && delivery.total > 1 && alive.current) {
          setNotice(`Delivered to ${delivery.delivered} sessions.`);
          setTimeout(() => alive.current && setNotice(null), NOTICE_MS);
        }
        opts?.then?.(result, delivery);
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
  return { pending, error, notice, clearError: () => setError(null), run };
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

export function toIso(d: string | Date | null | undefined, fallback?: string): string {
  const date = toDate(d);
  return date ? date.toISOString() : (fallback ?? new Date(0).toISOString());
}

/** `numeric(5,4)` arrives as a string; clamp to 0–1. */
export function progressValue(p: string | number | null | undefined): number {
  const n = typeof p === "string" ? Number.parseFloat(p) : typeof p === "number" ? p : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}

/** The worktree branch of a task (packages/sandbox `agentBranch`, mirrored by apps/api). */
export const agentBranch = (taskId: string) => `agent/${taskId}`;

/* ---------- Tasks ---------- */

export const LIVE_TASK_STATUSES: readonly TaskStatus[] = ["running", "paused", "blocked", "review", "merging"];
export const OVER_TASK_STATUSES: readonly TaskStatus[] = ["done", "failed", "stopped"];

export function isLiveStatus(status: TaskStatus): boolean {
  return LIVE_TASK_STATUSES.includes(status);
}

export function TaskStatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = TASK_STATUS_META[status];
  return (
    <StatusPill tone={meta.tone} icon={meta.icon} className={className}>
      {meta.word}
    </StatusPill>
  );
}

/* ---------- Agents ---------- */

export function useAgents(opts?: { enabled?: boolean }): QueryState<AgentsListResponse> {
  return useWidgetQuery<AgentsListResponse>("team.agents.list", { includeArchived: false }, opts);
}

export function agentDept(agent: Pick<AgentRow, "departments"> | null | undefined): DeptColourToken {
  return agent?.departments?.[0]?.colourToken ?? "dept-1";
}

/** The agent facts an AgentTile header needs; a placeholder when the squad list has not loaded yet. */
export function toTileAgent(agent: AgentRow | undefined, agentId: string | null | undefined): TileAgent {
  if (agent) {
    return { id: agent.id, name: agent.name, seed: agent.avatarSeed || agent.id, dept: agentDept(agent), status: agent.status, model: agent.modelKey, role: agent.role };
  }
  return { id: agentId ?? "unassigned", name: agentId ? "Agent" : "Unassigned", seed: agentId ?? "unassigned", dept: "dept-1", status: "idle", model: "sonnet" };
}

export function useAgentIndex(agents: readonly AgentRow[] | undefined): Map<string, AgentRow> {
  return useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
}

export function agentHref(businessId: string, agentId: string): string {
  return routes.agent(businessId, agentId);
}

/**
 * The department this screen is open in when it carries the development module (Development, or a department such as
 * Formulation Lab that maps onto it), else the first department that does. Links to Plan and Live sessions stay in the
 * department the founder is looking at.
 */
export function devDepartment(departments: readonly DepartmentRow[] | undefined, departmentId: string | undefined): DepartmentRow | undefined {
  const here = departments?.find((d) => d.id === departmentId);
  return here && here.moduleKeys.includes("development") ? here : departmentForModule(departments, "development");
}

export function useDevDepartment(departmentId: string | undefined): DepartmentRow | undefined {
  const departments = useDepartments();
  return devDepartment(departments.data, departmentId);
}

export function taskHref(businessId: string, deptSlug: string | undefined, taskId: string): string {
  return `${routes.department(businessId, deptSlug ?? "development", "plan")}?task=${taskId}`;
}

/** Tasks the Training Ground shows: anything with a live status, most recently started first. */
export function liveTasks(tasks: readonly TaskRow[] | undefined): TaskRow[] {
  return (tasks ?? [])
    .filter((t) => isLiveStatus(t.status))
    .slice()
    .sort((a, b) => (toDate(b.startedAt)?.getTime() ?? 0) - (toDate(a.startedAt)?.getTime() ?? 0) || a.title.localeCompare(b.title));
}
