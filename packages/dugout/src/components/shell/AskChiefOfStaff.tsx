"use client";
/**
 * "Ask <Chief of Staff>": the one control on every business page that lets the founder put three plain questions to the
 * Chief of Staff, "What's happening?", "What's blocking us?" and "Why am I seeing this?", and read the answer where they
 * are (founder, Phase 3). It sits at the end of the tab row (or the breadcrumb row, or the thin page row of a page with
 * neither), beside "Explain this page". A ghost/sm Button with the Chief of Staff's avatar and the name under the
 * reader's naming preference opens a small popover:
 *
 *   1. a menu of the three questions and "Ask something else…" (arrow keys move, Enter picks);
 *   2. the answer, as the Chief of Staff speaking: avatar, name, the question, the answer through `EntityText` (so every
 *      `[[ent:<uuid>|Name]]` is an EntityLink), a skeleton while it loads, a message with Try again when it fails, and
 *      "Continue in chat" (the desk opens with the question) and Back.
 *
 * The component draws and speaks; the caller reads the answer (`chiefOfStaff.answer`, no model call) and opens the desk.
 * Escape closes it and the focus goes back to the button (the popover primitive does both). Hidden by the caller when
 * the business has no Chief of Staff. Motion follows `prefers-reduced-motion` through the popover and the skeleton.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, MessageSquare, MessageSquareText, RotateCw } from "lucide-react";
import { CHIEF_ASK_ELSE_LABEL, CHIEF_QUESTIONS, CHIEF_QUESTION_LABELS, type ChiefQuestion } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { EntityText } from "../data/EntityText";
import { Button } from "../foundation/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../foundation/Popover";
import { Skeleton } from "../foundation/Skeleton";

export type AskChiefAnswer =
  | { status: "loading" }
  | { status: "error"; message?: string }
  | { status: "ready"; text: string };

export interface AskChiefOfStaffProps {
  /** The Chief of Staff's name under the reader's naming preference ("Ines"). */
  name: string;
  /** The avatar at a size (the caller draws the agent's portrait: `<Avatar size={size} … />`). */
  renderAvatar: (size: number) => ReactNode;
  /** The answer to the question asked; the caller reads it when `onQuestionChange` says which. */
  answer: AskChiefAnswer | null;
  /** A question was picked (or null: back to the menu, or closed). */
  onQuestionChange?: (question: ChiefQuestion | null) => void;
  /** "Continue in chat": the desk opens with this question. */
  onContinue: (question: ChiefQuestion) => void;
  /** "Ask something else…": the desk opens with nothing typed. */
  onAskElse: () => void;
  /** Try again after an error. */
  onRetry?: () => void;
  /** The pointer or focus reached the button: fetch what opening needs (the desk's code). Safe to call often. */
  onIntent?: () => void;
  /** Start open (stories, tests). */
  defaultOpen?: boolean;
  className?: string;
}

export const ASK_CHIEF_ERROR = "I couldn't work that out just now.";

