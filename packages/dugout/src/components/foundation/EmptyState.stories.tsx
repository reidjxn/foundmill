import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, Plus, Users } from "lucide-react";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Foundation/EmptyState",
  component: EmptyState,
  args: { icon: Inbox, children: "Inbox items appear here after the first cycle. Press Space to continue." },
  argTypes: { icon: { control: false } },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithAction: Story = {
  args: {
    icon: Users,
    title: "No agents yet",
    children: "Hire your first agent and the Chief of Staff will plan the first cycle.",
    action: { label: "Hire agent", icon: Plus },
  },
};
export const InPanel: Story = {
  render: (args) => (
    <div className="surface-panel w-96">
      <div className="flex h-panel-header items-center border-b border-subtle bg-panel-alt px-3">
        <span className="t-label">Inbox preview</span>
      </div>
      <EmptyState {...args} />
    </div>
  ),
};
