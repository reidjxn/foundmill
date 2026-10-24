import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { TaskStatus } from "@foundmill/shared";
import { TaskRunState, type TaskRunStateProps } from "./TaskRunState";

const meta = {
  title: "Agents/TaskRunState",
  component: TaskRunState,
  parameters: { layout: "padded" },
  args: { status: "planned" },
  argTypes: { onRun: { action: "run" }, onResume: { action: "resume" } },
} satisfies Meta<typeof TaskRunState>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Planned, ready, stopped, failed, or blocked with nothing left to wait for: a Play button, "Run now". */
export const RunNow: Story = { args: { status: "ready" } };

/** A spinning indicator and "Running now"; the spin stops on a legible frame under reduced motion. */
export const Running: Story = { args: { status: "running" } };

/** A paused task resumes with one press. */
export const Paused: Story = { args: { status: "paused" } };

/** A clock, not a button: the tooltip and accessible name say "Runs after Subscription pause and skip finishes". */
export const RunsAfter: Story = { args: { status: "planned", waitingOn: ["Subscription pause and skip"] } };

export const RunsAfterSeveral: Story = { args: { status: "blocked", waitingOn: ["Subscription pause and skip", "Billing webhooks", "Customer portal"] } };

/** Blocked, but every dependency is done: it can run now. */
export const BlockedButFree: Story = { args: { status: "blocked", waitingOn: [] } };

export const InReview: Story = { args: { status: "review" } };
export const Merging: Story = { args: { status: "merging" } };
export const Done: Story = { args: { status: "done" } };

/** The press is in flight: the button shows its busy state. */
export const Pending: Story = { args: { status: "ready", pending: true } };

/** The "Next" row in the Dependencies panel: the label as words, the button beside it. */
export const AsText: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      <TaskRunState {...args} status="ready" variant="text" />
      <TaskRunState {...args} status="paused" variant="text" />
      <TaskRunState {...args} status="running" variant="text" />
      <TaskRunState {...args} status="planned" waitingOn={["Subscription pause and skip", "Billing webhooks"]} variant="text" />
      <TaskRunState {...args} status="review" variant="text" />
      <TaskRunState {...args} status="merging" variant="text" />
      <TaskRunState {...args} status="done" variant="text" />
    </div>
  ),
};

const STATES: { status: TaskStatus; waitingOn?: string[] }[] = [
  { status: "running" },
  { status: "paused" },
  { status: "planned", waitingOn: ["Subscription pause and skip"] },
  { status: "ready" },
  { status: "failed" },
  { status: "review" },
  { status: "merging" },
  { status: "done" },
];

function CellDemo(args: TaskRunStateProps) {
  const [log, setLog] = useState<string>("Press a Play button.");
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1 rounded-panel bg-surface-1 p-2">
        {STATES.map((s, i) => (
          <li key={i} className="flex h-control-sm w-72 items-center gap-2 text-body">
            <span className="w-11 shrink-0 text-center">
              <TaskRunState {...args} status={s.status} waitingOn={s.waitingOn} onRun={() => setLog(`Run now: task ${i + 1}`)} onResume={() => setLog(`Resume: task ${i + 1}`)} />
            </span>
            <span className="text-secondary">{s.status}</span>
          </li>
        ))}
      </ul>
      <p className="text-small text-secondary" role="status">
        {log}
      </p>
    </div>
  );
}

/** Every state as it sits in the Plan table's 44 px "Run" column. */
export const InTheRunColumn: Story = { render: (args) => <CellDemo {...args} /> };
