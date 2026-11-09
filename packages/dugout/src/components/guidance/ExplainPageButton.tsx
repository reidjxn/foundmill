"use client";
/**
 * "Explain this page": the one quiet button that replaces a banner on every tab. A ghost/sm Button with a BookOpen that
 * opens a popover with the screen's three labeled lines (What this screen is for / What to do here / Watch for), an
 * optional "Show me an example" and Close. It shows only when a screen registered an explanation (`Explainer` ->
 * `PageExplainProvider`) and guidance is on and loaded. Opening it records the screen in
 * `account_preferences.explainers_seen` (`markExplainerSeen`): "the founder has read this page's explanation". Until
 * then a small dot on the button says there is something new to read. Nothing opens by itself. Escape closes it and the
 * focus goes back to the button (the popover primitive does both).
 */
import { useState, type ButtonHTMLAttributes } from "react";
import { BookOpen, Eye } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../foundation/Popover";
import { useGuidanceMode, useGuidanceProgress } from "./GuidanceProvider";
import { EXPLAINER_LABELS, usePageExplain, type PageExplainEntry } from "./PageExplain";

export const EXPLAIN_PAGE_LABEL = "Explain this page";

export interface ExplainTriggerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> {
  entry: PageExplainEntry;
}

/** The button and its panel for one entry; the shell's host and the Explainer's inline fallback both draw this. */
export function ExplainTrigger({ entry, className, ...rest }: ExplainTriggerProps) {
  const { guidance, loaded, markExplainerSeen } = useGuidanceMode();
  const { explainersSeen } = useGuidanceProgress();
  const [open, setOpen] = useState(false);
  // Local too: outside a provider (stories, tests) the action is a no-op and the dot still has to go.
  const [readHere, setReadHere] = useState<Record<string, true>>({});
  // Not before the account has answered: an account with guidance off never sees the button flash in and out.
  if (guidance !== "on" || !loaded) return null;
  const unread = explainersSeen[entry.screenId] !== true && !readHere[entry.screenId];
  const change = (next: boolean) => {
    setOpen(next);
    if (next) {
      setReadHere((r) => ({ ...r, [entry.screenId]: true }));
      markExplainerSeen(entry.screenId);
    }
  };
  const rows = [
    [EXPLAINER_LABELS.purpose, entry.purpose],
    [EXPLAINER_LABELS.action, entry.action],
    [EXPLAINER_LABELS.watchFor, entry.watchFor],
  ] as const;
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon={BookOpen}
          data-explainer={entry.screenId}
          data-coachmark="explainer"
          data-unread={unread ? "" : undefined}
          className={cn("relative", className)}
          {...rest}
        >
          {EXPLAIN_PAGE_LABEL}
          {unread ? (
            <>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-kit-lift" data-testid="explain-unread-dot" />
              <span className="sr-only">(new)</span>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-96 flex-col gap-3" aria-label={EXPLAIN_PAGE_LABEL} data-testid="explain-page-panel">
        <dl className="flex min-w-0 flex-col gap-2">
          {rows.map(([label, body]) => (
            <div key={label} className="min-w-0">
              <dt className="t-data">{label}</dt>
              <dd className="mt-0.5 text-body text-pretty text-primary">{body}</dd>
            </div>
          ))}
        </dl>
        <div className="-mb-1 -ml-2.5 flex flex-wrap items-center gap-1">
          {entry.onExample ? (
            <PopoverClose asChild>
              <Button variant="ghost" size="sm" icon={Eye} onClick={entry.onExample}>
                Show me an example
              </Button>
            </PopoverClose>
          ) : null}
          <PopoverClose asChild>
            <Button variant="ghost" size="sm" className="ml-auto">
              Close
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The shell's host: the page's one button, drawn when a screen registered an explanation. Renders nothing otherwise. */
export function ExplainPageButton(props: Omit<ExplainTriggerProps, "entry">) {
  const entry = usePageExplain();
  if (!entry) return null;
  return <ExplainTrigger key={entry.screenId} entry={entry} {...props} />;
}
