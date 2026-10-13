"use client";
/**
 * /new/import — Door B (BUILD §11.1, AC-11.1.5). Three phases in one screen: pick sources (GitHub repo, Drive,
 * Notion/Linear/Jira, website URL, Stripe/Shopify, bank, registry; every one read-only), watch the job check them,
 * read the Import report (what exists, what is missing, strengths, weaknesses, first decisions, roadmap seeds,
 * "nothing pushed"). Nothing is read before the business exists: the report says which sources the import will read
 * once the founder takes charge (commit starts that import) and words every strength "once …". "Continue to Commit"
 * saves the concept card describing the business and opens the Commit screen with the suggested name.
 *
 * The job runs on the API: `import.start` returns the job, `import.status` is polled until it is done and carries the
 * report. The moment the report is on screen the card is drafted ahead (`import.prepareConcept`, held on the API and
 * not saved), so "Continue to Commit" (`import.continue`) saves it without waiting on the model (audit P7).
 * `ImportFlow` is pure over an `ImportRunner` so it is tested with a fake runner and no tRPC.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleDashed, Clock, FileSearch, GitBranch, Lock, Play, ShieldCheck, ThumbsUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ARCHETYPE_LABELS } from "@foundmill/shared";
import { Button, Checkbox, Chip, Field, Input, Panel, ProgressRing, StatusPill, cn, usePrefersReducedMotion, useToast } from "@foundmill/dugout";
import { plainWords } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { IMPORT_STEPS, StudioFrame } from "../StudioFrame";
import { commitHref } from "../ideate/concepts";
import { IMPORT_SOURCES, IMPORT_SOURCE_GROUPS, doneSteps, hasImportReader, normaliseSourceValue, sourceByKey, totalSteps, validateConfigs, type ImportJob, type ImportSourceKey, type ImportStartInput, type ImportStatus, type ScoutingReport, type SourceConfig, type StepStatus } from "./import-job";

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

export function ImportScreen({ viewer }: ImportScreenProps) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const router = useRouter();
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
      // Best effort: Continue drafts the card itself when the draft ahead is missing or failed.
      onReport={(job) => void client.import.prepareConcept.mutate({ jobId: job.id }).catch(() => undefined)}
      onContinue={(report, _configs, job) =>
        continueImport.mutate(
          // The job id rides on the saved idea so commit links the business to this import (its report and sources).
          { jobId: job.id },
          { onSuccess: (res) => router.push(`${commitHref(res.idea.id)}?name=${encodeURIComponent(report.suggestedName)}&from=import`) },
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
  /** Milliseconds between `import.status` polls (tests pass 0). */
  pollMs?: number;
}

type Phase = { kind: "pick"; error?: string } | { kind: "starting" } | { kind: "running"; job: ImportJob } | { kind: "report"; job: ImportJob; report: ScoutingReport } | { kind: "failed"; job: ImportJob | null; message: string };

export function ImportFlow({ viewer, runner, onContinue, onReport, continuing, pollMs = DEFAULT_POLL_MS }: ImportFlowProps) {
  const reduced = usePrefersReducedMotion();
  const [chosen, setChosen] = useState<Map<ImportSourceKey, string>>(() => new Map());
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const configs = useMemo<SourceConfig[]>(() => IMPORT_SOURCES.filter((s) => chosen.has(s.key)).map((s) => ({ key: s.key, value: chosen.get(s.key) ?? "" })), [chosen]);
  const errors = useMemo(() => validateConfigs(configs), [configs]);
  const valid = configs.length > 0 && Object.keys(errors).length === 0;
  // The polling loop stops when the run id changes (Cancel, Change sources, unmount).
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      run.current++;
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
      .then((status) => apply(status, id))
      .catch((err: unknown) => id === run.current && setPhase({ kind: "pick", error: errorMessage(err, "The import could not start.") }));
  }

  function reset() {
    run.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPhase({ kind: "pick" });
  }

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
                              {hasImportReader(s.key) ? null : (
                                <Chip tone="warn" data-testid="no-import-reader">
                                  Not read by the import yet
                                </Chip>
                              )}
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
      <StudioFrame step="import" steps={IMPORT_STEPS} title="Checking your sources" lede="Each source is checked now and read through the gateway, read only, once you take charge. Nothing is read or written before then." viewer={viewer} actions={<Button variant="ghost" icon={X} onClick={reset}>Cancel</Button>}>
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
          <Button variant="primary" iconRight={ArrowRight} loading={continuing} onClick={() => onContinue(report, configs, job)} data-testid="continue-to-commit">
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
          {report.sources.some((s) => s.state === "read") ? null : (
            <StatusPill tone="info" icon={Clock} data-testid="report-read-state">
              Nothing read yet: the import reads your sources once you take charge
            </StatusPill>
          )}
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
          <Panel title={`Roadmap seeds · ${report.roadmapSeeds.length}`} empty={report.roadmapSeeds.length === 0 ? "No open issues have been read, so the Board proposes the first roadmap. Issues the import reads later can be added to it." : undefined} data-testid="roadmap-seeds">
            <ul className="flex flex-col divide-y divide-line-faint">
              {report.roadmapSeeds.map((s, i) => (
                <li key={`${s.source}-${i}`} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                  <span className="text-body">{s.title}</span>
                  <span className="ml-auto shrink-0 text-small text-tertiary">{sourceByKey(s.source)?.label ?? plainWords(s.source)}</span>
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
  done: { tone: "good", word: "Read" },
  failed: { tone: "bad", word: "Not read" },
  planned: { tone: "neutral", word: "After you take charge" },
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
                <li key={step.id} className={cn("flex items-center gap-2 text-body", (step.status === "queued" || step.status === "planned") && "text-secondary")} data-step-status={step.status}>
                  {step.status === "done" ? <Check size={14} className="text-status-good" aria-hidden /> : step.status === "running" ? <ProgressRing indeterminate size={14} label="Running" tone="kit" /> : step.status === "planned" ? <Clock size={14} className="text-secondary" aria-label="After you take charge" /> : step.status === "failed" ? <X size={14} className="text-status-bad" aria-hidden /> : <CircleDashed size={14} aria-hidden />}
                  <span>{step.label}</span>
                </li>
              ))}
            </ol>
          </Panel>
        );
      })}
    </div>
  );
}
