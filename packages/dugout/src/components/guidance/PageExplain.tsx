"use client";
/**
 * The page-level home of the per-screen explanation. A screen's `Explainer` registers its three lines here (and renders
 * nothing in place); the shell mounts one `PageExplainProvider` around its header and its content and draws one
 * `ExplainPageButton` in the tab row. The registry is a stack in mount order, and the last mounted Explainer wins: a
 * screen that opens a more specific one (a tab inside a profile) explains what the founder is looking at now, and when
 * it unmounts the one below takes over again.
 *
 * Two contexts, as with the guidance provider: the screens that register read only the stable setters, so a change of
 * entry never renders them again; the button reads the current entry.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export const EXPLAINER_LABELS = { purpose: "What this screen is for", action: "What to do here", watchFor: "Watch for" } as const;

/** What a screen tells the page about itself. */
export interface PageExplainEntry {
  /** The screen's stable id ("home", "finance/runway"); the key in `explainersSeen`. */
  screenId: string;
  purpose: ReactNode;
  action: ReactNode;
  watchFor: ReactNode;
  /** "Show me an example": omitted, no button in the panel. */
  onExample?: () => void;
}

interface Registered {
  token: string;
  entry: PageExplainEntry;
}

interface Setters {
  register(token: string, entry: PageExplainEntry): void;
  unregister(token: string): void;
}

const EntryContext = createContext<PageExplainEntry | null>(null);
const SettersContext = createContext<Setters | null>(null);

export function PageExplainProvider({ children }: { children?: ReactNode }) {
  const [stack, setStack] = useState<Registered[]>([]);
  const setters = useMemo<Setters>(
    () => ({
      register: (token, entry) =>
        setStack((s) => {
          const at = s.findIndex((r) => r.token === token);
          if (at < 0) return [...s, { token, entry }];
          const next = s.slice();
          next[at] = { token, entry };
          return next;
        }),
      unregister: (token) => setStack((s) => (s.some((r) => r.token === token) ? s.filter((r) => r.token !== token) : s)),
    }),
    [],
  );
  const entry = stack.length ? stack[stack.length - 1]!.entry : null;
  return (
    <SettersContext.Provider value={setters}>
      <EntryContext.Provider value={entry}>{children}</EntryContext.Provider>
    </SettersContext.Provider>
  );
}

/** The registered entry (the last mounted Explainer's), or null: none registered, or no provider above. */
export function usePageExplain(): PageExplainEntry | null {
  return useContext(EntryContext);
}

/** The registration setters, or null outside a provider (the Explainer then draws its button inline). */
export function usePageExplainSetters(): Setters | null {
  return useContext(SettersContext);
}
