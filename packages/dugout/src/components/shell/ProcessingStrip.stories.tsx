import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProcessingStrip } from "./ProcessingStrip";
import { NORTHWIND_SEGMENTS } from "./fixtures";

const meta = {
  title: "Shell/ProcessingStrip",
  component: ProcessingStrip,
  parameters: { layout: "fullscreen", docs: { description: { component: "3 px under the top bar. One segment per department in its colour; active segments shimmer with a 1.6 s sweep while a cycle runs. Reduced motion leaves them at full colour." } } },
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
