import type { Meta, StoryObj } from "@storybook/react-vite";
import { Building2, Bot, Inbox, Search, User, Users } from "lucide-react";
import { Icon } from "./Icon";

const meta = {
  title: "Foundation/Icon",
  component: Icon,
  args: { icon: Search, size: "default" },
  argTypes: { icon: { control: false }, size: { control: "select", options: ["inline", "default", "empty", "lg"] } },
} satisfies Meta<typeof Icon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4 text-primary">
      {(["inline", "default", "empty", "lg"] as const).map((s) => (
        <div key={s} className="flex flex-col items-center gap-1">
          <Icon icon={Inbox} size={s} />
          <span className="text-small text-secondary">{s}</span>
        </div>
      ))}
    </div>
  ),
};
export const EntityKinds: Story = {
  render: () => (
    <div className="flex gap-4 text-link">
      <span className="inline-flex items-center gap-1">
        <Icon icon={User} size="inline" /> Person
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon icon={Building2} size="inline" /> Organization
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon icon={Bot} size="inline" /> Agent
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon icon={Users} size="inline" /> Community
      </span>
    </div>
  ),
};
