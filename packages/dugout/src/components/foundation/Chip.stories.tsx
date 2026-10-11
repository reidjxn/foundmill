import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cpu, Filter, Flag, Users } from "lucide-react";
import { Chip, DeptChip, ProvenanceChip } from "./Chip";

const meta = {
  title: "Foundation/Chip",
  component: Chip,
  args: { children: "Runway", tone: "neutral" },
  argTypes: { tone: { control: "select", options: ["neutral", "good", "warn", "bad", "info", "kit", "gold", "ink", "dept-1", "dept-2", "dept-3", "dept-4", "dept-5", "dept-6", "dept-7", "dept-8"] }, icon: { control: false } },
} satisfies Meta<typeof Chip>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

/** 22 px, sentence case, Inter 500 12: neutral on a 3.5% plate; tones on their 12% fill with a 30% ring. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Chip tone="neutral">Neutral</Chip>
      <Chip tone="good">Good</Chip>
      <Chip tone="warn">Warn</Chip>
      <Chip tone="bad">Bad</Chip>
      <Chip tone="info">Info</Chip>
      <Chip tone="kit">Brand</Chip>
      <Chip tone="gold" icon={Users}>
        Customer
      </Chip>
      <Chip tone="dept-3" icon={Flag}>
        Milestone
      </Chip>
      <Chip tone="ink" mono icon={Cpu}>
        claude-sonnet
      </Chip>
    </div>
  ),
};

/** Department chips: a neutral chip with the department's glowing dot. */
export const Departments: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["dept-1", "dept-2", "dept-3", "dept-4", "dept-5", "dept-6", "dept-7", "dept-8"] as const).map((d, i) => (
        <DeptChip key={d} dept={d}>
          {["Product", "Development", "Retail Partnerships", "Finance", "Team", "Legal", "Formulation Lab", "Research"][i]}
        </DeptChip>
      ))}
    </div>
  ),
};

/** "Not measured": the dashed 18 px chip with the word in full, at least 4 px from its figure; in reading prose, the word alone. */
export const Provenance: Story = {
  name: "Forecast / Estimate",
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="t-display-lg">
          <span className="t-currency">£</span>48,200
        </span>
        <ProvenanceChip kind="forecast" />
        <span className="ml-6 t-display-lg">
          11.4<span className="t-unit">mo</span>
        </span>
        <ProvenanceChip kind="estimate" />
        <ProvenanceChip kind="forecast" showIcon className="ml-6" />
      </div>
      <p className="t-reading">
        At 60% sell-through we clear £18,900 <ProvenanceChip kind="estimate" appearance="word" />, and batch 002 already covers the units.
      </p>
    </div>
  ),
};

/** Chips never truncate by default: in a squeezed cell the words wrap and the chip grows. With `fit` they step down, then truncate with a tooltip. */
export const InATightCell: Story = {
  render: () => (
    <div className="flex gap-6">
      <div className="flex w-28 flex-col gap-2 border border-dashed border-line p-2">
        <span className="t-data">Wraps</span>
        <DeptChip dept="dept-3">Retail Partnerships</DeptChip>
        <Chip>Organizations</Chip>
      </div>
      <div className="flex w-28 flex-col gap-2 border border-dashed border-line p-2">
        <span className="t-data">Fit</span>
        <DeptChip dept="dept-3" fit>
          Retail Partnerships
        </DeptChip>
        <Chip fit>Organizations</Chip>
      </div>
    </div>
  ),
};

export const Removable: Story = { args: { onRemove: () => {}, children: "Status: live", icon: Filter } };
export const Selectable: Story = {
  render: () => (
    <div className="flex gap-2">
      <Chip onClick={() => {}} selected>
        This week
      </Chip>
      <Chip onClick={() => {}}>This month</Chip>
      <Chip onClick={() => {}}>Quarter</Chip>
    </div>
  ),
};
