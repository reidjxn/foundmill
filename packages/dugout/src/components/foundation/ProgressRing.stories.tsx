import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressRing } from "./ProgressRing";

const meta = {
  title: "Foundation/ProgressRing",
  component: ProgressRing,
  args: { value: 0.62, size: 16, tone: "kit" },
  argTypes: { value: { control: { type: "range", min: 0, max: 1, step: 0.01 } }, tone: { control: "select", options: ["current", "kit", "good", "warn", "bad", "gold"] } },
} satisfies Meta<typeof ProgressRing>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Indeterminate: Story = { args: { indeterminate: true } };
export const Large: Story = { args: { size: 48, strokeWidth: 4, value: 0.8, tone: "good" } };
/** A running process is a light source: `glow` adds a soft glow in the ring's color. */
export const Running: Story = { args: { size: 20, strokeWidth: 2.5, value: 0.35, tone: "kit", glow: true } };
export const Steps: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <div key={v} className="flex items-center gap-1">
          <ProgressRing value={v} tone="kit" />
          <span className="font-mono text-mono text-secondary">{Math.round(v * 100)}%</span>
        </div>
      ))}
    </div>
  ),
};
