import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Chip, DeptChip } from "./Chip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./HoverCard";
import { StatusPill } from "./StatusPill";

const meta = {
  title: "Foundation/HoverCard",
  component: HoverCard,
  parameters: { docs: { description: { component: "Opens after 300 ms, then fades and rises 4 px over 160 ms (DESIGN §7). 320 px wide." } } },
} satisfies Meta<typeof HoverCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EntityPreview: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a href="#scout" className="text-link">
          Scout
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex items-start gap-3">
          <Avatar name="Scout" size={48} agent={{ seed: "scout", dept: "dept-3" }} status="healthy" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="t-display-sm">Scout</div>
            <div className="flex flex-wrap gap-1">
              <Chip tone="neutral">Agent</Chip>
              <DeptChip dept="dept-3">Distribution</DeptChip>
              <StatusPill tone="good">Healthy</StatusPill>
            </div>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            ["Rating", "14"],
            ["Tasks", "42"],
            ["Model", "Sonnet"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="t-label">{k}</dt>
              <dd className="t-body-strong tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex gap-2">
          <Button size="sm">Message</Button>
          <Button size="sm" variant="ghost">
            Open profile
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};
