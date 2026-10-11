import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "../foundation/Avatar";
import { StatusPill } from "../foundation/StatusPill";
import { RightRail } from "./RightRail";

const meta = {
  title: "Shell/RightRail",
  component: RightRail,
  parameters: { layout: "fullscreen", docs: { description: { component: "Optional 320 px rail for hover-card details, the agent log or a decision preview. On the rail color with a hairline on its inner edge that catches light at the top; a 40 px header on its own surface (title style, a rule fading out under it). Collapses to a 32 px handle; 200 ms width transition." } } },
  args: { title: "Agent log", open: true, onOpenChange: () => {} },
} satisfies Meta<typeof RightRail>;
export default meta;
type Story = StoryObj<typeof meta>;

const LOG = [
  ["9:31:02 AM", "Forge", "Running packaging migration tests (12/40)"],
  ["9:30:48 AM", "Scout", "Drafted reply to Sara Lindqvist"],
  ["9:30:12 AM", "Beacon", "Paused Meta ad set: CPA +24%"],
  ["9:29:55 AM", "Ledger", "Categorized 42 transactions"],
  ["9:29:10 AM", "Clause", "Flagged exclusivity clause in influencer agreement"],
];

function Frame(args: Story["args"]) {
  const [open, setOpen] = useState(args?.open ?? true);
  return (
    <div className="flex h-screen bg-canvas">
      <div className="flex-1 p-4 text-small text-secondary">Content grid gets the width back when the rail collapses.</div>
      <RightRail {...args} open={open} onOpenChange={setOpen} actions={<StatusPill tone="good">Live</StatusPill>}>
        <ul className="flex flex-col gap-2">
          {LOG.map(([t, who, line]) => (
            <li key={t} className="flex items-start gap-2">
              <Avatar name={who as string} size={20} agent={{ seed: who as string, dept: "dept-2" }} />
              <span className="flex min-w-0 flex-col">
                <span className="text-small text-secondary">
                  <span className="font-mono">{t}</span> · {who}
                </span>
                <span className="text-body">{line}</span>
              </span>
            </li>
          ))}
        </ul>
      </RightRail>
    </div>
  );
}

export const Open: Story = { render: (args) => <Frame {...args} /> };
export const Collapsed: Story = { args: { open: false }, render: (args) => <Frame {...args} /> };
