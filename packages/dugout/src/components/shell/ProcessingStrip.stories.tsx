import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProcessingStrip } from "./ProcessingStrip";
import { NORTHWIND_SEGMENTS } from "./fixtures";

const meta = {
  title: "Shell/ProcessingStrip",
  component: ProcessingStrip,
  parameters: { layout: "fullscreen", docs: { description: { component: "3 px under the top bar, on ink with 2 px gaps: one segment per department in its color, its width its share of agent-minutes. A working department carries a bright head traveling its segment every 1.6 s with an 8 px glow (staggered, never in step); a department idle during a running cycle is dim; at rest every segment holds its color quietly. Reduced motion: the head rests mid-segment." } } },
  args: { segments: NORTHWIND_SEGMENTS, active: true },
} satisfies Meta<typeof ProcessingStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const AtRest: Story = { args: { active: false } };
export const Magnified: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4 p-4">
      <ProcessingStrip {...args} />
      <p className="t-label">Same strip at 8× height, for inspection</p>
      <ProcessingStrip {...args} style={{ height: 24 }} />
    </div>
  ),
};
