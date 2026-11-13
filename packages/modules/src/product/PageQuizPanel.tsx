"use client";
/**
 * Product › Public page › "Quiz on your page" (migration 0101; apps/api services/page-quiz.ts): the optional
 * "Which one is for you?" quiz, off until the founder turns it on. The team drafts it from the project's real customers
 * on the founder's press (never on its own); the founder reads every word, changes what they like, adds their own pay
 * link to an offer, approves it and turns it on or off. A phone-width preview beside the editor is drawn by the same
 * component the public page uses.
 *
 * What the founder sees is honest about where it came from: what the draft rested on ("Drafted from 8 customers, 3
 * replies and 11 purchases on record"; "Rests on 4 of your customers") and how many visitors got each result, counted
 * without names. These are real counts of their own records, shown to them alone and never on the page.
 *
 * Who may do what follows `pageQuiz.get`: members with Product write ask for a draft and edit it; owners and admins also
 * approve it, turn it on or off and edit an approved one (which puts it back to draft, off the page).
 */
import { useEffect, useId, useMemo, useState } from "react";
import { Power, PowerOff, RefreshCw, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Explainer,
  Field,
  Input,
  Panel,
  ProjectQuiz,
  SegmentedControl,
  SimpleSelect,
  StatusPill,
  Textarea,
} from "@foundmill/dugout";
import {
  PAGE_QUIZ_LIMITS,
  pageQuizBasisLine,
  pageQuizCountLine,
  pageQuizEvidenceLine,
  pageQuizNotReadyLine,
  pageQuizProblems,
  pageQuizStatusLine,
  removePageQuizType,
  samePageQuiz,
  type PageQuizDefinition,
  type PageQuizEvidence,
  type PageQuizProblem,
  type PageQuizStatus,
} from "@foundmill/shared/page-quiz";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { errorMessage } from "./shared";

/** `pageQuiz.get` as the panel reads it (apps/api services/page-quiz.ts `PageQuizView`). */
export interface PageQuizViewResponse {
  quiz: { definition: PageQuizDefinition; status: PageQuizStatus; version: number; evidence: Partial<PageQuizEvidence>; draftedAt: string | Date; approvedAt: string | Date | null; liveAt: string | Date | null } | null;
  counts: Record<string, number>;
  problems: PageQuizProblem[];
  readiness: { customers: number; need: number; ready: boolean };
  page: { saved: boolean; live: boolean; followForm: boolean; url: string | null };
  canEdit: boolean;
  canApprove: boolean;
  isSample: boolean;
}

type DraftResponse = { outcome: "drafted"; view: PageQuizViewResponse } | { outcome: "refused"; message: string; view: PageQuizViewResponse };

export const PAGE_QUIZ_EXPLAINER = {
  screenId: "product/page-quiz",
  purpose: "An optional quiz on your page: a visitor answers a few questions and sees which of your offers probably fits them. Every offer stays in view either way.",
  action: "Ask the team to draft it from your customers, check every word, add your pay links, approve it, then turn it on.",
  watchFor: "It is off until you turn it on. It only uses types your own records show, and it counts results without anyone's name.",
} as const;

export const PAGE_QUIZ_PANEL_WORDS = {
  title: "Quiz on your page",
  draft: "Draft from your customers",
  redraft: "Draft again",
  drafting: "The team is reading your customers…",
  save: "Save changes",
  saved: "Changes saved. The quiz is a draft until you approve it.",
  approve: "Approve",
  approved: "Approved. Turn it on when you want it on your page.",
  turnOn: "Turn on",
  turnOff: "Turn off",
  turnedOn: "The quiz is on your page.",
  turnedOnNotLive: "Turned on. It shows once your page is published.",
  turnedOff: "The quiz is off your page. The approved quiz is kept.",
  unsaved: "Changes not saved yet",
  readOnly: "An owner or an admin of this project can approve the quiz and turn it on.",
  intro: "Opening line",
  introHint: "Optional. One line above the questions.",
  types: "Types of customer",
  typeName: "Name",
  typeSummary: "What they have in common",
  typeOffer: "The offer that fits them",
  removeType: "Remove this type",
  offers: "Offers",
  offerTitle: "Offer",
  offerDetail: "Details",
  offerAction: "Button",
  followAction: "Follow form",
  linkAction: "Your link",
  linkUrl: "Link",
  linkUrlHint: "Your own pay or booking link, starting with https://.",
  linkLabel: "Button words",
  questions: "Questions",
  question: "Question",
  answer: "Answer",
  answerType: "Points to",
  before: "Before you approve",
  results: "Results so far",
  resultsNote: "Visitors who finished this version, counted without names or answers. Not checked: one person can finish it more than once.",
  preview: "Preview",
  previewNote: "As it looks on a phone.",
  redraftTitle: "Draft the quiz again?",
  redraftBody: "The team drafts a new quiz from your customers as they are now. It replaces this one, including your changes, and stays off your page until you approve it.",
  cancel: "Cancel",
  sample: "This is a sample business, so nothing of it is ever public. You can try the quiz here.",
} as const;

