/**
 * Data contract between widgets/module screens and the host app (docs/ARCHITECTURE.md §18).
 * Widgets never import the tRPC client; the host provides an implementation of `WidgetDataSource`.
 */
import { createContext, useContext, type ReactNode } from "react";

export type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

export type WidgetDataSource = {
  /** Subscribe to a tRPC query by dotted path, e.g. "inbox.list", with its input. */
  useQuery: <T = unknown>(path: string, input: Record<string, unknown> | undefined, opts?: { enabled?: boolean; refetchIntervalMs?: number }) => QueryState<T>;
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

export function useWidgetQuery<T = unknown>(path: string, input?: Record<string, unknown>, opts?: { enabled?: boolean; refetchIntervalMs?: number }): QueryState<T> {
  return useWidgetData().useQuery<T>(path, input, opts);
}

/** Apply the business glossary to a noun (falls back to the default). */
export function useGlossary(): (term: string) => string {
  const { glossary } = useWidgetData();
  return (term) => glossary[term] ?? term;
}
