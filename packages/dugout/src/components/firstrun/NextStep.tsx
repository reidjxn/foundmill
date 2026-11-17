"use client";
/**
 * NextStep (docs/UX_AUDIT_AND_PLAN.md §6.2, §7.8): the data-driven strip on Home (and in a RightRail where one exists)
 * that says what to do next. A `t-data` label ("Next step"), then one to three rows: a numbered disc (a CircleCheck in
 * status-good once done), the line in `t-body`, and a ghost "Go" with an arrow. "Go" is a link through the shell link
 * renderer (ShellLinkProvider), so an href becomes the app's router link, or a button when the step has an action.
 * With one row the strip is a single line; the number carries nothing alone, so a lone row has no disc unless done.
 * Guidance off: nothing renders (the Day one milestones stay, they are information). Rows come from `nextStepsFor`.
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, buttonVariants } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { useGuided } from "../guidance/GuidanceProvider";
import { Term } from "../guidance/Term";
import { useShellLink } from "../shell/ShellLink";
import type { NextStepItem } from "./nextSteps";

export interface NextStepProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** One to three rows (more are cut to three: the strip is a nudge, not a list). */
  steps: readonly NextStepItem[];
  /** The `t-data` label; default "Next step". */
  title?: ReactNode;
  /** Tighter rows (28 px) for a rail. */
  compact?: boolean;
}

const MAX_ROWS = 3;

/** The ghost "Go": a link when the step has a route, a button when it has an action, nothing when it has neither. */
function Go({ step, label }: { step: NextStepItem; label: string }) {
  const renderLink = useShellLink();
  const className = cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-secondary hover:text-primary");
  if (step.href) {
    return (
      <>
        {renderLink({
          href: step.href,
          className,
          "aria-label": label,
          children: (
            <>
              Go
              <Icon icon={ArrowRight} size="inline" />
            </>
          ),
        })}
      </>
    );
  }
  if (step.onGo) {
    return (
      <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={step.onGo} aria-label={label}>
        Go
      </Button>
    );
  }
  return null;
}

/** A step's line; "Cycle 3 is running" (nextSteps.ts `cycleRunningLine`) leads with the defined word as a `Term`. */
function StepLabel({ label }: { label: string }) {
  const m = /^Cycle\b/.exec(label);
  if (!m) return <>{label}</>;
  return (
    <>
      <Term id="cycle">Round of work</Term>
      {label.slice(m[0].length)}
    </>
  );
}

function Disc({ n, done }: { n: number; done: boolean }) {
  if (done) return <Icon icon={CircleCheck} size="default" className="text-status-good" label="Done" />;
  return (
    <span aria-hidden className="inline-flex size-badge shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-micro text-secondary tabular">
      {n}
    </span>
  );
}

export function NextStep({ steps, title = "Next step", compact, className, ...rest }: NextStepProps) {
  const guided = useGuided();
  if (!guided || steps.length === 0) return null;
  const rows = steps.slice(0, MAX_ROWS);
  const single = rows.length === 1;
  const rowClass = cn("flex min-w-0 items-center gap-2", compact ? "min-h-control-sm" : "min-h-control-md");

  const row = (step: NextStepItem, i: number) => {
    const done = !!step.done;
    return (
      <li key={step.id} className={rowClass} data-next-step-row={step.id} data-done={done || undefined}>
        {single && !done ? null : <Disc n={i + 1} done={done} />}
        <span className={cn("t-body min-w-0 flex-1 text-pretty", done ? "text-tertiary" : "text-primary")}>
          <StepLabel label={step.label} />
        </span>
        {done ? null : <Go step={step} label={`Go: ${step.label}`} />}
      </li>
    );
  };

  return (
    <div className={cn("flex min-w-0 gap-2", single ? "flex-wrap items-center" : "flex-col", className)} data-next-step="" data-rows={rows.length} {...rest}>
      <span className={cn("t-data shrink-0", single ? "self-center" : "")}>{title}</span>
      <ol className={cn("m-0 flex min-w-0 list-none flex-col p-0", single && "flex-1")}>{rows.map(row)}</ol>
    </div>
  );
}
