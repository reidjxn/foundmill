import type { Meta, StoryObj } from "@storybook/react-vite";
import { NarrowWindowNote } from "./NarrowWindowNote";

const meta = {
  title: "Shell/NarrowWindowNote",
  component: NarrowWindowNote,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "One line over the console between 640 and 1279 px, where the window scrolls sideways instead of showing NeedsLargerWindow (founder decision 3, Nov 16, 2026). Dismissed once per session." } },
  },
  args: { onDismiss: () => undefined },
} satisfies Meta<typeof NarrowWindowNote>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
