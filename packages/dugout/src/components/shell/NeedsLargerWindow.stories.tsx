import type { Meta, StoryObj } from "@storybook/react-vite";
import { NeedsLargerWindow } from "./NeedsLargerWindow";

const meta = {
  title: "Shell/NeedsLargerWindow",
  component: NeedsLargerWindow,
  parameters: { layout: "fullscreen", docs: { description: { component: "Centered and mark-less (no business logo, no Foundmill mark), display-md title, body line with the minimum width, the current width in mono (DESIGN §8). Rendered alone below 1280 px." } } },
  args: { width: 1279 },
} satisfies Meta<typeof NeedsLargerWindow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const At1279: Story = {};
export const Unmeasured: Story = { args: { width: undefined } };
export const Tablet: Story = { args: { width: 1024 } };
