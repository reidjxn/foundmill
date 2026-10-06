import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogoMark } from "./LogoMark";

const meta = {
  title: "Foundation/LogoMark",
  component: LogoMark,
  args: { size: 32, label: "Founder Manager", tone: "duo" },
  argTypes: { tone: { control: "inline-radio", options: ["mono", "duo"] } },
} satisfies Meta<typeof LogoMark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4 text-primary">
      {[16, 24, 32, 48, 96].map((s) => (
        <LogoMark key={s} size={s} />
      ))}
      <LogoMark size={48} tone="mono" className="text-secondary" />
    </div>
  ),
};
