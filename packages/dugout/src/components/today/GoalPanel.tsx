"use client";
/**
 * GoalPanel (Today, founder 2026-11-07: "Your goal"): the business's one number, as the Chief of Staff proposed it and
 * the founder approved it.
 *
 * - Waiting: one line ("Your Chief of Staff proposes a goal after the first round of work.").
 * - Proposed: who proposed it ("Proposed by Ines Park, your Chief of Staff"), the sentence in display-sm, why it is
 *   recommended, then **Approve this goal** (primary, one tap) and **Change it**, which opens "What should change?" with
 *   the founder's own words. Readers who cannot answer the Inbox see who can instead of the buttons.
 * - Active: the sentence, a ProgressBar (role=progressbar, aria-valuenow is the count or the minor units so far) with
 *   the figure in words, a status pill (On pace, Behind, Date passed, Reached; icon and word, never color alone) and the
 *   pace sentence ("4 of 10 so far, 38 days left: on pace (Forecast)."). A goal with no number reads "No number to track
 *   yet." A new proposal while a goal is active (a missed date, the next goal) sits under it with the same two answers.
 *
 * Every word of the sentences comes from the caller (packages/shared goals.ts); the panel only lays them out.
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Check, PenLine, Target } from "lucide-react";
import { Button } from "../foundation/Button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Field } from "../foundation/Label";
import { ProgressBar, type ProgressBarTone } from "../foundation/ProgressBar";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Textarea } from "../foundation/Textarea";
import { Panel } from "../shell/Panel";
import type { GridSpan } from "../shell/types";

/** Where an active goal stands. */
export type GoalPaceState = "on_pace" | "behind" | "overdue" | "reached" | "untracked";

export interface GoalPanelGoal {
  id: string;
  /** "Get the first 10 paying customers by Dec 19". */
  sentence: string;
  /** Null for a goal with no number to track. */
  progress: {
    /** The count, or minor units for money, so far. */
    current: number;
    target: number;
    /** The figure in words for a screen reader and beside the bar ("4 of 10 paying customers", "£1,200 of £5,000"). */
    valueText: string;
    /** The pace sentence ("4 of 10 so far, 38 days left: on pace (Forecast)."). */
    pace: string;
  } | null;
  state: GoalPaceState;
}

export interface GoalPanelProposal {
  id: string;
  sentence: string;
  /** The Chief of Staff's stored name; null when it is not known. */
  proposedBy: string | null;
  /** "Recommended because the first customers tell us what to build next." */
  because?: string | null;
}

export interface GoalPanelProps {
  active: GoalPanelGoal | null;
  proposed: GoalPanelProposal | null;
  /** May approve or change a proposal (a writing member with Inbox write). */
  canDecide: boolean;
  loading?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  /** Approve this goal (one tap). */
  onApprove?: (goalId: string) => void;
  /** The approval is on its way. */
  approving?: boolean;
  /** Change it: resolves once the revised proposal is written; a rejection's message is shown in the dialog. */
  onRequestChange?: (goalId: string, words: string) => Promise<unknown>;
  /** The waiting line; default the Chief of Staff one. */
  waitingText?: ReactNode;
  span?: GridSpan;
  className?: string;
}

export const GOAL_PANEL_WORDS = {
  title: "Your goal",
  waiting: "Your Chief of Staff proposes a goal after the first round of work.",
  approve: "Approve this goal",
  change: "Change it",
  dialogTitle: "What should change?",
  placeholder: "For example: 20 customers by the end of January",
  send: "Send to your Chief of Staff",
  readOnly: "A member who can answer the Inbox approves this goal or asks for a change.",
  untracked: "No number to track yet.",
  newProposal: "A new goal is proposed",
  help: "Your Chief of Staff is the agent who plans each round of work; it proposes one number for the team to aim at, and you approve it or say what to change.",
} as const;

const PACE: Record<GoalPaceState, { tone: StatusTone; word: string; bar: ProgressBarTone }> = {
  on_pace: { tone: "good", word: "On pace", bar: "good" },
  behind: { tone: "warn", word: "Behind", bar: "warn" },
  overdue: { tone: "bad", word: "Date passed", bar: "bad" },
  reached: { tone: "good", word: "Reached", bar: "gold" },
  untracked: { tone: "neutral", word: "No number yet", bar: "kit" },
};

/** "Proposed by Ines Park, your Chief of Staff". */
export function proposedByLine(name: string | null): string {
  return name ? `Proposed by ${name}, your Chief of Staff` : "Proposed by your Chief of Staff";
}

