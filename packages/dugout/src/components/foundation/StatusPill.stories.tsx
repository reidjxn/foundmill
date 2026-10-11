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

/** Icon + word, 22 px, fully round, sentence case: the tone's text on its 12% fill with a 30% ring. */
export const AllTones: Story = {
  render: () => (
    <div className="flex gap-2">
      <StatusPill tone="good">Healthy</StatusPill>
      <StatusPill tone="warn">Degraded</StatusPill>
      <StatusPill tone="bad">Needs you</StatusPill>
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

/** One ring pulse in the pill's own tone (re-mount to replay): a red pill pulses red, never the brand. */
export const Pulse: Story = {
  render: () => (
    <div className="flex gap-3">
      <StatusPill tone="info" pulse>
        Processing
      </StatusPill>
      <StatusPill tone="bad" pulse>
        Respond
      </StatusPill>
      <StatusPill tone="warn" pulse>
        Waiting
      </StatusPill>
    </div>
  ),
};

/** Never truncated by default (the words wrap); `fit` for a fixed table cell. */
export const InATightCell: Story = {
  render: () => (
    <div className="flex gap-6">
      <div className="w-24 border border-dashed border-line p-2">
        <StatusPill tone="warn">Waiting on supplier</StatusPill>
      </div>
      <div className="w-24 border border-dashed border-line p-2">
        <StatusPill tone="warn" fit>
          Waiting on supplier
        </StatusPill>
      </div>
    </div>
  ),
};
