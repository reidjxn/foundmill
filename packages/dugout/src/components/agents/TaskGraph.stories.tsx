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

/** Formation view: the Planner's task graph colored by status (icon + word), layered locally. Wheel zooms, drag pans, + − 0 and arrows on the keyboard. */
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

/** A hundred independent tasks: the layer wraps into side-by-side columns of eight, and the graph opens at a readable zoom at the top left. */
export const ManyIndependentTasks: Story = {
  args: {
    nodes: Array.from({ length: 100 }, (_, i) => ({
      id: `t${i}`,
      title: ["Monthly management accounts", "Customer interview synthesis", "Creator seeding round", "Stability check on serum batch"][i % 4]! + ` #${Math.floor(i / 4) + 1}`,
      status: (["done", "running", "planned", "blocked"] as const)[i % 4]!,
      deps: [],
    })),
    height: 520,
  },
  render: (args) => (
    <div style={{ width: 1100 }}>
      <TaskGraph {...args} />
    </div>
  ),
};
