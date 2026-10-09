/**
 * `<PrefetchBoundary>` (lib/hydrate-boundary.tsx). The server renders a handed-over query as pending; in the browser the
 * payload often already carries the answer when the page hydrates. TanStack's own boundary takes that answer in the
 * hydration render, which no longer matches the server's HTML (React then re-renders the whole tree in the browser).
 * PrefetchBoundary hydrates the query as pending, lets the answer land right after the commit without a request of its
 * own, survives renders React discards, and leaves renders after hydration (client navigations) alone.
 */
import { HydrationBoundary, QueryClient, QueryClientProvider, hydrate, useQuery, type DehydratedState } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrefetchBoundary, holdFor, holdPendingUntil } from "../hydrate-boundary";

const KEY = [["inbox", "list"], { input: { businessId: "b1" }, type: "query" }] as unknown as unknown[];

/** A thenable like the ones React's payload decoder hands out: once its row has arrived, `then` calls back synchronously. */
function resolvedChunk<T>(value: T): Promise<T> {
  return { status: "fulfilled", value, then: (resolve?: (v: T) => unknown) => void resolve?.(value) } as unknown as Promise<T>;
}

function pendingState(promise: Promise<unknown>): DehydratedState {
  return {
    mutations: [],
    queries: [
      {
        queryKey: KEY,
        queryHash: JSON.stringify(KEY),
        dehydratedAt: Date.now(),
        state: { data: undefined, dataUpdateCount: 0, dataUpdatedAt: 0, error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: "pending", fetchStatus: "fetching" },
        promise,
      },
    ],
  };
}

function Badge({ queryFn, seen }: { queryFn: () => Promise<{ n: number }>; seen: string[] }) {
  const q = useQuery({ queryKey: KEY, queryFn, staleTime: 60_000 });
  const text = q.data ? `badge ${q.data.n}` : "no badge";
  seen.push(text);
  return <span data-testid="badge">{text}</span>;
}

type Boundary = (p: { state: DehydratedState; options?: { defaultOptions?: { queries?: { retry?: number; retryDelay?: number } } }; children: ReactNode }) => ReactNode;

function tree(Boundary: Boundary, client: QueryClient, state: DehydratedState, queryFn: () => Promise<{ n: number }>, seen: string[], options?: Parameters<Boundary>[0]["options"]) {
  return (
    <QueryClientProvider client={client}>
      <Boundary state={state} options={options}>
        <Badge queryFn={queryFn} seen={seen} />
      </Boundary>
    </QueryClientProvider>
  );
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** Server-renders with the query still pending, then hydrates in a fresh browser cache with `clientState`. */
async function serverThenHydrate(Boundary: Boundary, clientState: DehydratedState, queryFn: () => Promise<{ n: number }>, options?: Parameters<Boundary>[0]["options"], before?: (client: QueryClient) => void) {
  const html = renderToString(tree(Boundary, new QueryClient(), pendingState(new Promise(() => {})), queryFn, []));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  expect(container.textContent).toBe("no badge");
  const client = new QueryClient();
  before?.(client);
  const seen: string[] = [];
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, tree(Boundary, client, clientState, queryFn, seen, options), { onRecoverableError: (e) => errors.push(e) });
  });
  return { container, seen, errors };
}

describe("PrefetchBoundary", () => {
  it("leaves a state without pending queries untouched", () => {
    const state: DehydratedState = { mutations: [], queries: [] };
    expect(holdPendingUntil(state, Promise.resolve())).toBe(state);
  });

  it("TanStack's own boundary takes an already-arrived answer while hydrating, which does not match the server (the bug)", async () => {
    const { seen, errors } = await serverThenHydrate(HydrationBoundary as Boundary, pendingState(resolvedChunk({ n: 4 })), vi.fn(async () => ({ n: 9 })));
    expect(seen[0]).toBe("badge 4");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("hydrates a handed-over query as pending, matching the server, then shows its answer without fetching", async () => {
    const queryFn = vi.fn(async () => ({ n: 9 }));
    const { container, seen, errors } = await serverThenHydrate(PrefetchBoundary, pendingState(resolvedChunk({ n: 4 })), queryFn);
    expect(seen[0]).toBe("no badge");
    expect(errors).toEqual([]);
    await waitFor(() => expect(container.textContent).toBe("badge 4"));
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("opens the hold of a render React discarded once the retried render commits (the hold follows the payload)", async () => {
    const queryFn = vi.fn(async () => ({ n: 9 }));
    const state = pendingState(resolvedChunk({ n: 4 }));
    // A discarded first attempt already put the held query in the cache; the committed retry finds it pending.
    const { container, errors } = await serverThenHydrate(PrefetchBoundary, state, queryFn, undefined, (client) => hydrate(client, holdFor(state).state));
    expect(errors).toEqual([]);
    await waitFor(() => expect(container.textContent).toBe("badge 4"));
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("still lets the browser fetch for itself when the server's query fails", async () => {
    const queryFn = vi.fn(async () => ({ n: 7 }));
    const failed = Promise.reject(new Error("redacted"));
    failed.catch(() => undefined);
    const { container, errors } = await serverThenHydrate(PrefetchBoundary, pendingState(failed), queryFn, { defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });
    expect(errors).toEqual([]);
    await waitFor(() => expect(container.textContent).toBe("badge 7"));
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("does not hold anything in renders after hydration (a client navigation has no server HTML to match)", () => {
    const seen: string[] = [];
    const queryFn = vi.fn(async () => ({ n: 9 }));
    render(tree(PrefetchBoundary, new QueryClient(), pendingState(resolvedChunk({ n: 4 })), queryFn, seen));
    expect(seen[0]).toBe("badge 4");
    expect(screen.getByTestId("badge").textContent).toBe("badge 4");
    expect(queryFn).not.toHaveBeenCalled();
  });
});