export function AskChiefOfStaff({ name, renderAvatar, answer, onQuestionChange, onContinue, onAskElse, onRetry, onIntent, defaultOpen = false, className }: AskChiefOfStaffProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [question, setQuestion] = useState<ChiefQuestion | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const panel = useRef<HTMLDivElement>(null);
  const label = `Ask ${name}`;

  const pick = useCallback(
    (next: ChiefQuestion | null) => {
      setQuestion(next);
      onQuestionChange?.(next);
    },
    [onQuestionChange],
  );
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) pick(null);
  };

  // The answer is announced where the founder's focus is: it moves to the panel when a question is picked, to the
  // first row when the menu comes back.
  useEffect(() => {
    if (!open) return;
    if (question) panel.current?.focus({ preventScroll: true });
    else items.current[0]?.focus({ preventScroll: true });
  }, [open, question]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = items.current.filter((r): r is HTMLButtonElement => r !== null);
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowDown" ? (at + 1) % rows.length : e.key === "ArrowUp" ? (at - 1 + rows.length) % rows.length : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    rows[to]?.focus();
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="ask-chief-trigger" data-coachmark="ask-chief" aria-haspopup="dialog" className={cn("shrink-0", className)} onPointerEnter={onIntent} onFocus={onIntent}>
          <span aria-hidden className="inline-flex">
            {renderAvatar(18)}
          </span>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-96 flex-col gap-2 p-2"
        aria-label={label}
        data-testid="ask-chief-panel"
        onOpenAutoFocus={(e) => {
          // The first question takes the focus, so the keyboard starts on the menu.
          if (!question) {
            e.preventDefault();
            items.current[0]?.focus();
          }
        }}
      >
        {question === null ? (
          <div role="menu" aria-label={label} className="flex flex-col" onKeyDown={onMenuKey} data-testid="ask-chief-menu">
            {CHIEF_QUESTIONS.map((q, i) => (
              <button
                key={q}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitem"
                data-question={q}
                className="flex min-h-control-md w-full items-center gap-2 rounded-sm px-2.5 text-left text-body text-primary transition-colors hover:bg-white/8 focus-visible:shadow-ring"
                onClick={() => pick(q)}
              >
                <MessageSquareText aria-hidden className="size-4 shrink-0 text-secondary" />
                {CHIEF_QUESTION_LABELS[q]}
              </button>
            ))}
            <button
              ref={(el) => {
                items.current[CHIEF_QUESTIONS.length] = el;
              }}
              type="button"
              role="menuitem"
              data-question="else"
              className="flex min-h-control-md w-full items-center gap-2 rounded-sm px-2.5 text-left text-body text-secondary transition-colors hover:bg-white/8 hover:text-primary focus-visible:shadow-ring"
              onClick={() => {
                change(false);
                onAskElse();
              }}
            >
              <MessageSquare aria-hidden className="size-4 shrink-0" />
              {CHIEF_ASK_ELSE_LABEL}
            </button>
          </div>
        ) : (
          <div ref={panel} tabIndex={-1} className="flex flex-col gap-3 p-1 outline-none" data-testid="ask-chief-answer" data-question={question} aria-label={`${name}: ${CHIEF_QUESTION_LABELS[question]}`} role="group">
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-flex shrink-0">
                {renderAvatar(28)}
              </span>
              <div className="min-w-0">
                <p className="text-body-strong truncate text-primary">{name}</p>
                <p className="t-data truncate">{CHIEF_QUESTION_LABELS[question]}</p>
              </div>
            </div>
            <div aria-live="polite" aria-busy={answer?.status === "loading" || answer === null} className="min-h-12">
              {!answer || answer.status === "loading" ? (
                <div className="flex flex-col gap-2" data-testid="ask-chief-loading">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-11/12" index={1} />
                  <Skeleton className="h-3.5 w-2/3" index={2} />
                  <span className="sr-only">{name} is looking.</span>
                </div>
              ) : answer.status === "error" ? (
                <div className="flex flex-col items-start gap-2" role="alert" data-testid="ask-chief-error">
                  <p className="text-body text-pretty text-primary">{answer.message || ASK_CHIEF_ERROR}</p>
                  {onRetry ? (
                    <Button variant="ghost" size="sm" icon={RotateCw} onClick={onRetry}>
                      Try again
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div data-testid="ask-chief-text">
                  <EntityText as="p" className="text-body text-pretty text-primary">
                    {answer.text}
                  </EntityText>
                </div>
              )}
            </div>
            <div className="-mb-0.5 flex items-center gap-1">
              <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => pick(null)}>
                Back
              </Button>
              <Button
                variant="default"
                size="sm"
                icon={MessageSquare}
                className="ml-auto"
                onClick={() => {
                  change(false);
                  onContinue(question);
                }}
              >
                Continue in chat
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
