/**
 * Data contract between widgets/module screens and the host app (docs/ARCHITECTURE.md §18).
 * Widgets never import the tRPC client; the host provides an implementation of `WidgetDataSource`.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { GameMode } from "@foundmill/shared";

export type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

export type QueryOptions = { enabled?: boolean; refetchIntervalMs?: number };

export type WidgetDataSource = {
  /** Subscribe to a tRPC query by dotted path, e.g. "inbox.list", with its input. */
  useQuery: <T = unknown>(path: string, input: Record<string, unknown> | undefined, opts?: QueryOptions) => QueryState<T>;
  /** Fire a tRPC mutation by dotted path. */
  mutate: <T = unknown>(path: string, input: Record<string, unknown>) => Promise<T>;
  /** Navigate inside the app (host router). */
  navigate: (href: string) => void;
  /** Subscribe to a realtime channel ("ev:<businessId>" | "as:<sessionId>"); returns unsubscribe. */
  subscribe: (channel: string, handler: (event: unknown) => void) => () => void;
  /** Current business context. */
  businessId: string;
  /** Business glossary (BUILD §11.13) for renaming nouns. */
  glossary: Record<string, string>;
  /** LIVE or Personal (BUILD §7.3). LIVE-only widgets render an explanation in Personal mode. Default "personal". */
  gameMode?: GameMode;
  /** Business currency for money the API returns without one. Default "EUR". */
  currency?: string;
};

const Ctx = createContext<WidgetDataSource | null>(null);

export function WidgetDataProvider({ source, children }: { source: WidgetDataSource; children: ReactNode }) {
  return <Ctx.Provider value={source}>{children}</Ctx.Provider>;
}

export function useWidgetData(): WidgetDataSource {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWidgetData must be used inside <WidgetDataProvider>");
  return v;
}

export function useWidgetQuery<T = unknown>(path: string, input?: Record<string, unknown>, opts?: QueryOptions): QueryState<T> {
  return useWidgetData().useQuery<T>(path, input, opts);
}

/** Apply the business glossary to a noun (falls back to the default). */
export function useGlossary(): (term: string) => string {
  const { glossary } = useWidgetData();
  return (term) => glossary[term] ?? term;
}

/* ---------- Realtime events (ev:<businessId>) ---------- */

/** The slice of a platform event widgets read (BUILD §8.1 envelope; payload validated by the consumer). */
export type WidgetEvent = {
  id?: string;
  type: string;
  occurredAt?: string;
  businessId?: string;
  entityIds?: string[];
  payload: Record<string, unknown>;
  actor?: Record<string, unknown>;
};

/**
 * Read a stream frame as a platform event. The stream client hands widgets the `e` of `{ ch, e }`; the relay's
 * raw `{ id, type, json }` field triple and the `{ ch, e }` frame itself are also accepted so a thinner host
 * implementation still works. Returns null for anything else (pong frames, errors, agent-session events).
 */
export function readWidgetEvent(raw: unknown): WidgetEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("e" in obj && obj.e && typeof obj.e === "object") return readWidgetEvent(obj.e);
  if (typeof obj.json === "string" && typeof obj.type === "string") {
    try {
      const parsed = JSON.parse(obj.json) as unknown;
      const inner = readWidgetEvent(parsed);
      if (inner) return inner;
      return { id: typeof obj.id === "string" ? obj.id : undefined, type: obj.type, payload: {} };
    } catch {
      return null;
    }
  }
  if (typeof obj.type !== "string" || !obj.type.includes(".")) return null;
  const payload = obj.payload && typeof obj.payload === "object" ? (obj.payload as Record<string, unknown>) : {};
  const occurredAt = obj.occurredAt instanceof Date ? obj.occurredAt.toISOString() : typeof obj.occurredAt === "string" ? obj.occurredAt : undefined;
  return {
    id: typeof obj.id === "string" ? obj.id : undefined,
    type: obj.type,
    occurredAt,
    businessId: typeof obj.businessId === "string" ? obj.businessId : undefined,
    entityIds: Array.isArray(obj.entityIds) ? obj.entityIds.filter((x): x is string => typeof x === "string") : undefined,
    payload,
    actor: obj.actor && typeof obj.actor === "object" ? (obj.actor as Record<string, unknown>) : undefined,
  };
}

/**
 * Subscribe to the business event channel for the lifetime of the component. `handler` always sees the latest
 * closure (no resubscribe on re-render), and `types` narrows delivery to the listed event types.
 */
export function useBusinessEvents(handler: (event: WidgetEvent) => void, types?: readonly string[]): void {
  const { subscribe, businessId } = useWidgetData();
  const latest = useRef(handler);
  latest.current = handler;
  const typeKey = types ? types.join("|") : "";
  useEffect(() => {
    const wanted = typeKey ? new Set(typeKey.split("|")) : null;
    return subscribe(`ev:${businessId}`, (raw) => {
      const event = readWidgetEvent(raw);
      if (!event) return;
      if (wanted && !wanted.has(event.type)) return;
      latest.current(event);
    });
  }, [subscribe, businessId, typeKey]);
}
