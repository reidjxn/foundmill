import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "./Button";

const meta = {
  title: "Foundation/Button",
  component: Button,
  args: { children: "Continue", variant: "default", size: "md" },
  argTypes: {
    variant: { control: "select", options: ["primary", "default", "ghost", "danger", "gold"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
    icon: { control: false },
    iconRight: { control: false },
  },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary", children: "Continue" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Swap content" } };
export const Danger: Story = { args: { variant: "danger", children: "Stop all agents", icon: Trash2 } };
export const Small: Story = { args: { size: "sm", children: "Pin to Home" } };
export const WithIcon: Story = { args: { icon: Plus, children: "Hire agent" } };
export const WithTrailingIcon: Story = { args: { iconRight: ArrowRight, children: "Go to Journey", variant: "gold" } };
export const Loading: Story = { args: { loading: true, children: "Executing" } };
export const Disabled: Story = { args: { disabled: true, children: "Unavailable" } };

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["md", "sm"] as const).map((size) => (
        <div key={size} className="flex items-center gap-2">
          <Button size={size} variant="primary" icon={Play}>
            Continue
          </Button>
          <Button size={size} variant="default">
            Default
          </Button>
          <Button size={size} variant="ghost">
            Ghost
          </Button>
          <Button size={size} variant="danger" icon={Pause}>
            Pause
          </Button>
          <Button size={size} variant="gold">
            Match Day
          </Button>
          <Button size={size} loading>
            Loading
          </Button>
          <Button size={size} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};
