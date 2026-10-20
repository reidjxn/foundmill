"use client";
/**
 * The per-screen intro (docs/UX_AUDIT_AND_PLAN.md §6.2 `Explainer`): a surface-2 strip inside the first panel's body,
 * never floating and never pushing the 40 px header. A BookOpen in kit-lift, three data labels (What this screen is
 * for / What to do here / Watch for) each with one body line, a ghost "Got it" and an optional ghost "Show me an
 * example". After "Got it" it collapses to one line with a chevron; the screen is remembered in
 * `account_preferences.explainers_seen` through `markExplainerSeen`. Guidance off: not rendered.
 */
import { useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { BookOpen, Check, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { useGuidance } from "./GuidanceProvider";

export interface ExplainerProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The screen's stable id ("home", "inbox", "finance/runway"); the key in `explainersSeen`. */
  screenId: string;
  /** What this screen is for. */
  purpose: ReactNode;
  /** What to do here. */
  action: ReactNode;
  /** Watch for. */
  watchFor: ReactNode;
  /** "Show me an example": swaps the panel for a labeled example (ExampleToggle). Omitted: no button. */
  onExample?: () => void;
}

export const EXPLAINER_LABELS = { purpose: "What this screen is for", action: "What to do here", watchFor: "Watch for" } as const;

export function Explainer({ screenId, purpose, action, watchFor, onExample, className, ...rest }: ExplainerProps) {
  const { guidance, explainersSeen, markExplainerSeen } = useGuidance();
  const id = useId();
  // Local state too: outside a provider (stories, tests) the actions are no-ops, and "Got it" still has to collapse.
  const [dismissed, setDismissed] = useState(false);
  const [reopened, setReopened] = useState(false);
  if (guidance !== "on") return null;
  const seen = dismissed || explainersSeen[screenId] === true;
  const collapsed = seen && !reopened;
  const gotIt = () => {
    setDismissed(true);
    setReopened(false);
    markExplainerSeen(screenId);
  };

  if (collapsed)
    return (
      <section
        aria-labelledby={`${id}-title`}
        data-explainer={screenId}
        data-state="collapsed"
        className={cn("flex min-w-0 items-center gap-2 rounded-md bg-surface-2 py-1.5 pl-3 pr-1.5 text-primary", className)}
        {...rest}
      >
        <Icon icon={BookOpen} size="inline" className="text-kit-lift" />
        <span id={`${id}-title`} className="t-data shrink-0">
          {EXPLAINER_LABELS.purpose}
        </span>
        <span className="min-w-0 flex-1 text-small text-secondary text-pretty">{purpose}</span>
        <IconButton icon={ChevronDown} label="Show more about this screen" size="sm" aria-expanded={false} aria-controls={`${id}-body`} onClick={() => setReopened(true)} />
      </section>
    );

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-explainer={screenId}
      data-state="open"
      className={cn("flex min-w-0 gap-3 rounded-md bg-surface-2 p-3 text-primary", className)}
      {...rest}
    >
      <Icon icon={BookOpen} className="mt-0.5 text-kit-lift" />
      <div id={`${id}-body`} className="flex min-w-0 flex-1 flex-col gap-3">
        <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-2">
          <div className="min-w-0">
            <dt id={`${id}-title`} className="t-data">
              {EXPLAINER_LABELS.purpose}
            </dt>
            <dd className="mt-0.5 text-body text-pretty text-primary">{purpose}</dd>
          </div>
          <div className="min-w-0">
            <dt className="t-data">{EXPLAINER_LABELS.action}</dt>
            <dd className="mt-0.5 text-body text-pretty text-primary">{action}</dd>
          </div>
          <div className="min-w-0">
            <dt className="t-data">{EXPLAINER_LABELS.watchFor}</dt>
            <dd className="mt-0.5 text-body text-pretty text-primary">{watchFor}</dd>
          </div>
        </dl>
        <div className="-mb-1 -ml-2.5 flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" icon={Check} onClick={gotIt}>
            Got it
          </Button>
          {onExample ? (
            <Button variant="ghost" size="sm" icon={Eye} onClick={onExample}>
              Show me an example
            </Button>
          ) : null}
          {seen ? <IconButton icon={ChevronUp} label="Show less about this screen" size="sm" aria-expanded aria-controls={`${id}-body`} className="ml-auto" onClick={() => setReopened(false)} /> : null}
        </div>
      </div>
    </section>
  );
}
