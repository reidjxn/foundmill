"use client";
import type { HTMLAttributes } from "react";
import { ArrowUpRight } from "lucide-react";
import { TEAM_CALL_WORDS, teamCallActionsLine, type TeamCallActionStatus, type TeamCallActionView, type TeamCallParticipantView } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Panel } from "../shell/Panel";
import { useCallAgentDisplay } from "./identity";

/** The chip per status: filed is done, awaiting is the founder's go-ahead, yours to do is a step, not filed is neutral. */
export const CALL_ACTION_STATUS: Record<TeamCallActionStatus, { tone: StatusTone; word: string }> = {
  filed: { tone: "good", word: "Filed" },
  awaiting_go_ahead: { tone: "warn", word: TEAM_CALL_WORDS.awaiting },
  founder_step: { tone: "info", word: TEAM_CALL_WORDS.founderStep },
  not_filed: { tone: "neutral", word: TEAM_CALL_WORDS.notFiled },
};

const TARGET_WORD = { task: "Open task", roadmap_item: "Open roadmap item", plan: "Open plan to confirm" } as const;

/** Where "Open" goes for an action: its target, else the plan it waits in. */
export function actionTarget(a: Pick<TeamCallActionView, "target" | "planId">): { kind: "task" | "roadmap_item" | "plan"; id: string } | null {
  return a.target ?? (a.planId ? { kind: "plan", id: a.planId } : null);
}

export interface CallActionGroup {
  /** Null: business-wide actions. */
  departmentId: string | null;
  name: string;
  actions: TeamCallActionView[];
}

/** Actions grouped by department, in the order a department first appears; business-wide actions last. */
export function groupCallActions(actions: readonly TeamCallActionView[], departmentName: (departmentId: string) => string, wholeProject = "Across the project"): CallActionGroup[] {
  const groups = new Map<string | null, CallActionGroup>();
  for (const a of actions) {
    const g = groups.get(a.departmentId) ?? { departmentId: a.departmentId, name: a.departmentId ? departmentName(a.departmentId) : wholeProject, actions: [] };
    g.actions.push(a);
    groups.set(a.departmentId, g);
  }
  const all = [...groups.values()];
  return [...all.filter((g) => g.departmentId !== null), ...all.filter((g) => g.departmentId === null)];
}

export interface CallWrapUpProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  summary: string | null;
  actions: readonly TeamCallActionView[];
  /** A department's name, read from the department by the caller (never hard-coded here). */
  departmentName: (departmentId: string) => string;
  /** The agents on the call, to name who does each action (optional). */
  participants?: readonly TeamCallParticipantView[];
  /** Opens a task, a roadmap item or the plan to confirm. */
  onOpenTarget?: (target: { kind: "task" | "roadmap_item" | "plan"; id: string }, action: TeamCallActionView) => void;
}

/**
 * The ended call: the summary, then what the team will do grouped by department with a status chip on each action
 * (filed, needs your go-ahead, yours to do, not filed), the reason when there is one, a link to where it went, and the
 * one-line count (`teamCallActionsLine`) in the header.
 */
export function CallWrapUp({ summary, actions, departmentName, participants = [], onOpenTarget, className, ...rest }: CallWrapUpProps) {
  const display = useCallAgentDisplay();
  const byId = new Map(participants.map((p) => [p.agentId, p] as const));
  const groups = groupCallActions(actions, departmentName);
  return (
    <div className={cn("flex flex-col gap-gutter", className)} data-testid="call-wrapup" {...rest}>
      <Panel title="What was discussed" glow="brand">
        <p className="max-w-[var(--reading-measure)] whitespace-pre-line text-reading text-primary" data-testid="call-summary">
          {summary ?? "No summary was written."}
        </p>
      </Panel>
      <Panel title={TEAM_CALL_WORDS.actionsHeading} meta={<span data-testid="call-actions-line">{teamCallActionsLine(actions)}</span>} flush>
        {groups.length === 0 ? <p className="px-panel-pad py-3 text-body text-secondary">{teamCallActionsLine(actions)}</p> : null}
        {groups.map((g) => (
          <section key={g.departmentId ?? "project"} aria-label={g.name} className="border-t border-subtle first:border-t-0" data-testid="call-action-group">
            <h3 className="t-data px-panel-pad pb-1 pt-3" data-testid="call-group-name">
              {g.name}
            </h3>
            <ul>
              {g.actions.map((a) => {
                const s = CALL_ACTION_STATUS[a.status];
                const target = actionTarget(a);
                const owner = a.agentId ? byId.get(a.agentId) : undefined;
                return (
                  <li key={a.id} className="flex items-start gap-3 px-panel-pad py-2" data-testid="call-action" data-status={a.status}>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-body font-medium text-primary">{a.title}</span>
                      {a.detail ? <span className="text-small text-secondary">{a.detail}</span> : null}
                      {a.reason ? <span className="text-small text-tertiary">{a.reason}</span> : null}
                      {owner ? <span className="text-small text-tertiary">{display(owner).label}</span> : null}
                    </div>
                    <StatusPill tone={s.tone} data-testid="call-action-status">
                      {s.word}
                    </StatusPill>
                    {target && onOpenTarget ? (
                      <Button variant="ghost" size="sm" iconRight={ArrowUpRight} onClick={() => onOpenTarget(target, a)} aria-label={`${TARGET_WORD[target.kind]}: ${a.title}`}>
                        {TARGET_WORD[target.kind]}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Panel>
    </div>
  );
}
