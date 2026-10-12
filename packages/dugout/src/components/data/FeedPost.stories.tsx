import type { Meta, StoryObj } from "@storybook/react-vite";
import { Clock, Flag, MoreHorizontal, Trash2 } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Icon } from "../foundation/Icon";
import { FeedPost } from "./FeedPost";

// Relative to the clock, so "5 min ago" reads right whenever the story is opened.
const NOW = Date.now();
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

/** The post's own controls (a More menu: report, edit, delete, a moderator's hide) and status chips about the post. */
export const WithActionsAndStatus: Story = {
  render: (args) => (
    <div className="surface-panel w-[560px]">
      <FeedPost
        {...args}
        status={
          <>
            <Chip tone="neutral">Edited</Chip>
            <Chip tone="warn" icon={Clock}>
              Held for review
            </Chip>
          </>
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="More for this post" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Icon icon={Flag} size="inline" /> Report
              </DropdownMenuItem>
              <DropdownMenuItem variant="danger">
                <Icon icon={Trash2} size="inline" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        replyCount={0}
        onReply={() => undefined}
      />
    </div>
  ),
};

export const NoReplies: Story = {
  render: (args) => (
    <div className="surface-panel w-[560px]">
      <FeedPost {...args} replyCount={0} onToggleReplies={() => undefined} onReply={() => undefined} />
    </div>
  ),
};
