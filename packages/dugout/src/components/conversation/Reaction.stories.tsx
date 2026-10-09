import type { Meta, StoryObj } from "@storybook/react-vite";
import { AGENT_REACTIONS } from "@foundmill/shared";
import { Reaction } from "./Reaction";

const meta = {
  title: "Conversation/Reaction",
  component: Reaction,
  parameters: {
    docs: {
      description: {
        component:
          "The agent's reaction to a founder message: a Lucide icon disc in the agent's colour on the bubble's corner, never an emoji. Concerned always uses the warning tone.",
      },
    },
  },
  args: { reaction: "noted", by: "Juno", dept: "dept-3" },
} satisfies Meta<typeof Reaction>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Each reaction on a founder bubble. */
export const All: Story = {
  render: (args) => (
    <div className="flex flex-col items-end gap-6 p-gutter">
      {AGENT_REACTIONS.filter((r) => r !== "none").map((r) => (
        <div key={r} className="desk-bubble" data-author="founder">
          {r === "thinking"
            ? "Why not split it and wait for the serum review?"
            : r === "concerned"
              ? "Can we pay Pennine on 90 days?"
              : r === "pleased"
                ? "Yes, ask for 45 days"
                : "What if only 40% sells through?"}
          <Reaction {...args} reaction={r} />
        </div>
      ))}
    </div>
  ),
};
