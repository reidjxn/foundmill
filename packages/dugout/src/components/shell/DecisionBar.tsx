"use client";
import { forwardRef, useId, useState, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { CircleCheck, Play, RotateCcw, ThumbsUp, TriangleAlert } from "lucide-react";
import type { Money } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { formatMoney } from "../../lib/format";
import { Button } from "../foundation/Button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { Icon } from "../foundation/Icon";
import { Input } from "../foundation/Input";
import { Kbd } from "../foundation/Kbd";
import { StatusPill } from "../foundation/StatusPill";

/** One option from the Composer schema (BUILD §11.3 `decision.options`). */
export interface DecisionOption {
  id: string;
  label: string;
  recommended?: boolean;
  /** One line: what happens if chosen. */
  consequence?: string;
  /** Cost of the option; null or 0 reads "No cost". */
  cost?: Money | null;
  /** Whether the action can be undone. */
  reversible?: boolean;
  disabled?: boolean;
}

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
  /** Extra content on the left (expiry, "Decided by the Chief of Staff"). */
  note?: ReactNode;
}

/** "€500.00" / "No cost" / "Cost unknown". Exported for tests. */
export function costText(cost: Money | null | undefined): string {
  if (cost === undefined) return "Cost unknown";
  if (cost === null || cost.amountMinor === 0) return "No cost";
  return formatMoney(cost);
}

/** "Reversible" / "Not reversible" / "Reversibility unknown". */
export function reversibilityText(reversible: boolean | undefined): string {
  if (reversible === undefined) return "Reversibility unknown";
  return reversible ? "Reversible" : "Not reversible";
}

/** The hidden description a screen reader gets for an option. */
export function optionDescription(o: DecisionOption): string {
  return [o.recommended ? "Recommended." : null, o.consequence, `${costText(o.cost)}.`, `${reversibilityText(o.reversible)}.`].filter(Boolean).join(" ");
}

/**
 * The DecisionBar (BUILD §5.4, §11.3, DESIGN §8): sticky at the bottom of the reading pane, 64 px, bg-panel-alt, 2–4
 * buttons. The recommended option carries a thumbs-up and a kit-primary fill, the others are outlined; hover (or
 * focus) shows consequence, cost and reversibility in a small card; free text + Execute on the right. 1–4 choose.
 */
export const DecisionBar = forwardRef<HTMLDivElement, DecisionBarProps>(function DecisionBar(
  { options, onChoose, onExecute, freeTextPlaceholder = "Or tell the team what to do…", disabled, executing, answered, onReopen, hotkeys = true, sticky = true, note, className, ...rest },
  ref,
) {
  const shown = options.slice(0, DECISION_OPTIONS_MAX);
  const [text, setText] = useState("");
  const baseId = useId();
  const locked = !!disabled || !!executing || !!answered;

  useHotkeys(
    "1,2,3,4",
    (e, hk) => {
      const n = Number(hk.keys?.[0]);
      const option = shown[n - 1];
      if (!option || option.disabled) return;
      e.preventDefault();
      onChoose(option);
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
      ref={ref}
      role="group"
      aria-label="Decision"
      data-testid="decision-bar"
      data-state={answered ? "answered" : executing ? "executing" : disabled ? "disabled" : "open"}
      className={cn("flex h-16 shrink-0 items-center gap-2 border-t border-subtle bg-panel-alt px-gutter", sticky && "sticky bottom-0 z-10", className)}
      {...rest}
    >
      {answered ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StatusPill tone="good" icon={CircleCheck}>
            Decided
          </StatusPill>
          <span className="truncate text-body text-primary">{chosen ? chosen.label : answered.text ? `“${answered.text}”` : "Answered"}</span>
          {note ? <span className="truncate text-small text-secondary">{note}</span> : null}
          {onReopen ? (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReopen} className="ml-auto">
              Reopen
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2" role="group" aria-label="Options">
            {shown.map((o, i) => {
              const descId = `${baseId}-${o.id}`;
              return (
                <HoverCard key={o.id}>
                  <HoverCardTrigger asChild>
                    <Button
                      variant={o.recommended ? "primary" : "default"}
                      icon={o.recommended ? ThumbsUp : undefined}
                      disabled={locked || o.disabled}
                      onClick={() => onChoose(o)}
                      aria-describedby={descId}
                      aria-keyshortcuts={hotkeys ? String(i + 1) : undefined}
                      data-option-id={o.id}
                      data-recommended={o.recommended || undefined}
                      className="max-w-64"
                    >
                      <span className="truncate">{o.label}</span>
                      {hotkeys ? <Kbd className="ml-0.5 border-current/30 bg-transparent text-current/80">{i + 1}</Kbd> : null}
                      <span id={descId} className="sr-only">
                        {optionDescription(o)}
                      </span>
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent side="top" className="w-72">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="t-display-sm">{o.label}</span>
                        {o.recommended ? (
                          <StatusPill tone="info" icon={ThumbsUp}>
                            Recommended
                          </StatusPill>
                        ) : null}
                      </div>
                      {o.consequence ? <p className="text-body text-secondary">{o.consequence}</p> : null}
                      <dl className="grid grid-cols-2 gap-2">
                        <div>
                          <dt className="t-label">Cost</dt>
                          <dd className="text-body-strong tabular-nums">{costText(o.cost)}</dd>
                        </div>
                        <div>
                          <dt className="t-label">Reversibility</dt>
                          <dd className="inline-flex items-center gap-1 text-body-strong">
                            {o.reversible === false ? <Icon icon={TriangleAlert} size="inline" className="text-status-warn" /> : null}
                            {reversibilityText(o.reversible)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              );
            })}
          </div>
          {note ? <span className="truncate text-small text-secondary">{note}</span> : null}
          {onExecute ? (
            <form onSubmit={submit} className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2" data-testid="decision-free-text">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={freeTextPlaceholder}
                disabled={locked}
                aria-label="Free-text instruction"
                wrapperClassName="min-w-0 max-w-96 flex-1"
              />
              <Button type="submit" variant="default" icon={Play} disabled={locked || text.trim() === ""} loading={executing} aria-label="Execute the instruction">
                Execute
              </Button>
            </form>
          ) : executing ? (
            <StatusPill tone="info" className="ml-auto">
              Executing
            </StatusPill>
          ) : null}
        </>
      )}
    </div>
  );
});
