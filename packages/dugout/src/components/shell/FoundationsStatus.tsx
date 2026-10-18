import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ArrowRight, BookOpen, CircleCheck, CircleDashed, CircleX, LoaderCircle, Map as MapIcon, RotateCcw, ScrollText } from "lucide-react";
import { Button } from "../foundation/Button";
import { Icon, type IconComponent } from "../foundation/Icon";
import { ProgressRing } from "../foundation/ProgressRing";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Panel } from "./Panel";
import type { GridSpan } from "./types";

/** pending → drafting → ready | failed (a failed draft is retried). Pending reads as drafting: it starts on the first open. */
export type FoundationsState = "pending" | "drafting" | "ready" | "failed";

export interface FoundationsStatusProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  state: FoundationsState;
  /** What the drafting reads, e.g. "From your idea and your founder profile." */
  basis?: ReactNode;
  /** Ready: one line on what was written ("10 sections · 11 roadmap items"). */
  summary?: ReactNode;
  /** Failed: the reason, in plain words. */
  error?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  /** Ready: the way in (e.g. the Vision tab). */
  onOpen?: () => void;
  openLabel?: string;
  /** Ready: the status line, when the default ("Your vision, specification and roadmap are drafted.") is not the whole story. */
  readyLine?: ReactNode;
  /** Ready: a second way in beside `onOpen` (e.g. the Inbox, where the sign-off notes wait). */
  secondaryAction?: { label: string; onClick: () => void };
  /** Columns on a PageGrid. */
  span?: GridSpan;
  /** Panel title. */
  heading?: ReactNode;
}

const PILL: Record<FoundationsState, { tone: StatusTone; word: string; icon: IconComponent }> = {
  pending: { tone: "info", word: "Drafting", icon: LoaderCircle },
  drafting: { tone: "info", word: "Drafting", icon: LoaderCircle },
  ready: { tone: "good", word: "Ready", icon: CircleCheck },
  failed: { tone: "bad", word: "Not drafted", icon: CircleX },
};

const PARTS: { label: string; icon: IconComponent }[] = [
  { label: "Vision", icon: BookOpen },
  { label: "Specification", icon: ScrollText },
  { label: "Roadmap", icon: MapIcon },
];

export const DRAFTING_LINE = "Drafting your vision, specification and roadmap…";
export const READY_LINE = "Your vision, specification and roadmap are drafted.";

/**
 * The state of a new business's foundations (BUILD §11.1 first open, §11.5): drafting with an indeterminate ring and the
 * three parts, ready with the way in, or failed with the reason and Try again. A panel like any other (DESIGN §3, §8);
 * the body is a polite live region so the change to ready or failed is announced once.
 */
export const FoundationsStatus = forwardRef<HTMLElement, FoundationsStatusProps>(function FoundationsStatus(
  { state, basis, summary, error, onRetry, retrying, onOpen, openLabel = "Open the vision", readyLine, secondaryAction, span, heading = "Vision, specification and roadmap", className, ...rest },
  ref,
) {
  const pill = PILL[state];
  const drafting = state === "pending" || state === "drafting";
  return (
    <Panel
      ref={ref}
      title={heading}
      span={span}
      glow={drafting ? "brand" : undefined}
      data-foundations-state={state}
      actions={
        <StatusPill tone={pill.tone} icon={pill.icon} pulse={drafting}>
          {pill.word}
        </StatusPill>
      }
      className={className}
      {...rest}
    >
      <div role="status" aria-live="polite" className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {drafting ? <ProgressRing indeterminate size={20} strokeWidth={2} tone="kit" label="Drafting" /> : <Icon icon={state === "ready" ? CircleCheck : CircleX} size={20} className={state === "ready" ? "text-status-good" : "text-status-bad"} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-body-strong text-primary">{drafting ? DRAFTING_LINE : state === "ready" ? (readyLine ?? READY_LINE) : "The drafting did not finish."}</p>
          {drafting && basis ? <p className="text-small text-secondary">{basis}</p> : null}
          {state === "ready" && summary ? <p className="text-small text-secondary tabular-nums">{summary}</p> : null}
          {state === "failed" && error ? <p className="text-small text-status-bad">{error}</p> : null}
          {drafting ? (
            <>
              <ul className="flex flex-wrap items-center gap-3" aria-label="Being drafted">
                {PARTS.map((p) => (
                  <li key={p.label} className="inline-flex items-center gap-1.5 text-small text-secondary">
                    <Icon icon={CircleDashed} size="inline" />
                    <Icon icon={p.icon} size="inline" />
                    {p.label}
                  </li>
                ))}
              </ul>
              <p className="text-small text-secondary">You can keep working. This updates by itself when they are ready.</p>
            </>
          ) : null}
          {state === "ready" && (onOpen || secondaryAction) ? (
            <div className="flex flex-wrap items-center gap-2">
              {onOpen ? (
                <Button size="sm" variant="default" iconRight={ArrowRight} onClick={onOpen} data-foundations-open>
                  {openLabel}
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={secondaryAction.onClick} data-foundations-secondary>
                  {secondaryAction.label}
                </Button>
              ) : null}
            </div>
          ) : null}
          {state === "failed" && onRetry ? (
            <div>
              <Button size="sm" variant="default" icon={RotateCcw} loading={retrying} onClick={onRetry} data-foundations-retry>
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
});

/** Whether a foundations state should be shown as a banner (everything but a settled ready). */
export function foundationsNeedsAttention(state: FoundationsState | "none" | null | undefined): state is "pending" | "drafting" | "failed" {
  return state === "pending" || state === "drafting" || state === "failed";
}

export const FOUNDATIONS_STATES = ["pending", "drafting", "ready", "failed"] as const satisfies readonly FoundationsState[];