const set = <T,>(list: T[], i: number, next: T): T[] => list.map((x, j) => (j === i ? next : x));

export function PageQuizPanel() {
  const id = useId();
  const W = PAGE_QUIZ_PANEL_WORDS;
  const { mutate } = useWidgetData();
  const view = useWidgetQuery<PageQuizViewResponse>("pageQuiz.get", {});
  useBusinessEvents(() => view.refetch(), ["quiz.approved", "quiz.published", "quiz.unpublished", "page.published", "page.unpublished"]);
  const data = view.data;

  const [draft, setDraft] = useState<PageQuizDefinition | null>(null);
  const [base, setBase] = useState<PageQuizDefinition | null>(null);
  useEffect(() => {
    const server = data?.quiz?.definition ?? null;
    if (!base || !draft || samePageQuiz(draft, base) || !server) {
      setDraft(server);
      setBase(server);
    }
    // Only a new server definition matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.quiz?.version, data?.quiz?.status]);

  const [pending, setPending] = useState<null | "draft" | "save" | "approve" | "on" | "off">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmRedraft, setConfirmRedraft] = useState(false);

  const quiz = data?.quiz ?? null;
  const def = draft ?? quiz?.definition ?? null;
  const dirty = Boolean(def && base && !samePageQuiz(def, base));
  const followForm = Boolean(data?.page.followForm);
  const problems = useMemo(() => (def ? pageQuizProblems(def, { followForm }) : []), [def, followForm]);
  const canEdit = Boolean(data?.canEdit) && (quiz?.status === "draft" || Boolean(data?.canApprove));

  const apply = (next: PageQuizViewResponse) => {
    setDraft(next.quiz?.definition ?? null);
    setBase(next.quiz?.definition ?? null);
    view.refetch();
  };
  const run = async (what: NonNullable<typeof pending>, fn: () => Promise<void>) => {
    setPending(what);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err as Error));
    } finally {
      setPending(null);
    }
  };
  const askDraft = () =>
    run("draft", async () => {
      setConfirmRedraft(false);
      setRefusal(null);
      const r = await mutate<DraftResponse>("pageQuiz.draft", {});
      apply(r.view);
      if (r.outcome === "refused") setRefusal(r.message);
    });
  const save = () => run("save", async () => (apply(await mutate<PageQuizViewResponse>("pageQuiz.save", { definition: def })), setNotice(W.saved)));
  const approve = () => run("approve", async () => (apply(await mutate<PageQuizViewResponse>("pageQuiz.approve", { definition: def })), setNotice(W.approved)));
  const turn = (on: boolean) =>
    run(on ? "on" : "off", async () => {
      const next = await mutate<PageQuizViewResponse>("pageQuiz.setLive", { on });
      apply(next);
      setNotice(on ? (next.page.live ? W.turnedOn : W.turnedOnNotLive) : W.turnedOff);
    });
  const edit = (next: PageQuizDefinition) => {
    setNotice(null);
    setDraft(next);
  };

  const status = quiz?.status ?? null;
  const stateLine = data ? pageQuizStatusLine({ status, pageLive: data.page.live }) : "";
  const tone = status === "live" && data?.page.live ? "good" : status === "approved" ? "info" : "neutral";
  const problemAt = (path: string) => problems.find((p) => p.path === path || p.path.startsWith(`${path}.`))?.message;
  const typeOptions = def?.types.map((t) => ({ value: t.key, label: t.name || t.key })) ?? [];
  const offerOptions = def?.offers.map((o) => ({ value: o.key, label: o.title || o.key })) ?? [];
  const evidence = quiz?.evidence;
  const hasCounts = Object.values(data?.counts ?? {}).some((n) => n > 0);

  return (
    <Panel
      title={W.title}
      span={12}
      loading={view.isLoading}
      error={view.error ? view.error.message : undefined}
      onRetry={view.refetch}
      actions={data ? <StatusPill tone={tone} data-testid="quiz-state">{stateLine}</StatusPill> : undefined}
      data-testid="page-quiz"
    >
      <Explainer {...PAGE_QUIZ_EXPLAINER} className="mb-4" />
      {data ? (
        <div className="flex flex-col gap-5">
          {data.isSample ? <p className="t-body text-secondary">{W.sample}</p> : null}
          {!data.canApprove && data.canEdit ? <p className="t-body text-secondary" data-testid="quiz-read-only">{W.readOnly}</p> : null}

          {!quiz || !def ? (
            <div className="flex flex-col items-start gap-3" data-testid="quiz-empty">
              {!data.readiness.ready ? (
                <p className="t-body text-secondary" data-testid="quiz-not-ready">
                  {pageQuizNotReadyLine(data.readiness.customers, data.readiness.need)}
                </p>
              ) : null}
              {data.canEdit ? (
                <Button variant="primary" icon={Sparkles} onClick={askDraft} loading={pending === "draft"} disabled={!data.readiness.ready}>
                  {W.draft}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-8">
              <div className="flex min-w-0 flex-col gap-6" data-testid="quiz-editor">
                {evidence && typeof evidence.customers === "number" ? (
                  <p className="t-body text-secondary" data-testid="quiz-evidence">
                    {pageQuizEvidenceLine({ customers: evidence.customers, replies: evidence.replies ?? 0, purchases: evidence.purchases ?? 0 })}
                  </p>
                ) : null}

                <Field htmlFor={`${id}-intro`} label={W.intro} hint={W.introHint} error={problemAt("intro")}>
                  <Input id={`${id}-intro`} value={def.intro} maxLength={PAGE_QUIZ_LIMITS.introMax + 20} readOnly={!canEdit} onChange={(e) => edit({ ...def, intro: e.target.value })} />
                </Field>

                <section aria-labelledby={`${id}-types`} className="flex flex-col gap-4" data-testid="quiz-types">
                  <h3 id={`${id}-types`} className="t-label text-secondary">{W.types}</h3>
                  {def.types.map((t, i) => (
                    <div key={t.key} className="flex flex-col gap-3 rounded-md border border-line p-4" data-quiz-type={t.key}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="t-small text-secondary">
                          {evidence?.perType?.[t.key] !== undefined ? pageQuizBasisLine(evidence.perType[t.key]!) : null}
                          {hasCounts ? ` · ${pageQuizCountLine(data.counts[t.key] ?? 0)}` : null}
                        </span>
                        {canEdit && def.types.length > PAGE_QUIZ_LIMITS.types.min ? (
                          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => edit(removePageQuizType(def, t.key))}>
                            {W.removeType}
                          </Button>
                        ) : null}
                      </div>
                      <Field htmlFor={`${id}-t${i}-name`} label={W.typeName} error={problemAt(`types.${i}.name`) ?? problems.find((p) => p.path === `types.${i}`)?.message}>
                        <Input id={`${id}-t${i}-name`} value={t.name} readOnly={!canEdit} onChange={(e) => edit({ ...def, types: set(def.types, i, { ...t, name: e.target.value }) })} />
                      </Field>
                      <Field htmlFor={`${id}-t${i}-summary`} label={W.typeSummary} error={problemAt(`types.${i}.summary`)}>
                        <Textarea id={`${id}-t${i}-summary`} rows={2} value={t.summary} readOnly={!canEdit} onChange={(e) => edit({ ...def, types: set(def.types, i, { ...t, summary: e.target.value }) })} />
                      </Field>
                      <Field htmlFor={`${id}-t${i}-offer`} label={W.typeOffer} error={problemAt(`types.${i}.offer`)}>
                        <SimpleSelect id={`${id}-t${i}-offer`} options={offerOptions} value={t.offer} disabled={!canEdit} onValueChange={(v) => edit({ ...def, types: set(def.types, i, { ...t, offer: v }) })} />
                      </Field>
                    </div>
                  ))}
                </section>

                <section aria-labelledby={`${id}-offers`} className="flex flex-col gap-4" data-testid="quiz-offers">
                  <h3 id={`${id}-offers`} className="t-label text-secondary">{W.offers}</h3>
                  {def.offers.map((o, i) => (
                    <div key={o.key} className="flex flex-col gap-3 rounded-md border border-line p-4" data-quiz-offer-editor={o.key}>
                      <Field htmlFor={`${id}-o${i}-title`} label={W.offerTitle} error={problemAt(`offers.${i}.title`)}>
                        <Input id={`${id}-o${i}-title`} value={o.title} readOnly={!canEdit} onChange={(e) => edit({ ...def, offers: set(def.offers, i, { ...o, title: e.target.value }) })} />
                      </Field>
                      <Field htmlFor={`${id}-o${i}-detail`} label={W.offerDetail} error={problemAt(`offers.${i}.detail`)}>
                        <Textarea id={`${id}-o${i}-detail`} rows={2} value={o.detail} readOnly={!canEdit} onChange={(e) => edit({ ...def, offers: set(def.offers, i, { ...o, detail: e.target.value }) })} />
                      </Field>
                      <div className="flex flex-col gap-1.5">
                        <span className="t-label text-secondary">{W.offerAction}</span>
                        <SegmentedControl<"follow" | "link">
                          aria-label={`${W.offerAction}: ${o.title}`}
                          size="md"
                          options={[
                            { value: "follow", label: W.followAction, disabled: !canEdit || !followForm },
                            { value: "link", label: W.linkAction, disabled: !canEdit },
                          ]}
                          value={o.action.kind}
                          onValueChange={(v) => canEdit && edit({ ...def, offers: set(def.offers, i, { ...o, action: v === "follow" ? { kind: "follow" } : { kind: "link", url: o.action.kind === "link" ? o.action.url : "", label: o.action.kind === "link" ? o.action.label : "Get it" } }) })}
                          className="self-start"
                        />
                      </div>
                      {o.action.kind === "link" ? (
                        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                          <Field htmlFor={`${id}-o${i}-url`} label={W.linkUrl} hint={W.linkUrlHint} error={problemAt(`offers.${i}.action`)}>
                            <Input id={`${id}-o${i}-url`} value={o.action.url} placeholder="https://" mono readOnly={!canEdit} onChange={(e) => edit({ ...def, offers: set(def.offers, i, { ...o, action: { kind: "link", url: e.target.value, label: o.action.kind === "link" ? o.action.label : "" } }) })} />
                          </Field>
                          <Field htmlFor={`${id}-o${i}-label`} label={W.linkLabel}>
                            <Input id={`${id}-o${i}-label`} value={o.action.label} readOnly={!canEdit} onChange={(e) => edit({ ...def, offers: set(def.offers, i, { ...o, action: { kind: "link", url: o.action.kind === "link" ? o.action.url : "", label: e.target.value } }) })} />
                          </Field>
                        </div>
                      ) : problemAt(`offers.${i}.action`) ? (
                        <p className="t-small text-status-bad">{problemAt(`offers.${i}.action`)}</p>
                      ) : null}
                    </div>
                  ))}
                </section>

                <section aria-labelledby={`${id}-questions`} className="flex flex-col gap-4" data-testid="quiz-questions">
                  <h3 id={`${id}-questions`} className="t-label text-secondary">{W.questions}</h3>
                  {def.questions.map((q, i) => (
                    <div key={q.key} className="flex flex-col gap-3 rounded-md border border-line p-4" data-quiz-question-editor={q.key}>
                      <Field htmlFor={`${id}-q${i}`} label={`${W.question} ${i + 1}`} error={problemAt(`questions.${i}.text`) ?? problems.find((p) => p.path === `questions.${i}.answers`)?.message}>
                        <Input id={`${id}-q${i}`} value={q.text} readOnly={!canEdit} onChange={(e) => edit({ ...def, questions: set(def.questions, i, { ...q, text: e.target.value }) })} />
                      </Field>
                      {q.answers.map((a, j) => (
                        <div key={a.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                          <Field htmlFor={`${id}-q${i}a${j}`} label={`${W.answer} ${j + 1}`} error={problemAt(`questions.${i}.answers.${j}.text`)}>
                            <Input id={`${id}-q${i}a${j}`} value={a.text} readOnly={!canEdit} onChange={(e) => edit({ ...def, questions: set(def.questions, i, { ...q, answers: set(q.answers, j, { ...a, text: e.target.value }) }) })} />
                          </Field>
                          <Field htmlFor={`${id}-q${i}a${j}-type`} label={W.answerType} error={problemAt(`questions.${i}.answers.${j}.type`)}>
                            <SimpleSelect id={`${id}-q${i}a${j}-type`} options={typeOptions} value={a.type} disabled={!canEdit} onValueChange={(v) => edit({ ...def, questions: set(def.questions, i, { ...q, answers: set(q.answers, j, { ...a, type: v }) }) })} />
                          </Field>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>

                {hasCounts ? (
                  <section aria-labelledby={`${id}-results`} className="flex flex-col gap-2" data-testid="quiz-results">
                    <h3 id={`${id}-results`} className="t-label text-secondary">{W.results}</h3>
                    <ul className="flex flex-col gap-1">
                      {def.types.map((t) => (
                        <li key={t.key} className="t-body text-primary">
                          {t.name}: {pageQuizCountLine(data.counts[t.key] ?? 0)}
                        </li>
                      ))}
                    </ul>
                    <p className="t-small text-secondary">{W.resultsNote}</p>
                  </section>
                ) : null}

                {problems.length ? (
                  <section aria-labelledby={`${id}-before`} className="flex flex-col gap-2 border-t border-line pt-4" data-testid="quiz-problems">
                    <h3 id={`${id}-before`} className="t-label text-status-warn">{W.before}</h3>
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                      {problems.map((p, i) => (
                        <li key={`${p.path}-${i}`} className="t-body text-primary">
                          {p.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>

              <div className="flex w-phone max-w-full flex-col gap-2 self-start" data-testid="quiz-preview">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="t-label text-secondary">{W.preview}</span>
                  <span className="t-small text-secondary">{W.previewNote}</span>
                </div>
                <div className="@container rounded-md border border-line-strong bg-canvas p-4">
                  <ProjectQuiz quiz={def} followForm={followForm} preview />
                </div>
              </div>
            </div>
          )}

          {refusal ? (
            <p role="status" className="t-body text-primary" data-testid="quiz-refusal">
              {refusal}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="t-body text-status-bad">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="t-body text-secondary" data-testid="quiz-notice">
              {notice}
            </p>
          ) : null}

          {quiz && def && data.canEdit ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="quiz-actions">
              {data.canApprove && (status === "draft" || dirty) ? (
                <Button variant="primary" icon={ShieldCheck} onClick={approve} loading={pending === "approve"} disabled={problems.length > 0}>
                  {W.approve}
                </Button>
              ) : null}
              {data.canApprove && status === "approved" && !dirty ? (
                <Button variant="primary" icon={Power} onClick={() => turn(true)} loading={pending === "on"}>
                  {W.turnOn}
                </Button>
              ) : null}
              {data.canApprove && status === "live" && !dirty ? (
                <Button icon={PowerOff} onClick={() => turn(false)} loading={pending === "off"}>
                  {W.turnOff}
                </Button>
              ) : null}
              {canEdit ? (
                <Button icon={Save} onClick={save} loading={pending === "save"} disabled={!dirty}>
                  {W.save}
                </Button>
              ) : null}
              {canEdit ? (
                <Button variant="ghost" icon={RefreshCw} onClick={() => setConfirmRedraft(true)} loading={pending === "draft"}>
                  {W.redraft}
                </Button>
              ) : null}
              {dirty ? <span className="t-small text-secondary">{W.unsaved}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={confirmRedraft} onOpenChange={setConfirmRedraft}>
        <DialogContent size="sm" aria-describedby={`${id}-redraft`}>
          <DialogHeader>
            <DialogTitle>{W.redraftTitle}</DialogTitle>
            <DialogDescription id={`${id}-redraft`}>{W.redraftBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRedraft(false)}>
              {W.cancel}
            </Button>
            <Button variant="primary" icon={Sparkles} onClick={askDraft} loading={pending === "draft"} data-testid="quiz-confirm-redraft">
              {W.redraft}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
