"use client";
/**
 * /new/import — Door B (BUILD §11.1, AC-11.1.5). Three phases in one screen: pick sources (GitHub repo, Drive,
 * Notion/Linear/Jira, website URL, Stripe/Shopify, bank, registry; every one read-only), watch the import job run
 * step by step, read the Scouting report (what exists, what is missing, strengths, weaknesses, first decisions,
 * roadmap seeds, "nothing pushed"). "Continue to Commit" saves the concept card describing the business and opens the
 * Commit screen with the suggested name.
 *
 * The job runs on the API: `import.start` returns the job, `import.status` is polled until it is done and carries the
 * report. The moment the report is on screen the card is drafted ahead (`import.prepareConcept`, held on the API and
 * not saved), so "Continue to Commit" (`import.continue`) saves it without waiting on the model (audit P7).
 * The job id rides in the address (`?job=`), so a reload, the browser's Back, or Back from the Commit screen finds the
 * running import or its report again instead of an empty picker (the id is signed and self-contained on the API).
 * `ImportFlow` is pure over an `ImportRunner` so it is tested with a fake runner and no tRPC.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleDashed, FileSearch, GitBranch, Lock, Play, ShieldCheck, ThumbsUp, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ARCHETYPE_LABELS } from "@foundmill/shared";
import { Button, Checkbox, Chip, Field, Input, Panel, ProgressRing, StatusPill, cn, usePrefersReducedMotion, useToast } from "@foundmill/dugout";
import { errorMessage } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { IMPORT_STEPS, StudioFrame } from "../StudioFrame";
import { commitHref } from "../ideate/concepts";
import { IMPORT_SOURCES, IMPORT_SOURCE_GROUPS, doneSteps, normaliseSourceValue, sourceByKey, totalSteps, validateConfigs, type ImportJob, type ImportSourceKey, type ImportStartInput, type ImportStatus, type ScoutingReport, type SourceConfig, type StepStatus } from "./import-job";

export interface ImportScreenProps {
  viewer: { email: string | null };
}

/** The two API calls the flow needs (BUILD §11.1 Door B); the screen binds them to tRPC, tests pass a fake. */
export interface ImportRunner {
  start(input: ImportStartInput): Promise<ImportStatus>;
  status(jobId: string): Promise<ImportStatus>;
}

/** Local-job step length the API applies under reduced motion (the whole job finishes within one poll). */
export const REDUCED_MOTION_STEP_MS = 1;
/** Polls about once a step (the API's local steps take 120 ms), so the progress reads smoothly and the report shows at once. */
export const DEFAULT_POLL_MS = 150;

/** The address of the Commit screen after Import's Continue: the name, the report's archetype and the job to come back to. */
export function commitFromImportHref(ideaId: string, report: Pick<ScoutingReport, "suggestedName" | "archetypeHint">, jobId: string): string {
  return `${commitHref(ideaId)}?name=${encodeURIComponent(report.suggestedName)}&from=import&archetype=${encodeURIComponent(report.archetypeHint)}&job=${encodeURIComponent(jobId)}`;
}

/** `/new/import` with the job in the address (so a reload resumes it), or the bare picker. */
export function importJobHref(jobId: string | null): string {
  return jobId ? `/new/import?job=${encodeURIComponent(jobId)}` : "/new/import";
}

