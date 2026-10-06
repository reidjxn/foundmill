import type { Meta, StoryObj } from "@storybook/react-vite";
import { AGENT_STATUSES, DEPT_COLOUR_TOKENS } from "@founder-manager/shared";
import { AVATAR_SIZES, Avatar, AvatarStack } from "./Avatar";

const meta = {
  title: "Foundation/Avatar",
  component: Avatar,
  args: { name: "Scout", agent: { seed: "scout", dept: "dept-3" }, status: "healthy", size: 32 },
  argTypes: { size: { control: "select", options: AVATAR_SIZES }, status: { control: "select", options: AGENT_STATUSES } },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Agent: Story = {};
export const Human: Story = { args: { name: "Ada Lovelace", agent: undefined, status: undefined } };
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-3">
      {AVATAR_SIZES.map((s) => (
        <Avatar key={s} {...args} size={s} />
      ))}
      {AVATAR_SIZES.map((s) => (
        <Avatar key={`h${s}`} name="Ada Lovelace" size={s} />
      ))}
    </div>
  ),
};
export const StatusRings: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {AGENT_STATUSES.map((s) => (
        <div key={s} className="flex flex-col items-center gap-1">
          <Avatar name={s} agent={{ seed: s, dept: "dept-1" }} status={s} size={48} />
          <span className="text-small text-secondary">{s}</span>
        </div>
      ))}
    </div>
  ),
};
export const DepartmentPalettes: Story = {
  render: () => (
    <div className="grid grid-cols-8 gap-3">
      {DEPT_COLOUR_TOKENS.map((d) =>
        [1, 2, 3].map((n) => <Avatar key={`${d}-${n}`} name={`${d} ${n}`} agent={{ seed: `${d}-${n}`, dept: d }} size={48} />),
      )}
    </div>
  ),
};
export const Stack: Story = {
  render: () => (
    <AvatarStack
      size={24}
      max={5}
      items={Array.from({ length: 8 }, (_, i) => ({ name: `Agent ${i + 1}`, agent: { seed: `a${i}`, dept: "dept-2" as const }, status: i % 3 === 0 ? ("degraded" as const) : ("healthy" as const) }))}
    />
  ),
};
