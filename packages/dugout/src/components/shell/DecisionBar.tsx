"use client";
import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { CircleCheck, MessageCircle, Play, RotateCcw, ThumbsUp, TriangleAlert } from "lucide-react";
import type { Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { formatMoney } from "../../lib/format";
import { Button } from "../foundation/Button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { Icon } from "../foundation/Icon";
import { Input } from "../foundation/Input";
import { Kbd } from "../foundation/Kbd";
import { StatusPill } from "../foundation/StatusPill";
import { ConsequenceLine, type ConsequenceParts } from "../guidance/ConsequenceLine";
import { useGuided } from "../guidance/GuidanceProvider";
import { ReassuranceLine } from "../guidance/ReassuranceLine";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** One option from the Composer schema (BUILD §11.3 `decision.options`). */
export interface DecisionOption {
  id: string;
  label: string;
  recommended?: boolean;
  /** One line: what happens if chosen. */
  consequence?: string;
  /**
   * Why this option is recommended, or why it is on the list, in the agent's words ("Recommended because it is free and
   * reversible."; docs/UX_AUDIT_AND_PLAN.md §8.1). A small line under the consequence.
   */
  because?: string;
  /** Cost of the option; null or 0 reads "No cost". */
  cost?: Money | null;
  /** Whether the action can be undone. */
  reversible?: boolean;
  disabled?: boolean;
}

/** The line under "Your decision" while guidance is on: what the bar asks for, and the reassurance that nothing runs yet. */
export const DECISION_GUIDED_LINE = "Pick one. Nothing runs until you do.";

/** The hover card's word for a cost or a reversibility the option never stated (never "unknown", UX plan B11). */
export const NOT_STATED = "Not stated";

export const DECISION_OPTIONS_MIN = 2;
export const DECISION_OPTIONS_MAX = 4;

export interface DecisionAnswer {
  /** The chosen option, or undefined when free text was executed. */
  optionId?: string;
  /** The free text that was executed. */
  text?: string;
}

export interface DecisionBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  /** 2–4 options; the bar renders at most four. */
  options: DecisionOption[];
  onChoose: (option: DecisionOption) => void;
  /** Free text → Plan compiler (BUILD §11.3). Omit to hide the text box. */
  onExecute?: (text: string) => void;
  freeTextPlaceholder?: string;
  /** Everything disabled (the decision expired, the viewer cannot decide, a plan is executing). */
  disabled?: boolean;
  /** Shown while the chosen plan compiles or executes. */
  executing?: boolean;
  /** The decision was answered: options lock and the bar states what was chosen. */
  answered?: DecisionAnswer;
  /** Undo the answer while it is still reversible. */
  onReopen?: () => void;
  /** Bind 1–4 to the options (default true). Turn off when the shell's keyboard map owns the digits. */
  hotkeys?: boolean;
  /** Sticky at the bottom of the reading pane (default true). */
  sticky?: boolean;
  /** Extra content: the expiry beside "Your decision" when `deadline` is not given, otherwise a line after the options. */
  note?: ReactNode;
  /** The deadline beside "Your decision" ("If you do nothing by Nov 20, Juno waits."). */
  deadline?: ReactNode;
  /** The data label on the left (default "Your decision"). */
  heading?: ReactNode;
  /**
   * Talk it through instead of typing: an "Ask <agent>" / "Reply to <agent>" button that opens the conversation
   * (DIRECTION #7). When given it replaces the free-text box; without it the free-text form stays (`onExecute`).
   */
  onAsk?: () => void;
  /** The ask button's label, e.g. "Ask Juno" or "Reply to Juno" (default "Ask the team"). */
  askLabel?: string;
  /** The ask button's second line (default "Talk it through first"). */
  askDescription?: ReactNode;
  /**
   * Show the 1–4 key caps on the options even when the shell's keyboard map owns the digits (default: `hotkeys`). The
   * caps are an operator's affordance: they render only while guidance is off (`useGuided`); the keys work either way.
   */
  keyHints?: boolean;
}

/**
 * "€500.00 (Estimate)" / "No cost" / "Not stated". An option's cost is written with the option before anything runs,
 * so it is an Estimate (CLAUDE.md: label every non-real number). A cost the option never stated reads "Not stated"
 * in the hover card and is left out of the subline (never "unknown", UX plan B11). Exported for tests.
 */
