"use client";
import { Check, Clock, Eye, GitMerge, LoaderCircle, Play } from "lucide-react";
import type { TaskStatus } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Tooltip } from "../foundation/Tooltip";

/**
 * Whether a task is running, can be run, or runs after another task (Development › Plan). One state per task, worked out
 * from its status and the tasks it still waits on, so the founder never has to read a graph to know what happens next.
 */
export type TaskRunKind = "running" | "paused" | "waiting" | "startable" | "review" | "merging" | "done";

export interface TaskRunInfo {
  kind: TaskRunKind;
  /** Short label: the button's name, the cell's aria-label and tooltip, the text in the "Next" row. */
  label: string;
  /** The full sentence (tooltip and accessible name). The label itself, except for a task that waits ("Runs after X finishes"). */
  sentence: string;
}

/** The first open dependency by name, then "and N more". */
function waitingLabel(waitingOn: readonly string[]): { label: string; sentence: string } {
  const [first = "another task", ...rest] = waitingOn;
  const more = rest.length;
  const label = `Runs after ${first}${more > 0 ? ` and ${more} more` : ""}`;
  const sentence = `Runs after ${first}${more > 0 ? ` and ${more} more finish` : " finishes"}`;
  return { label, sentence };
}

/**
 * The run state of a task. `waitingOn` holds the titles of the tasks it depends on whose status is not `done` (first
 * one first). A task that is running, paused, in review, merging or done keeps that state whatever it waits on; a
 * planned, ready or blocked task with an open dependency waits; every other task (planned, ready, stopped, failed, or
 * blocked with nothing left to wait for) can be run now. This is the same rule the API applies when starting a task.
 */
export function taskRunInfo(status: TaskStatus, waitingOn: readonly string[] = []): TaskRunInfo {
  switch (status) {
    case "running":
      return { kind: "running", label: "Running now", sentence: "Running now" };
    case "paused":
      return { kind: "paused", label: "Resume", sentence: "Resume" };
    case "review":
      return { kind: "review", label: "In review", sentence: "In review" };
    case "merging":
      return { kind: "merging", label: "Merging", sentence: "Merging" };
    case "done":
      return { kind: "done", label: "Done", sentence: "Done" };
    default:
      if (waitingOn.length > 0) return { kind: "waiting", ...waitingLabel(waitingOn) };
      return { kind: "startable", label: "Run now", sentence: "Run now" };
  }
}

/** Whether the task can be started now (the rule behind "Run now" and the row menu's Start). */
export function canStartTask(status: TaskStatus, waitingOn: readonly string[] = []): boolean {
  return taskRunInfo(status, waitingOn).kind === "startable";
}

const KIND_ICON: Record<TaskRunKind, IconComponent> = {
  running: LoaderCircle,
  paused: Play,
  waiting: Clock,
  startable: Play,
  review: Eye,
  merging: GitMerge,
  done: Check,
};

/** Tone of the glyph when it is not a button: color never carries the state alone (icon and words do). */
const KIND_TONE: Record<TaskRunKind, string> = {
  running: "text-kit-lift",
  paused: "text-secondary",
  waiting: "text-tertiary",
  startable: "text-secondary",
  review: "text-status-info",
  merging: "text-status-info",
  done: "text-status-good",
};

export interface TaskRunStateProps {
  /** The task's status. */
  status: TaskStatus;
  /** Titles of the tasks it depends on that are not done, first one first. Empty or omitted when it waits on nothing. */
  waitingOn?: readonly string[];
  /** Runs the task ("Run now"). Without it a startable task shows no button (read-only). */
  onRun?: () => void;
  /** Resumes a paused task ("Resume"). Without it a paused task shows no button (read-only). */
  onResume?: () => void;
  /** The run or resume call is in flight: the button shows its busy state and ignores presses. */
  pending?: boolean;
  /**
   * `icon` (default): one 24 px target, the label as its accessible name and tooltip; fits a 44 px table column.
   * `text`: the label as words, with the button beside it when there is something to press.
   */
  variant?: "icon" | "text";
  className?: string;
}

/**
 * The run state of one task: a spinner while it runs, a Play button to run it or resume it, a clock with "Runs after X"
 * while it waits on another task, and an eye, merge or check once it is in review, merging or done. Keyboard: the
 * button is a native button (Tab, Enter, Space); the other states are read-only and carry their words as the accessible
 * name. Under prefers-reduced-motion the spinner rests on a legible frame (the global rule in dugout.css).
 */
export function TaskRunState({ status, waitingOn = [], onRun, onResume, pending = false, variant = "icon", className }: TaskRunStateProps) {
  const info = taskRunInfo(status, waitingOn);
  const action = info.kind === "startable" ? onRun : info.kind === "paused" ? onResume : undefined;
  const glyph = KIND_ICON[info.kind];

  const button = action ? (
    <IconButton
      size="sm"
      icon={glyph}
      label={info.label}
      loading={pending}
      // 24 px (`--target-size`), the same target as the table's "…" button.
      className="size-target text-secondary"
      data-run-action={info.kind}
      onClick={(e) => {
        e.stopPropagation();
        if (!pending) action();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  ) : null;

  if (variant === "text") {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-2", className)} data-run-state={info.kind}>
        {button ? null : <Icon icon={glyph} size="default" className={cn(KIND_TONE[info.kind], info.kind === "running" && "animate-spin")} />}
        <span className="min-w-0 text-body" title={info.sentence}>
          {info.label}
        </span>
        {button}
      </span>
    );
  }

  if (button) {
    return (
      <span className={cn("inline-flex items-center justify-center", className)} data-run-state={info.kind}>
        {button}
      </span>
    );
  }

  // Read-only states: a glyph with the words as its accessible name and tooltip.
  return (
    <Tooltip content={info.sentence}>
      <span role="img" aria-label={info.sentence} className={cn("inline-flex size-target items-center justify-center", KIND_TONE[info.kind], className)} data-run-state={info.kind}>
        <Icon icon={glyph} size="default" className={info.kind === "running" ? "animate-spin" : undefined} />
      </span>
    </Tooltip>
  );
}
