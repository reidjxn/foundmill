"use client";
/**
 * Foundations on Home and the Product tabs (BUILD §11.1 "Take charge" → first open, §11.5): the vision, the first
 * specification and the first roadmap are drafted once when a new business is first opened (the business shell calls
 * `product.foundations.ensure`). While they are drafting the screens show the Dugout `FoundationsStatus` and poll
 * `product.foundations.get`; when they turn ready the screen refetches what it shows; a failure offers Try again
 * (`product.foundations.retry`). Businesses committed before foundations existed report "none" and show nothing.
 */
import { useEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { FoundationsStatus, Icon, Panel, ProvenanceChip, foundationsNeedsAttention, type GridSpan } from "@foundmill/dugout";
import { moduleHref, routes, useDepartments, useWidgetData, useWidgetQuery, type QueryState } from "@foundmill/widgets";
import { errorMessage, useAction } from "./shared";
import type { FoundationsResponse, FoundationsVision } from "./types";

export const FOUNDATIONS_PATH = "product.foundations.get";
export const FOUNDATIONS_RETRY_PATH = "product.foundations.retry";
/** How often a drafting business is polled (the drafting takes a minute or two in live mode). */
export const FOUNDATIONS_POLL_MS = 2_000;

/** What the drafting reads, by door. */
export function foundationsBasis(door: FoundationsResponse["door"]): string {
  return door === "import" ? "From the Import report and the sources you connected at sign-up." : "From your idea and your founder profile.";
}

/** "10 specification sections · 11 roadmap items, 4 in Now · 3 imported issues" (null when the summary is empty). */
export function foundationsSummary(f: Pick<FoundationsResponse, "summary">): string | null {
  const s = f.summary ?? {};
  const r = s.roadmap ?? {};
  const items = (r.now ?? 0) + (r.next ?? 0) + (r.later ?? 0);
  const parts: string[] = [];
  if (typeof s.sectionsWritten === "number") parts.push(`${s.sectionsWritten} specification section${s.sectionsWritten === 1 ? "" : "s"}`);
  if (items) parts.push(`${items} roadmap item${items === 1 ? "" : "s"}, ${r.now ?? 0} in Now`);
  if (s.importedIssues) parts.push(`${s.importedIssues} imported issue${s.importedIssues === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Shown when an attempt ran past its window without finishing (a restarted api, a lost worker). */
export const FOUNDATIONS_INTERRUPTED = "The drafting stopped before it finished. Try again.";

/** The state to show: an attempt past its window (`stale`) reads as failed, with Try again, and is no longer polled. */
export function foundationsDisplayState(f: Pick<FoundationsResponse, "status" | "stale">): FoundationsResponse["status"] {
  return f.stale && (f.status === "pending" || f.status === "drafting") ? "failed" : f.status;
}

export interface FoundationsQuery extends QueryState<FoundationsResponse> {
  status: FoundationsResponse["status"] | undefined;
  /** This visit saw the foundations pending or drafting (so a ready state is news worth showing). */
  sawDrafting: boolean;
}

/** Reads the foundations, polls while they are drafting, and calls `onReady` once when they turn ready during this visit. */
export function useFoundations(onReady?: () => void): FoundationsQuery {
  const [polling, setPolling] = useState(false);
  const [sawDrafting, setSawDrafting] = useState(false);
  const q = useWidgetQuery<FoundationsResponse>(FOUNDATIONS_PATH, {}, { refetchIntervalMs: polling ? FOUNDATIONS_POLL_MS : undefined });
  const status = q.data ? foundationsDisplayState(q.data) : undefined;
  const previous = useRef<FoundationsResponse["status"] | undefined>(undefined);
  const latest = useRef(onReady);
  latest.current = onReady;
  useEffect(() => {
    const drafting = status === "pending" || status === "drafting";
    setPolling(drafting);
    if (drafting) setSawDrafting(true);
    if (status === "ready" && (previous.current === "pending" || previous.current === "drafting")) latest.current?.();
    previous.current = status;
  }, [status]);
  return { ...q, status, sawDrafting };
}

export interface FoundationsBannerProps {
  foundations: FoundationsQuery;
  span?: GridSpan;
  /** Keep the panel after the drafting finished during this visit, with the way to the Vision tab (Home). */
  showReady?: boolean;
  className?: string;
}

/** The drafting / failed (and, on Home, just-ready) state as a panel; nothing for a settled or foundation-less business. */
export function FoundationsBanner({ foundations, span = 12, showReady = false, className }: FoundationsBannerProps) {
  const { businessId, navigate } = useWidgetData();
  const departments = useDepartments({ enabled: showReady });
  const retry = useAction();
  const f = foundations.data;
  if (!f) return null;
  const state = foundationsDisplayState(f);
  const readyNews = showReady && state === "ready" && foundations.sawDrafting;
  if (state === "none" || (!foundationsNeedsAttention(state) && !readyNews)) return null;
  const visionHref = moduleHref(businessId, departments.data, "product", "vision") ?? routes.department(businessId, "product", "vision");
  const reason = state === "failed" && f.status !== "failed" ? FOUNDATIONS_INTERRUPTED : f.error;
  const error = [reason, retry.error ? errorMessage(retry.error) : null].filter(Boolean).join(" ");
  return (
    <FoundationsStatus
      state={state}
      span={span}
      basis={foundationsBasis(f.door)}
      summary={foundationsSummary(f)}
      error={error || undefined}
      onRetry={() => void retry.run(FOUNDATIONS_RETRY_PATH, {}, { then: () => foundations.refetch() })}
      retrying={retry.pending !== null}
      onOpen={readyNews ? () => navigate(visionHref) : undefined}
      className={className}
      data-testid="foundations-status"
    />
  );
}

/** The stored vision on the Vision tab: the statement with who it is for, the problem and why now, the principles, and the north-star metric. */
export function VisionPanels({ vision }: { vision: FoundationsVision }) {
  const label = vision.northStar.label === "Forecast" ? "forecast" : "estimate";
  return (
    <>
      <Panel title="Vision" span={8} data-testid="vision-record">
        <div className="flex max-w-reading flex-col gap-4">
          <p className="t-display-sm text-primary" data-vision-statement>
            {vision.statement}
          </p>
          <dl className="flex flex-col gap-3">
            {(
              [
                ["Who it is for", vision.forWhom],
                ["The problem", vision.problem],
                ["Why now", vision.whyNow],
              ] as const
            ).map(([term, text]) => (
              <div key={term}>
                <dt className="t-label mb-0.5">{term}</dt>
                <dd className="text-body text-primary">{text}</dd>
              </div>
            ))}
          </dl>
          {vision.principles.length ? (
            <section aria-labelledby="vision-principles">
              <h3 id="vision-principles" className="t-label mb-1">
                Principles
              </h3>
              <ol className="flex flex-col gap-1.5">
                {vision.principles.map((p, i) => (
                  <li key={`${p.title}-${i}`} className="text-body">
                    <span className="text-body-strong text-primary">{p.title}.</span> <span className="text-secondary">{p.detail}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </Panel>
      <Panel title="North star" span={4} data-testid="north-star">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-body-strong text-primary">
            <Icon icon={Compass} size="inline" className="text-secondary" />
            {vision.northStar.metric}
          </p>
          <p className="text-small text-secondary">{vision.northStar.definition}</p>
          <div className="flex flex-wrap items-center gap-2">
            {/* The chip carries the label, so a trailing "(Forecast)" in the text is not repeated. */}
            <span className="text-body text-primary tabular-nums">{vision.northStar.target.replace(/\s*\((?:Forecast|Estimate)\)\s*$/i, "")}</span>
            <ProvenanceChip kind={label} />
          </div>
        </div>
      </Panel>
    </>
  );
}
