import { Term } from "../guidance/Term";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GraduationCap, MessageSquare, Pause } from "lucide-react";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { AgentStatusPill } from "../foundation/StatusPill";
import { ProfileHeader } from "./ProfileHeader";

const meta = {
  title: "Shell/ProfileHeader",
  component: ProfileHeader,
  parameters: { layout: "fullscreen", docs: { description: { component: "96 px on the canvas with a rule fading out under it: avatar or logo 64 px, name display-md, role and kind chips, three key facts as data-label + value pairs, actions right, model chip (mono) and current/potential stars (DESIGN §8). The name never gives way: the facts shrink and wrap first, then the name steps its size down." } } },
  args: {
    avatar: <Avatar name="Scout" size={64} agent={{ seed: "scout", dept: "dept-3" }} status="healthy" />,
    name: "Scout",
    chips: [
      { label: "Agent", tone: "neutral" },
      { label: "Distribution lead", tone: "dept-3" },
    ],
    status: <AgentStatusPill status="healthy" />,
    facts: [
      { label: "Rating", value: "14" },
      { label: "Tasks", value: "42" },
      { label: "Wage / month", value: "€120", provenance: "estimate" },
    ],
    model: "sonnet",
    stars: { current: 3, potential: 4.5 },
    actions: (
      <>
        <Button size="sm" icon={MessageSquare}>
          Message
        </Button>
        <Button size="sm" icon={GraduationCap}>
          Train
        </Button>
        <Button size="sm" variant="ghost" icon={Pause}>
          Pause
        </Button>
      </>
    ),
  },
} satisfies Meta<typeof ProfileHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Agent: Story = {};
/** A fact label can be a Term on the screen's first mention of a defined word; `id` keys it. */
export const DefinedFactLabels: Story = {
  args: {
    facts: [
      { id: "line-manager", label: <Term id="line_manager">Line manager</Term>, value: "Chief of Staff" },
      { label: "Tasks", value: "42" },
      { id: "wage", label: <Term id="wage">AI cost (USD)</Term>, value: "$120", provenance: "estimate" },
    ],
  },
};
export const Person: Story = {
  args: {
    avatar: <Avatar name="Sara Lindqvist" size={64} />,
    name: "Sara Lindqvist",
    chips: [{ label: "Person" }, { label: "Head of buying" }, { label: "Customer", tone: "good" }],
    status: undefined,
    facts: [
      { label: "Organization", value: "Nordic Beauty AB" },
      { label: "Relationship", value: "16 / 20" },
      { label: "Last touch", value: "2 days ago" },
    ],
    model: undefined,
    stars: { current: 4 },
    actions: (
      <Button size="sm" icon={MessageSquare}>
        Message
      </Button>
    ),
  },
};
export const Organization: Story = {
  args: {
    avatar: <BusinessLogo name="Nordic Beauty AB" primary="#2B6CB0" monogram="NB" size={64} />,
    name: "Nordic Beauty AB",
    chips: [{ label: "Organization" }, { label: "Retailer" }, { label: "Stockholm" }],
    status: undefined,
    facts: [
      { label: "Orders", value: "4" },
      { label: "Revenue (12 mo)", value: "€18,400" },
      { label: "Owner", value: "Scout" },
    ],
    model: undefined,
    stars: undefined,
    actions: undefined,
  },
};
/** A long agent name beside three facts and three actions at the 1280 window: the facts give way first. */
export const LongNameAt1280: Story = {
  name: "Long name at 1280",
  args: { name: "Sourcing and Manufacturing Specialist" },
  decorators: [
    (Story) => (
      <div style={{ width: 1048 }}>
        <Story />
      </div>
    ),
  ],
};
