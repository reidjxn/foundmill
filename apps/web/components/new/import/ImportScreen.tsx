"use client";
/**
 * /new/import — Door B (BUILD §11.1, AC-11.1.5). Three phases in one screen: pick sources (GitHub repo, Drive,
 * Notion/Linear/Jira, website URL, Stripe/Shopify, bank, registry; every one read-only), watch the import job run
 * step by step, read the Scouting report (what exists, what is missing, strengths, weaknesses, first decisions,
 * roadmap seeds, "nothing pushed"). "Continue to Commit" turns the report into a concept card through idea.generate
 * and opens the Commit screen with the suggested name.
 *
 * `ImportFlow` is pure (the job runs locally and deterministically, see import-job.ts) so it is tested without tRPC.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleDashed, FileSearch, GitBranch, Lock, Play, ShieldCheck, ThumbsUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ARCHETYPE_LABELS } from "@foundmill/shared";
import { Button, Checkbox, Chip, Field, Input, Panel, ProgressRing, StatusPill, cn, usePrefersReducedMotion, useToast } from "@foundmill/dugout";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { IMPORT_STEPS, StudioFrame } from "../StudioFrame";
import { commitHref } from "../ideate/concepts";
import { IMPORT_SOURCES, IMPORT_SOURCE_GROUPS, advanceJob, buildScoutingReport, completeJob, doneSteps, normaliseSourceValue, planImportJob, reportToPrompt, sourceByKey, totalSteps, validateConfigs, type ImportJob, type ImportSourceKey, type ScoutingReport, type SourceConfig, type StepStatus } from "./import-job";

export interface ImportScreenProps {
  viewer: { email: string | null };
}

export function ImportScreen({ viewer }: ImportScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const { toast } = useToast();
  const generate = useMutation(
    trpc.idea.generate.mutationOptions({
      onError: (err) => toast({ title: "Could not prepare the Commit screen", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <ImportFlow
      viewer={viewer}
      continuing={generate.isPending}
      onContinue={(report) =>
        generate.mutate(
          { prompt: reportToPrompt(report), archetypeHint: report.archetypeHint },
          {
            onSuccess: (res) => {
              const first = res.ideas[0];
              if (!first) {
                toast({ title: "No concept came back", description: "Try again or start from the Ideation Studio.", tone: "warn" });
                return;
              }
              router.push(`${commitHref(first.id)}?name=${encodeURIComponent(report.suggestedName)}&from=import`);
            },
          },
        )
      }
    />
  );
}

/* ---------- the pure flow ---------- */

export interface ImportFlowProps {
  viewer: { email: string | null };
  onContinue: (report: ScoutingReport, configs: SourceConfig[]) => void;
  continuing?: boolean;
  /** Milliseconds per job step (tests pass 0; reduced motion completes at once). */
  stepMs?: number;
}

type Phase = { kind: "pick" } | { kind: "running"; job: ImportJob } | { kind: "report"; job: ImportJob; report: ScoutingReport };

export const DEFAULT_STEP_MS = 420;

export function ImportFlow({ viewer, onContinue, continuing, stepMs = DEFAULT_STEP_MS }: ImportFlowProps) {
  const reduced = usePrefersReducedMotion();
  const [chosen, setChosen] = useState<Map<ImportSourceKey, string>>(() => new Map());
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "pick" });
  const configs = useMemo<SourceConfig[]>(() => IMPORT_SOURCES.filter((s) => chosen.has(s.key)).map((s) => ({ key: s.key, value: chosen.get(s.key) ?? "" })), [chosen]);
  const errors = useMemo(() => validateConfigs(configs), [configs]);
  const valid = configs.length > 0 && Object.keys(errors).length === 0;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

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

  function start() {
    setTouched(true);
    if (!valid) return;
    const normalised = configs.map((c) => ({ key: c.key, value: normaliseSourceValue(sourceByKey(c.key)!, c.value) }));
    const planned = planImportJob(normalised, `import-${Date.now().toString(36)}`);
    if (reduced || stepMs <= 0) {
      const done = completeJob(planned);
      setPhase({ kind: "report", job: done, report: buildScoutingReport(normalised, done) });
      return;
    }
    let job = advanceJob(planned);
    setPhase({ kind: "running", job });
    timer.current = setInterval(() => {
      job = advanceJob(job);
      if (job.status === "done") {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setPhase({ kind: "report", job, report: buildScoutingReport(normalised, job) });
      } else setPhase({ kind: "running", job });
    }, stepMs);
  }

  function reset() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPhase({ kind: "pick" });
  }

  const back = (
    <LinkButton variant="ghost" icon={ArrowLeft} href="/new">
      Back to the doors
    </LinkButton>
  );

  if (phase.kind === "pick") {
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
                      <li key={s.key} className={cn("rounded-panel border border-subtle bg-panel-alt p-3 transition-colors duration-micro ease-dugout", on && "border-link")} data-source={s.key} data-selected={on || undefined}>
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
            <div className="sticky top-6 flex flex-col gap-gutter">
              <Panel title="Your import" footer={<span>Sources connect through the gateway with per-business credentials; the web app never sees a secret.</span>}>
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
                  <Button variant="primary" icon={Play} disabled={configs.length === 0} onClick={start} data-testid="start-import">
                    Start the import
                  </Button>
                  {touched && !valid && configs.length > 0 ? (
                    <StatusPill tone="warn" role="alert">
                      Complete the highlighted fields
                    </StatusPill>
                  ) : null}
                </div>
              </Panel>
              <Panel title="What the agent will not do">
                <ul className="flex flex-col gap-1 text-body text-secondary">
                  <li>Push to a repository or open a pull request</li>
                  <li>Move money, change settings or accept terms</li>
                  <li>Crawl pages robots.txt excludes</li>
                  <li>Keep credentials in the browser</li>
                </ul>
              </Panel>
            </div>
          </aside>
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
          <Button variant="primary" iconRight={ArrowRight} loading={continuing} onClick={() => onContinue(report, configs)} data-testid="continue-to-commit">
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
        <div className="grid grid-cols-[1fr_1fr] gap-gutter">
          <Panel title="Suggested first decisions" footer={<span>These arrive in the Inbox as the Board's first item once you take charge.</span>} data-testid="first-decisions">
            <ol className="flex flex-col divide-y divide-subtle/50">
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
            <ul className="flex flex-col divide-y divide-subtle/50">
              {report.roadmapSeeds.map((s, i) => (
                <li key={`${s.source}-${i}`} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                  <span className="text-body">{s.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-mono text-secondary">{s.source}</span>
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
                  {step.status === "done" ? <Check size={14} className="text-status-good" aria-hidden /> : step.status === "running" ? <ProgressRing indeterminate size={14} label="Running" tone="kit" /> : <CircleDashed size={14} aria-hidden />}
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
