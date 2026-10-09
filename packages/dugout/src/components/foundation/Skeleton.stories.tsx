import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton, SkeletonRows, SkeletonText } from "./Skeleton";

const meta = {
  title: "Foundation/Skeleton",
  component: Skeleton,
  parameters: {
    docs: {
      description: {
        component:
          "Surface-2 bars with a 100° light band every 1.6 s. Bars in a group are numbered (`index`, or `stagger-N`) so the band runs down a card 60 ms a bar instead of flashing all at once. Never a spinner inside a panel. A flat bar under reduced motion. Server-safe.",
      },
    },
  },
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Bar: Story = { args: { className: "w-48" } };
export const Circle: Story = { args: { shape: "circle", className: "size-8" } };
export const Text: Story = { render: () => <SkeletonText className="w-80" /> };
export const Rows: Story = { render: () => <SkeletonRows className="surface-panel w-128" /> };
/** A card's skeleton keeps the real anatomy and names its queue; the band runs top to bottom. */
export const StaggeredCard: Story = {
  render: () => (
    <div className="surface-panel flex w-80 flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" index={0} className="size-control-lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton index={1} className="h-4 w-2/3" />
          <Skeleton index={2} className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={3} start={3} />
      <p className="text-small text-tertiary">Queued for Teodor · 3rd</p>
    </div>
  ),
};
export const PanelLoading: Story = {
  render: () => (
    <div className="surface-panel w-80 overflow-hidden">
      <div className="flex h-panel-header items-center px-3 rule-fade">
        <span className="t-title">Cash</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <Skeleton index={0} className="h-7 w-32" />
        <Skeleton index={1} className="h-4 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton shape="circle" index={2} className="size-6" />
          <Skeleton index={2} className="h-3 flex-1" />
        </div>
      </div>
    </div>
  ),
};
