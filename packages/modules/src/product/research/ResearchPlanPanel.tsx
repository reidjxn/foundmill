"use client";
/**
 * Product › Research › the plan (BUILD §11.5; the founder's 2026-10-18 request): how the Product Researcher tests the
 * specification with the ICP, in parallel with the build. The panel reads `product.research.get`, asks the api to start
 * the drafting once the foundations are ready (`product.research.ensure`, once per business per session; idempotent on
 * the server), refreshes while the plan is drafting (on `product.research_drafted`, and by polling without a stream),
 * and shows the plan once ready: the riskiest assumptions with the sections they come from, the artifacts as cards with
 * a reading dialog, and the first research tasks on Development › Plan. Nothing here contacts anyone: the artifacts are
 * drafts the founder marks ready or shared.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, CheckCircle2, FileText, FlaskConical, ListChecks, LoaderCircle, Mic, Presentation, RotateCcw, ScrollText, Share2, Target, type LucideIcon } from "lucide-react";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Markdown, Panel, StatusPill, cn, useFormatters, type ChipTone, type GridSpan } from "@foundmill/dugout";
import type { ResearchArtifactKind, ResearchArtifactStatus } from "@foundmill/shared";
import { failedWithoutData, isForbidden, moduleHref, routes, useBusinessEvents, useDepartments, useHostStreamOpen, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { useCanWrite } from "../../env";
import { errorMessage, InlineError, useAction } from "../shared";
import type { ResearchArtifactRow, ResearchResponse, SpecBlockRow } from "../types";

export const RESEARCH_PATH = "product.research.get";
export const RESEARCH_ENSURE_PATH = "product.research.ensure";
export const RESEARCH_RETRY_PATH = "product.research.retry";
export const RESEARCH_ARTIFACT_UPDATE_PATH = "product.research.artifacts.update";
/** How often a drafting plan is polled when the host has no stream connection (one worker call: a minute or two). */
export const RESEARCH_POLL_MS = 2_000;
/** The safety net while the stream is connected (`product.research_drafted` pushes the change). */
export const RESEARCH_STREAM_POLL_MS = 15_000;

export const ARTIFACT_KIND_META: Record<ResearchArtifactKind, { word: string; icon: LucideIcon; tone: ChipTone }> = {
  interview_plan: { word: "Interview plan", icon: Mic, tone: "info" },
  interview_script: { word: "Interview script", icon: ScrollText, tone: "info" },
  smoke_test: { word: "Smoke test", icon: FlaskConical, tone: "warn" },
  survey: { word: "Survey", icon: ListChecks, tone: "neutral" },
  demo_script: { word: "Demo script", icon: Presentation, tone: "good" },
  demo: { word: "Demo", icon: Presentation, tone: "good" },
  findings: { word: "Findings", icon: BookOpenText, tone: "info" },
};

export const ARTIFACT_STATUS_META: Record<ResearchArtifactStatus, { word: string; tone: "neutral" | "good" | "info" }> = {
  draft: { word: "Draft", tone: "neutral" },
  ready: { word: "Ready", tone: "good" },
  shared: { word: "Shared", tone: "info" },
};

export type ResearchPlanState = "none" | "waiting" | "pending" | "drafting" | "ready" | "failed";

/**
 * The state the panel shows. The foundations gate it: until they are ready nothing can be drafted (`waiting`); a plan
 * past its window reads as failed, with Try again.
 */
export function researchPlanState(research: Pick<ResearchResponse, "status" | "stale"> | undefined, foundationsStatus: string | undefined): ResearchPlanState {
  if (!research) return "waiting";
  if (research.status === "none") return "none";
  if (research.stale && research.status === "drafting") return "failed";
  if (research.status === "pending") return foundationsStatus === "ready" ? "pending" : "waiting";
  return research.status;
}

/** Businesses this tab already asked the api to start the plan for (once per business per session). */
const ensured = new Set<string>();
/** Tests and the Home screen reset it between businesses. */
export function resetResearchEnsured(): void {
  ensured.clear();
}

export interface ResearchPlanPanelProps {
  businessId: string;
  blocks: readonly SpecBlockRow[];
  onOpenBlock: (blockId: string) => void;
  span?: GridSpan;
  className?: string;
}

