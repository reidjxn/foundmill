import { Circle, CircleCheck, CircleMinus, CirclePlay, FlaskConical, ListChecks } from "lucide-react";
import { cn } from "../../lib/cn";
import { Chip } from "../foundation/Chip";
import { EmptyState } from "../foundation/EmptyState";
import { Icon, type IconComponent } from "../foundation/Icon";
import type { PlanStep, PlanStepState, TestSummary } from "./types";

const STEP: Record<PlanStepState, { icon: IconComponent; word: string; className: string }> = {
  done: { icon: CircleCheck, word: "Done", className: "text-status-good" },
  active: { icon: CirclePlay, word: "In progress", className: "text-status-info" },
  todo: { icon: Circle, word: "To do", className: "text-secondary" },
  skipped: { icon: CircleMinus, word: "Skipped", className: "text-secondary" },
};

export interface PlanViewProps {
  plan: readonly PlanStep[];
  tests?: TestSummary;
  className?: string;
}

/** Plan body: the agent's checklist with done / active / to-do states and the acceptance-test tally underneath. */
export function PlanView({ plan, tests, className }: PlanViewProps) {
  const done = plan.filter((s) => s.state === "done").length;
  if (plan.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center bg-panel", className)}>
        <EmptyState icon={ListChecks}>The plan appears once the agent has read the task and written its steps.</EmptyState>
      </div>
    );
  }
  const acc = tests?.acceptance ?? null;
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-panel", className)}>
      <div className="flex h-panel-header shrink-0 items-center justify-between border-b border-subtle px-panel-pad">
        <span className="t-label">Plan</span>
        <span className="text-small text-secondary tabular-nums">
          {done} of {plan.length} steps
        </span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto py-1">
        {plan.map((step, i) => {
          const s = STEP[step.state];
          return (
            <li
              key={step.id}
              aria-current={step.state === "active" ? "step" : undefined}
              data-state={step.state}
              className={cn("flex min-h-row-compact items-start gap-2 px-panel-pad py-1 text-body", step.state === "active" ? "bg-white/4 text-primary" : step.state === "done" ? "text-secondary" : "text-primary")}
            >
              <Icon icon={s.icon} size="inline" className={cn("mt-0.5", s.className)} label={s.word} />
              <span className="w-4 shrink-0 text-right text-small text-secondary tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">{step.text}</span>
              {step.state === "active" ? <Chip tone="info">{s.word}</Chip> : step.state === "skipped" ? <Chip tone="neutral">{s.word}</Chip> : null}
            </li>
          );
        })}
      </ol>
      {tests ? (
        <div className="flex shrink-0 flex-col gap-1 border-t border-subtle px-panel-pad py-2 text-small">
          <div className="flex items-center gap-1.5 text-primary">
            <Icon icon={FlaskConical} size="inline" className="text-secondary" />
            {acc ? (
              <span className="tabular-nums">
                Acceptance tests: {acc.passed} of {acc.passed + acc.failed} passing
              </span>
            ) : (
              <span className="text-secondary">Acceptance tests have not run yet</span>
            )}
          </div>
          {acc && acc.failures.length > 0 ? (
            <ul className="ml-5 list-disc text-status-bad">
              {acc.failures.slice(0, 3).map((f) => (
                <li key={f} className="truncate" title={f}>
                  {f}
                </li>
              ))}
              {acc.failures.length > 3 ? <li className="text-secondary">+{acc.failures.length - 3} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
