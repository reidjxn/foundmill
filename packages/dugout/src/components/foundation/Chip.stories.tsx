import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cpu, Filter } from "lucide-react";
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
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Chip tone="neutral">Neutral</Chip>
      <Chip tone="good">Good</Chip>
      <Chip tone="warn">Warn</Chip>
      <Chip tone="bad">Bad</Chip>
      <Chip tone="info">Info</Chip>
      <Chip tone="kit">Kit</Chip>
      <Chip tone="gold">Gold</Chip>
      <Chip tone="ink" mono icon={Cpu}>
        claude-sonnet
      </Chip>
    </div>
  ),
};
export const Departments: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["dept-1", "dept-2", "dept-3", "dept-4", "dept-5", "dept-6", "dept-7", "dept-8"] as const).map((d, i) => (
        <DeptChip key={d} dept={d}>
          {["Product", "Development", "Distribution", "Finance", "Team", "Legal", "Ops", "Research"][i]}
        </DeptChip>
      ))}
    </div>
  ),
};
export const Provenance: Story = {
  name: "Forecast / Estimate",
  render: () => (
    <div className="flex items-center gap-3">
      <span className="t-display-lg tabular-nums">€48,200</span>
      <ProvenanceChip kind="forecast" />
      <span className="t-display-lg tabular-nums">11.4 mo</span>
      <ProvenanceChip kind="estimate" />
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
