import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Tooltip, TooltipProvider } from "./Tooltip";

const meta = {
  title: "Foundation/Tooltip",
  component: Tooltip,
  args: { content: "Tested 15 · Proven 13 · 42 tasks", children: <Button>Hover or focus me</Button> },
  argTypes: { side: { control: "inline-radio", options: ["top", "right", "bottom", "left"] } },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sides: Story = {
  render: () => (
    <TooltipProvider>
      <div className="flex gap-3">
        {(["top", "right", "bottom", "left"] as const).map((s) => (
          <Tooltip key={s} content={`Side: ${s}`} side={s}>
            <Button variant="ghost">{s}</Button>
          </Tooltip>
        ))}
        <IconButton icon={Info} label="Information, not legal or tax advice" />
      </div>
    </TooltipProvider>
  ),
};
