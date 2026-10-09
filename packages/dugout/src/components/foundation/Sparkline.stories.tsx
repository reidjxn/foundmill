import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRng } from "../../lib/seed";
import { Sparkline } from "./Sparkline";

const rng = createRng("sparkline");
const series = Array.from({ length: 24 }, (_, i) => 40 + i * 1.5 + rng.range(-8, 8));

const meta = {
  title: "Foundation/Sparkline",
  component: Sparkline,
  args: { data: series, className: "text-kit-lift" },
} satisfies Meta<typeof Sparkline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Filled: Story = { args: { fill: true, dot: true, width: 96, height: 24 } };
export const Linear: Story = { args: { linear: true, className: "text-status-good" } };
export const Flat: Story = { args: { data: [5, 5, 5, 5, 5], className: "text-secondary" } };
export const InATile: Story = {
  render: () => (
    <div className="surface-panel flex w-56 items-end justify-between p-3">
      <div className="flex flex-col">
        <span className="t-data">Revenue</span>
        <span className="t-display-lg">
          <span className="t-currency">€</span>12,480
        </span>
        <span className="text-small text-status-good">▲ 8.2%</span>
      </div>
      <Sparkline data={series} fill dot className="text-kit-lift" width={48} height={16} label="Revenue, 24 weeks, rising" />
    </div>
  ),
};
