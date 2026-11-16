"use client";
/**
 * Product › Vision › "How the team describes your project" (WP-08 T1; apps/api services/positioning.ts): the
 * project's positioning notes. Every page, post and email the team drafts reads the approved copy; until a founder
 * approves one, the team writes from the founder's own words only.
 *
 * The five sections made of lines are plain editable lists, each line with its label (how sure it is) and where it
 * comes from. Members with Product write save changes (a waiting copy, never read by a prompt); an owner or an admin
 * approves. With no notes yet, one press asks the team to draft them.
 */
import { useEffect, useId, useState } from "react";
import { Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button, Field, Input, Panel, SimpleSelect, StatusPill, useFormatters } from "@foundmill/dugout";
import {
  POSITIONING_HEADINGS,
  POSITIONING_LABELS,
  POSITIONING_LIMITS,
  POSITIONING_LINE_SECTIONS,
  POSITIONING_STEPS,
  POSITIONING_STEP_LABELS,
  positioningProblems,
  type PositioningLabel,
  type PositioningLine,
  type PositioningLineSection,
  type PositioningNotes,
  type PositioningStep,
} from "@foundmill/shared/positioning";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { useCanWrite } from "../env";
import { errorMessage } from "./shared";

/** `positioning.get` as the panel reads it (apps/api `PositioningView`). */
export interface PositioningViewResponse {
  approved: PositioningNotes | null;
  draft: PositioningNotes | null;
  text: string;
  problems: string[];
  canApprove: boolean;
}

export const POSITIONING_PANEL_WORDS = {
  title: "How the team describes your project",
  intro: "Who it is for, their problem, what they use today and what is different. Every page, post and email the team writes starts here.",
  empty: "No notes yet. The team can draft them from your own words in a minute; you check every line.",
  askDraft: "Ask the team to draft it",
  drafting: "Drafting…",
  save: "Save changes",
  approve: "Approve",
  approved: (version: number, on: string) => `Approved, version ${version}${on ? `, ${on}` : ""}`,
  waiting: "Waiting for you to approve",
  notApproved: "Until you approve these notes, the team writes from your own words only.",
  approveOnly: "An owner or an admin approves the notes.",
  oneLine: "One line",
  oneLineHint: "What it is and who it is for, in words a stranger could repeat.",
  step: "The step we ask for",
  addLine: "Add a line",
  removeLine: "Remove this line",
  lineText: "Line",
  label: "How sure",
  source: "Where it comes from",
  sourceHint: "For a guess: the cheapest way to find out.",
} as const;

export const POSITIONING_LABEL_WORDS: Readonly<Record<PositioningLabel, string>> = {
  founder: "You said it",
  customer: "Someone it is for said it",
  observed: "Seen on a public page",
  assumption: "A guess for now",
};

const LABEL_OPTIONS = POSITIONING_LABELS.map((l) => ({ value: l, label: POSITIONING_LABEL_WORDS[l] }));
const STEP_OPTIONS = POSITIONING_STEPS.map((s) => ({ value: s, label: POSITIONING_STEP_LABELS[s] }));

/** The notes as the api takes them (version, date and Changes are set by approving). */
const toInput = (n: PositioningNotes) => ({ oneLine: n.oneLine, step: n.step, forWhom: n.forWhom, problem: n.problem, today: n.today, different: n.different, proof: n.proof, objections: n.objections, voice: n.voice, learned: n.learned });

