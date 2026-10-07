import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { mockTaskGraph } from "./mock";
import { TaskGraph, type TaskGraphProps } from "./TaskGraph";

const meta = {
  title: "Agents/TaskGraph",
  component: TaskGraph,
  parameters: { layout: "padded" },
  args: { nodes: mockTaskGraph(), height: 520 },
  argTypes: { nodes: { control: false } },
} satisfies Meta<typeof TaskGraph>;
export default meta;
type Story = StoryObj<typeof meta>;

function FormationDemo(args: TaskGraphProps) {
  const [selected, setSelected] = useState<string | null>("task-5");
  return (
    <div className="w-[1100px]">
      <TaskGraph {...args} selectedId={selected} onSelect={setSelected} />
      <p className="mt-2 text-small text-secondary">Selected: {selected ?? "none"}</p>
    </div>
  );
}

/** Formation view: the Planner's task graph coloured by status (icon + word), layered locally. Wheel zooms, drag pans, + − 0 and arrows on the keyboard. */
export const Formation: Story = { render: (args) => <FormationDemo {...args} /> };

export const Linear: Story = {
  args: {
    nodes: ["Plan", "Schema", "Repo functions", "API", "UI", "Tests", "Review"].map((title, i) => ({
      id: `l${i}`,
      title,
      status: i < 3 ? "done" : i === 3 ? "running" : "planned",
      deps: i ? [`l${i - 1}`] : [],
      progress: i < 3 ? 1 : i === 3 ? 0.4 : 0,
    })),
    height: 240,
  },
};

export const Empty: Story = { args: { nodes: [], height: 200 } };
