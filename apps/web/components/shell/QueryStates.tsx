"use client";
/**
 * How a screen shows the state of its main query (audit RES-04, IAE-16, WEB-14):
 * - nothing loaded yet and the load failed: the error panel (one plain line, Try again);
 * - the record does not exist (NOT_FOUND, or an address that is not an id at all): a not-found state with a way back,
 *   never a Try again that can never succeed;
 * - a background refetch failed while good data is on screen (a deploy, an API restart): the data stays, with a quiet
 *   "Couldn't refresh" line and Retry above it. TanStack keeps `data` after a failed refetch and sets `error`, so a
 *   screen that checked only `error` threw loaded content away.
 */
import { RotateCw, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button, EmptyState, Panel, StatusPill } from "@foundmill/dugout";
import { trpcErrorCode } from "@/lib/trpc";

/** The parts of a TanStack query result these states read. */
export interface QueryLike {
  error: unknown;
  data: unknown;
  isFetching?: boolean;
  refetch: () => unknown;
}

/** The load failed and nothing is on screen: show the error panel. */
export function loadFailed(q: Pick<QueryLike, "error" | "data">): boolean {
  return q.error != null && q.data === undefined;
}

/** A refetch failed while loaded data is on screen: keep the data, say it may be out of date. */
export function refreshFailed(q: Pick<QueryLike, "error" | "data">): boolean {
  return q.error != null && q.data !== undefined;
}

/** The API says the record is not there (deleted, never existed, or in another business: the same answer). */
export function isMissing(err: unknown): boolean {
  return trpcErrorCode(err) === "NOT_FOUND";
}

/** One quiet line above loaded content whose last refresh failed; Retry refetches. */
export function RefreshFailedNotice({ query, className }: { query: QueryLike; className?: string }) {
  return (
    <div role="status" className={className ?? "flex items-center gap-2 px-gutter py-2"} data-testid="refresh-failed">
      <StatusPill tone="warn">Not refreshed</StatusPill>
      <span className="min-w-0 flex-1 text-small text-secondary">Couldn&apos;t refresh. What you see may be out of date.</span>
      <Button size="sm" variant="ghost" icon={RotateCw} loading={query.isFetching} onClick={() => void query.refetch()}>
        Retry
      </Button>
    </div>
  );
}

export interface NotFoundPanelProps {
  /** The panel title (the screen's name: "Agent profile", "Note"). */
  title: string;
  /** "No such agent". */
  heading: string;
  /** One line: what may have happened. */
  children: ReactNode;
  /** Where the way back goes. */
  back: { label: string; href: string };
  /** Render without the outer Panel (inside a pane that has its own frame). */
  bare?: boolean;
}

/** A record that is not there: says so and offers the way back, with no retry. */
export function NotFoundPanel({ title, heading, children, back, bare }: NotFoundPanelProps) {
  const router = useRouter();
  const state = (
    <EmptyState icon={SearchX} title={heading} action={{ label: back.label, onClick: () => router.push(back.href) }}>
      {children}
    </EmptyState>
  );
  if (bare) return <div className="my-auto" data-testid="not-found-panel">{state}</div>;
  return (
    <div className="p-gutter" data-testid="not-found-panel">
      <Panel title={title} span={12}>
        {state}
      </Panel>
    </div>
  );
}
