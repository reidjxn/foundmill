import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadReceipt } from "./ReadReceipt";
import { deskAt } from "./fixtures";

const meta = {
  title: "Conversation/ReadReceipt",
  component: ReadReceipt,
  parameters: {
    docs: {
      description: {
        component:
          "Under the founder's last bubble: an icon and a word in mono text-3, so the state never rests on color.",
      },
    },
  },
  args: { state: "seen" },
} satisfies Meta<typeof ReadReceipt>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="flex flex-col items-end gap-3 p-gutter">
      <ReadReceipt state="sending" />
      <ReadReceipt state="seen" />
      <ReadReceipt state="seen" readAt={deskAt(1)} />
      <ReadReceipt state="failed" />
    </div>
  ),
};
