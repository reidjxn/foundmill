import type { Meta, StoryObj } from "@storybook/react-vite";
import { kitStyle } from "./KitBar";
import { StopAllAgents } from "./StopAllAgents";
import { NORTHWIND_KIT } from "./fixtures";

const meta = {
  title: "Shell/StopAllAgents",
  component: StopAllAgents,
  parameters: { backgrounds: { value: "panel" }, docs: { description: { component: "The kill switch (BUILD §5.4): visible on every screen — on the top bar a 34 px glass square with the octagon in a light red that warms toward red on hover — confirms in a dialog, shows loading until onConfirm settles, keeps the dialog open with the error if it fails. Nothing is deleted." } } },
  args: { onConfirm: () => new Promise<void>((r) => setTimeout(r, 1200)), runningCount: 7 },
} satisfies Meta<typeof StopAllAgents>;
export default meta;
type Story = StoryObj<typeof meta>;

export const IconTrigger: Story = {
  decorators: [
    (Story) => (
      <div className="kitbar-slab inline-flex rounded-md p-3 text-kit-on-primary" style={kitStyle(NORTHWIND_KIT)}>
        <Story />
      </div>
    ),
  ],
};
export const ButtonTrigger: Story = { args: { variant: "button", className: undefined } };
export const Fails: Story = { args: { onConfirm: () => Promise.reject(new Error("The orchestrator did not answer in 10 s. Sessions may still be running.")) } };
export const WithDetail: Story = {
  args: {
    children: (
      <ul className="text-small text-secondary">
        <li>Forge · packaging schema change (implementing)</li>
        <li>Scout · Nordic Beauty AB reply (review)</li>
        <li>Pixel · bundle picker screenshots (testing)</li>
      </ul>
    ),
    runningCount: 3,
  },
};