export function ImportScreen({ viewer }: ImportScreenProps) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const router = useRouter();
  const resumeJobId = useSearchParams().get("job");
  const { toast } = useToast();
  const runner = useMemo<ImportRunner>(() => ({ start: (input) => client.import.start.mutate(input), status: (jobId) => client.import.status.query({ jobId }) }), [client]);
  const continueImport = useMutation(
    trpc.import.continue.mutationOptions({
      onError: (err) => toast({ title: "Could not prepare the Commit screen", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <ImportFlow
      viewer={viewer}
      runner={runner}
      continuing={continueImport.isPending}
      resumeJobId={resumeJobId}
      onJob={(jobId) => router.replace(importJobHref(jobId), { scroll: false })}
      // Best effort: Continue drafts the card itself when the draft ahead is missing or failed.
      onReport={(job) => void client.import.prepareConcept.mutate({ jobId: job.id }).catch(() => undefined)}
      onContinue={(report, _configs, job) =>
        continueImport.mutate(
          // The job id rides on the saved idea so commit links the business to this import (its report and sources).
          { jobId: job.id },
          { onSuccess: (res) => router.push(commitFromImportHref(res.idea.id, report, job.id)) },
        )
      }
    />
  );
}

/* ---------- the pure flow ---------- */

export interface ImportFlowProps {
  viewer: { email: string | null };
  runner: ImportRunner;
  /** Continue to Commit with the report; `job` is the Import job the business will be linked to at commit. */
  onContinue: (report: ScoutingReport, configs: SourceConfig[], job: ImportJob) => void;
  /** The report is on screen (once per finished job): the screen drafts the concept card ahead of Continue. */
  onReport?: (job: ImportJob, report: ScoutingReport) => void;
  continuing?: boolean;
  /** A job in the address (`?job=`): the flow resumes it (running or report) instead of showing the picker. */
  resumeJobId?: string | null;
  /** The job id when one starts, and null when the founder goes back to the picker: the screen keeps the address in step. */
  onJob?: (jobId: string | null) => void;
  /** Milliseconds between `import.status` polls (tests pass 0). */
  pollMs?: number;
}

type Phase = { kind: "pick"; error?: string } | { kind: "starting" } | { kind: "running"; job: ImportJob } | { kind: "report"; job: ImportJob; report: ScoutingReport } | { kind: "failed"; job: ImportJob | null; message: string };

export function ImportFlow({ viewer, runner, onContinue, onReport, continuing, resumeJobId = null, onJob, pollMs = DEFAULT_POLL_MS }: ImportFlowProps) {
  const reduced = usePrefersReducedMotion();
  const [chosen, setChosen] = useState<Map<ImportSourceKey, string>>(() => new Map());
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => (resumeJobId ? { kind: "starting" } : { kind: "pick" }));
  const configs = useMemo<SourceConfig[]>(() => IMPORT_SOURCES.filter((s) => chosen.has(s.key)).map((s) => ({ key: s.key, value: chosen.get(s.key) ?? "" })), [chosen]);
  const errors = useMemo(() => validateConfigs(configs), [configs]);
  const valid = configs.length > 0 && Object.keys(errors).length === 0;
  // The polling loop stops when the run id changes (Cancel, Change sources, unmount).
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One Continue per press: a double click reaches onContinue twice before `continuing` re-renders the button.
  const continuingRef = useRef(false);
  useEffect(() => {
    if (!continuing) continuingRef.current = false;
  }, [continuing]);
  // The job already running or finished in the address (reload, Back, Back from Commit): picked up once on mount.
  const resumed = useRef<string | null>(null);

  useEffect(
    () => () => {
      run.current++;
      resumed.current = null;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function toggle(key: ImportSourceKey) {
    setChosen((m) => {
      const next = new Map(m);
      if (next.has(key)) next.delete(key);
      else next.set(key, "");
      return next;
    });
  }

  function setValue(key: ImportSourceKey, value: string) {
    setChosen((m) => new Map(m).set(key, value));
  }

  function apply(status: ImportStatus, id: number) {
    if (id !== run.current) return;
    if (status.job.status === "failed") setPhase({ kind: "failed", job: status.job, message: "The import did not finish; every source reported a failure." });
    else if (status.job.status === "done" && status.report) {
      setPhase({ kind: "report", job: status.job, report: status.report });
      onReport?.(status.job, status.report);
    } else {
      setPhase({ kind: "running", job: status.job });
      timer.current = setTimeout(() => {
        runner
          .status(status.job.id)
          .then((next) => apply(next, id))
          .catch((err: unknown) => id === run.current && setPhase({ kind: "failed", job: status.job, message: errorMessage(err, "Lost track of the import job.") }));
      }, pollMs);
    }
  }

  function start() {
    setTouched(true);
    if (!valid) return;
    const id = ++run.current;
    const normalised = configs.map((c) => ({ key: c.key, value: normaliseSourceValue(sourceByKey(c.key)!, c.value) }));
    setPhase({ kind: "starting" });
    runner
      .start({ sources: normalised, ...(reduced || pollMs <= 0 ? { stepMs: REDUCED_MOTION_STEP_MS } : {}) })
      .then((status) => {
        if (id !== run.current) return;
        // The job goes into the address: a reload finds it again (the effect below skips the job this flow runs itself).
        resumed.current = status.job.id;
        onJob?.(status.job.id);
        apply(status, id);
      })
      .catch((err: unknown) => id === run.current && setPhase({ kind: "pick", error: errorMessage(err, "The import could not start.") }));
  }

  function reset() {
    run.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    resumed.current = null;
    onJob?.(null);
    setPhase({ kind: "pick" });
  }

  useEffect(() => {
    if (!resumeJobId || resumed.current === resumeJobId) return;
    resumed.current = resumeJobId;
    const id = ++run.current;
    setPhase({ kind: "starting" });
    runner
      .status(resumeJobId)
      .then((status) => {
        if (id !== run.current) return;
        // The picker behind "Change sources" shows what this import read.
        setChosen(new Map(status.job.sources.map((s) => [s.key as ImportSourceKey, s.value] as const)));
        apply(status, id);
      })
      .catch(() => {
        if (id !== run.current) return;
        resumed.current = null;
        onJob?.(null);
        setPhase({ kind: "pick", error: "That import is no longer available. Choose the sources again." });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- picks up the job in the address once per job id
  }, [resumeJobId]);

  const back = (
    <LinkButton variant="ghost" icon={ArrowLeft} href="/new">
      Back to the doors
    </LinkButton>
  );

  if (phase.kind === "pick" || phase.kind === "starting") {
    const starting = phase.kind === "starting";
    const startError = phase.kind === "pick" ? phase.error : undefined;
    return (
      <StudioFrame step="import" steps={IMPORT_STEPS} title="Import what already exists" lede="Choose the sources. Every connection is read-only; the Import agent never writes until you grant it separately." viewer={viewer} actions={back}>
        <div className="grid grid-cols-12 gap-gutter" data-testid="import-sources">
          <div className="col-span-8 flex flex-col gap-gutter">
            {IMPORT_SOURCE_GROUPS.map((group) => (
              <Panel key={group} title={group}>
                <ul className="flex flex-col gap-2">
                  {IMPORT_SOURCES.filter((s) => s.group === group).map((s) => {
                    const on = chosen.has(s.key);
                    const err = touched ? errors[s.key] : undefined;
                    return (
                      <li key={s.key} className={cn("rounded-md bg-white/2 p-3 ring-1 ring-line transition-[box-shadow,background-color] duration-hover ease-out hover:ring-line-strong", on && "bg-accent/6 ring-accent/60 hover:ring-accent/70")} data-source={s.key} data-selected={on || undefined}>
                        <div className="flex items-start gap-3">
                          <Checkbox id={`src-${s.key}`} checked={on} onCheckedChange={() => toggle(s.key)} className="mt-0.5" aria-label={`Import from ${s.label}`} />
                          <div className="min-w-0 flex-1">
                            <label htmlFor={`src-${s.key}`} className="flex cursor-pointer items-center gap-2">
                              <span className="text-body-strong">{s.label}</span>
                              <Chip icon={Lock}>Read only</Chip>
                            </label>
                            <p className="text-small text-secondary">{s.description}</p>
                            {on ? (
                              <div className="mt-2 flex flex-col gap-2">
                                {s.input !== "none" ? (
                                  <Field htmlFor={`src-${s.key}-value`} label={s.input === "repo" ? "Repository" : s.input === "url" ? "Address" : "Registration number"} error={err}>
                                    <Input id={`src-${s.key}-value`} value={chosen.get(s.key) ?? ""} onChange={(e) => setValue(s.key, e.target.value)} placeholder={s.placeholder} mono={s.input !== "url"} invalid={Boolean(err)} autoFocus />
                                  </Field>
                                ) : null}
                                <p className="flex items-center gap-1.5 text-small text-secondary">
                                  <ShieldCheck size={14} aria-hidden /> {s.consent}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))}
          </div>
          <aside className="col-span-4">
            <div className="sticky top-20 flex flex-col gap-gutter">
              <Panel title="Your import" footer={<span>Each source connects with credentials kept for this business alone; this page never sees a password or key.</span>}>
                {configs.length === 0 ? (
                  <p className="text-body text-secondary">Nothing chosen yet. A repository or a website is enough to start; revenue sources make the first forecast real.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5" aria-label="Chosen sources">
                    {configs.map((c) => (
                      <li key={c.key} className="flex items-center gap-2 text-body">
                        <Check size={14} className="text-status-good" aria-hidden />
                        <span className="text-body-strong">{sourceByKey(c.key)?.label}</span>
                        {c.value ? <span className="truncate font-mono text-mono text-secondary">{c.value}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-col gap-2">
                  <Button variant="primary" icon={Play} disabled={configs.length === 0} loading={starting} onClick={start} data-testid="start-import">
                    Start the import
                  </Button>
                  {touched && !valid && configs.length > 0 ? (
                    <StatusPill tone="warn" role="alert">
                      Complete the highlighted fields
                    </StatusPill>
                  ) : null}
                  {startError ? (
                    <StatusPill tone="bad" role="alert" data-testid="import-start-error">
                      {startError}
                    </StatusPill>
                  ) : null}
                </div>
              </Panel>
              <Panel title="What the agent will not do">
                <ul className="flex flex-col gap-1 text-body text-secondary">
                  <li>Push to a repository or open a pull request</li>
                  <li>Move money, change settings or accept terms</li>
                  <li>Read pages a website asks crawlers to skip</li>
                  <li>Keep credentials in the browser</li>
                </ul>
              </Panel>
            </div>
          </aside>
        </div>
      </StudioFrame>
    );
  }

  if (phase.kind === "failed") {
    return (
      <StudioFrame step="import" steps={IMPORT_STEPS} title="The import stopped" lede={phase.message} viewer={viewer} actions={back}>
        <div className="flex flex-col gap-gutter" data-testid="import-failed">
          <StatusPill tone="bad" role="alert">
            {phase.message}
          </StatusPill>
          {phase.job ? <JobPanels job={phase.job} /> : null}
          <div>
            <Button variant="default" icon={ArrowLeft} onClick={reset}>
              Change sources and try again
            </Button>
          </div>
        </div>
      </StudioFrame>
    );
  }

  if (phase.kind === "running") {
    const { job } = phase;
    const total = totalSteps(job);
    const done = doneSteps(job);
    return (
      <StudioFrame step="import" steps={IMPORT_STEPS} title="Importing" lede="The Import agent reads each source in turn. Nothing is written anywhere." viewer={viewer} actions={<Button variant="ghost" icon={X} onClick={reset}>Cancel</Button>}>
        <div className="mb-gutter flex items-center gap-3" data-testid="import-progress" aria-live="polite">
          <ProgressRing value={total ? done / total : 0} size={24} strokeWidth={3} tone="kit" label="Import progress" />
          <span className="t-display-sm tabular-nums">
            {done} of {total} steps
          </span>
        </div>
        <JobPanels job={job} />
      </StudioFrame>
    );
  }

  const { report, job } = phase;
  return (
    <StudioFrame
      step="import"
      steps={IMPORT_STEPS}
      title={report.title}
      lede={report.summary}
      viewer={viewer}
      actions={
        <>
          <Button variant="ghost" icon={ArrowLeft} onClick={reset}>
            Change sources
          </Button>
          <Button variant="primary" iconRight={ArrowRight} loading={continuing} onClick={() => {
              if (continuingRef.current) return;
              continuingRef.current = true;
              onContinue(report, configs, job);
            }}
            data-testid="continue-to-commit"
          >
            Continue to Commit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gutter" data-testid="scouting-report">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="info" icon={FileSearch}>
            {report.provenance}
          </Chip>
          <Chip>{ARCHETYPE_LABELS[report.archetypeHint]} (suggested)</Chip>
          {report.neverPushed ? (
            <StatusPill tone="good" icon={GitBranch} data-testid="never-pushed">
              Nothing was pushed
            </StatusPill>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-gutter">
          <ListPanel title="What exists" items={report.whatExists} tone="good" />
          <ListPanel title="What is missing" items={report.whatIsMissing} tone="warn" />
          <ListPanel title="Strengths" items={report.strengths} tone="good" />
          <ListPanel title="Weaknesses" items={report.weaknesses} tone="bad" />
        </div>
        <div className="grid grid-cols-2 gap-gutter">
          <Panel title="Suggested first decisions" footer={<span>These arrive in the Inbox as the Board's first item once you take charge.</span>} data-testid="first-decisions">
            <ol className="flex flex-col divide-y divide-line-faint">
              {report.firstDecisions.map((d) => (
                <li key={d.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0" data-decision={d.id} data-recommended={d.recommended || undefined}>
                  <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border", d.recommended ? "border-kit-primary text-kit-primary" : "border-subtle text-secondary")} aria-hidden>
                    {d.recommended ? <ThumbsUp size={11} /> : <CircleDashed size={11} />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body-strong">{d.label}</span>
                      {d.recommended ? <Chip tone="kit">Recommended</Chip> : null}
                      <Chip>{d.reversible ? "Reversible" : "Hard to reverse"}</Chip>
                    </div>
                    <p className="text-small text-secondary">{d.consequence}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title={`Roadmap seeds · ${report.roadmapSeeds.length}`} empty={report.roadmapSeeds.length === 0 ? "No tracker or repository was imported, so the Board proposes the first roadmap." : undefined} data-testid="roadmap-seeds">
            <ul className="flex flex-col divide-y divide-line-faint">
              {report.roadmapSeeds.map((s, i) => (
                <li key={`${s.source}-${i}`} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 text-body">{s.title}</span>
                  {/* An identifier ("acme/ledgerly issue #4", "Linear LIN-12"), shown as written and cut short, not re-spelled. */}
                  <span className="min-w-0 max-w-[40%] truncate text-small text-tertiary" title={s.source}>
                    {s.source}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <JobPanels job={job} compact />
      </div>
    </StudioFrame>
  );
}

function ListPanel({ title, items, tone }: { title: string; items: string[]; tone: "good" | "warn" | "bad" }) {
  return (
    <Panel title={title} empty={items.length === 0 ? "Nothing to report." : undefined}>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-body">
            <span aria-hidden className={cn("mt-1.5 inline-block size-1.5 shrink-0 rounded-full", tone === "good" ? "bg-status-good" : tone === "warn" ? "bg-status-warn" : "bg-status-bad")} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const STEP_TONE: Record<StepStatus, { tone: "good" | "info" | "neutral" | "bad"; word: string }> = {
  queued: { tone: "neutral", word: "Queued" },
  running: { tone: "info", word: "Running" },
  done: { tone: "good", word: "Done" },
  failed: { tone: "bad", word: "Failed" },
};

function JobPanels({ job, compact }: { job: ImportJob; compact?: boolean }) {
  return (
    <div className={cn("grid gap-gutter", compact ? "grid-cols-3" : "grid-cols-2")} data-testid="job-panels">
      {job.sources.map((s) => {
        const source = sourceByKey(s.key);
        const st = STEP_TONE[s.status];
        return (
          <Panel key={s.key} title={`${source?.label ?? s.key}${s.value ? ` · ${s.value}` : ""}`} actions={<StatusPill tone={st.tone} pulse={s.status === "running"}>{st.word}</StatusPill>} footer={s.summary ? <span>{s.summary}</span> : undefined} data-source-progress={s.key} data-status={s.status}>
            <ol className="flex flex-col gap-1">
              {s.steps.map((step) => (
                <li key={step.id} className={cn("flex items-center gap-2 text-body", step.status === "queued" && "text-secondary")} data-step-status={step.status}>
                  {/* The icon keeps its size when a long label wraps beside it. */}
                  <span className="inline-flex shrink-0" data-testid="step-icon">
                    {step.status === "done" ? <Check size={14} className="text-status-good" aria-hidden /> : step.status === "failed" ? <X size={14} className="text-status-bad" aria-hidden /> : step.status === "running" ? <ProgressRing indeterminate size={14} label="Running" tone="kit" /> : <CircleDashed size={14} aria-hidden />}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{step.label}</span>
                </li>
              ))}
            </ol>
          </Panel>
        );
      })}
    </div>
  );
}
