import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "../foundation/Avatar";
import { StatusPill } from "../foundation/StatusPill";
import { RightRail } from "./RightRail";

const meta = {
  title: "Shell/RightRail",
  component: RightRail,
  parameters: { layout: "fullscreen", docs: { description: { component: "Optional 320 px rail for hover-card details, the agent log or a decision preview. Collapses to a 32 px handle; 200 ms width transition." } } },
  args: { title: "Agent log", open: true, onOpenChange: () => {} },
} satisfies Meta<typeof RightRail>;
export default meta;
type Story = StoryObj<typeof meta>;

const LOG = [
  ["09:31:02", "Forge", "Running packaging migration tests (12/40)"],
  ["09:30:48", "Scout", "Drafted reply to Sara Lindqvist"],
  ["09:30:12", "Beacon", "Paused Meta ad set: CPA +24 %"],
  ["09:29:55", "Ledger", "Categorised 42 transactions"],
  ["09:29:10", "Clause", "Flagged exclusivity clause in influencer agreement"],
];

function Frame(args: Story["args"]) {
  const [open, setOpen] = useState(args?.open ?? true);
  return (
    <div className="flex h-screen bg-base">
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
