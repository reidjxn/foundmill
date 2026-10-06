import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton, SkeletonRows, SkeletonText } from "./Skeleton";

const meta = {
  title: "Foundation/Skeleton",
  component: Skeleton,
  parameters: { docs: { description: { component: "bg-panel-alt bars with a 1.6 s shimmer. Never a spinner inside a panel. Static under reduced motion." } } },
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Bar: Story = { args: { className: "w-48" } };
export const Circle: Story = { args: { shape: "circle", className: "size-8" } };
export const Text: Story = { render: () => <SkeletonText className="w-80" /> };
export const Rows: Story = { render: () => <SkeletonRows className="surface-panel w-128" /> };
export const PanelLoading: Story = {
  render: () => (
    <div className="surface-panel w-80 overflow-hidden">
      <div className="flex h-panel-header items-center border-b border-subtle bg-panel-alt px-3">
        <span className="t-label">Cash</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton shape="circle" className="size-6" />
          <Skeleton className="h-3 flex-1" />
        </div>
      </div>
    </div>
  ),
};
