import type { Meta, StoryObj } from "@storybook/react-vite";
import { StarRating } from "./StarRating";

const meta = {
  title: "Foundation/StarRating",
  component: StarRating,
  args: { value: 3.5, label: "Current ability" },
  argTypes: { value: { control: { type: "range", min: 0, max: 5, step: 0.5 } }, potential: { control: { type: "range", min: 0, max: 5, step: 0.5 } } },
} satisfies Meta<typeof StarRating>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};
/** With a potential the caption reads "Now 2.5 · could reach 4.5" once, and the tooltip says the same. */
export const CurrentAndPotential: Story = { args: { value: 2.5, potential: 4.5, showValue: true } };
export const Ladder: Story = {
  render: () => (
    <div className="flex flex-col gap-1">
      {[0, 0.5, 1, 2.5, 4, 5].map((v) => (
        <div key={v} className="flex items-center gap-3">
          <StarRating value={v} potential={5} />
          <span className="font-mono text-mono text-secondary">{v}</span>
        </div>
      ))}
    </div>
  ),
};
export const Large: Story = { args: { value: 4, potential: 5, size: 20 } };
