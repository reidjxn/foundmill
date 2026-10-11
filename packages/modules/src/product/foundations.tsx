"use client";
/**
 * Foundations on Home and the Product tabs (BUILD §11.1 "Take charge" → first open, §11.5): the vision, the first
 * specification and the first roadmap are drafted once when a new business is first opened (the business shell calls
 * `product.foundations.ensure`). The drafting is staged (audit P3): the vision lands within seconds, then the
 * specification sections and the roadmap items as they are written, so while it runs the screens show the document
 * writing itself (`FoundationsProgressPanel`: who is writing what, the vision, "4 of 11 sections", the roadmap items
 * arriving) and, before anything has landed, the Dugout `FoundationsStatus`. They refresh on `foundations.progressed`
 * (the host's stream invalidates `product.foundations`) and poll every second when the host has no stream connection;
 * when they turn ready the screen refetches what it shows; a failure offers Try again (`product.foundations.retry`),
 * which resumes from what was written. Businesses committed before foundations existed report "none" and show nothing.
 */
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleDashed, Compass, LoaderCircle } from "lucide-react";
import { Avatar, Chip, EntityLink, FoundationsStatus, Icon, LiveRun, Panel, ProvenanceChip, StatusPill, cn, foundationsNeedsAttention, useDateFormat, type GridSpan, type LiveRunItem, type LiveRunStep } from "@foundmill/dugout";
import type { DeptColourToken, RoadmapHorizon } from "@foundmill/shared";
import { moduleHref, routes, useDepartments, useHostStreamOpen, useWidgetData, useWidgetQuery, type QueryState } from "@foundmill/widgets";
import { PlainDoc } from "./PlainDoc";
import { errorMessage, useAction } from "./shared";
import type { FoundationsProgress, FoundationsResponse, FoundationsVision } from "./types";

export const FOUNDATIONS_PATH = "product.foundations.get";
export const FOUNDATIONS_RETRY_PATH = "product.foundations.retry";
/** How often a drafting business is polled when the host has no stream connection (the parts land every few seconds). */
export const FOUNDATIONS_POLL_MS = 1_000;
/** The safety net while the stream is connected (each stored part pushes `foundations.progressed`). */
export const FOUNDATIONS_STREAM_POLL_MS = 10_000;

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

/**
 * Reads the foundations, refreshes them while they are drafting (every second without a stream connection, as a
 * safety net with one), and calls `onReady` once when they turn ready during this visit.
 */
export function useFoundations(onReady?: () => void): FoundationsQuery {
  const [polling, setPolling] = useState(false);
  const [sawDrafting, setSawDrafting] = useState(false);
  const streamOpen = useHostStreamOpen();
  const q = useWidgetQuery<FoundationsResponse>(FOUNDATIONS_PATH, {}, { refetchIntervalMs: polling ? (streamOpen ? FOUNDATIONS_STREAM_POLL_MS : FOUNDATIONS_POLL_MS) : undefined });
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
  /** What the drafting panel shows of the parts written so far (each tab shows what it is about). */
  detail?: FoundationsProgressDetail;
  className?: string;
}