/** What "(Estimate)" on a cost means, under the figure in the hover card (UX plan §8.3: define on first use). */
export const COST_ESTIMATE_NOTE = "Estimate: worked out from the option before anything runs, not measured.";

export function costText(cost: Money | null | undefined): string {
  if (cost === undefined) return NOT_STATED;
  if (cost === null || cost.amountMinor === 0) return "No cost";
  return `${formatMoney(cost)} (Estimate)`;
}

/** "Reversible" / "Not reversible" / "Not stated". */
export function reversibilityText(reversible: boolean | undefined): string {
  if (reversible === undefined) return NOT_STATED;
  return reversible ? "Reversible" : "Not reversible";
}

/**
 * The second line of an option: its consequence, or else what is known of its cost and reversibility ("No cost ·
 * Reversible"); a part the option never stated is left out, and the line is undefined when nothing is known. Exported
 * for tests.
 */
export function optionSubline(o: DecisionOption): string | undefined {
  if (o.consequence) return o.consequence;
  const parts = [o.cost !== undefined ? costText(o.cost) : null, o.reversible !== undefined ? reversibilityText(o.reversible) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * The parts of an option's subline for its `ConsequenceLine`, the same choice as `optionSubline`: the consequence when
 * the agent gave one, or else the cost and reversibility it stated. Exported for tests.
 */
export function optionConsequence(o: DecisionOption): ConsequenceParts {
  if (o.consequence) return { consequence: o.consequence };
  return { cost: o.cost !== undefined ? costText(o.cost) : null, reversible: o.reversible ?? null };
}

/**
 * An option's share of the bar's width: its words (label, consequence, the Recommended tag), so a long option gets the
 * room to sit on two lines while a short one stays narrow. Exported for tests.
 */
export function optionWeight(o: DecisionOption): number {
  return Math.max(20, o.label.length + (optionSubline(o)?.length ?? 0) + (o.recommended ? 14 : 0));
}

/**
 * The hidden description a screen reader gets for an option: the recommendation, the consequence, the reason, then
 * only the cost and reversibility the option stated.
 */
export function optionDescription(o: DecisionOption): string {
  return [o.recommended ? "Recommended." : null, o.consequence, o.because, o.cost !== undefined ? `${costText(o.cost)}.` : null, o.reversible !== undefined ? `${reversibilityText(o.reversible)}.` : null].filter(Boolean).join(" ");
}

/**
 * The DecisionBar (BUILD §5.4, §11.3, DESIGN §8, DIRECTION #7): sticky at the bottom of the reading pane, at least
 * 64 px, glass (surface 2 at 86 % over a 16 px blur) with a top light line and an upward shadow. Compact, so the
 * conversation above keeps its room: one heading line ("Your decision", with "Pick one. Nothing runs until you do."
 * beside it while guidance is on, the deadline and, at its right, "Ask <agent> · Talk it through first"), then the
 * options in a tight grid across the whole bar. Options are two-line buttons, each carrying its own consequence under
 * its label and, when the agent said why, a small "because" line; the recommended one is primary with an inline
 * thumbs-up "Recommended" tag. Options wrap and the bar grows — nothing truncates or overlaps. Hover (or focus) still
 * shows consequence, cost and reversibility in a small card ("Not stated" for a part the option left out). With `onAsk`
 * the ask button opens the conversation instead of a free-text box (typing is optional, never required); without it
 * the free-text form + Execute stays. 1–4 choose; their key caps show only while guidance is off.
 */
export const DecisionBar = forwardRef<HTMLDivElement, DecisionBarProps>(function DecisionBar(
  {
    options,
    onChoose,
    onExecute,
    freeTextPlaceholder = "Or tell the team what to do…",
    disabled,
    executing,
    answered,
    onReopen,
    hotkeys = true,
    sticky = true,
    note,
    deadline,
    heading = "Your decision",
    onAsk,
    askLabel = "Ask the team",
    askDescription = "Talk it through first",
    keyHints,
    className,
    ...rest
  },
  ref,
) {
  const shown = options.slice(0, DECISION_OPTIONS_MAX);
  const [text, setText] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const baseId = useId();
  const locked = !!disabled || !!executing || !!answered;
  // While the choice is being carried out the options refuse presses but keep keyboard focus (aria-disabled, not
  // `disabled`): a control that turns disabled under the keyboard drops focus to <body> (WCAG 2.4.3).
  const busy = !!executing && !disabled && !answered;
  const choose = (option: DecisionOption) => {
    setChosenId(option.id);
    onChoose(option);
  };

  // Once the decision is recorded the options give way to the "Decided" line; when one of them had focus, the line
  // takes it, so the founder keeps their place. Whether focus was inside is read at render, before the swap commits.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const isAnswered = !!answered;
  const focusInside = typeof document !== "undefined" && !!rootRef.current?.contains(document.activeElement);
  useIsoLayoutEffect(() => {
    if (!isAnswered || !focusInside) return;
    const active = document.activeElement;
    if (!active || active === document.body || !rootRef.current?.contains(active)) summaryRef.current?.focus({ preventScroll: true });
  }, [isAnswered, focusInside]);
  // Key caps are for operators: guidance on hides them (the keys still choose); the guided line says what the bar asks.
  const guided = useGuided();
  const showKeys = (keyHints ?? hotkeys) && !guided;
  const leftLine = deadline ?? note;
  const trailingNote = deadline !== undefined && deadline !== null ? note : undefined;

  useHotkeys(
    "1,2,3,4",
    (e, hk) => {
      const n = Number(hk.keys?.[0]);
      const option = shown[n - 1];
      if (!option || option.disabled) return;
      e.preventDefault();
      choose(option);
    },
    { enabled: hotkeys && !locked },
    [shown, onChoose, hotkeys, locked],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || locked || !onExecute) return;
    onExecute(t);
    setText("");
  };

  const chosen = answered?.optionId ? shown.find((o) => o.id === answered.optionId) : undefined;

  return (
    <div
      ref={setRootRef}
      role="group"
      aria-label="Decision"
      // The shell's 1–4 choose only with focus in here (keyboard.ts DECISION_BAR_ATTRIBUTE, WP-04 T13).
      data-decision-bar=""
      data-testid="decision-bar"
      data-state={answered ? "answered" : executing ? "executing" : disabled ? "disabled" : "open"}
      // The Inbox tour (Coachmark) rings the bar ("Every option says what it costs…") and then its ask button.
      data-coachmark="decision-bar"
      className={cn("decision-glass decision-layout flex min-h-decision-bar shrink-0 flex-col justify-center px-gutter py-2", sticky && "sticky bottom-0 z-10", className)}
      {...rest}
    >
      {answered ? (
        <div ref={summaryRef} tabIndex={-1} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm outline-none focus-visible:shadow-ring" data-decision-summary>
          <StatusPill tone="good" icon={CircleCheck}>
            Decided
          </StatusPill>
          <span className="min-w-0 text-body-strong text-primary">{chosen ? chosen.label : answered.text ? `“${answered.text}”` : "Answered"}</span>
          {note ? <span className="min-w-0 text-small text-secondary">{note}</span> : null}
          {onReopen ? (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReopen} className="ml-auto">
              Reopen
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="decision-inner">
          <div className="decision-heading" data-decision-heading>
            {/* One heading line (DESIGN §8): the guided line sits beside the heading and wraps under it only when the bar
                has no room, so guidance never makes the sticky bar a row taller. */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5" data-decision-heading-line="">
              <span className="t-data">{heading}</span>
              {/* Tutoring: ReassuranceLine renders only while guidance is on. */}
              <ReassuranceLine data-decision-guided-line="">{DECISION_GUIDED_LINE}</ReassuranceLine>
            </div>
            {leftLine ? <span className="text-small text-tertiary tabular-nums">{leftLine}</span> : null}
            {onAsk ? (
              <Button size="sm" variant="default" icon={MessageCircle} disabled={!!disabled || !!executing} onClick={onAsk} className="decision-ask in-data-[phone]:min-h-tap" data-decision-ask data-coachmark="decision-ask">
                <span>{askLabel}</span>
                <span className="font-normal opacity-70">{askDescription}</span>
              </Button>
            ) : null}
          </div>
          <div
            className="decision-options min-w-0 flex-1"
            data-count={shown.length}
            style={{ "--option-cols": shown.map((o) => `minmax(min(100%, 168px), ${optionWeight(o)}fr)`).join(" ") } as CSSProperties}
          >
            <div className="contents" role="group" aria-label="Options">
              {shown.map((o, i) => {
                const descId = `${baseId}-${o.id}`;
                const sub = optionSubline(o);
                // The consequence (or what is known of the cost and reversibility), then the agent's "because" as its own
                // small line, both as ConsequenceLines; `text-inherit` keeps the button's own description color, which
                // the recommended (primary) option needs. The screen reader's sentence stays `optionDescription`.
                const description =
                  sub || o.because ? (
                    <>
                      {sub ? <ConsequenceLine {...optionConsequence(o)} className="text-inherit" data-option-subline="" /> : null}
                      {o.because ? <ConsequenceLine consequence={o.because} className={cn("text-inherit", sub && "mt-0.5")} data-option-because="" /> : null}
                    </>
                  ) : undefined;
                return (
                  <HoverCard key={o.id} openDelay={500}>
                    <HoverCardTrigger asChild>
                      <Button
                        variant={o.recommended ? "primary" : "default"}
                        disabled={!!disabled || o.disabled}
                        loading={busy && chosenId === o.id}
                        aria-disabled={busy || undefined}
                        onClick={busy ? undefined : () => choose(o)}
                        aria-describedby={descId}
                        aria-keyshortcuts={hotkeys || showKeys ? String(i + 1) : undefined}
                        data-option-id={o.id}
                        data-recommended={o.recommended || undefined}
                        description={description}
                        lines={2}
                        className={cn("decision-option min-w-0 justify-start", showKeys && "pr-8")}
                      >
                        <span className="min-w-0">{o.label}</span>
                        {o.recommended ? (
                          <span className="btn-tag gap-1">
                            <Icon icon={ThumbsUp} size={11} />
                            Recommended
                          </span>
                        ) : null}
                        {showKeys ? (
                          <Kbd aria-hidden className="absolute right-2 top-2 opacity-80" data-option-key>
                            {i + 1}
                          </Kbd>
                        ) : null}
                        <span id={descId} className="sr-only">
                          {optionDescription(o)}
                        </span>
                      </Button>
                    </HoverCardTrigger>
                    <HoverCardContent side="top" className="w-72">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="t-display-sm">{o.label}</span>
                          {o.recommended ? (
                            <StatusPill tone="info" icon={ThumbsUp}>
                              Recommended
                            </StatusPill>
                          ) : null}
                        </div>
                        {o.consequence ? <p className="text-body text-secondary">{o.consequence}</p> : null}
                        {o.because ? (
                          <p className="text-small text-secondary" data-option-because>
                            {o.because}
                          </p>
                        ) : null}
                        <dl className="grid grid-cols-2 gap-2">
                          <div>
                            <dt className="t-data">Cost</dt>
                            <dd className="text-body-strong tabular-nums">{costText(o.cost)}</dd>
                          </div>
                          <div>
                            <dt className="t-data">Reversibility</dt>
                            <dd className="inline-flex items-center gap-1 text-body-strong">
                              {o.reversible === false ? <Icon icon={TriangleAlert} size="inline" className="text-status-warn" /> : null}
                              {reversibilityText(o.reversible)}
                            </dd>
                          </div>
                        </dl>
                        {o.cost && o.cost.amountMinor !== 0 ? <p className="text-small text-tertiary">{COST_ESTIMATE_NOTE}</p> : null}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                );
              })}
            </div>
            {onAsk ? null : onExecute ? (
              <form onSubmit={submit} className="flex min-w-0 items-center gap-2" data-testid="decision-free-text" data-decision-row>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={freeTextPlaceholder}
                  disabled={!!disabled || !!answered}
                  readOnly={busy}
                  aria-label="Free-text instruction"
                  wrapperClassName="min-w-0 flex-1"
                />
                <Button type="submit" variant="default" icon={Play} disabled={locked || text.trim() === ""} loading={executing} aria-label="Execute the instruction">
                  Execute
                </Button>
              </form>
            ) : null}
            {executing && !onExecute ? (
              <StatusPill tone="info" className="self-center justify-self-start" data-decision-row>
                Executing
              </StatusPill>
            ) : null}
            {trailingNote ? (
              <span className="text-small text-secondary" data-decision-row>
                {trailingNote}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
});
