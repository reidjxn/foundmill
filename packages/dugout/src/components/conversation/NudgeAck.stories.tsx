import type { Meta, StoryObj } from "@storybook/react-vite";
import { NudgeAck } from "./NudgeAck";

const meta = {
  title: "Conversation/NudgeAck",
  component: NudgeAck,
  parameters: {
    docs: {
      description: {
        component:
          "One bubble from the agent after a nudge: its portrait and a short acknowledgement in its own voice (`voice.ack`), in its department's tint. Instant and deterministic: no model call.",
      },
    },
  },
  args: { name: "Backend Engineer", avatarSeed: "be-1", dept: "dept-2", text: "Understood.", nudge: "Focus on tests" },
} satisfies Meta<typeof NudgeAck>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Other voices and departments. */
export const Voices: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4 p-gutter">
      <NudgeAck name="Formulation Chemist" avatarSeed="fc" dept="dept-7" text="Noted." />
      <NudgeAck name="Influencer engine" avatarSeed="ie" dept="dept-3" text="On it — I'll keep it on brand." />
      <NudgeAck name="Chief of Staff" avatarSeed="cos" text="Clear." />
    </div>
  ),
};