/** The drafting / failed (and, on Home, just-ready) state as a panel; nothing for a settled or foundation-less business. */
export function FoundationsBanner({ foundations, span = 12, showReady = false, detail = {}, className }: FoundationsBannerProps) {
  const { businessId, navigate } = useWidgetData();
  const departments = useDepartments({ enabled: showReady });
  const retry = useAction();
  const f = foundations.data;
  if (!f) return null;
  const state = foundationsDisplayState(f);
  const readyNews = showReady && state === "ready" && foundations.sawDrafting;
  if (state === "none" || (!foundationsNeedsAttention(state) && !readyNews)) return null;
  if ((state === "pending" || state === "drafting") && f.progress) return <FoundationsProgressPanel progress={f.progress} vision={f.vision} state={state} span={span} detail={detail} className={className} />;
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

/* ---------- The document writing itself (audit P3) ---------- */

export interface FoundationsProgressDetail {
  /** The vision statement (Home: the Vision tab shows the whole vision itself). */
  vision?: boolean;
  /** Each written section's text under its title (Specification). */
  sectionText?: boolean;
  /** The roadmap items as they arrive (Home, Roadmap). */
  roadmap?: boolean;
}

const STAGE_VERB: Record<FoundationsProgress["stage"], string> = {
  vision: "is writing the vision",
  specification: "is writing the specification",
  roadmap: "is writing the roadmap",
  finishing: "is putting the vision, specification and roadmap in place",
};

const HORIZON_LABEL: Record<RoadmapHorizon, string> = { now: "Now", next: "Next", later: "Later" };

/** "4 of 11 sections · 3 of 9 roadmap items" (roadmap counted against the plan's titles until it is written). */
export function foundationsProgressLine(p: Pick<FoundationsProgress, "sectionsDone" | "sectionsTotal" | "roadmap" | "roadmapWritten" | "roadmapDone">): string {
  const sections = `${p.sectionsDone} of ${p.sectionsTotal} section${p.sectionsTotal === 1 ? "" : "s"}`;
  const planned = p.roadmap.length;
  if (!planned) return sections;
  const roadmap = p.roadmapDone ? `${p.roadmapWritten} roadmap item${p.roadmapWritten === 1 ? "" : "s"}` : `${p.roadmapWritten} of ${planned} roadmap item${planned === 1 ? "" : "s"}`;
  return `${sections} · ${roadmap}`;
}

/** Share of the work done, for the ring: the vision, then sections and roadmap items weighted alike. */
export function foundationsProgressFraction(p: Pick<FoundationsProgress, "sectionsDone" | "sectionsTotal" | "roadmap" | "roadmapWritten" | "roadmapDone" | "stage">): number {
  if (p.stage === "vision") return 0.05;
  const total = p.sectionsTotal + Math.max(p.roadmap.length, 1);
  const done = p.sectionsDone + (p.roadmapDone ? Math.max(p.roadmap.length, 1) : p.roadmapWritten);
  return Math.min(0.97, 0.1 + 0.9 * (done / total));
}

/** "Mira, Product lead," — the drafting agent as an entity link, with its role when it has one. */
function Author({ author }: { author: FoundationsProgress["author"] }) {
  if (!author?.name) return <>The drafting agent</>;
  const name = author.agentId ? <EntityLink entity={{ id: author.agentId, kind: "agent", name: author.name }} /> : <>{author.name}</>;
  return (
    <>
      {name}
      {author.role ? `, ${author.role},` : ""}
    </>
  );
}

export interface FoundationsProgressPanelProps {
  progress: FoundationsProgress;
  vision: FoundationsVision | null;
  state: "pending" | "drafting";
  span?: GridSpan;
  detail?: FoundationsProgressDetail;
  className?: string;
}

/** The drafting's steps for the live run rail: the vision, the specification, the roadmap, then putting it in place. */
export function foundationsSteps(p: Pick<FoundationsProgress, "stage" | "sectionsDone" | "sectionsTotal" | "roadmap" | "roadmapWritten" | "roadmapDone">): LiveRunStep[] {
  const order: FoundationsProgress["stage"][] = ["vision", "specification", "roadmap", "finishing"];
  const at = order.indexOf(p.stage);
  const state = (i: number): LiveRunStep["state"] => (i < at ? "done" : i === at ? "current" : "pending");
  const planned = p.roadmap.length;
  return [
    { id: "vision", label: "Vision", detail: at > 0 ? "Written" : "Who it is for, the problem, why now", state: state(0) },
    { id: "specification", label: "Specification", detail: `${p.sectionsDone} of ${p.sectionsTotal} written`, state: state(1) },
    { id: "roadmap", label: "Roadmap", detail: planned ? `${p.roadmapWritten} of ${planned} written` : "Now, Next and Later", state: state(2) },
    { id: "finishing", label: "Into the tabs", detail: "Vision, Specification and Roadmap", state: state(3) },
  ];
}

/** One bar segment per part: each specification section, then each roadmap item (written, being written, to come). */
export function foundationsItems(p: Pick<FoundationsProgress, "stage" | "sections" | "roadmap">, dept?: DeptColourToken): LiveRunItem[] {
  const writing = p.stage === "specification" ? p.sections.find((s) => !s.done) : undefined;
  const sections: LiveRunItem[] = p.sections.map((s) => ({ id: `section-${s.section}`, label: s.title ?? s.section, state: s.done ? "landed" : s === writing ? "drafting" : "queued", dept }));
  const firstPlanned = p.stage === "roadmap" ? p.roadmap.findIndex((r) => !r.written) : -1;
  const roadmap: LiveRunItem[] = p.roadmap.map((r, i) => ({ id: `roadmap-${i}`, label: r.title, state: r.written ? "landed" : i === firstPlanned ? "drafting" : "queued", dept }));
  return [...sections, ...roadmap];
}

/**
 * The drafting as it happens — the document writing itself: the Product lead's live portrait and who is writing what,
 * the step rail (vision → specification → roadmap → into the tabs) with one segment per part, the thesis of the
 * section being written streaming on the log line, and the parts already written (the vision, each section as it
 * lands, the roadmap items as they arrive). Only the first line is a live region, so screen readers hear the stage
 * change, not every section.
 */
export function FoundationsProgressPanel({ progress: p, vision, state, span = 12, detail = {}, className }: FoundationsProgressPanelProps) {
  const datePrefs = useDateFormat();
  const writing = p.sections.find((s) => !s.done);
  const departments = useDepartments();
  const dept = (departments.data?.find((d) => d.moduleKeys.includes("product"))?.colourToken as DeptColourToken | undefined) ?? undefined;
  const author = p.author;
  const portraitSeed = author?.agentId ?? author?.name ?? "product-lead";
  const thesis = p.stage === "specification" && writing?.thesis ? writing.thesis : null;
  return (
    <Panel
      title="Vision, specification and roadmap"
      span={span}
      data-testid="foundations-status"
      data-foundations-state={state}
      data-foundations-stage={p.stage}
      actions={
        <StatusPill tone="info" icon={LoaderCircle} pulse>
          Drafting
        </StatusPill>
      }
      className={className}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="shrink-0" aria-hidden>
            <Avatar size={36} name={author?.name ?? "Product lead"} agent={{ seed: portraitSeed, dept: dept ?? "dept-1" }} presence="live" surface="surface-1" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p role="status" aria-live="polite" className="text-body-strong text-primary" data-foundations-author>
              <Author author={p.author} /> {STAGE_VERB[p.stage]}.
            </p>
            <p className="font-mono text-mono text-tertiary tabular-nums" data-foundations-progress>
              {foundationsProgressLine(p)}
            </p>
          </div>
        </div>

        <LiveRun
          label="Drafting progress"
          steps={foundationsSteps(p)}
          items={foundationsItems(p, dept)}
          itemNoun={["part", "parts"]}
          log={thesis ? { text: thesis, person: { name: author?.name ?? "Product lead", avatarSeed: portraitSeed, dept }, open: true } : null}
          datePrefs={datePrefs}
        />

        {detail.vision && vision ? (
          <p className="max-w-reading text-body text-primary" data-vision-statement>
            {vision.statement}
          </p>
        ) : null}

        {p.sections.length ? (
          <ol className="flex flex-col gap-1.5" aria-label="Specification sections">
            {p.sections.map((s) => {
              const now = !s.done && s === writing && p.stage !== "vision";
              return (
                <li key={s.section} className="flex items-start gap-2" data-foundations-section={s.section} data-done={s.done ? "true" : "false"}>
                  <Icon icon={s.done ? CircleCheck : now ? LoaderCircle : CircleDashed} size="inline" className={cn("mt-0.5 shrink-0", s.done ? "text-status-good" : "text-secondary", now && "animate-spin")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-body", s.done ? "text-primary" : "text-secondary")}>
                      <span className={cn(s.done && "text-body-strong")}>{s.title ?? s.section}</span>
                      {s.title && s.title !== s.section ? <span className="text-small text-secondary"> · {s.section}</span> : null}
                    </p>
                    {!s.done && s.thesis ? <p className="text-small text-secondary">{s.thesis}</p> : null}
                    {detail.sectionText && s.done && s.content ? (
                      <div className="mt-1 max-w-reading">
                        <PlainDoc doc={s.content} />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {detail.roadmap && p.roadmap.length ? (
          <ul className="flex flex-col gap-1" aria-label="Roadmap items">
            {p.roadmap.map((r, i) => (
              <li key={`${r.title}-${i}`} className={cn("flex items-center gap-2 text-body", r.written ? "text-primary" : "text-secondary")} data-roadmap-draft={r.written ? "written" : "planned"}>
                <Icon icon={r.written ? CircleCheck : CircleDashed} size="inline" className={cn("shrink-0", r.written ? "text-status-good" : "text-secondary")} />
                <span className="min-w-0 flex-1 text-pretty">{r.title}</span>
                <Chip tone="neutral">{HORIZON_LABEL[r.horizon]}</Chip>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-small text-secondary">You can keep working. Each part appears here as it is written, and the tabs fill in when everything is in place.</p>
      </div>
    </Panel>
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
