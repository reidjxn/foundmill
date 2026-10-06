import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./Separator";

const meta = { title: "Foundation/Separator", component: Separator } satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64 text-body">
      <p>Home</p>
      <Separator className="my-2" />
      <p className="t-label">Live</p>
      <p>Network</p>
      <Separator className="my-2" faint />
      <p>Communities</p>
    </div>
  ),
};
export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-3 text-small text-secondary">
      <span>12.4K tokens</span>
      <Separator orientation="vertical" />
      <span>$0.19</span>
      <Separator orientation="vertical" />
      <span>ETA 4 min</span>
    </div>
  ),
};
