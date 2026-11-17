"use client";
/**
 * FounderTaskPanel (Today, WP-04 T9): "Your one thing today", the one task the founder can finish in minutes (packages
 * shared founder-task.ts `founderTaskOf`: publish the page, share it, approve the plan, ask five people), its reason,
 * one button, and under a hairline what happens next. Once a task is done today it reads "Done for today." and names the
 * next one for tomorrow, with no button. One panel for every task: new tasks extend `FounderTaskId`, never a second panel.
 * The host renders it only when `today.get` › `founderTask` is set, first after Needs you, 12 columns at every width.
 */
import { CircleCheck, Copy, FileText, Globe, Share2 } from "lucide-react";
import { FOUNDER_TASK_WORDS, type FounderTask } from "@foundmill/shared/founder-task";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { Panel } from "../shell/Panel";
import type { GridSpan } from "../shell/types";

const ACTION_ICON = { open_page: Globe, share: Share2, open_note: FileText, copy: Copy } as const;

export interface FounderTaskPanelProps {
  task: FounderTask;
  /** The task's one button was pressed (open the page or the note, share or copy the message). */
  onAction?: (task: FounderTask) => void;
  /** The action is under way. */
  pending?: boolean;
  /** One line after the action, read out politely ("Message copied"). */
  status?: string | null;
  span?: GridSpan;
  className?: string;
}

export function FounderTaskPanel({ task, onAction, pending, status, span = 12, className }: FounderTaskPanelProps) {
  return (
    <Panel title={FOUNDER_TASK_WORDS.title} span={span} className={className} data-testid="founder-task" data-task={task.id} data-done-today={task.doneToday ? "" : undefined}>
      <div className="flex flex-col gap-3">
        {task.doneToday ? (
          <div className="flex flex-col gap-1">
            <p className="t-body-strong m-0 inline-flex items-center gap-2 text-primary" data-testid="founder-task-done">
              <Icon icon={CircleCheck} className="shrink-0 text-status-good" />
              {FOUNDER_TASK_WORDS.doneToday}
            </p>
            <p className="t-body m-0 text-secondary text-pretty" data-testid="founder-task-next">
              {FOUNDER_TASK_WORDS.tomorrowPrefix} {task.title}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 @page-wide:flex-row @page-wide:items-center @page-wide:justify-between @page-wide:gap-6">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="t-body-strong m-0 text-primary text-pretty" data-testid="founder-task-title">
                {task.title}
              </p>
              <p className="t-body m-0 text-secondary text-pretty">{task.why}</p>
            </div>
            <Button variant="primary" icon={ACTION_ICON[task.action.kind]} className="min-h-tap w-full shrink-0 @page-wide:w-auto" loading={pending} onClick={() => onAction?.(task)} data-testid="founder-task-action">
              {task.action.label}
            </Button>
          </div>
        )}
        {status ? (
          <p role="status" className="t-small m-0 text-secondary">
            {status}
          </p>
        ) : null}
        <p className="t-small m-0 border-t border-line pt-3 text-secondary text-pretty" data-testid="founder-task-tomorrow">
          {task.tomorrow}
        </p>
      </div>
    </Panel>
  );
}
