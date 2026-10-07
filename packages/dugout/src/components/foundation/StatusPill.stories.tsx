import type { Meta, StoryObj } from "@storybook/react-vite";
import { AGENT_STATUSES } from "@foundmill/shared";
import { AgentStatusPill, StatusPill } from "./StatusPill";

const meta = {
  title: "Foundation/StatusPill",
  component: StatusPill,
  args: { tone: "good", children: "Healthy" },
  argTypes: { tone: { control: "inline-radio", options: ["good", "warn", "bad", "info", "neutral"] }, icon: { control: false } },
} satisfies Meta<typeof StatusPill>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Good: Story = {};
export const AllTones: Story = {
  render: () => (
    <div className="flex gap-2">
      <StatusPill tone="good">Healthy</StatusPill>
      <StatusPill tone="warn">Degraded</StatusPill>
      <StatusPill tone="bad">Failing</StatusPill>
      <StatusPill tone="info">Scheduled</StatusPill>
      <StatusPill tone="neutral">Idle</StatusPill>
    </div>
  ),
};
export const AgentStatuses: Story = {
  render: () => (
    <div className="flex gap-2">
      {AGENT_STATUSES.map((s) => (
        <AgentStatusPill key={s} status={s} />
      ))}
    </div>
  ),
};
export const Pulse: Story = { args: { tone: "info", children: "Processing", pulse: true } };
