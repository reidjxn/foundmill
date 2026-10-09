import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { Chip } from "../foundation/Chip";
import { FeedPost } from "./FeedPost";

const NOW = new Date("2026-10-09T10:00:00Z").getTime();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const meta = {
  title: "Data/FeedPost",
  component: FeedPost,
  parameters: { layout: "padded" },
  args: {
    author: "Jamie Reyes",
    at: at(95),
    badge: <Chip tone="neutral">Ledgerly</Chip>,
    children: "We moved first-touch to outbound for UK fintechs and the time to first reply halved.",
  },
} satisfies Meta<typeof FeedPost>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="surface-panel w-[560px]">
      <FeedPost {...args} />
    </div>
  ),
};

/** The replies toggle is a disclosure; the thread nests under the post. */
function RepliesDemo(args: ComponentProps<typeof FeedPost>) {
  const [open, setOpen] = useState(true);
  return (
    <div className="surface-panel w-[560px]">
      <FeedPost
        {...args}
        replyCount={2}
        repliesOpen={open}
        onToggleReplies={() => setOpen((o) => !o)}
        onReply={() => undefined}
        thread={
          open ? (
            <>
              <FeedPost author="Priya Nair" at={at(60)}>
                Which countries did you start with?
              </FeedPost>
              <FeedPost author="Jamie Reyes" at={at(20)}>
                UK and Ireland first, then Germany.
              </FeedPost>
            </>
          ) : null
        }
      />
    </div>
  );
}

export const WithReplies: Story = { render: (args) => <RepliesDemo {...args} /> };

export const NoReplies: Story = {
  render: (args) => (
    <div className="surface-panel w-[560px]">
      <FeedPost {...args} replyCount={0} onToggleReplies={() => undefined} onReply={() => undefined} />
    </div>
  ),
};