export function ResearchPlanPanel({ businessId, blocks, onOpenBlock, span = 12, className }: ResearchPlanPanelProps) {
  const { mutate, navigate } = useWidgetData();
  const canWrite = useCanWrite("product");
  const departments = useDepartments();
  const streamOpen = useHostStreamOpen();
  const business = useWidgetQuery<{ foundationsStatus?: string }>("business.get", {});
  const foundationsStatus = business.data?.foundationsStatus;
  const [polling, setPolling] = useState(false);
  const research = useWidgetQuery<ResearchResponse>(RESEARCH_PATH, {}, { refetchIntervalMs: polling ? (streamOpen ? RESEARCH_STREAM_POLL_MS : RESEARCH_POLL_MS) : undefined });
  const state = researchPlanState(research.data, foundationsStatus);
  useBusinessEvents(() => research.refetch(), ["product.research_drafted"]);
  useEffect(() => setPolling(state === "pending" || state === "drafting"), [state]);

  // The first open once the foundations are ready starts the drafting (the server claims it exactly once).
  const refetch = research.refetch;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (foundationsStatus !== "ready" || !research.data || state !== "pending") return;
    if (ensured.has(businessId) || asked.current === businessId) return;
    asked.current = businessId;
    ensured.add(businessId);
    void mutate(RESEARCH_ENSURE_PATH, {})
      .then(() => refetch())
      .catch(() => undefined);
  }, [businessId, foundationsStatus, mutate, refetch, research.data, state]);

  const action = useAction();
  const [reading, setReading] = useState<ResearchArtifactRow | null>(null);
  const r = research.data;
  const icp = r?.icp || "the customers the specification names";
  const summary = (r?.summary ?? {}) as { assumptions?: { assumption: string; fromSection: string; whyItMatters: string; testKind: string }[]; firstStepTaskIds?: string[]; openQuestions?: string[] };
  const assumptions = Array.isArray(summary.assumptions) ? summary.assumptions : [];
  const taskCount = Array.isArray(summary.firstStepTaskIds) ? summary.firstStepTaskIds.length : 0;
  const blockFor = useMemo(() => new Map(blocks.map((b) => [b.section.toLowerCase(), b] as const)), [blocks]);
  const planHref = moduleHref(businessId, departments.data, "development", "plan") ?? routes.department(businessId, "development", "plan");
  const setStatus = (artifact: ResearchArtifactRow, status: ResearchArtifactStatus) => void action.run(RESEARCH_ARTIFACT_UPDATE_PATH, { artifactId: artifact.id, status }, { key: artifact.id, then: () => research.refetch() });

  if (!r) {
    if (failedWithoutData(research) && !isForbidden(research.error)) return <Panel span={span} title="Testing the specification" error={`The research plan could not be loaded. ${errorMessage(research.error)}`} onRetry={research.refetch} className={className} data-testid="research-plan" data-research-state="error" />;
    return <Panel span={span} title="Testing the specification" loading className={className} data-testid="research-plan" data-research-state="loading" />;
  }

  const pill =
    state === "ready" ? (
      <StatusPill tone="good" icon={CheckCircle2}>
        Ready
      </StatusPill>
    ) : state === "drafting" || state === "pending" ? (
      <StatusPill tone="info" icon={LoaderCircle} pulse>
        {state === "drafting" ? "Drafting" : "Starting"}
      </StatusPill>
    ) : state === "failed" ? (
      <StatusPill tone="bad">Failed</StatusPill>
    ) : (
      <StatusPill tone="neutral">Waiting</StatusPill>
    );

  const title = state === "ready" || state === "drafting" || state === "pending" ? `Testing the specification with ${icp}` : "Testing the specification";
  const agentName = r.agent?.name ?? "The Product Researcher";

  return (
    <Panel
      title={title}
      span={span}
      actions={pill}
      className={className}
      data-testid="research-plan"
      data-research-state={state}
      footer={state === "ready" ? <span className="tabular-nums">{r.artifacts.length} artifacts · every threshold and sample size is an Estimate until it is measured · nothing is sent to anyone without your approval</span> : undefined}
    >
      {state === "none" ? (
        <p className="max-w-reading text-body text-secondary">This business has no research plan: it was set up before the Product Researcher joined. Hire one from Team › Agents and it plans how to test the specification with your customers.</p>
      ) : null}
      {state === "waiting" ? <p className="max-w-reading text-body text-secondary">Starts when the specification is drafted. {agentName} then plans how to test it with the people it is for: discovery interviews, a smoke test, a survey and a demo script.</p> : null}
      {state === "pending" || state === "drafting" ? (
        <p role="status" aria-live="polite" className="max-w-reading text-body text-primary">
          {agentName} is reading the specification and planning how to test it with {icp}: the riskiest assumptions, an interview plan and script, a smoke test, a survey and a demo script. Each part lands here when the plan is ready.
        </p>
      ) : null}
      {state === "failed" ? (
        <div className="flex flex-col gap-2">
          <p className="max-w-reading text-body text-primary">{r.stale && r.status === "drafting" ? "The research plan stopped before it finished. Try again." : r.error}</p>
          {canWrite ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" icon={RotateCcw} onClick={() => void action.run(RESEARCH_RETRY_PATH, {}, { key: "retry", then: () => research.refetch() })} loading={action.pending === "retry"} data-testid="research-retry">
                Try again
              </Button>
              <InlineError error={action.pending === null ? action.error : null} />
            </div>
          ) : null}
        </div>
      ) : null}

      {state === "ready" ? (
        <div className="flex flex-col gap-4">
          {assumptions.length ? (
            <section aria-labelledby="research-assumptions">
              <h3 id="research-assumptions" className="t-label mb-1.5 flex items-center gap-1">
                <Icon icon={Target} size="inline" /> Riskiest assumptions
              </h3>
              <ol className="flex flex-col gap-1.5" aria-label="Riskiest assumptions">
                {assumptions.map((a, i) => {
                  const block = blockFor.get(a.fromSection.toLowerCase());
                  const kind = ARTIFACT_KIND_META[a.testKind as ResearchArtifactKind];
                  return (
                    <li key={`${a.assumption}-${i}`} className="flex flex-col gap-0.5" data-research-assumption>
                      <p className="text-body text-primary">{a.assumption}</p>
                      <div className="flex flex-wrap items-center gap-1 text-small text-secondary">
                        {block ? (
                          <Chip tone="neutral" icon={FileText} onClick={() => onOpenBlock(block.id)} title="Open the specification section">
                            {a.fromSection}
                          </Chip>
                        ) : (
                          <Chip tone="neutral" icon={FileText}>
                            {a.fromSection}
                          </Chip>
                        )}
                        {kind ? <span>tested by the {kind.word.toLowerCase()}</span> : null}
                        <span>· {a.whyItMatters}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          <ul className="grid grid-cols-2 gap-3" aria-label="Research artifacts">
            {r.artifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} canWrite={canWrite} pending={action.pending === a.id} onRead={() => setReading(a)} onStatus={(status) => setStatus(a, status)} />
            ))}
          </ul>
          <InlineError error={action.error} />

          <p className="flex flex-wrap items-center gap-2 text-small text-secondary" data-research-first-steps>
            {taskCount ? (
              <>
                <span className="tabular-nums">
                  {taskCount} research task{taskCount === 1 ? "" : "s"} for the next cycles (recruiting, the page, the survey), each ending with your approval before anyone is contacted.
                </span>
                <Button size="sm" variant="ghost" onClick={() => navigate(planHref)}>
                  Open Development › Plan
                </Button>
              </>
            ) : (
              <span>The follow-up work (recruiting, the page, the survey) runs as research tasks in the next cycles.</span>
            )}
          </p>
        </div>
      ) : null}

      <Dialog open={reading !== null} onOpenChange={(open) => (open ? undefined : setReading(null))}>
        <DialogContent size="lg">
          {reading ? (
            <>
              <DialogHeader>
                <DialogTitle>{reading.title}</DialogTitle>
                <DialogDescription>
                  {ARTIFACT_KIND_META[reading.kind].word} · {ARTIFACT_STATUS_META[reading.status].word}
                  {reading.summary ? ` · ${reading.summary}` : ""}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="max-h-[60vh] overflow-y-auto" data-research-artifact-body>
                <Markdown variant="body" images={false} entities={false} externalLinks={false}>
                  {reading.bodyMd}
                </Markdown>
              </DialogBody>
              <DialogFooter>
                {canWrite && reading.status === "draft" ? (
                  <Button variant="secondary" icon={CheckCircle2} onClick={() => setStatus(reading, "ready")} loading={action.pending === reading.id}>
                    Mark ready
                  </Button>
                ) : null}
                {canWrite && reading.status === "ready" ? (
                  <Button variant="secondary" icon={Share2} onClick={() => setStatus(reading, "shared")} loading={action.pending === reading.id}>
                    Mark shared
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => setReading(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function ArtifactCard({ artifact, canWrite, pending, onRead, onStatus }: { artifact: ResearchArtifactRow; canWrite: boolean; pending: boolean; onRead: () => void; onStatus: (status: ResearchArtifactStatus) => void }) {
  const { formatDateSmart } = useFormatters();
  const kind = ARTIFACT_KIND_META[artifact.kind];
  const status = ARTIFACT_STATUS_META[artifact.status];
  return (
    <li className={cn("flex flex-col gap-2 rounded-panel border border-subtle bg-panel-alt p-3")} data-research-artifact={artifact.id} data-artifact-kind={artifact.kind} data-artifact-status={artifact.status}>
      <div className="flex items-start gap-2">
        <Chip tone={kind.tone} icon={kind.icon} className="shrink-0">
          {kind.word}
        </Chip>
        <StatusPill tone={status.tone} fit className="ml-auto shrink-0">
          {status.word}
        </StatusPill>
      </div>
      <h3 className="text-body-strong text-pretty break-words text-primary">{artifact.title}</h3>
      {artifact.summary ? <p className="text-small text-secondary">{artifact.summary}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon={BookOpenText} onClick={onRead} data-read-artifact={artifact.id}>
          Read
        </Button>
        {canWrite && artifact.status === "draft" ? (
          <Button size="sm" variant="ghost" icon={CheckCircle2} onClick={() => onStatus("ready")} loading={pending}>
            Mark ready
          </Button>
        ) : null}
        {canWrite && artifact.status === "ready" ? (
          <Button size="sm" variant="ghost" icon={Share2} onClick={() => onStatus("shared")} loading={pending}>
            Mark shared
          </Button>
        ) : null}
        <span className="ml-auto text-small text-tertiary tabular-nums">{formatDateSmart(artifact.updatedAt)}</span>
      </div>
    </li>
  );
}