function ChangeDialog({ open, onOpenChange, onSend }: { open: boolean; onOpenChange: (open: boolean) => void; onSend: (words: string) => Promise<unknown> }) {
  const id = useId();
  const [words, setWords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (open) {
      setWords("");
      setError(null);
    }
  }, [open]);
  const trimmed = words.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "That did not go through. Try again.");
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="goal-change-dialog">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{GOAL_PANEL_WORDS.dialogTitle}</DialogTitle>
            <DialogDescription>Say it in your own words: a number, a date, or both. Your Chief of Staff writes the revised goal for you to approve.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field htmlFor={`${id}-words`} label="Your words" error={error ?? undefined}>
              <Textarea id={`${id}-words`} value={words} onChange={(e) => setWords(e.target.value)} placeholder={GOAL_PANEL_WORDS.placeholder} maxLength={2000} rows={3} autoFocus data-testid="goal-change-words" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!trimmed} loading={sending} data-testid="goal-change-send">
              {GOAL_PANEL_WORDS.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Proposal({ proposal, canDecide, approving, onApprove, onChange, lead }: { proposal: GoalPanelProposal; canDecide: boolean; approving?: boolean; onApprove?: (goalId: string) => void; onChange?: () => void; lead?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" data-goal-proposal={proposal.id}>
      {lead}
      <p className="t-small text-secondary" data-testid="goal-proposed-by">
        {proposedByLine(proposal.proposedBy)}
      </p>
      <p className="t-display-sm text-balance text-primary" data-testid="goal-sentence">
        {proposal.sentence}
      </p>
      {proposal.because ? <p className="t-body text-secondary">{proposal.because}</p> : null}
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" size="sm" icon={Check} className="min-h-tap @page-wide:min-h-0" loading={approving} onClick={() => onApprove?.(proposal.id)} data-testid="goal-approve">
            {GOAL_PANEL_WORDS.approve}
          </Button>
          <Button variant="ghost" size="sm" icon={PenLine} className="min-h-tap @page-wide:min-h-0" onClick={onChange} data-testid="goal-change">
            {GOAL_PANEL_WORDS.change}
          </Button>
        </div>
      ) : (
        <p className="t-small text-tertiary">{GOAL_PANEL_WORDS.readOnly}</p>
      )}
    </div>
  );
}

function ActiveGoal({ goal }: { goal: GoalPanelGoal }) {
  const pace = PACE[goal.state];
  return (
    <div className="flex flex-col gap-2" data-goal-active={goal.id} data-goal-state={goal.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="t-display-sm min-w-0 flex-1 text-balance text-primary" data-testid="goal-sentence">
          {goal.sentence}
        </p>
        {goal.progress ? <StatusPill tone={pace.tone}>{pace.word}</StatusPill> : null}
      </div>
      {goal.progress ? (
        <>
          <ProgressBar value={goal.progress.current} max={goal.progress.target} label="Goal progress" valueText={goal.progress.valueText} tone={pace.bar} size="md" data-testid="goal-progress" />
          <p className="t-body text-secondary" data-testid="goal-pace">
            {goal.progress.pace}
          </p>
        </>
      ) : (
        <p className="t-body text-secondary" data-testid="goal-pace">
          {GOAL_PANEL_WORDS.untracked}
        </p>
      )}
    </div>
  );
}

export function GoalPanel({ active, proposed, canDecide, loading, error, onRetry, onApprove, approving, onRequestChange, waitingText = GOAL_PANEL_WORDS.waiting, span, className }: GoalPanelProps) {
  const [changing, setChanging] = useState<string | null>(null);
  const empty = !loading && !error && !active && !proposed ? { icon: Target, children: waitingText, tone: "kit" as const, compact: true, "data-testid": "goal-waiting" } : undefined;
  return (
    <Panel title={GOAL_PANEL_WORDS.title} span={span} glow="brand" help={GOAL_PANEL_WORDS.help} loading={loading} error={error} onRetry={onRetry} empty={empty} className={className} data-testid="goal-panel" data-goal={active ? "active" : proposed ? "proposed" : "waiting"}>
      <div className="flex flex-col gap-4">
        {active ? <ActiveGoal goal={active} /> : null}
        {proposed ? (
          <Proposal
            proposal={proposed}
            canDecide={canDecide}
            approving={approving}
            onApprove={onApprove}
            onChange={() => setChanging(proposed.id)}
            lead={active ? <p className="t-data border-t border-line pt-3">{GOAL_PANEL_WORDS.newProposal}</p> : undefined}
          />
        ) : null}
      </div>
      {onRequestChange ? <ChangeDialog open={changing !== null} onOpenChange={(open) => !open && setChanging(null)} onSend={(words) => onRequestChange(changing!, words)} /> : null}
    </Panel>
  );
}
