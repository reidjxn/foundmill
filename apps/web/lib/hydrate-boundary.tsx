"use client";
/**
 * The browser half of `<Prefetched>` (lib/hydrate.server.tsx): TanStack's `HydrationBoundary`, except that while the
 * page is being server-rendered and hydrated, the queries the server handed over still pending are held back until
 * this boundary has committed.
 *
 * Why: the server renders a pending query as loading (the sidebar without its Inbox badge). In the browser, React's
 * payload often already carries the answer by the time the page hydrates, and `hydrate` takes an already-resolved
 * promise synchronously, so the first client render would show the badge, not match the server's HTML (React error
 * 418), and React would throw the server HTML away and render the whole tree again in the browser. Held back until
 * after the commit, hydration renders exactly what the server rendered, and the answer lands one commit later, without
 * a request of its own.
 *
 * The hold is keyed by the dehydrated state the payload carries (the same object when React restarts or retries a
 * render), not by component state, which React drops with a render it discards: a hold created by a discarded render
 * would never open and its queries would stay pending forever. Renders after hydration (client navigations, refreshes)
 * have no server HTML to match and pass the state straight through.
 */
import { HydrationBoundary, type DehydratedState, type HydrationBoundaryProps } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

/**
 * `state` with each handed-over pending query's promise chained behind `after`. A native `then` never runs its callback
 * synchronously, so `hydrate` sees these queries as pending on the server and in the browser alike.
 */
export function holdPendingUntil(state: DehydratedState, after: Promise<void>): DehydratedState {
  if (!state.queries.some((q) => q.promise)) return state;
  return { ...state, queries: state.queries.map((q) => (q.promise ? { ...q, promise: after.then(() => q.promise) } : q)) };
}

interface Hold {
  /** The state to hydrate: pending queries chained behind `open`. */
  state: DehydratedState;
  open: () => void;
}

/** One hold per dehydrated state (weakly held: it goes with the payload; on the server it simply never opens). */
const holds = new WeakMap<DehydratedState, Hold>();

export function holdFor(state: DehydratedState): Hold {
  let hold = holds.get(state);
  if (!hold) {
    let open: () => void = () => {};
    const committed = new Promise<void>((resolve) => (open = resolve));
    hold = { state: holdPendingUntil(state, committed), open };
    holds.set(state, hold);
  }
  return hold;
}

const subscribeNothing = () => () => {};

/** True while server rendering and hydrating; false in renders after hydration. */
function useHydrating(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => false,
    () => true,
  );
}

export function PrefetchBoundary({ state, options, children }: { state: DehydratedState; options?: HydrationBoundaryProps["options"]; children: ReactNode }) {
  const hydrating = useHydrating();
  // Once held, a state stays held (same object) so the switch out of hydration does not hand TanStack a new state.
  const hold = hydrating || holds.has(state) ? holdFor(state) : null;
  useEffect(() => hold?.open(), [hold]);
  return (
    <HydrationBoundary state={hold ? hold.state : state} options={options}>
      {children}
    </HydrationBoundary>
  );
}
