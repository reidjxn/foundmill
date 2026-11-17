"use client";
/**
 * Training tab (BUILD §11.10 "Training screen tabs" and "Training session"; AC-11.10.1/4/5/6):
 *   Instructions (structured editor with versions, diffs, comments) · Focus (≤ 3 skills, Coach proposals with
 *   expected gains) · Model (Opus / Sonnet / Haiku with predicted deltas → preview run) · Tools (grants, retested).
 * Session flow: edit → Save draft (`agent.training.saveDraft`, house-rule conflicts flagged and ignored) → Train
 * with the cost estimate (`estimate` → `run`) → progress while the live version keeps working → TrainingResults
 * (old → new per skill) → Promote / Discard → 7-day watch banner with one-click rollback (`rollback`).
 *
 * The three steps are the guided layer's Explainer (UX plan §7.15 C5), shown behind the shell's "Explain this page" button,
 * remembered per account, never rendered with guidance off.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleStop, Dumbbell, Eye, FlaskConical, History, Save, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Explainer, Icon, InstructionsEditor, KeyValueList, MODEL_LABELS, ModelPicker, Panel, ProgressRing, ProvenanceChip, SkillGrid, TabBar, Term, TrainingResults, formatDuration, formatMoney, formatRelative, instructionsEqual, useDateFormat, type AgentInstructions, type InstructionComment, type InstructionViolation, type TabItem } from "@foundmill/dugout";
import type { ModelKey } from "@foundmill/shared";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { readOnlyReason } from "@/lib/access";
import { useBusiness } from "@/components/shell/business-context";
import { formatDayMonth } from "@/lib/format";
import type { TabProps } from "./AgentProfileScreen";
import { AddedSkillsPanel } from "./AddedSkillsPanel";
import { CustomSkillsPanel } from "./CustomSkillsPanel";
import { ModelChangeDialog } from "./ModelChangeDialog";
import { ToolGrantsEditor } from "./ToolsTab";
import {
  RUN_PHASE_LABEL,
  TRAINING_SUB_TABS,
  applyProposal,
  coachProposals,
  currentVersion,
  grantsEqual,
  grantsWiden,
  instructionVersions,
  isRetestRun,
  latestDraft,
  localPeriod,
  modelOptions,
  parseInstructions,
  parseToolGrants,
  readFocus,
  runProgress,
  runStalled,
  toSkillRows,
  toTrainingResults,
  trainingFlow,
  violationsToEditor,
  writeFocus,
  type ToolGrant,
  type TrainingSubTab,
} from "./logic";

/** The Training tab's three steps (UX plan §7.15 C5), as the per-screen Explainer: what it is for, what to do, what to watch. */
export const AGENT_TRAINING_EXPLAINER = {
  screenId: "agent-training",
  purpose: "Training tries new instructions on practice tests; nothing goes live until you promote it.",
  action: "1 Edit the instructions · 2 Train (2–5 minutes) · 3 Promote if the scores improved",
  watchFor: "A drop of more than one point is highlighted; the Coach explains it.",
} as const;

