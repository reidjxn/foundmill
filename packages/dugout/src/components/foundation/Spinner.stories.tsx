import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "./Spinner";

const meta = {
  title: "Foundation/Spinner",
  component: Spinner,
  parameters: {
    docs: {
      description: {
        component: "For buttons and inline controls only (a busy Save, a refresh). Panels, lists and cards load with Skeleton. Stops under reduced motion; the label still says Loading.",
      },
    },
  },
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const InlineInText: Story = {
  render: () => (
    <span className="inline-flex items-center gap-1.5 text-small text-secondary">
      <Spinner size="inline" decorative />
      Refreshing
    </span>
  ),
};
