import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { PostReadyNote } from "./PostReadyNote";

const meta = {
  title: "Today/PostReadyNote",
  component: PostReadyNote,
  parameters: {
    docs: { description: { component: "One quiet line on Today while a post the team wrote waits for the founder to share it, pointing at the post on Customers › Creative. An offer: no badge, no color. It goes when the post is shared or set aside." } },
  },
  decorators: [
    (Story) => (
      <PageGrid>
        <Story />
      </PageGrid>
    ),
  ],
  args: { href: "#creative", span: 12 },
} satisfies Meta<typeof PostReadyNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** More than one waits (the caps allow two in a day): still one line. */
export const TwoWaiting: Story = { args: { waiting: 2 } };
