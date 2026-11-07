import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar } from "./ProgressBar";

const meta = {
  title: "Foundation/ProgressBar",
  component: ProgressBar,
  parameters: {
    docs: {
      description: {
        component: "A linear progress bar (Today's goal): a faint track and a round-capped fill in its tone. role=progressbar with aria-valuenow on the caller's own scale (a count, minor units) and the value in words. Always shown beside the figure in words.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96 p-4">
        <Story />
      </div>
    ),
  ],
  args: { value: 4, max: 10, label: "Goal progress", valueText: "4 of 10 paying customers", tone: "kit", size: "md" },
  argTypes: { tone: { control: "select", options: ["kit", "good", "warn", "bad", "gold"] }, size: { control: "inline-radio", options: ["sm", "md"] } },
} satisfies Meta<typeof ProgressBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const OnPace: Story = { args: { tone: "good" } };
export const Behind: Story = { args: { value: 2, tone: "warn" } };
export const Reached: Story = { args: { value: 10, tone: "gold" } };
export const Small: Story = { args: { size: "sm", value: 0.62, max: 1, valueText: undefined } };
