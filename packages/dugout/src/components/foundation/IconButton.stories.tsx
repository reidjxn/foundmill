import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pin, Settings, Square, X } from "lucide-react";
import { IconButton } from "./IconButton";

const meta = {
  title: "Foundation/IconButton",
  component: IconButton,
  args: { icon: Settings, label: "Settings", variant: "ghost", size: "md" },
  argTypes: {
    icon: { control: false },
    variant: { control: "select", options: ["primary", "default", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
} satisfies Meta<typeof IconButton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Ghost: Story = {};
export const Default: Story = { args: { variant: "default" } };
export const StopAllAgents: Story = { args: { icon: Square, label: "Stop all agents", variant: "danger" } };
export const Pressed: Story = { args: { icon: Pin, label: "Pinned to Home", pressed: true } };
export const Small: Story = { args: { icon: X, label: "Close", size: "sm" } };
export const Loading: Story = { args: { loading: true, label: "Refreshing" } };