export function PositioningPanel() {
  const id = useId();
  const W = POSITIONING_PANEL_WORDS;
  const { mutate } = useWidgetData();
  const canWrite = useCanWrite("product");
  const view = useWidgetQuery<PositioningViewResponse>("positioning.get", {});
  useBusinessEvents(() => view.refetch(), ["positioning.approved"]);
  const data = view.data;
  const { formatDate } = useFormatters();
  const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDate(new Date(`${d}T12:00:00Z`)) : "");
  const server = data?.draft ?? data?.approved ?? null;

  const [notes, setNotes] = useState<PositioningNotes | null>(server);
  useEffect(() => setNotes(server), [server?.version, server?.updatedOn, server?.oneLine, data?.draft === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pending, setPending] = useState<null | "draft" | "save" | "approve">(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: NonNullable<typeof pending>, procedure: string, input: Record<string, unknown>) => {
    setPending(what);
    setError(null);
    try {
      const next = await mutate<PositioningViewResponse>(procedure, input);
      setNotes(next.draft ?? next.approved);
      view.refetch();
    } catch (err) {
      setError(errorMessage(err as Error));
    } finally {
      setPending(null);
    }
  };

  const problems = notes ? positioningProblems(notes) : [];
  const setLines = (key: PositioningLineSection, lines: PositioningLine[]) => notes && setNotes({ ...notes, [key]: lines });
  const status = data?.draft ? <StatusPill tone="warn">{W.waiting}</StatusPill> : data?.approved ? <StatusPill tone="good">{W.approved(data.approved.version, day(data.approved.updatedOn))}</StatusPill> : null;

  return (
    <Panel title={W.title} span={12} loading={view.isLoading} error={view.error ? view.error.message : undefined} onRetry={view.refetch} actions={status} data-testid="positioning-panel">
      <p className="t-body mb-4 max-w-reading text-secondary">{W.intro}</p>
      {!notes ? (
        <div className="flex flex-col items-start gap-3">
          <p className="t-body">{W.empty}</p>
          {canWrite ? (
            <Button icon={Sparkles} onClick={() => run("draft", "positioning.requestDraft", {})} disabled={pending !== null} data-testid="positioning-ask">
              {pending === "draft" ? W.drafting : W.askDraft}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex max-w-reading flex-col gap-5">
          {!data?.approved ? <p className="t-small text-secondary">{W.notApproved}</p> : null}
          <Field htmlFor={`${id}-one`} label={W.oneLine} hint={W.oneLineHint}>
            <Input id={`${id}-one`} value={notes.oneLine} maxLength={POSITIONING_LIMITS.oneLine} readOnly={!canWrite} onChange={(e) => setNotes({ ...notes, oneLine: e.target.value })} />
          </Field>
          <Field htmlFor={`${id}-step`} label={W.step}>
            <SimpleSelect id={`${id}-step`} options={STEP_OPTIONS} value={notes.step} disabled={!canWrite} onValueChange={(v) => setNotes({ ...notes, step: v as PositioningStep })} />
          </Field>
          {POSITIONING_LINE_SECTIONS.map(({ key, heading }) => (
            <section key={key} aria-labelledby={`${id}-${key}`} className="flex flex-col gap-3" data-testid={`positioning-${key}`}>
              <h3 id={`${id}-${key}`} className="t-label">
                {heading}
              </h3>
              {notes[key].map((line, i) => (
                <div key={i} className="grid gap-2 border-b border-subtle pb-3 md:grid-cols-[1fr_12rem]">
                  <Field htmlFor={`${id}-${key}-${i}`} label={W.lineText}>
                    <Input id={`${id}-${key}-${i}`} value={line.text} maxLength={POSITIONING_LIMITS.line} readOnly={!canWrite} onChange={(e) => setLines(key, notes[key].map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))} />
                  </Field>
                  <Field htmlFor={`${id}-${key}-${i}-label`} label={W.label}>
                    <SimpleSelect id={`${id}-${key}-${i}-label`} options={LABEL_OPTIONS} value={line.label} disabled={!canWrite} onValueChange={(v) => setLines(key, notes[key].map((l, j) => (j === i ? { ...l, label: v as PositioningLabel } : l)))} />
                  </Field>
                  <Field htmlFor={`${id}-${key}-${i}-source`} label={W.source} hint={line.label === "assumption" ? W.sourceHint : undefined}>
                    <Input id={`${id}-${key}-${i}-source`} value={line.source ?? ""} maxLength={POSITIONING_LIMITS.source} readOnly={!canWrite} onChange={(e) => setLines(key, notes[key].map((l, j) => (j === i ? { ...l, source: e.target.value || null } : l)))} />
                  </Field>
                  {canWrite ? (
                    <div className="flex items-end">
                      <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setLines(key, notes[key].filter((_, j) => j !== i))}>
                        {W.removeLine}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              {canWrite && notes[key].length < POSITIONING_LIMITS.perSection ? (
                <Button variant="ghost" size="sm" icon={Plus} className="self-start" onClick={() => setLines(key, [...notes[key], { text: "", label: "assumption", source: null }])}>
                  {W.addLine}
                </Button>
              ) : null}
            </section>
          ))}
          <ReadOnlyLists notes={notes} day={day} />
          {problems.length ? (
            <ul className="t-small list-disc pl-5 text-status-bad" data-testid="positioning-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="t-small text-status-bad">{error}</p> : null}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => run("save", "positioning.save", { notes: toInput(notes) })} disabled={pending !== null}>
                {W.save}
              </Button>
              {data?.canApprove ? (
                <Button icon={ShieldCheck} onClick={() => run("approve", "positioning.approve", { notes: toInput(notes) })} disabled={pending !== null || problems.length > 0} data-testid="positioning-approve">
                  {W.approve}
                </Button>
              ) : (
                <span className="t-small text-secondary">{W.approveOnly}</span>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/** Objections, voice and what was learned: shown as they are (the team proposes changes to them). */
function ReadOnlyLists({ notes, day }: { notes: PositioningNotes; day: (d: string) => string }) {
  const rows: { heading: string; items: string[] }[] = [
    { heading: POSITIONING_HEADINGS.objections, items: notes.objections.map((o) => `${o.doubt} ${o.answer}`) },
    { heading: POSITIONING_HEADINGS.voice, items: [...notes.voice.traits.map((t) => `${t.trait}: ${t.means}`), ...(notes.voice.uses.length ? [`Words we use: ${notes.voice.uses.join(", ")}`] : []), ...(notes.voice.never.length ? [`Words we never use: ${notes.voice.never.join(", ")}`] : [])] },
    { heading: POSITIONING_HEADINGS.learned, items: notes.learned.map((l) => `${l.on ? `${day(l.on)}: ` : ""}${l.lesson}`) },
  ];
  return (
    <>
      {rows.map((r) => (
        <section key={r.heading} className="flex flex-col gap-2">
          <h3 className="t-label">{r.heading}</h3>
          {r.items.length ? (
            <ul className="t-body list-disc pl-5">
              {r.items.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : (
            <p className="t-small text-secondary">None yet.</p>
          )}
        </section>
      ))}
    </>
  );
}