export function TrainingTab({ businessId, profile, refetch }: TabProps) {
  // Viewers and advisors read the instructions and the results; saving a draft and training are changes (RUI-05).
  const { access } = useBusiness();
  const canChange = access.canChange;
  const datePrefs = useDateFormat();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { isAdmin } = useBusiness();
  const agent = profile.agent;
  const live = currentVersion(profile);
  const draftVersion = latestDraft(profile.versions);
  const baseVersion = draftVersion ?? live;

  // --- editor state -----------------------------------------------------------------------------------------------
  const [sub, setSub] = useState<TrainingSubTab>("instructions");
  const [instructions, setInstructions] = useState<AgentInstructions>(() => parseInstructions(baseVersion?.instructions ?? {}));
  const [tools, setTools] = useState<ToolGrant[]>(() => parseToolGrants(baseVersion?.tools));
  // A draft keeps the model it was saved on (a preview on another model); edits of the live version train on the model
  // the agent runs now, which a model change sets before its retest is decided.
  const draftModel: ModelKey = draftVersion?.modelKey ?? agent.modelKey;
  const [savedVersionId, setSavedVersionId] = useState<string | null>(draftVersion?.id ?? null);
  const [savedSnapshot, setSavedSnapshot] = useState<AgentInstructions | null>(draftVersion ? parseInstructions(draftVersion.instructions) : null);
  const [violations, setViolations] = useState<InstructionViolation[]>([]);
  const [comments, setComments] = useState<InstructionComment[]>([]);
  const [focus, setFocus] = useState<string[]>([]);
  useEffect(() => setFocus(readFocus(agent.id)), [agent.id]);
  const onFocusChange = useCallback(
    (ids: string[]) => {
      setFocus(ids);
      writeFocus(agent.id, ids);
    },
    [agent.id],
  );
  // A newer draft from elsewhere (Tools tab) becomes the editing base once it appears.
  useEffect(() => {
    if (draftVersion && draftVersion.id !== savedVersionId && !savedVersionId) {
      setInstructions(parseInstructions(draftVersion.instructions));
      setTools(parseToolGrants(draftVersion.tools));
      setSavedVersionId(draftVersion.id);
      setSavedSnapshot(parseInstructions(draftVersion.instructions));
    }
  }, [draftVersion, savedVersionId]);

  const liveInstructions = useMemo(() => parseInstructions(live?.instructions ?? {}), [live]);
  const dirtySinceSave = savedSnapshot ? !instructionsEqual(instructions, savedSnapshot) : !instructionsEqual(instructions, liveInstructions);
  const trainable = savedVersionId !== null && !dirtySinceSave;
  // A released agent keeps its training history as a record; it is not trained again (the API refuses it too).
  const released = !!agent.archivedAt;
  const versions = useMemo(() => instructionVersions(profile.versions), [profile.versions]);
  const skills = useMemo(() => toSkillRows(profile.skills, profile.trainingRuns), [profile.skills, profile.trainingRuns]);
  const flow = useMemo(() => trainingFlow(profile.trainingRuns, new Date(), profile.agent.currentVersionId), [profile.trainingRuns, profile.agent.currentVersionId]);
  const proposals = useMemo(() => coachProposals(focus, skills), [focus, skills]);

  // --- mutations and queries ----------------------------------------------------------------------------------------
  const invalidateAgent = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("agent") as unknown[] });
  const [notice, setNotice] = useState<{ tone: "good" | "warn" | "bad" | "info"; text: string } | null>(null);
  const saveDraft = useMutation(
    trpc.agent.training.saveDraft.mutationOptions({
      onSuccess: (r) => {
        setSavedVersionId(r.version.id);
        setSavedSnapshot(instructions);
        setViolations(violationsToEditor(r.violations, instructions));
        setNotice(r.flagged ? { tone: "warn", text: `Draft v${r.version.version} saved. ${r.violations.length} ${r.violations.length === 1 ? "line contradicts" : "lines contradict"} a house rule and ${r.violations.length === 1 ? "is" : "are"} ignored.` } : { tone: "good", text: `Draft v${r.version.version} saved. The live version is untouched until you promote.` });
        void invalidateAgent();
      },
      onError: (err) => setNotice({ tone: "bad", text: errorMessage(err) }),
    }),
  );
  const [trainOpen, setTrainOpen] = useState(false);
  const [previewModel, setPreviewModel] = useState<ModelKey | null>(null);
  const estimateQ = useQuery(trpc.agent.training.estimate.queryOptions({ businessId, agentId: agent.id, modelKey: previewModel ?? draftModel }, { enabled: trainOpen || sub === "model", staleTime: 60_000 }));
  const run = useMutation(
    trpc.agent.training.run.mutationOptions({
      onSuccess: () => {
        setTrainOpen(false);
        setNotice({ tone: "info", text: "Training started. Tests run in sandboxes against mock tools; the live version keeps working." });
        void invalidateAgent();
        refetch();
      },
      onError: (err) => setNotice({ tone: "bad", text: errorMessage(err) }),
    }),
  );
  const resultsQ = useQuery(trpc.agent.training.results.queryOptions({ businessId, runId: flow.awaiting?.id ?? "" }, { enabled: !!flow.awaiting, staleTime: 30_000 }));
  const promote = useMutation(
    trpc.agent.training.promote.mutationOptions({
      onSuccess: (run) => {
        const n = run.ratings.length;
        setNotice({ tone: "good", text: `Promoted${n ? `; ${n} ${n === 1 ? "rating" : "ratings"} updated` : ""}. A seven-day watch starts now; a drop in proven performance offers a one-click rollback.` });
        setSavedVersionId(null);
        setSavedSnapshot(null);
        void invalidateAgent();
        refetch();
      },
      onError: (err) => setNotice({ tone: "bad", text: errorMessage(err) }),
    }),
  );
  const discard = useMutation(
    trpc.agent.training.discard.mutationOptions({
      onSuccess: (r) => {
        // A model change applies at once; discarding its retest keeps the live version but not the old model.
        setNotice({ tone: "info", text: isRetestRun(r, profile.versions) ? `Retest discarded. The live version is unchanged; ${agent.name} keeps working on ${MODEL_LABELS[agent.modelKey]} until you change the model back.` : "Draft discarded. The live version is unchanged." });
        void invalidateAgent();
        refetch();
      },
      onError: (err) => setNotice({ tone: "bad", text: errorMessage(err) }),
    }),
  );
  const cancel = useMutation(
    trpc.agent.training.cancel.mutationOptions({
      onSuccess: (r) => {
        // Canceling a retest does not undo the model change it was scoring; say so, as Discard does.
        setNotice({ tone: "info", text: isRetestRun(r.run, profile.versions) ? `Retest canceled. The live version is unchanged; ${agent.name} keeps working on ${MODEL_LABELS[agent.modelKey]}.` : "Training canceled. The live version is unchanged." });
        void invalidateAgent();
        refetch();
      },
      onError: (err) => setNotice({ tone: "bad", text: errorMessage(err) }),
    }),
  );
  const rollback = useMutation(
    trpc.agent.training.rollback.mutationOptions({
      onSuccess: () => {
        setNotice({ tone: "good", text: "Rolled back to the previous live version and its skills." });
        void invalidateAgent();
        refetch();
      },
      onError: (err) => setNotice({ tone: "bad", text: errorMessage(err) }),
    }),
  );
  const compareQ = useQuery(trpc.agent.model.compare.queryOptions({ businessId, agentId: agent.id, period: localPeriod() }, { enabled: sub === "model", staleTime: 60_000 }));
  const [applyModel, setApplyModel] = useState<ModelKey | null>(null);

  const doSave = (modelKey?: ModelKey) => saveDraft.mutate({ businessId, agentId: agent.id, instructions, tools: tools.length ? tools : undefined, modelKey: modelKey ?? draftModel, comment: comments[comments.length - 1]?.text });
  const trainSaved = () => {
    if (!savedVersionId) return;
    run.mutate({ businessId, agentId: agent.id, versionId: savedVersionId });
  };
  const saveAndTrain = async (modelKey?: ModelKey) => {
    const r = await saveDraft.mutateAsync({ businessId, agentId: agent.id, instructions, tools: tools.length ? tools : undefined, modelKey: modelKey ?? draftModel, comment: comments[comments.length - 1]?.text });
    run.mutate({ businessId, agentId: agent.id, versionId: r.version.id });
  };

  const subTabs: TabItem[] = TRAINING_SUB_TABS.map((t) => ({ id: t.id, label: t.label, badge: t.id === "focus" && focus.length ? focus.length : undefined }));
  const results = flow.awaiting && resultsQ.data ? toTrainingResults(resultsQ.data, profile.skills) : [];
  const busy = saveDraft.isPending || run.isPending;
  // Retry runs the draft that failed (a model change's retest copy included) while it is still a draft.
  const failedDraft = flow.failed ? (profile.versions.find((v) => v.id === flow.failed?.toVersionId && v.state === "draft") ?? null) : null;
  const retryFailed = failedDraft ? () => run.mutate({ businessId, agentId: agent.id, versionId: failedDraft.id }) : savedVersionId ? trainSaved : undefined;

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-training" data-phase={flow.phase}>
      {/* session flow --------------------------------------------------------------------------------------------- */}
      {flow.watch ? (
        <Panel
          title="Seven-day watch"
          span={12}
          actions={<Chip tone="info">{flow.watch.daysLeft} {flow.watch.daysLeft === 1 ? "day" : "days"} left</Chip>}
          footer="If proven performance drops below the previous version during the watch, the Inbox also offers this rollback."
          data-testid="watch-banner"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body text-primary">
              Promoted {formatRelative(flow.watch.run.endedAt ?? flow.watch.run.createdAt)}. Watching live outcomes until {formatDayMonth(flow.watch.until, datePrefs)}.
            </p>
            <Button variant="danger" icon={Undo2} loading={rollback.isPending} onClick={() => rollback.mutate({ businessId, agentId: agent.id })} data-testid="rollback">
              Roll back to the previous version
            </Button>
          </div>
        </Panel>
      ) : null}

      {flow.active ? (
        <Panel title="Training in progress" span={12} data-testid="training-progress" data-run-id={flow.active.id}>
          <div className="flex items-center gap-4">
            <ProgressRing value={runProgress(flow.active, estimateQ.data?.durationMinutes ?? 3)} size={40} strokeWidth={3} tone="kit" label="Training progress" />
            <div className="flex flex-col">
              <span className="text-body-strong text-primary">{RUN_PHASE_LABEL[flow.active.status] ?? flow.active.status}</span>
              <span className="text-small text-secondary" data-testid="training-progress-note">
                {runStalled(flow.active) ? `Queued ${formatRelative(flow.active.createdAt)} and not started yet. If it does not start soon, cancel it and train again.` : `Started ${formatRelative(flow.active.startedAt ?? flow.active.createdAt)} · target 2–5 minutes · the live version keeps working`}
              </span>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 text-small text-secondary">
              <Icon icon={FlaskConical} size="inline" /> Half of the practice tests stay hidden so the scores stay honest.
            </span>
            <Button size="sm" variant="ghost" icon={CircleStop} loading={cancel.isPending} onClick={() => cancel.mutate({ businessId, runId: flow.active!.id })} data-testid="cancel-training">
              Cancel run
            </Button>
          </div>
        </Panel>
      ) : null}

      {flow.awaiting ? (
        <div className="col-span-12" data-testid="training-results">
          {resultsQ.error ? (
            <Panel title="Results" span={12} error={errorMessage(resultsQ.error)} onRetry={() => void resultsQ.refetch()} />
          ) : !resultsQ.data ? (
            <Panel title="Results" span={12} loading />
          ) : (
            <TrainingResults
              results={results}
              coachExplanation={resultsQ.data.coachSummaryMd || "The Coach's explanation arrives with the grading pass."}
              candidateVersion={profile.versions.find((v) => v.id === flow.awaiting?.toVersionId)?.version}
              liveVersion={live?.version}
              cost={{ amountMinor: Number(flow.awaiting.costMinor ?? 0), currency: flow.awaiting.currency ?? CREDITS_CURRENCY }}
              durationMs={flow.awaiting.startedAt && flow.awaiting.endedAt ? Date.parse(String(flow.awaiting.endedAt)) - Date.parse(String(flow.awaiting.startedAt)) : undefined}
              onPromote={() => promote.mutate({ businessId, runId: flow.awaiting!.id })}
              onDiscard={() => discard.mutate({ businessId, runId: flow.awaiting!.id })}
              promoting={promote.isPending}
              discarding={discard.isPending}
            />
          )}
        </div>
      ) : null}

      {flow.failed ? <Panel title="Last run failed" span={12} error={`The training run failed before grading; nothing changed on the live version.${retryFailed ? " Retry runs the same draft again." : " Save the draft again to retry."}`} onRetry={retryFailed} data-testid="training-failed" /> : null}

      {/* editor ----------------------------------------------------------------------------------------------------- */}
      <Panel
        title={<Term id="training">Training</Term>}
        span={12}
        flush
        actions={
          <span className="inline-flex items-center gap-2">
            {live ? <Chip tone="neutral">Live v{live.version}</Chip> : <Chip tone="warn">No live version</Chip>}
            {savedVersionId ? <Chip tone={dirtySinceSave ? "info" : "good"}>{dirtySinceSave ? "Draft edited" : `Draft v${profile.versions.find((v) => v.id === savedVersionId)?.version ?? "?"} saved`}</Chip> : dirtySinceSave ? <Chip tone="info">Unsaved edits</Chip> : null}
            <Button size="sm" icon={Save} onClick={() => doSave()} loading={saveDraft.isPending} disabled={!canChange || released || (!dirtySinceSave && !!savedVersionId)} title={canChange ? undefined : readOnlyReason(access)} data-testid="save-draft">
              Save draft
            </Button>
            <Button size="sm" variant="primary" icon={Dumbbell} onClick={() => setTrainOpen(true)} disabled={!canChange || released || busy || !!flow.active || (!dirtySinceSave && !savedVersionId)} title={canChange ? undefined : readOnlyReason(access)} data-testid="train">
              Train
            </Button>
          </span>
        }
        footer={notice ? <span data-testid="training-notice" data-tone={notice.tone} className={notice.tone === "bad" ? "text-status-bad" : notice.tone === "warn" ? "text-status-warn" : undefined}>{notice.text}</span> : <span data-testid="training-footer">The house rules always apply; a draft line that contradicts one is flagged and ignored.</span>}
      >
        {/* The three-step strip (C5): inside the panel body, above the sections; nothing with guidance off. */}
        <div className="px-panel-pad pt-panel-pad empty:hidden">
          <Explainer {...AGENT_TRAINING_EXPLAINER} />
        </div>
        <TabBar tabs={subTabs} activeId={sub} onChange={(id) => setSub(id as TrainingSubTab)} aria-label="Training sections" className="px-2" />
        <div className="p-panel-pad">
          {sub === "instructions" ? (
            <InstructionsEditor
              value={instructions}
              onChange={(v) => {
                setInstructions(v);
                setViolations([]);
              }}
              previous={liveInstructions}
              versions={versions}
              violations={violations}
              comments={comments}
              onComment={(text) => setComments((c) => [...c, { id: `${Date.now()}`, author: "You", at: new Date().toISOString(), text }])}
            />
          ) : null}

          {sub === "focus" ? (
            <div className="grid grid-cols-12 gap-gutter">
              <div className="col-span-7">
                <p className="mb-2 text-small text-secondary">Pick up to three skills to focus the next training run on. Each comes with suggested instruction edits, with the expected gain.</p>
                {/* A narrow column: the band word folds into each figure's tooltip (compact), never a pill cut at the edge. */}
                <SkillGrid skills={skills} focus={{ selected: focus, onChange: onFocusChange, max: 3 }} showPotential density="compact" />
              </div>
              <div className="col-span-5 flex flex-col gap-2" data-testid="coach-proposals">
                <h3 className="t-label flex items-center gap-1">
                  <Icon icon={Sparkles} size={12} /> Suggested edits
                </h3>
                {proposals.length === 0 ? <p className="text-small text-secondary">Choose a focus skill to see proposals.</p> : null}
                {proposals.map((p) => {
                  const applied = p.section === "examples" ? instructions.examples.some((e) => e.output === p.text) : instructions[p.section].includes(p.text);
                  return (
                    <div key={p.id} className="flex flex-col gap-1 rounded-panel border border-subtle bg-panel-alt p-2" data-proposal={p.id}>
                      <div className="flex items-center gap-2">
                        <span className="text-body-strong text-primary">{p.skillName}</span>
                        <Chip tone="neutral">{p.section}</Chip>
                        <span className="ml-auto inline-flex items-center gap-1 text-small tabular-nums text-status-good">
                          <ProvenanceChip kind="estimate">{p.expectedGain > 0 ? `+${p.expectedGain}` : "±0"}</ProvenanceChip>
                        </span>
                      </div>
                      <p className="text-body text-primary">{p.text}</p>
                      <Button size="sm" variant={applied ? "ghost" : "default"} disabled={applied} onClick={() => setInstructions((i) => applyProposal(i, p))} className="self-start">
                        {applied ? "Applied to draft" : "Apply to draft"}
                      </Button>
                    </div>
                  );
                })}
                <p className="text-small text-secondary">Expected gains are estimates from the gap between current and potential ratings.</p>
              </div>
            </div>
          ) : null}

          {sub === "model" ? (
            <div className="grid grid-cols-12 gap-gutter" data-testid="training-model">
              <div className="col-span-7">
                {compareQ.data ? <ModelPicker options={modelOptions(compareQ.data, CREDITS_CURRENCY)} value={previewModel ?? agent.modelKey} onChange={(m) => setPreviewModel(m === agent.modelKey ? null : m)} disabled={profile.modelLock} /> : <p className="text-small text-secondary">{compareQ.error ? errorMessage(compareQ.error) : "Loading model comparison…"}</p>}
                {profile.modelLock ? <p className="mt-2 text-small text-secondary">{profile.route === "inboxComposer" ? "The Inbox Composer is locked to Opus." : "This agent's route is locked to its model."}</p> : null}
              </div>
              <div className="col-span-5 flex flex-col gap-3">
                <h3 className="t-label">Preview {previewModel ? `on ${MODEL_LABELS[previewModel]}` : ""}</h3>
                {previewModel ? (
                  <>
                    <KeyValueList
                      items={[
                        { label: "Tests", value: estimateQ.data ? `${estimateQ.data.tests} across ${estimateQ.data.skills} skills` : "…", numeric: true },
                        { label: "Cost", value: estimateQ.data ? <span className="inline-flex items-center gap-1"><ProvenanceChip kind="estimate">{formatMoney({ amountMinor: estimateQ.data.costMinor, currency: estimateQ.data.currency })}</ProvenanceChip></span> : "…", numeric: true },
                        { label: "Duration", value: estimateQ.data ? `about ${estimateQ.data.durationMinutes} min` : "…", numeric: true },
                        { label: "Cost per month, change", value: compareQ.data ? <span className="inline-flex items-center gap-1"><ProvenanceChip kind="estimate">{formatMoney(modelOptions(compareQ.data, CREDITS_CURRENCY).find((o) => o.key === previewModel)?.wageDelta ?? { amountMinor: 0, currency: CREDITS_CURRENCY })}/mo</ProvenanceChip></span> : "…", numeric: true },
                        { label: "Skill changes", value: "From the preview run" },
                      ]}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button icon={Eye} loading={busy} onClick={() => void saveAndTrain(previewModel)} data-testid="preview-run">
                        Run preview tests
                      </Button>
                      <Button variant="primary" onClick={() => setApplyModel(previewModel)} data-testid="apply-model">
                        Apply {MODEL_LABELS[previewModel]}…
                      </Button>
                    </div>
                    <p className="text-small text-secondary">A preview saves a draft on {MODEL_LABELS[previewModel]} and trains it; the results show how each skill would change. Apply changes the live model through the scope dialog; its skills are re-tested on the new model so the ratings stay honest.</p>
                  </>
                ) : (
                  <p className="text-small text-secondary">Choose a candidate model to see the change in cost per month and run preview tests. The agent runs on {MODEL_LABELS[agent.modelKey]} now.</p>
                )}
              </div>
            </div>
          ) : null}

          {sub === "tools" ? (
            <div className="flex flex-col gap-2">
              <p className="text-small text-secondary">Tool changes are part of the draft and are retested when you train.</p>
              <ToolGrantsEditor businessId={businessId} value={tools} onChange={(t) => setTools(t)} />
              {!grantsEqual(tools, parseToolGrants(baseVersion?.tools)) ? <Chip tone="info">Tools changed in this draft</Chip> : null}
              {!isAdmin && grantsWiden(parseToolGrants(live?.tools), tools) ? <Chip tone="warn" data-testid="tools-admin-only">Only an owner or admin can give this agent new tools</Chip> : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Versions" span={12} data-testid="versions-panel">
        <ul className="grid grid-cols-4 gap-2">
          {versions.slice(0, 8).map((v) => (
            <li key={v.version} className="flex flex-col gap-0.5 rounded-panel border border-subtle bg-panel-alt p-2 text-small">
              <span className="inline-flex items-center gap-1 text-body-strong text-primary">
                <Icon icon={History} size="inline" className="text-secondary" /> v{v.version}
                <Chip tone={v.state === "live" ? "good" : v.state === "draft" ? "info" : "neutral"}>{v.state}</Chip>
              </span>
              <span className="text-secondary">
                {v.author} · {formatRelative(v.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* train dialog ----------------------------------------------------------------------------------------------- */}
      <Dialog open={trainOpen} onOpenChange={setTrainOpen}>
        <DialogContent
          size="sm"
          data-testid="train-dialog"
          // Open on the primary button (the first input there is none of), not on the Estimate chip in the cost row or
          // the defined word in the note: their cards would open with the dialog, and Esc would close them first.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById("train-confirm")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Train {agent.name}</DialogTitle>
            <DialogDescription>{trainable ? "The saved draft is trained as is." : "Your edits are saved as a new draft first, then trained."}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <KeyValueList
              items={[
                { label: "Tests", value: estimateQ.data ? `${estimateQ.data.tests} across ${estimateQ.data.skills} skills (half stay hidden)` : "…" },
                { label: "Cost", value: estimateQ.data ? <span className="inline-flex items-center gap-1"><ProvenanceChip kind="estimate">{formatMoney({ amountMinor: estimateQ.data.costMinor, currency: estimateQ.data.currency })}</ProvenanceChip></span> : "…", numeric: true },
                { label: "Duration", value: estimateQ.data ? `about ${formatDuration(estimateQ.data.durationMinutes * 60_000)}` : "…", numeric: true },
                { label: "Model", value: MODEL_LABELS[draftModel] },
              ]}
            />
            <p className="mt-2 text-small text-secondary">
              Practice tests run in sandboxes against mock tools: no real email, no spend, nothing goes live. The live version keeps working until you promote. The cost comes out of your <Term id="credits">credits</Term>.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrainOpen(false)}>
              Cancel
            </Button>
            <Button id="train-confirm" variant="primary" icon={Dumbbell} loading={busy} onClick={() => (trainable ? trainSaved() : void saveAndTrain())} data-testid="train-confirm">
              {trainable ? "Train" : "Save draft and train"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ModelChangeDialog businessId={businessId} profile={profile} open={!!applyModel} onOpenChange={(o) => !o && setApplyModel(null)} preselect={applyModel} />
      <AddedSkillsPanel businessId={businessId} profile={profile} onChanged={refetch} />
      <CustomSkillsPanel businessId={businessId} profile={profile} onChanged={refetch} />
    </div>
  );
}
