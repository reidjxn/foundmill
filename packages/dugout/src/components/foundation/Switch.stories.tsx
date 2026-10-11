import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "./Label";
import { Switch } from "./Switch";

const meta = {
  title: "Foundation/Switch",
  component: Switch,
  args: { "aria-label": "Offline tracking", size: "md" },
  argTypes: { size: { control: "inline-radio", options: ["sm", "md"] } },
} satisfies Meta<typeof Switch>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const Small: Story = { args: { size: "sm", defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };
/** Both sizes, off and on: 28 × 16 and 36 × 20; the pearl thumb springs across. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Switch size="sm" aria-label="Small off" />
      <Switch size="sm" defaultChecked aria-label="Small on" />
      <Switch aria-label="Medium off" />
      <Switch defaultChecked aria-label="Medium on" />
    </div>
  ),
};
export const Labeled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="auto" defaultChecked />
      <Label htmlFor="auto" className="text-body text-primary">
        Let agents merge to main without asking
      </Label>
    </div>
  ),
};
