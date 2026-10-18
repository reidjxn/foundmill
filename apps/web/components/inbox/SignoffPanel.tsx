"use client";
/**
 * The founder's sign-off of the specification or the roadmap, or Ready to start selling (founder, 2026-10-18): the
 * note's DecisionBar carries Approve and Request changes (or Start distribution now and Not yet); this panel carries
 * the founder's notes, required for Request changes (they become the Product lead's revision task) and optional with
 * an approval, and reads back how the round was answered. The same decision can be taken on the Product tabs.
 */
import { Field, Panel, StatusPill, Textarea, fieldDescribedBy, useFormatters, type StatusTone } from "@foundmill/dugout";
import type { RouterOutputs } from "@/lib/trpc";

type SignoffRound = NonNullable<RouterOutputs["inbox"]["get"]["signoff"]>;

export interface SignoffPanelProps {
  signoff: SignoffRound;
  /** The notes typed so far; sent with Approve or Request changes. */
  notes: string;
  onNotesChange: (notes: string) => void;
  /** The note was answered (or is being answered): the notes can no longer change. */
  answered: boolean;
  /** Request changes was pressed without notes: say so beside the field. */
  needsNotes: boolean;
  /** The option recorded, when answered here or before. */
  chosenOption?: string | null;
}

export const SIGNOFF_NOTES_ID = "signoff-notes";

const KIND_WORDS: Record<SignoffRound["kind"], string> = { spec: "the specification", roadmap: "the roadmap", ready_to_sell: "distribution" };

/** The pill for a round's state (an answered round reads from its status, a pending one from the note's own state). */
export function signoffPanelStatus(signoff: Pick<SignoffRound, "status" | "kind">, chosenOption: string | null | undefined, formatDate: (d: Date | string) => string, decidedAt: Date | string | null): { tone: StatusTone; word: string } {
  const by = (word: string) => `${word} by you${decidedAt ? ` · ${formatDate(decidedAt)}` : ""}`;
  if (signoff.status === "approved" || chosenOption === "approve" || chosenOption === "start") return { tone: "good", word: by(signoff.kind === "ready_to_sell" ? "Started" : "Approved") };
  if (signoff.status === "changes_requested" || chosenOption === "request_changes") return { tone: "warn", word: by("Changes requested") };
  if (signoff.status === "declined" || chosenOption === "not_yet") return { tone: "neutral", word: by("Not yet") };
  return { tone: "info", word: `Round ${"round" in signoff ? (signoff as { round: number }).round : 1} · waiting for you` };
}

export function SignoffPanel({ signoff, notes, onNotesChange, answered, needsNotes, chosenOption }: SignoffPanelProps) {
  const { formatDate } = useFormatters();
  const status = signoffPanelStatus(signoff, chosenOption, formatDate, signoff.decidedAt);
  const open = !answered && (signoff.status === "pending" || signoff.status === "changes_requested");
  const ready = signoff.kind === "ready_to_sell";
  return (
    <Panel title={ready ? "Your call" : "Your sign-off"} span={12} actions={<StatusPill tone={status.tone}>{status.word}</StatusPill>} data-testid="signoff-panel" data-signoff-kind={signoff.kind} data-signoff-status={signoff.status}>
      <div className="flex flex-col gap-3">
        <p className="text-body text-secondary">
          {ready
            ? "Start distribution now and the channel engines start; Not yet keeps building, and you can start it any time from Distribution › Board."
            : `Approve ${KIND_WORDS[signoff.kind]} and the team builds from it, or ask for changes in your own words: they become the Product lead's revision task and you are asked to sign off again. You can also decide on the Product tabs.`}
        </p>
        {open ? (
          <Field htmlFor={SIGNOFF_NOTES_ID} label={ready ? "Notes (optional)" : "Notes"} hint={ready ? "Kept with your answer." : "Required for Request changes; optional with Approve."} error={needsNotes ? "Say what should change, in a sentence or two, so the Product lead can revise it." : undefined}>
            <Textarea id={SIGNOFF_NOTES_ID} value={notes} onChange={(e) => onNotesChange(e.target.value)} maxLength={2000} rows={3} aria-describedby={fieldDescribedBy(SIGNOFF_NOTES_ID, { hint: true, error: needsNotes })} aria-invalid={needsNotes || undefined} data-testid="signoff-notes" />
          </Field>
        ) : signoff.notes ? (
          <p className="text-small text-secondary" data-testid="signoff-recorded-notes">
            Your notes: <q>{signoff.notes}</q>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
